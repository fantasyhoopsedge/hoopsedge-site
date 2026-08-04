/**
 * Build the canonical player registry — Phase 1 of docs/player-identity-layer.md.
 *
 *   npm run identity:build              # compute, write the JSON artifact + Supabase
 *   npm run identity:build -- --dry-run # compute + report only, no writes anywhere
 *
 * ── What it does ────────────────────────────────────────────────────────────
 * Merges every id space FHE touches into one row per human:
 *
 *   nba_players               ESPN athlete ids (the spine, ~882 rows)
 *   src/lib/nba-player-ids.json   NBA Stats ids (~587, headshot lookups)
 *   data/player-ids/bbm-players.csv   Basketball Monster ids (~1005) + NBA Stats ids
 *   data/player-ids/espn-ids.csv      approved ESPN ids for name-only players
 *   nba_roster                dob / draft year / draft pick — the disambiguators
 *   dynasty-rankings.json     prospects who exist nowhere else yet
 *
 * ── Why the merge order matters ─────────────────────────────────────────────
 * Sources are merged strongest-evidence-first. A provider id shared by two
 * sources is an EXACT join and can never be wrong; a name is a guess that is
 * usually right. So BBM is merged after nba-player-ids.json specifically because
 * by then ~587 identities already carry an NBA Stats id, and 673 of BBM's 1,005
 * players carry one too — those merge by id, not by name. Reordering these calls
 * silently downgrades exact joins to name joins.
 *
 * ── fhe_id stability ────────────────────────────────────────────────────────
 * Ids are minted sequentially, but only for humans the registry has never seen.
 * Every run first loads the previous registry and re-attaches its ids by
 * provider id or name, so `fhe_000412` means the same person forever. Rebuilding
 * from scratch after deleting the artifact WILL renumber everyone — don't, once
 * anything references these ids.
 *
 * ── What it refuses to do ───────────────────────────────────────────────────
 * Guess. If a name matches two existing identities, or a provider id would have
 * to be reassigned from one human to another, the row goes to
 * player_identity_unresolved for a person to settle. A confidently wrong id is
 * worse than a missing one: it attaches a real stat line to the wrong player,
 * which is exactly the failure the Fantrax waiver board shipped.
 */
import { promises as fs } from "fs";
import path from "path";
import { getServiceClient, loadEnv, normalizeName } from "./nba-data/client";
import { isNbaTeam, normalizeTeamAbbr } from "../src/lib/nba-teams";
import { NICKNAME_TO_LEGAL_NAME, nameKeyCandidates } from "../src/lib/player-name-aliases";

loadEnv();

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");

const DATA_DIR = path.join(process.cwd(), "data", "player-ids");
const ARTIFACT = path.join(DATA_DIR, "player-identity.json");
/**
 * The slim resolution index every runtime reads (docs §3.3). Distinct from
 * ARTIFACT above, which is the full id LEDGER — the ledger exists to keep
 * `fhe_id`s stable across rebuilds and carries fields (sources, confidence,
 * rotowire/sportradar/statsinc ids) no resolver needs. This one carries exactly
 * the ids and disambiguators `PlayerIdentityIndex` resolves on, so it can be
 * imported into a bundle without shipping the provenance trail.
 *
 * It lives under src/lib because TypeScript imports it directly, the same way
 * nba-player-ids.json and dynasty-rankings.json already do. Python reads THIS
 * file too rather than getting its own copy — a second copy is a second thing to
 * drift, which is the exact failure this layer removes.
 */
const RUNTIME_INDEX = path.join(process.cwd(), "src", "lib", "player-identity", "registry.json");
/**
 * The headshot index the app reads — normalized name → NBA Stats id, which is
 * the namespace `cdn.nba.com/headshots/...` is keyed on.
 *
 * A GENERATED VIEW of the registry, and deliberately NOT the same file as
 * `src/lib/nba-player-ids.json`. That one is an INPUT to this build (the
 * stats.nba.com scraper writes it, see scripts/sync-nba-players.js), so writing
 * it here would make the build self-feeding: it could never learn an id it
 * hadn't already been given.
 *
 * Splitting them means the app reads ids the registry has assembled from ALL its
 * sources — the scraper, Basketball Monster's NBA ID column, approved ESPN
 * resolutions — rather than from the scraper alone. Measured when introduced:
 * every one of the scraper file's 587 keys resolves to the identical id, none
 * are dropped, and 105 more players gain one.
 */
