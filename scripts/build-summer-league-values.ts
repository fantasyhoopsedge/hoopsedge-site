/**
 * Build Summer League (Vegas) category values — a STANDALONE dataset alongside
 * the regular-season/playoffs seasonal-rankings datasets.
 *
 *   npm run summerleague:build                  # all years, upsert
 *   npm run summerleague:build -- --only 2025    # one year
 *   npm run summerleague:build -- --dry-run      # compute + report, no writes
 *   npm run summerleague:build -- --apply-espn-ids  # re-key to approved ESPN ids (cascades!)
 *
 * Source: stats.nba.com/stats/leaguedashplayerstats, LeagueID=15 (Vegas Summer
 * League) — the same unofficial, unauthenticated endpoint NBA.com's own
 * summer-league stats pages call client-side (confirmed by inspecting
 * nba.com/<year>-summer-league-vegas-player-stats' network requests). No SLA,
 * requires spoofed browser headers, and can rate-limit/block datacenter IPs
 * without notice — that's why this is a manual/occasional script, NOT part of
 * the daily nba-stats-daily.yml cron (Summer League runs once a year for ~10
 * days in July).
 *
 * Standalone by construction: writes to the SAME season_player_stats /
 * season_player_values tables as scripts/build-seasonal-values.ts, keyed by
 * season_type='summer' + season=<calendar year of the event>. Every existing
 * reader (the /seasonal-rankings page, /api/seasonal-values) already filters
 * by (season, season_type), so these rows can never leak into or affect a
 * regular-season/playoffs baseline pool. Same 9-cat engine, unmodified.
 *
 * Player identity: the API's PLAYER_ID is an NBA.com person id, a different
 * namespace than the ESPN athlete id season_player_stats.player_id normally
 * holds (from the hoopR/ESPN pipeline). To keep one identity per player across
 * datasets (and keep ESPN-CDN headshots working), each row is resolved to its
 * existing nba_players id by normalized name when possible; unmatched players
 * (undrafted invitees never seen in a real NBA box score) get a synthesized
 * `sl-<nbaComId>` — stable across re-runs, headshot-less (silhouette fallback).
 */
import { readFileSync } from "fs";
import path from "path";
import { getServiceClient, loadEnv, normalizeName } from "./nba-data/client";
import { normalizeTeamAbbr } from "../src/lib/nba-teams";
import { lookupWithNameAlias } from "../src/lib/player-name-aliases";
import {
  computeAllLeagueSizes,
  type PlayerStats,
  type RankedPlayerValues,
} from "../src/lib/value/compute-values";
import { loadConsensus, pos5, round1, round3, batchUpsert } from "./build-seasonal-values";

const YEARS = [2026, 2025, 2024, 2023, 2022] as const;

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const onlyArgIdx = argv.indexOf("--only");
const ONLY = onlyArgIdx >= 0 ? Number(argv[onlyArgIdx + 1]) : null;
/**
 * Apply the approved ESPN id overrides (data/player-ids/espn-ids.json).
 *
 * OFF by default, and that is a safety decision rather than a preference:
 * turning it on RE-KEYS players from `sl-<nbaComId>` to their real ESPN id, and
 * build-projection-values.ts resolves the current draft class against the
 * Summer League 2026 rows this script writes. Re-keying here without rebuilding
 * projections (then trends, then real-salary) leaves those datasets pointing at
 * ids that no longer exist. Use it as a deliberate step with the rest of the
 * chain, never as a side effect of a routine rebuild.
 */
const APPLY_ESPN_IDS = argv.includes("--apply-espn-ids");

// ── stats.nba.com fetch ──────────────────────────────────────────────────────

const STATS_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
};

