/**
 * Resolve ESPN athlete ids for the players FHE currently knows only by name.
 *
 *   npm run espn:resolve                     # resolve → write the review CSV
 *   npm run espn:resolve -- --include-roster # also target nba_roster's null player_id rows
 *   npm run espn:resolve -- --recheck        # re-resolve rows already marked approved/rejected
 *   npm run espn:resolve -- --all-seasons    # include the four historical Summer Leagues too
 *   npm run espn:resolve -- --limit 10       # stop after N players (smoke test)
 *   npm run espn:resolve -- --emit           # approved rows → data/player-ids/espn-ids.json
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * ESPN issues an athlete id to a prospect years before he plays an NBA game and
 * KEEPS it — verified 2026-08-03: Ajay Mitchell (4900671) is an NBA player in
 * season_player_stats and resolves on ESPN's mens-college-basketball athlete
 * endpoint under that same id. One global athlete id across college and the NBA.
 *
 * That matters because `season_player_stats.player_id` IS an ESPN athlete id,
 * so a prospect's id today is the id his NBA career will arrive under. Today,
 * players ESPN can't be matched to by name get a synthetic `sl-<nbaComId>` from
 * build-summer-league-values.ts (`espnId ?? \`sl-${r.playerId}\``) — a namespace
 * nothing else in the ecosystem uses, and one the player silently sheds at his
 * NBA debut. Filling in real ESPN ids collapses that fallback.
 *
 * ── Why it writes a CSV instead of the database ──────────────────────────────
 * Because hand-collected ids are wrong at an alarming rate. Of 13 rookie ESPN
 * ids reviewed on 2026-08-03, SIX were wrong — four pointed at entirely
 * different athletes (Jaxon Pollard, Joshua Ola-Joseph, Keeshawn Kellman) and
 * two didn't resolve at all. And ESPN's own index carries duplicates: searching
 * "Cameron Boozer" returns two athletes (5041935 and 4700867). An id written to
 * the wrong player is worse than no id, because every downstream join then
 * attaches a real stat line to the wrong human — exactly the failure the Fantrax
 * waiver board hit. So: this script proposes, a person disposes.
 *
 * Every candidate is verified against the athlete endpoint (name must match, DOB
 * captured) before it is ever written as `exact`. Anything with more than one
 * plausible athlete is written as `multiple` and left `pending` for a human.
 *
 * The CSV is the source of truth and is meant to be committed. Re-running merges
 * rather than overwrites: a row you've marked `approved` or `rejected` is left
 * exactly as you left it (use --recheck to force re-resolution).
 */
import { promises as fs } from "fs";
import path from "path";
import { getServiceClient, loadEnv, normalizeName } from "./nba-data/client";

loadEnv();

const argv = process.argv.slice(2);
const INCLUDE_ROSTER = argv.includes("--include-roster");
const RECHECK = argv.includes("--recheck");
const ALL_SEASONS = argv.includes("--all-seasons");
const EMIT = argv.includes("--emit");
const limitIdx = argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : null;

const REVIEW_DIR = path.join(process.cwd(), "data", "player-ids");
const REVIEW_CSV = path.join(REVIEW_DIR, "espn-ids.csv");
const EMIT_JSON = path.join(REVIEW_DIR, "espn-ids.json");

/** Politeness delay between ESPN calls. These are unauthenticated public
 *  endpoints with no SLA — the same posture build-summer-league-values.ts takes
 *  toward stats.nba.com. Don't parallelise this. */
const THROTTLE_MS = 150;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── review-file schema ───────────────────────────────────────────────────────

type Confidence = "exact" | "multiple" | "unresolved";
type Status = "pending" | "approved" | "rejected";

interface ReviewRow {
  norm_name: string;
  display_name: string;
  /** Which FHE dataset wants this id. */
  source: string;
  /** The id FHE holds today ("sl-1643407", or empty when it holds none). */
  current_id: string;
  espn_id: string;
  espn_name: string;
  espn_dob: string;
  espn_league: string;
  confidence: Confidence | "";
  status: Status;
  note: string;
}