const HEADSHOT_INDEX = path.join(process.cwd(), "src", "lib", "nba-headshot-ids.json");
const BBM_CSV = path.join(DATA_DIR, "bbm-players.csv");
const ESPN_CSV = path.join(DATA_DIR, "espn-ids.csv");
const FANTRAX_CSV = path.join(DATA_DIR, "fantrax-players.csv");

// ── shape ────────────────────────────────────────────────────────────────────

type Status = "prospect" | "nba" | "former";

interface Identity {
  fhe_id: string;
  display_name: string;
  norm_name: string;
  slug: string;
  status: Status;
  dob: string | null;
  draft_year: number | null;
  draft_pick: number | null;
  current_team: string | null;
  espn_id: string | null;
  nba_stats_id: string | null;
  bbm_id: string | null;
  fantrax_id: string | null;
  rotowire_id: string | null;
  sportradar_id: string | null;
  statsinc_id: string | null;
  confidence: string;
  sources: string[];
}

/** The provider-id fields, in the order they are trusted for matching. */
const ID_FIELDS = ["espn_id", "nba_stats_id", "bbm_id", "fantrax_id", "rotowire_id", "sportradar_id", "statsinc_id"] as const;
type IdField = (typeof ID_FIELDS)[number];

interface Candidate extends Partial<Omit<Identity, "fhe_id" | "sources">> {
  display_name: string;
  norm_name: string;
  source: string;
  /**
   * Attach to an existing identity or do nothing — never create one.
   *
   * For sources whose player universe is WIDER than FHE's. Fantrax lists 1,816
   * NBA-eligible players against the registry's ~1,200; merging it normally
   * would mint 844 new identities for G-League and deep-international players
   * FHE holds no stats, values or rankings for, growing the registry 70% with a
   * vendor's roster rather than its own ecosystem.
   */
  matchOnly?: boolean;
}

interface Unresolved {
  norm_name: string;
  raw_name: string;
  source: string;
  reason: "ambiguous" | "no_match" | "id_conflict" | "dob_conflict";
  candidates: string[];
  detail: string;
}

const slugify = (norm: string) => norm.replace(/\s+/g, "-");

// ── registry ─────────────────────────────────────────────────────────────────

class Registry {
  private byId = new Map<string, Identity>();
  private idIndex: Record<IdField, Map<string, string>> = {
    espn_id: new Map(), nba_stats_id: new Map(), bbm_id: new Map(), fantrax_id: new Map(),
    rotowire_id: new Map(), sportradar_id: new Map(), statsinc_id: new Map(),
  };
  private nameIndex = new Map<string, Set<string>>();
  private seq = 0;
  readonly unresolved: Unresolved[] = [];
  /** matchOnly candidates that matched nothing — expected, not a problem. */
  skippedMatchOnly = 0;

  /** Re-seed from a previous run so fhe_ids stay stable. */
  adopt(prev: Identity[]): void {
    for (const row of prev) {
      this.byId.set(row.fhe_id, row);
      for (const f of ID_FIELDS) {
        const v = row[f];
        if (v) this.idIndex[f].set(v, row.fhe_id);
      }
      this.indexName(row.norm_name, row.fhe_id);
      const n = Number(row.fhe_id.replace(/\D/g, ""));
      if (Number.isFinite(n) && n > this.seq) this.seq = n;
    }
  }

  private indexName(norm: string, fheId: string): void {
    const set = this.nameIndex.get(norm) ?? new Set<string>();
    set.add(fheId);
    this.nameIndex.set(norm, set);
  }

  private mint(): string {
    this.seq += 1;
    return `fhe_${String(this.seq).padStart(6, "0")}`;
  }

  /** Existing identities a candidate could be, strongest evidence first. */
  private lookup(c: Candidate): { hits: Set<string>; matchedBy: string } {
    for (const f of ID_FIELDS) {
      const v = c[f];
      if (!v) continue;
      const hit = this.idIndex[f].get(v);
      if (hit) return { hits: new Set([hit]), matchedBy: `provider_id:${f}` };
    }
    const hits = new Set<string>();
    for (const key of nameKeyCandidates(c.norm_name)) {
      for (const id of this.nameIndex.get(key) ?? []) hits.add(id);
    }
    return { hits, matchedBy: hits.size ? "name" : "none" };
  }