function summerLeagueUrl(year: number): string {
  const params = new URLSearchParams({
    College: "", Conference: "", Country: "", DateFrom: "", DateTo: "",
    Division: "", DraftPick: "", DraftYear: "", GameScope: "", GameSegment: "",
    Height: "", LastNGames: "0", LeagueID: "15", Location: "", MeasureType: "Base",
    Month: "0", OpponentTeamID: "0", Outcome: "", PORound: "0", PaceAdjust: "N",
    PerMode: "Totals", Period: "0", PlayerExperience: "", PlayerPosition: "",
    PlusMinus: "N", Rank: "N", Season: String(year), SeasonSegment: "",
    SeasonType: "Regular Season", ShotClockRange: "", StarterBench: "",
    TeamID: "0", TwoWay: "", VsConference: "", VsDivision: "", Weight: "",
  });
  return `https://stats.nba.com/stats/leaguedashplayerstats?${params.toString()}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const wait = 1000 * 2 ** i;
        console.warn(`  ${label} failed (attempt ${i + 1}/${attempts}), retrying in ${wait}ms…`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

type ApiRow = {
  playerId: string; // NBA.com person id
  name: string;
  team: string | null;
  gp: number; min: number;
  pts: number; reb: number; ast: number; stl: number; blk: number; tov: number;
  fg3m: number; fgm: number; fga: number; ftm: number; fta: number;
};

async function fetchYear(year: number): Promise<ApiRow[]> {
  const json = await withRetry(`Summer League ${year} fetch`, async () => {
    const res = await fetch(summerLeagueUrl(year), { headers: STATS_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ resultSets: Array<{ headers: string[]; rowSet: unknown[][] }> }>;
  });
  const rs = json.resultSets?.[0];
  if (!rs) throw new Error(`no resultSets for Summer League ${year}`);
  const idx = (col: string) => {
    const i = rs.headers.indexOf(col);
    if (i === -1) throw new Error(`missing column ${col} in Summer League ${year} response`);
    return i;
  };
  const iId = idx("PLAYER_ID"), iName = idx("PLAYER_NAME"), iTeam = idx("TEAM_ABBREVIATION"),
    iGp = idx("GP"), iMin = idx("MIN"), iPts = idx("PTS"), iReb = idx("REB"), iAst = idx("AST"),
    iStl = idx("STL"), iBlk = idx("BLK"), iTov = idx("TOV"), iFg3m = idx("FG3M"),
    iFgm = idx("FGM"), iFga = idx("FGA"), iFtm = idx("FTM"), iFta = idx("FTA");
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
  return rs.rowSet
    .map((r) => ({
      playerId: String(r[iId]),
      // NBA.com occasionally has a placeholder roster row with no name on file yet
      // (seen as a null PLAYER_NAME + a synthetic ~196M-range id, likely a
      // late/unregistered addition) — String(null) would otherwise silently
      // become the literal string "null", polluting the name column and 404ing
      // the prospect-headshot lookup. Surface as empty string; filtered below.
      name: r[iName] == null ? "" : String(r[iName]),
      team: normalizeTeamAbbr(String(r[iTeam] ?? "")),
      gp: num(r[iGp]), min: num(r[iMin]), pts: num(r[iPts]), reb: num(r[iReb]), ast: num(r[iAst]),
      stl: num(r[iStl]), blk: num(r[iBlk]), tov: num(r[iTov]), fg3m: num(r[iFg3m]),
      fgm: num(r[iFgm]), fga: num(r[iFga]), ftm: num(r[iFtm]), fta: num(r[iFta]),
    }))
    .filter((r) => r.gp > 0 && r.name !== "");
}

// ── identity resolution ──────────────────────────────────────────────────────

/** nba_players → normalized name → ESPN athlete id (fetched once, shared across years). */
async function fetchEspnIdByName(): Promise<Map<string, string>> {
  const supabase = getServiceClient();
  const map = new Map<string, string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("nba_players")
      .select("id,full_name")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`nba_players fetch failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      const key = normalizeName(r.full_name as string);
      if (!map.has(key)) map.set(key, r.id as string);
    }
    if (rows.length < PAGE) break;
  }
  return map;
}

type ResolvedRow = ApiRow & { playerIdResolved: string; matched: boolean };

/**
 * Hand-approved ESPN athlete ids for players `nba_players` has never seen —
 * data/player-ids/espn-ids.json, produced by `npm run espn:resolve -- --emit`.
 *
 * ESPN issues an athlete id to a prospect long before his NBA debut and keeps it
 * through the transition, so an id from that file is the SAME id his eventual
 * hoopR/ESPN game logs will arrive under. Consulting it here means a Summer
 * League invitee lands on his real, permanent identity instead of the `sl-`
 * placeholder below — no re-key when he debuts, and ESPN-CDN headshots work.
 *
 * Optional by design: a missing file is not an error, it just means nothing has
 * been approved yet and every unmatched player keeps the `sl-` fallback.
 */