const COLUMNS: (keyof ReviewRow)[] = [
  "norm_name", "display_name", "source", "current_id",
  "espn_id", "espn_name", "espn_dob", "espn_league", "confidence", "status", "note",
];

// ── minimal CSV (src/lib/csv-export.ts is browser-only — Blob/document) ──────

function csvField(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCsv(rows: ReviewRow[]): string {
  const lines = [COLUMNS.join(",")];
  for (const r of rows) lines.push(COLUMNS.map((c) => csvField(r[c] ?? "")).join(","));
  return lines.join("\n") + "\n";
}

/** Parses RFC-4180-ish CSV: quoted fields, doubled quotes, embedded commas. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);

  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

async function readReview(): Promise<Map<string, ReviewRow>> {
  try {
    const text = await fs.readFile(REVIEW_CSV, "utf8");
    const map = new Map<string, ReviewRow>();
    for (const raw of parseCsv(text)) {
      const row = raw as unknown as ReviewRow;
      if (row.norm_name) map.set(row.norm_name, row);
    }
    return map;
  } catch {
    return new Map();
  }
}

// ── ESPN ─────────────────────────────────────────────────────────────────────

const BASKETBALL_LEAGUES = ["mens-college-basketball", "nba"] as const;

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Candidate athlete ids for a name, from ESPN's public search. */
async function searchAthletes(name: string): Promise<string[]> {
  const url = `https://site.web.api.espn.com/apis/search/v2?${new URLSearchParams({
    region: "us", lang: "en", query: name, limit: "10",
  })}`;
  const data = (await getJson(url)) as { results?: { type?: string; contents?: unknown[] }[] } | null;
  if (!data?.results) return [];

  const ids = new Set<string>();
  for (const group of data.results) {
    if (group.type !== "player" && group.type !== "athlete") continue;
    for (const item of group.contents ?? []) {
      const it = item as { link?: unknown; uid?: string; displayName?: string };
      // Only keep candidates whose displayed name actually matches — the search
      // is fuzzy and will happily return a different athlete entirely.
      if (!it.displayName || normalizeName(it.displayName) !== normalizeName(name)) continue;
      const link = typeof it.link === "string" ? it.link
        : ((it.link as { web?: string })?.web ?? "");
      const fromLink = /\/id\/(\d+)/.exec(link)?.[1];
      const fromUid = /a:(\d+)/.exec(it.uid ?? "")?.[1];
      const id = fromLink ?? fromUid;
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

interface Athlete { id: string; name: string; dob: string; league: string }

/** Confirms an id is a real basketball athlete and returns its canonical record. */
async function fetchAthlete(id: string): Promise<Athlete | null> {
  for (const league of BASKETBALL_LEAGUES) {
    const data = (await getJson(
      `https://sports.core.api.espn.com/v2/sports/basketball/leagues/${league}/athletes/${id}`,
    )) as { displayName?: string; dateOfBirth?: string } | null;
    if (data?.displayName) {
      return { id, name: data.displayName, dob: (data.dateOfBirth ?? "").slice(0, 10), league };
    }
    await sleep(THROTTLE_MS);
  }
  return null;
}

/** Search → verify. Returns every VERIFIED athlete whose name matches. */
async function resolveOne(displayName: string): Promise<Athlete[]> {
  const ids = await searchAthletes(displayName);
  await sleep(THROTTLE_MS);

  const verified: Athlete[] = [];
  for (const id of ids) {
    const athlete = await fetchAthlete(id);
    await sleep(THROTTLE_MS);
    if (athlete && normalizeName(athlete.name) === normalizeName(displayName)) verified.push(athlete);
  }
  return verified;
}

// ── targets ──────────────────────────────────────────────────────────────────

interface Target { normName: string; displayName: string; source: string; currentId: string }

/**
 * PostgREST caps a single response at 1000 rows and returns no error when it
 * truncates — which silently under-collects the target list (there are >1000
 * `sl-` rows across five Summer Leagues). Always page.
 */
async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`${label} fetch failed: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Who needs an id.
 *
 * Default scope is deliberately narrow: the dynasty-board rookies plus the
 * `sl-` rows in the datasets that actually feed live surfaces (Summer League
 * 2026 and the 2026-27 projections). The other four Summer Leagues are historical
 * exhibition data — ~430 further names, mostly undrafted invitees who never
 * played an NBA minute, whose ids nothing reads. `--all-seasons` includes them
 * for a one-time backfill.
 */
async function collectTargets(): Promise<Target[]> {
  const supabase = getServiceClient();
  const byName = new Map<string, Target>();

  const add = (displayName: string, source: string, currentId: string) => {
    const normName = normalizeName(displayName);
    if (!normName) return;
    const existing = byName.get(normName);
    if (existing) {
      if (!existing.source.includes(source)) existing.source += `+${source}`;
      if (!existing.currentId && currentId) existing.currentId = currentId;
      return;
    }
    byName.set(normName, { normName, displayName, source, currentId });
  };

  const slRows = await fetchAllPages<{ player_id: string; name: string; season: number; season_type: string }>(
    (from, to) =>
      supabase.from("season_player_stats")
        .select("player_id,name,season,season_type")
        .like("player_id", "sl-%")
        .range(from, to),
    "season_player_stats",
  );
  for (const r of slRows) {
    const live = (r.season === 2026 && r.season_type === "summer")
      || (r.season === 2027 && r.season_type === "projection");
    if (!ALL_SEASONS && !live) continue;
    add(r.name, "sl-row", r.player_id);
  }

  const dynastyPath = path.join(process.cwd(), "src", "lib", "dynasty-rankings.json");
  const dynasty = JSON.parse(await fs.readFile(dynastyPath, "utf8")) as
    { player: string; isRookie?: boolean }[];
  for (const p of dynasty) if (p.isRookie) add(p.player, "dynasty-rookie", "");

  if (INCLUDE_ROSTER) {
    const rosterRows = await fetchAllPages<{ full_name: string }>(
      (from, to) =>
        supabase.from("nba_roster").select("full_name").is("player_id", null).range(from, to),
      "nba_roster",
    );
    for (const r of rosterRows) add(r.full_name, "roster-null", "");
  }

  return [...byName.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Known dates of birth, by normalized name, from the roster CSV.
 *
 * This is the tiebreak for duplicate names — the strongest disambiguator FHE
 * owns, and the generalization of the Fantrax duplicate-name fix. ESPN's index
 * genuinely carries several athletes per common college name; DOB settles it
 * without a human having to.
 */
async function fetchKnownDobs(): Promise<Map<string, string>> {
  const supabase = getServiceClient();
  const rows = await fetchAllPages<{ norm_name: string; dob: string | null }>(
    (from, to) => supabase.from("nba_roster").select("norm_name,dob").range(from, to),
    "nba_roster dob",
  );
  const map = new Map<string, string>();
  for (const r of rows) if (r.dob) map.set(r.norm_name, r.dob.slice(0, 10));
  return map;
}

// ── emit ─────────────────────────────────────────────────────────────────────

/**
 * Approved rows → a normalized-name → ESPN id map, for build scripts to consult
 * before falling back to a synthetic id. Only `approved` rows are emitted: a
 * `pending` row is an unreviewed guess and must never reach the pipeline.
 */
async function emit(): Promise<void> {
  const review = await readReview();
  const map: Record<string, string> = {};
  let skipped = 0;
  for (const row of review.values()) {
    if (row.status !== "approved") { skipped += 1; continue; }
    if (!row.espn_id) { skipped += 1; continue; }
    map[row.norm_name] = row.espn_id;
  }
  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  await fs.mkdir(REVIEW_DIR, { recursive: true });
  await fs.writeFile(EMIT_JSON, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  console.log(`\nEmitted ${Object.keys(sorted).length} approved id(s) → ${path.relative(process.cwd(), EMIT_JSON)}`);
  if (skipped) console.log(`  (${skipped} row(s) not approved — not emitted)`);
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (EMIT) { await emit(); return; }

  const review = await readReview();
  const targets = await collectTargets();
  const knownDobs = await fetchKnownDobs();
  const todo = targets.filter((t) => {
    const existing = review.get(t.normName);
    if (!existing) return true;
    if (RECHECK) return true;
    // A human decision is final until --recheck says otherwise.
    return existing.status === "pending" && existing.confidence !== "multiple";
  });

  const capped = LIMIT ? todo.slice(0, LIMIT) : todo;
  console.log(`${targets.length} target(s); ${todo.length} to resolve${LIMIT ? ` (capped at ${capped.length})` : ""}.`);
  if (review.size) console.log(`Existing review file: ${review.size} row(s).`);
  console.log("");

  const tally = { exact: 0, multiple: 0, unresolved: 0 };

  for (const [i, t] of capped.entries()) {
    let found = await resolveOne(t.displayName);
    const prior = review.get(t.normName);

    // Duplicate names: if we already know this player's DOB, let it pick.
    let dobResolved = false;
    if (found.length > 1) {
      const knownDob = knownDobs.get(t.normName);
      if (knownDob) {
        const byDob = found.filter((a) => a.dob === knownDob);
        if (byDob.length === 1) { found = byDob; dobResolved = true; }
      }
    }

    let row: ReviewRow;
    if (found.length === 1) {
      const a = found[0];
      row = {
        norm_name: t.normName, display_name: t.displayName, source: t.source,
        current_id: t.currentId, espn_id: a.id, espn_name: a.name, espn_dob: a.dob,
        espn_league: a.league, confidence: "exact",
        status: prior?.status && prior.status !== "pending" ? prior.status : "pending",
        note: dobResolved
          ? `duplicate name resolved by roster DOB ${a.dob}`
          : (prior?.note ?? ""),
      };
      tally.exact += 1;
    } else if (found.length > 1) {
      row = {
        norm_name: t.normName, display_name: t.displayName, source: t.source,
        current_id: t.currentId, espn_id: "", espn_name: "", espn_dob: "", espn_league: "",
        confidence: "multiple", status: "pending",
        note: `${found.length} athletes share this name — pick one: ` +
          found.map((a) => `${a.id} (${a.dob || "no dob"}, ${a.league})`).join(" | "),
      };
      tally.multiple += 1;
    } else {
      row = {
        norm_name: t.normName, display_name: t.displayName, source: t.source,
        current_id: t.currentId, espn_id: "", espn_name: "", espn_dob: "", espn_league: "",
        confidence: "unresolved", status: "pending",
        note: "no ESPN athlete matched this name — set espn_id by hand and mark approved",
      };
      tally.unresolved += 1;
    }

    review.set(t.normName, row);
    const mark = row.confidence === "exact" ? "OK  " : row.confidence === "multiple" ? "DUP " : "MISS";
    console.log(
      `[${String(i + 1).padStart(3)}/${capped.length}] ${mark} ${t.displayName.padEnd(24)} ` +
      `${row.espn_id.padEnd(9)} ${row.espn_dob}`,
    );
  }

  const out = [...review.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
  await fs.mkdir(REVIEW_DIR, { recursive: true });
  await fs.writeFile(REVIEW_CSV, toCsv(out), "utf8");

  const pending = out.filter((r) => r.status === "pending").length;
  const approved = out.filter((r) => r.status === "approved").length;

  console.log(`\nThis run: ${tally.exact} exact · ${tally.multiple} duplicate-name · ${tally.unresolved} unresolved`);
  console.log(`Review file: ${path.relative(process.cwd(), REVIEW_CSV)} (${out.length} rows — ${approved} approved, ${pending} pending)`);
  console.log(`\nNext: review the CSV, set status to approved/rejected, then:`);
  console.log(`  npm run espn:resolve -- --emit`);
  console.log(`\nNothing has been written to the database.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