  merge(c: Candidate): void {
    const { hits, matchedBy } = this.lookup(c);

    if (hits.size > 1) {
      // A name that could be two different humans. Never pick one — unless a
      // dob settles it, which is the whole reason dob is carried on the row.
      const byDob = c.dob
        ? [...hits].filter((id) => this.byId.get(id)?.dob === c.dob)
        : [];
      if (byDob.length !== 1) {
        this.unresolved.push({
          norm_name: c.norm_name, raw_name: c.display_name, source: c.source,
          reason: "ambiguous", candidates: [...hits],
          detail: `${hits.size} identities share this name${c.dob ? ` and dob ${c.dob} did not separate them` : " and no dob was available"}`,
        });
        return;
      }
      hits.clear();
      hits.add(byDob[0]);
    }

    if (hits.size === 0) {
      if (c.matchOnly) { this.skippedMatchOnly += 1; return; }
      const fheId = this.mint();
      const row: Identity = {
        fhe_id: fheId,
        display_name: c.display_name,
        norm_name: c.norm_name,
        slug: slugify(c.norm_name),
        status: c.status ?? "nba",
        dob: c.dob ?? null,
        draft_year: c.draft_year ?? null,
        draft_pick: c.draft_pick ?? null,
        current_team: c.current_team ?? null,
        espn_id: c.espn_id ?? null,
        nba_stats_id: c.nba_stats_id ?? null,
        bbm_id: c.bbm_id ?? null,
        fantrax_id: c.fantrax_id ?? null,
        rotowire_id: c.rotowire_id ?? null,
        sportradar_id: c.sportradar_id ?? null,
        statsinc_id: c.statsinc_id ?? null,
        confidence: matchedBy === "none" ? "name_exact" : matchedBy,
        sources: [c.source],
      };
      this.byId.set(fheId, row);
      for (const f of ID_FIELDS) if (row[f]) this.idIndex[f].set(row[f]!, fheId);
      this.indexName(row.norm_name, fheId);
      return;
    }

    const fheId = [...hits][0];
    const row = this.byId.get(fheId)!;

    // Provider ids are write-once. A source claiming a DIFFERENT id for a field
    // this human already has means one of the two sources is about a different
    // person — surface it rather than overwrite.
    for (const f of ID_FIELDS) {
      const incoming = c[f];
      if (!incoming) continue;
      const existing = row[f];
      if (existing && existing !== incoming) {
        this.unresolved.push({
          norm_name: c.norm_name, raw_name: c.display_name, source: c.source,
          reason: "id_conflict", candidates: [fheId],
          detail: `${f}: registry has ${existing}, ${c.source} says ${incoming}`,
        });
        continue;
      }
      const owner = this.idIndex[f].get(incoming);
      if (owner && owner !== fheId) {
        this.unresolved.push({
          norm_name: c.norm_name, raw_name: c.display_name, source: c.source,
          reason: "id_conflict", candidates: [fheId, owner],
          detail: `${f} ${incoming} is already held by ${owner}`,
        });
        continue;
      }
      if (!existing) {
        row[f] = incoming;
        this.idIndex[f].set(incoming, fheId);
      }
    }

    // A DOB disagreement means EITHER a name join has fused two different
    // people, OR one source simply has the date wrong. Both matter and neither
    // can be told apart automatically, so this flags and never overwrites.
    // Measured against the ESPN dates already collected: 11 of 120 comparable
    // players disagree with the roster CSV, and all 11 look like data entry
    // (transposed digits, off-by-one years) rather than mistaken identity —
    // consistent with ESPN's known bad DOBs (Zach Edey). Whichever the cause,
    // picking a winner automatically would be guessing.
    if (row.dob && c.dob && row.dob !== c.dob) {
      this.unresolved.push({
        norm_name: c.norm_name, raw_name: c.display_name, source: c.source,
        reason: "dob_conflict", candidates: [fheId],
        detail: `dob: registry has ${row.dob}, ${c.source} says ${c.dob}`,
      });
    }

    // Descriptive fields: fill blanks, never clobber. Sources arrive in
    // increasing recency, so a later source's team is the fresher one.
    if (!row.dob && c.dob) row.dob = c.dob;
    if (row.draft_year == null && c.draft_year != null) row.draft_year = c.draft_year;
    if (row.draft_pick == null && c.draft_pick != null) row.draft_pick = c.draft_pick;
    if (c.current_team) row.current_team = c.current_team;
    // "prospect" means never played an NBA game, so it must never overwrite a
    // row the ESPN/NBA-Stats spines already know — those players have service.
    if (c.status === "prospect") {
      if (!row.espn_id && !row.nba_stats_id) row.status = "prospect";
    } else if (c.status) {
      row.status = c.status;
    }
    if (!row.sources.includes(c.source)) row.sources.push(c.source);
    // A name-only merge shouldn't downgrade a row that was matched by id.
    if (row.confidence === "name_exact" && matchedBy.startsWith("provider_id")) {
      row.confidence = matchedBy;
    }
    this.indexName(c.norm_name, fheId);
  }