function loadApprovedEspnIds(): Map<string, string> {
  const file = path.join(process.cwd(), "data", "player-ids", "espn-ids.json");
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

/**
 * NBA.com person ids that refer to the same human WITHIN one event.
 *
 * stats.nba.com can return a player twice under two person records: Dain Dainja
 * appeared in Summer League 2026 as both `1643120` (4 games) and `27810` (1
 * game, his older id from the 2025 event), splitting his line across two rows
 * and listing him twice in the rankings. Found 2026-08-03 by
 * `npm run identity:reconcile`.
 *
 * Collapsed on normalized name AND team, deliberately: same name + same Summer
 * League roster is one player, whereas the same name on two teams could be a
 * genuine mid-event trade (which aggregateDuplicates already handles, because a
 * traded player keeps one person id) or two different people. The survivor is
 * the id with the most games — the more complete record — with the numerically
 * larger (newer) id as tiebreak, so the choice is deterministic across re-runs.
 */
function canonicalNbaComIds(rows: ApiRow[]): Map<string, string> {
  const groups = new Map<string, ApiRow[]>();
  for (const r of rows) {
    const key = `${normalizeName(r.name)}|${r.team ?? ""}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  const canonical = new Map<string, string>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const ids = [...new Set(list.map((r) => r.playerId))];
    if (ids.length < 2) continue; // already one id — aggregateDuplicates handles it
    const winner = [...list].sort(
      (a, b) => b.gp - a.gp || Number(b.playerId) - Number(a.playerId),
    )[0].playerId;
    for (const id of ids) canonical.set(id, winner);
    console.log(
      `  merged duplicate person records for ${list[0].name}: ${ids.join(" + ")} -> ${winner}`,
    );
  }
  return canonical;
}

function resolveIdentity(
  rows: ApiRow[],
  espnByName: Map<string, string>,
  approvedEspnIds: Map<string, string>,
): ResolvedRow[] {
  const canonical = canonicalNbaComIds(rows);
  return rows.map((r) => {
    const key = normalizeName(r.name);
    // nba_players first (a player with real NBA game logs is already canonical),
    // then the approved-override file, then the synthetic placeholder built on
    // the canonical NBA.com id.
    const espnId = espnByName.get(key) ?? approvedEspnIds.get(key);
    const nbaComId = canonical.get(r.playerId) ?? r.playerId;
    return { ...r, playerIdResolved: espnId ?? `sl-${nbaComId}`, matched: espnId != null };
  });
}

/** Sum any duplicate rows that resolved to the same identity (e.g. a mid-event team change). */
function aggregateDuplicates(rows: ResolvedRow[]): ResolvedRow[] {
  const byId = new Map<string, ResolvedRow>();
  for (const r of rows) {
    const existing = byId.get(r.playerIdResolved);
    if (!existing) {
      byId.set(r.playerIdResolved, { ...r });
      continue;
    }
    existing.gp += r.gp; existing.min += r.min;
    existing.pts += r.pts; existing.reb += r.reb; existing.ast += r.ast;
    existing.stl += r.stl; existing.blk += r.blk; existing.tov += r.tov;
    existing.fg3m += r.fg3m; existing.fgm += r.fgm; existing.fga += r.fga;
    existing.ftm += r.ftm; existing.fta += r.fta;
  }
  return [...byId.values()];
}

// ── stats shapes (per-game + totals, mirroring build-seasonal-values.ts) ─────

function buildStats(rows: ResolvedRow[]): PlayerStats[] {
  return rows.map((r) => ({
    playerId: r.playerIdResolved,
    pts: r.pts / r.gp, fg3m: r.fg3m / r.gp, reb: r.reb / r.gp, ast: r.ast / r.gp,
    stl: r.stl / r.gp, blk: r.blk / r.gp, tov: r.tov / r.gp,
    fgPct: r.fga === 0 ? 0 : r.fgm / r.fga, fga: r.fga / r.gp,
    ftPct: r.fta === 0 ? 0 : r.ftm / r.fta, fta: r.fta / r.gp,
  }));
}

function buildTotalsStats(rows: ResolvedRow[]): PlayerStats[] {
  return rows.map((r) => ({
    playerId: r.playerIdResolved,
    pts: r.pts, fg3m: r.fg3m, reb: r.reb, ast: r.ast, stl: r.stl, blk: r.blk, tov: r.tov,
    fgPct: r.fga === 0 ? 0 : r.fgm / r.fga, fga: r.fga,
    ftPct: r.fta === 0 ? 0 : r.ftm / r.fta, fta: r.fta,
  }));
}

function assertFinite(values: Map<number, RankedPlayerValues[]>): void {
  for (const [size, rows] of values) {
    for (const r of rows) {
      for (const [k, v] of Object.entries(r)) {
        if (typeof v === "number" && !Number.isFinite(v)) {
          throw new Error(`Non-finite ${k}=${v} for player ${r.playerId} at league_size ${size}`);
        }
      }
    }
  }
}

// ── upsert ────────────────────────────────────────────────────────────────────

async function upsert(
  year: number,
  rows: ResolvedRow[],
  values: Map<number, RankedPlayerValues[]>,
  totals: Map<number, RankedPlayerValues[]>,
  consensus: Map<string, { rank: number; position: string | null; team: string | null }>,
): Promise<void> {
  const supabase = getServiceClient();
  const now = new Date().toISOString();
  const byId = new Map(rows.map((r) => [r.playerIdResolved, r]));

  const statRows = rows.map((r) => {
    const cons = lookupWithNameAlias(consensus, normalizeName(r.name)) ?? null;
    return {
      player_id: r.playerIdResolved,
      season: year,
      season_type: "summer",
      name: r.name,
      team: r.team,
      position: cons?.position ?? pos5(null),
      headshot_id: r.matched ? r.playerIdResolved : null,
      g: r.gp,
      mpg: round1(r.min / r.gp),
      pts: round1(r.pts / r.gp),
      fg3m: round1(r.fg3m / r.gp),
      reb: round1(r.reb / r.gp),
      ast: round1(r.ast / r.gp),
      stl: round1(r.stl / r.gp),
      blk: round1(r.blk / r.gp),
      tov: round1(r.tov / r.gp),
      fga: round1(r.fga / r.gp),
      fta: round1(r.fta / r.gp),
      fg_pct: round3(r.fga === 0 ? 0 : r.fgm / r.fga),
      ft_pct: round3(r.fta === 0 ? 0 : r.ftm / r.fta),
      consensus_rank: cons?.rank ?? null,
      updated_at: now,
    };
  });

  const totIndex = new Map<string, RankedPlayerValues>();
  for (const [size, rs] of totals) for (const r of rs) totIndex.set(`${size}:${r.playerId}`, r);

  const valueRows: Record<string, unknown>[] = [];
  for (const [size, rs] of values) {
    for (const r of rs) {
      if (!byId.has(r.playerId)) continue;
      const t = totIndex.get(`${size}:${r.playerId}`) ?? null;
      valueRows.push({
        player_id: r.playerId,
        season: year,
        season_type: "summer",
        league_size: size,
        v_pts: round3(r.vPts), v_fg3: round3(r.vFg3), v_reb: round3(r.vReb), v_ast: round3(r.vAst),
        v_stl: round3(r.vStl), v_blk: round3(r.vBlk), v_fg: round3(r.vFg), v_ft: round3(r.vFt),
        v_to: round3(r.vTo), value: round3(r.value), minus1v: round3(r.minus1v), value_rank: r.valueRank,
        v_pts_tot: t ? round3(t.vPts) : null, v_fg3_tot: t ? round3(t.vFg3) : null,
        v_reb_tot: t ? round3(t.vReb) : null, v_ast_tot: t ? round3(t.vAst) : null,
        v_stl_tot: t ? round3(t.vStl) : null, v_blk_tot: t ? round3(t.vBlk) : null,
        v_fg_tot: t ? round3(t.vFg) : null, v_ft_tot: t ? round3(t.vFt) : null,
        v_to_tot: t ? round3(t.vTo) : null, value_tot: t ? round3(t.value) : null,
        minus1v_tot: t ? round3(t.minus1v) : null,
        updated_at: now,
      });
    }
  }

  await batchUpsert(supabase, "season_player_stats", statRows, "player_id,season,season_type");
  await batchUpsert(supabase, "season_player_values", valueRows, "player_id,season,season_type,league_size");
  console.log(`  ✓ upserted ${statRows.length} stat rows + ${valueRows.length} value rows`);

  await sweepStaleRows(supabase, year, statRows.map((r) => r.player_id as string));
}

/**
 * Delete rows in THIS dataset whose player_id this build no longer produces.
 *
 * Both writes above are upserts keyed on player_id, so whenever a player's id
 * changes — two NBA.com person records collapsing onto one, or a `sl-` id
 * becoming a real ESPN id — the new row is inserted and the OLD one survives.
 * The same human then appears twice in the rankings, which is exactly what
 * happened to Dain Dainja (sl-1643120 and sl-27810 both in 2026/summer).
 *
 * Scoped hard to (season, season_type='summer') so it can only ever remove rows
 * this very build was responsible for. It cannot touch a regular season, a
 * playoff dataset, or another Summer League year. Same posture as the `cons-`
 * sweep in build-real-salary-values.ts.
 */
async function sweepStaleRows(
  supabase: ReturnType<typeof getServiceClient>,
  year: number,
  writtenIds: string[],
): Promise<void> {
  const written = new Set(writtenIds);
  const { data, error } = await supabase
    .from("season_player_stats")
    .select("player_id,name")
    .eq("season", year)
    .eq("season_type", "summer");
  if (error) throw new Error(`sweep read failed: ${error.message}`);

  const stale = (data ?? []).filter((r) => !written.has(r.player_id as string));
  if (stale.length === 0) return;

  for (const r of stale) {
    const pid = r.player_id as string;
    for (const table of ["season_player_values", "season_player_stats"] as const) {
      const { error: delErr } = await supabase
        .from(table).delete()
        .eq("player_id", pid).eq("season", year).eq("season_type", "summer");
      if (delErr) throw new Error(`sweep delete ${table} ${pid}: ${delErr.message}`);
    }
  }
  console.log(
    `  swept ${stale.length} stale row(s) this build no longer produces: ` +
      stale.map((r) => `${r.name} (${r.player_id})`).join(", "),
  );
}

// ── per-year build ────────────────────────────────────────────────────────────

async function buildYear(
  year: number,
  espnByName: Map<string, string>,
  approvedEspnIds: Map<string, string>,
  consensus: Map<string, { rank: number; position: string | null; team: string | null }>,
): Promise<void> {
  console.log(`\n══ Summer League ${year} (Vegas) ══`);
  const raw = await fetchYear(year);
  console.log(`  ${raw.length} player rows fetched`);
  if (raw.length === 0) {
    console.log("  (no rows — skipping)");
    return;
  }

  const resolved = aggregateDuplicates(resolveIdentity(raw, espnByName, approvedEspnIds));
  const matched = resolved.filter((r) => r.matched).length;
  console.log(`  identity resolved: ${matched}/${resolved.length} matched an existing nba_players id`);

  const values = computeAllLeagueSizes(buildStats(resolved));
  assertFinite(values);
  const totals = computeAllLeagueSizes(buildTotalsStats(resolved));
  assertFinite(totals);

  const consMatched = resolved.filter((r) => lookupWithNameAlias(consensus, normalizeName(r.name)) != null).length;
  console.log(`  consensus matched for ${consMatched}/${resolved.length} players`);

  const nameOf = new Map(resolved.map((r) => [r.playerIdResolved, r.name]));
  const ranked250 = values.get(250)!;
  console.log(`  ── league_size 250: top 10 by value ──`);
  for (const r of ranked250.slice(0, 10)) {
    console.log(`  ${String(r.valueRank).padStart(2)}. ${(nameOf.get(r.playerId) ?? r.playerId).padEnd(26)} value=${r.value.toFixed(3)}`);
  }

  if (DRY_RUN) {
    console.log("  [DRY RUN] skipping upsert.");
    return;
  }
  await upsert(year, resolved, values, totals, consensus);
}

async function main(): Promise<void> {
  loadEnv();
  const years = ONLY != null ? YEARS.filter((y) => y === ONLY) : YEARS;
  if (years.length === 0) throw new Error(`--only ${ONLY} matched no Summer League year`);
  console.log(`Building ${years.length} Summer League dataset(s)${DRY_RUN ? " [DRY RUN]" : ""}: ${years.join(", ")}`);

  const [espnByName, consensus] = await Promise.all([fetchEspnIdByName(), Promise.resolve(loadConsensus())]);
  const approvedEspnIds = APPLY_ESPN_IDS ? loadApprovedEspnIds() : new Map<string, string>();
  if (APPLY_ESPN_IDS) {
    console.log(
      `Applying ${approvedEspnIds.size} approved ESPN id override(s) — this RE-KEYS players; ` +
      "rebuild projections -> trends -> realsalary after.",
    );
  } else {
    console.log("ESPN id overrides NOT applied (pass --apply-espn-ids; re-keys players, see the flag docs).");
  }

  for (const year of years) {
    await buildYear(year, espnByName, approvedEspnIds, consensus);
    if (year !== years[years.length - 1]) await sleep(750); // be polite to the unofficial endpoint
  }
  console.log(`\n✓ done (${years.length} dataset${years.length === 1 ? "" : "s"})`);
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