  all(): Identity[] {
    return [...this.byId.values()].sort((a, b) => a.fhe_id.localeCompare(b.fhe_id));
  }

  /** Every distinct name form seen for each identity → the alias table. */
  aliases(): { norm_name: string; fhe_id: string }[] {
    const out: { norm_name: string; fhe_id: string }[] = [];
    for (const [norm, ids] of this.nameIndex) {
      if (ids.size === 1) out.push({ norm_name: norm, fhe_id: [...ids][0] });
    }
    return out;
  }
}

// ── CSV ──────────────────────────────────────────────────────────────────────

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; }
      else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = []; continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

async function readCsv(file: string): Promise<Record<string, string>[]> {
  try {
    return parseCsv(await fs.readFile(file, "utf8"));
  } catch {
    return [];
  }
}

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// ── build ────────────────────────────────────────────────────────────────────

/**
 * Fantrax ids that must not be name-joined because another Fantrax player shares
 * their name.
 *
 * The same guard src/lib/fantrax/resolve.ts needed at runtime, moved here so it
 * runs once at build time rather than on every league import: the feed carries
 * 38 duplicated names, including two Jalen Johnsons and two Jaylin Williamses
 * (one rostered, one teamless). Resolved by NBA team when exactly one candidate
 * has a real one; otherwise every candidate is blocked, because a wrong provider
 * id is worse than a missing one.
 */
function blockedFantraxNames(rows: Record<string, string>[]): Set<string> {
  const groups = new Map<string, Record<string, string>[]>();
  for (const r of rows) {
    if (!r.norm_name) continue;
    const list = groups.get(r.norm_name) ?? [];
    list.push(r);
    groups.set(r.norm_name, list);
  }
  const blocked = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const identifiable = group.filter((r) => isNbaTeam(normalizeTeamAbbr(r.team)));
    if (identifiable.length === 1) {
      for (const r of group) if (r.fantrax_id !== identifiable[0].fantrax_id) blocked.add(r.fantrax_id);
    } else {
      for (const r of group) blocked.add(r.fantrax_id);
    }
  }
  return blocked;
}

/**
 * Emit the slim resolution index (see RUNTIME_INDEX above).
 *
 * Null fields are omitted rather than written: at 1,200 identities × 11 fields
 * the nulls are most of the file, and the loader restores them, so the committed
 * diff shows only ids that actually exist. The alias map travels with it so the
 * TypeScript and Python sides read ONE authored list — `player-name-aliases.ts`
 * remains the only place a nickname pair is written by hand, and the Python
 * comment about it being "TypeScript-side only, so it cannot be imported here"
 * stops being true.
 */
async function writeRuntimeIndex(all: Identity[]): Promise<void> {
  const players = all.map((r) => {
    const slim: Record<string, unknown> = {
      fheId: r.fhe_id,
      displayName: r.display_name,
      normName: r.norm_name,
      status: r.status,
    };
    const optional: [string, unknown][] = [
      ["espnId", r.espn_id], ["nbaStatsId", r.nba_stats_id], ["bbmId", r.bbm_id],
      ["fantraxId", r.fantrax_id], ["dob", r.dob], ["draftYear", r.draft_year],
      ["currentTeam", r.current_team],
    ];
    for (const [k, v] of optional) if (v != null) slim[k] = v;
    return slim;
  });

  const body = [
    "{",
    `"generatedAt": ${JSON.stringify(new Date().toISOString())},`,
    `"count": ${players.length},`,
    `"aliases": ${JSON.stringify(NICKNAME_TO_LEGAL_NAME, null, 2)},`,
    '"players": [',
    players.map((p) => JSON.stringify(p)).join(",\n"),
    "]",
    "}",
  ].join("\n");

  await fs.mkdir(path.dirname(RUNTIME_INDEX), { recursive: true });
  await fs.writeFile(RUNTIME_INDEX, `${body}\n`, "utf8");
  const kb = (Buffer.byteLength(body) / 1024).toFixed(0);
  console.log(`Wrote ${path.relative(process.cwd(), RUNTIME_INDEX)} (${players.length} players, ${kb} KB)`);
}

/**
 * Emit the headshot index (see HEADSHOT_INDEX above).
 *
 * Carries `id` and `name` only. The file it replaces also had `team` and
 * `position`, and neither was ever read — `position` was null on all 587 rows,
 * and the single consumer (`nbaIdFor` in src/lib/dynasty-rankings.ts) reads
 * `.id`. Regenerating a `team` nobody reads would just churn the committed diff
 * every time a player moved.
 *
 * A normalized name that maps to two different NBA Stats ids is DROPPED rather
 * than resolved to whichever identity was seen first — a headshot index keyed on
 * a name it cannot attribute would put the wrong player's face on the page,
 * which is worse than the blank the caller already handles. (Currently zero such
 * names; the guard is for the day there is one.)
 */
async function writeHeadshotIndex(all: Identity[]): Promise<void> {
  const byNorm = new Map<string, { id: string; name: string }>();
  const ambiguous = new Set<string>();
  for (const r of all) {
    if (!r.nba_stats_id) continue;
    const prev = byNorm.get(r.norm_name);
    if (prev && prev.id !== r.nba_stats_id) ambiguous.add(r.norm_name);
    else if (!prev) byNorm.set(r.norm_name, { id: r.nba_stats_id, name: r.display_name });
  }
  for (const name of ambiguous) byNorm.delete(name);

  const keys = [...byNorm.keys()].sort();
  const body = [
    "{",
    keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(byNorm.get(k))}`).join(",\n"),
    "}",
  ].join("\n");
  await fs.writeFile(HEADSHOT_INDEX, `${body}\n`, "utf8");
  console.log(`Wrote ${path.relative(process.cwd(), HEADSHOT_INDEX)} (${keys.length} headshot ids`
    + `${ambiguous.size ? `, ${ambiguous.size} dropped as ambiguous: ${[...ambiguous].join(", ")}` : ""})`);
}

async function main(): Promise<void> {
  const supabase = getServiceClient();
  const reg = new Registry();

  // Previous run first — this is what keeps fhe_ids stable.
  try {
    const prev = JSON.parse(await fs.readFile(ARTIFACT, "utf8")) as Identity[];
    reg.adopt(prev);
    console.log(`Adopted ${prev.length} identities from the previous build.`);
  } catch {
    console.log("No previous registry — minting fresh ids.");
  }

  // 1. ESPN spine.
  const players = await fetchAll<{ id: string; full_name: string; team: string | null; is_active: boolean }>(
    (f, t) => supabase.from("nba_players").select("id,full_name,team,is_active").range(f, t),
    "nba_players",
  );
  for (const p of players) {
    reg.merge({
      display_name: p.full_name, norm_name: normalizeName(p.full_name), source: "nba_players",
      espn_id: p.id, current_team: normalizeTeamAbbr(p.team ?? "") ?? undefined,
      status: p.is_active ? "nba" : "former",
    });
  }
  console.log(`nba_players       : ${players.length} rows (ESPN ids)`);

  // 2. NBA Stats ids. Name-keyed, so this is a name join by construction — it is
  //    what puts an nba_stats_id on the spine for BBM to then match by ID.
  const idsJson = JSON.parse(
    await fs.readFile(path.join(process.cwd(), "src", "lib", "nba-player-ids.json"), "utf8"),
  ) as Record<string, { id: string; name: string; team: string | null }>;
  for (const [norm, v] of Object.entries(idsJson)) {
    reg.merge({ display_name: v.name, norm_name: norm, source: "nba_player_ids_json", nba_stats_id: v.id });
  }
  console.log(`nba-player-ids.json: ${Object.keys(idsJson).length} rows (NBA Stats ids)`);

  // 3. Basketball Monster. 673 of these carry an NBA Stats id and therefore
  //    merge by EXACT id against step 2 rather than by name.
  const bbm = await readCsv(BBM_CSV);
  for (const r of bbm) {
    reg.merge({
      display_name: r.name, norm_name: r.norm_name || normalizeName(r.name), source: "bbm",
      bbm_id: r.bbm_id || undefined,
      nba_stats_id: r.nba_stats_id || undefined,
      current_team: normalizeTeamAbbr(r.team ?? "") ?? undefined,
      status: r.nba_stats_id ? undefined : "prospect",
    });
  }
  console.log(`bbm-players.csv    : ${bbm.length} rows (BBM ids)`);

  // 4. Approved ESPN ids for players the spine has never seen.
  const espnApproved = (await readCsv(ESPN_CSV)).filter((r) => r.status === "approved" && r.espn_id);
  for (const r of espnApproved) {
    reg.merge({
      display_name: r.display_name, norm_name: r.norm_name, source: "espn_resolve",
      espn_id: r.espn_id, dob: r.espn_dob || undefined, status: "prospect",
    });
  }
  console.log(`espn-ids.csv       : ${espnApproved.length} approved row(s)`);

  // 5. Roster — the only source of dob/draft data, which is what breaks ties.
  const roster = await fetchAll<{
    full_name: string; norm_name: string; dob: string | null;
    draft_year: number | null; draft_pick: number | null; team: string; is_incoming_rookie: boolean;
  }>(
    (f, t) => supabase.from("nba_roster")
      .select("full_name,norm_name,dob,draft_year,draft_pick,team,is_incoming_rookie")
      .eq("season", "2026-27").range(f, t),
    "nba_roster",
  );
  for (const r of roster) {
    reg.merge({
      display_name: r.full_name, norm_name: r.norm_name, source: "nba_roster",
      dob: r.dob ?? undefined, draft_year: r.draft_year ?? undefined, draft_pick: r.draft_pick ?? undefined,
      current_team: normalizeTeamAbbr(r.team) ?? undefined,
      status: r.is_incoming_rookie ? "prospect" : undefined,
    });
  }
  console.log(`nba_roster 2026-27 : ${roster.length} rows (dob / draft)`);

  // 6. Dynasty board — prospects who exist in no other source yet.
  const dynasty = JSON.parse(
    await fs.readFile(path.join(process.cwd(), "src", "lib", "dynasty-rankings.json"), "utf8"),
  ) as { player: string; isRookie?: boolean; team?: string }[];
  for (const p of dynasty) {
    reg.merge({
      display_name: p.player, norm_name: normalizeName(p.player), source: "dynasty_board",
      current_team: normalizeTeamAbbr(p.team ?? "") ?? undefined,
      status: p.isRookie ? "prospect" : undefined,
    });
  }
  console.log(`dynasty-rankings   : ${dynasty.length} rows`);

  // 7. Fantrax — LAST, and match-only. It is the only source carrying no id FHE
  //    already holds, so it can join by name alone: weakest evidence, largest
  //    feed. Merging it earlier would let a name guess claim an identity before
  //    a stronger source could. What it brings back is Rotowire / SportRadar /
  //    StatsInc ids for the players it does match — the keys most future data
  //    partners speak.
  const fantrax = await readCsv(FANTRAX_CSV);
  const blockedFx = blockedFantraxNames(fantrax);
  let fantraxConsidered = 0;
  for (const r of fantrax) {
    if (blockedFx.has(r.fantrax_id)) continue;
    fantraxConsidered += 1;
    reg.merge({
      display_name: r.name, norm_name: r.norm_name || normalizeName(r.name), source: "fantrax",
      matchOnly: true,
      fantrax_id: r.fantrax_id || undefined,
      rotowire_id: r.rotowire_id || undefined,
      sportradar_id: r.sportradar_id || undefined,
      statsinc_id: r.statsinc_id || undefined,
    });
  }
  console.log(
    `fantrax-players.csv: ${fantrax.length} rows — ${blockedFx.size} blocked (duplicate names), ` +
    `${fantraxConsidered} considered, ${reg.skippedMatchOnly} not in FHE's ecosystem (skipped, never minted)`,
  );

  // ── report ────────────────────────────────────────────────────────────────
  const all = reg.all();
  const count = (f: IdField) => all.filter((r) => r[f]).length;
  console.log(`\n── registry: ${all.length} identities ──`);
  for (const f of ID_FIELDS) {
    const n = count(f);
    if (n) console.log(`  ${f.padEnd(14)} ${String(n).padStart(5)}  (${(n / all.length * 100).toFixed(0)}%)`);
  }
  const bothNbaIds = all.filter((r) => r.espn_id && r.nba_stats_id).length;
  const bbmLinked = all.filter((r) => r.bbm_id && r.espn_id).length;
  console.log(`  ESPN + NBA Stats on one row : ${bothNbaIds}`);
  console.log(`  BBM + ESPN on one row       : ${bbmLinked}`);
  console.log(`  status: ${["nba", "prospect", "former"].map((s) => `${s}=${all.filter((r) => r.status === s).length}`).join("  ")}`);

  if (reg.unresolved.length) {
    console.log(`\n── unresolved: ${reg.unresolved.length} ──`);
    const byReason = new Map<string, number>();
    for (const u of reg.unresolved) byReason.set(u.reason, (byReason.get(u.reason) ?? 0) + 1);
    for (const [k, v] of byReason) console.log(`  ${k}: ${v}`);
    for (const u of reg.unresolved.slice(0, 12)) console.log(`    ${u.raw_name} [${u.source}] — ${u.detail}`);
    if (reg.unresolved.length > 12) console.log(`    …and ${reg.unresolved.length - 12} more`);
  }

  if (DRY_RUN) {
    console.log("\n[DRY RUN] nothing written.");
    return;
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  // One identity per line rather than pretty-printed: this file is the id
  // LEDGER and is committed, so a diff should read as "these players changed",
  // not as hundreds of reindented field lines. Still ordinary JSON.
  await fs.writeFile(ARTIFACT, `[\n${all.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`, "utf8");
  console.log(`\nWrote ${path.relative(process.cwd(), ARTIFACT)}`);

  await writeRuntimeIndex(all);
  await writeHeadshotIndex(all);

  // Supabase is best-effort: Phase 1 is additive and nothing reads these tables
  // yet, so a missing migration must not fail the build that produces the
  // artifact everything else can already use.
  const rows = all.map((r) => ({ ...r, updated_at: new Date().toISOString() }));
  const { error } = await supabase.from("player_identity").upsert(rows as never, { onConflict: "fhe_id" });
  if (error) {
    console.warn(`\n! Supabase write skipped: ${error.message}`);
    console.warn("  (apply supabase/migrations/20260803020000_player_identity.sql, then re-run)");
    return;
  }
  console.log(`Upserted ${rows.length} rows into player_identity`);

  const aliases = reg.aliases().map((a) => {
    const row = all.find((r) => r.fhe_id === a.fhe_id)!;
    return { norm_name: a.norm_name, fhe_id: a.fhe_id, raw_name: row.display_name, source: "build", kind: "legal" };
  });
  const { error: aliasErr } = await supabase
    .from("player_name_alias").upsert(aliases as never, { onConflict: "norm_name" });
  if (aliasErr) console.warn(`! player_name_alias write skipped: ${aliasErr.message}`);
  else console.log(`Upserted ${aliases.length} name aliases`);

  if (reg.unresolved.length) {
    const { error: unErr } = await supabase
      .from("player_identity_unresolved")
      .upsert(reg.unresolved.map((u) => ({ ...u, candidates: u.candidates })) as never, { onConflict: "norm_name" });
    if (unErr) console.warn(`! player_identity_unresolved write skipped: ${unErr.message}`);
    else console.log(`Upserted ${reg.unresolved.length} unresolved row(s) for review`);
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
