/**
 * Build the precomputed seasonal-rankings value sets and persist them.
 *
 *   npm run seasonal:build                     # ALL datasets, upsert to Supabase
 *   npm run seasonal:build -- --only 2026:regular
 *   npm run seasonal:build -- --dry-run        # compute + validate, NO writes
 *
 * Datasets: the regular season + playoffs for the seasons that have game logs
 * (see DATASETS). Each is built independently — same engine, its own baseline.
 *
 * Pipeline (per dataset):
 *   1. Aggregate per-game averages from nba_player_game_logs (the documented
 *      source of truth) for that season + season_type. We read the logs directly
 *      rather than the matview so fga/fta are always available.
 *   2. Run the industry-standard 9-cat value engine for every league size.
 *   3. Validation gate (league_size 400, 2025-26 regular ONLY) — must reproduce
 *      the reference export within tolerance, else STOP.
 *   4. Left-join dynasty consensus rank + position by aggressive-normalized name
 *      (consensus position overrides the nba_players position when present).
 *   5. Upsert season_player_stats + season_player_values, keyed by season +
 *      season_type so datasets coexist.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getServiceClient, normalizeName, loadEnv } from "./nba-data/client";
import { isNbaTeam, normalizeTeamAbbr } from "../src/lib/nba-teams";
import { lookupWithNameAlias } from "../src/lib/player-name-aliases";
import {
  computeAllLeagueSizes,
  type PlayerStats,
  type RankedPlayerValues,
} from "../src/lib/value/compute-values";
import {
  SEASON_DATASETS,
  GATE_DATASET as GATE,
  type SeasonType,
  type SeasonDataset as Dataset,
} from "../src/lib/value/seasons";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Datasets + the validation-gate target come from the shared module so the page
// and the build stay in lockstep. (SEASON_DATASETS, GATE, types imported above.)
const DATASETS = SEASON_DATASETS;

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const onlyArgIdx = argv.indexOf("--only");
// --only 2026:regular  → build just that dataset (key = `${season}:${type}`).
const ONLY = onlyArgIdx >= 0 ? argv[onlyArgIdx + 1] : null;

// ── validation gate reference (league_size = 400) ──────────────────────────────
const REF_VALUES: Record<string, number> = {
  "nikola jokic": 1.640,
  "victor wembanyama": 1.545,
  "shai gilgeous-alexander": 1.423,
};
const REF_BASELINE_PTS_MU = 11.783;
const VALUE_TOLERANCE = 0.03;

export type LogRow = {
  player_id: string;
  game_id: string | null;
  game_date: string | null;
  team: string | null;
  min: number | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  stl: number | null;
  blk: number | null;
  tov: number | null;
  fg3m: number | null;
  fgm: number | null;
  fga: number | null;
  ftm: number | null;
  fta: number | null;
};

// isNbaTeam() allowlists the 30 real teams (any known dialect, normalized) so
// All-Star / Rising Stars exhibition rows — whose "team" label changes every
// year (2024: EAST/WEST, 2025: CHK/SHQ/KEN/CAN, 2026: STARS/STRIPES/WORLD) and
// which the feed mislabels season_type='regular' — are dropped generically.

/**
 * The NBA Cup (In-Season Tournament) CHAMPIONSHIP game does not count toward
 * regular-season stats, but the feed tags it season_type='regular', giving the
 * two finalists 83 games. Detect it generically (no hardcoded ids): it's the
 * game the two >82-game teams share inside the tournament-final window
 * (~Dec 6-20, neutral site). Returns game_ids to drop. Regular season only.
 */
export function cupFinalGameIds(logs: LogRow[], ds: Dataset): Set<string> {
  const drop = new Set<string>();
  if (ds.type !== "regular") return drop;
  const byTeam = new Map<string, Set<string>>();
  const dateOf = new Map<string, string>();
  for (const r of logs) {
    if (!r.game_id || !r.team) continue;
    if (r.game_date) dateOf.set(r.game_id, r.game_date);
    (byTeam.get(r.team) ?? byTeam.set(r.team, new Set()).get(r.team)!).add(r.game_id);
  }
  const finalists = [...byTeam.entries()].filter(([, s]) => s.size > 82).map(([t]) => t);
  for (let i = 0; i < finalists.length; i++) {
    for (let j = i + 1; j < finalists.length; j++) {
      const a = byTeam.get(finalists[i])!;
      const b = byTeam.get(finalists[j])!;
      for (const g of a) {
        if (!b.has(g)) continue;
        const md = (dateOf.get(g) ?? "").slice(5); // MM-DD
        if (md >= "12-06" && md <= "12-20") drop.add(g);
      }
    }
  }
  return drop;
}

/** Drop exhibition (non-NBA-team) rows + the Cup final from a season's logs. */
export function filterRealGames(logs: LogRow[], ds: Dataset): LogRow[] {
  const nba = logs.filter((r) => isNbaTeam(r.team));
  const drop = cupFinalGameIds(nba, ds);
  const kept = drop.size > 0 ? nba.filter((r) => !(r.game_id && drop.has(r.game_id))) : nba;
  const exhibition = logs.length - nba.length;
  const cup = nba.length - kept.length;
  if (exhibition > 0 || cup > 0) {
    console.log(`  excluded ${exhibition} exhibition + ${cup} cup-final rows (non-counting)`);
  }
  return kept;
}

type Aggregate = {
  gp: number;
  sumMin: number;
  sumPts: number;
  sumReb: number;
  sumAst: number;
  sumStl: number;
  sumBlk: number;
  sumTov: number;
  sumFg3m: number;
  sumFgm: number;
  sumFga: number;
  sumFtm: number;
  sumFta: number;
};

const n = (v: number | null) => (v == null ? 0 : v);

async function fetchAllLogs(season: number, seasonType: SeasonType): Promise<LogRow[]> {
  const supabase = getServiceClient();
  const cols = "player_id,game_id,game_date,team,min,pts,reb,ast,stl,blk,tov,fg3m,fgm,fga,ftm,fta";
  const all: LogRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("nba_player_game_logs")
      .select(cols)
      .eq("season", season)
      .eq("season_type", seasonType)
      .order("game_date", { ascending: true })
      .order("game_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`game-log fetch failed: ${error.message}`);
    const rows = (data ?? []) as LogRow[];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

async function fetchPlayers(): Promise<Map<string, { name: string; team: string | null; position: string | null }>> {
  const supabase = getServiceClient();
  const map = new Map<string, { name: string; team: string | null; position: string | null }>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("nba_players")
      .select("id,full_name,team,position")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`players fetch failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) map.set(r.id as string, { name: r.full_name as string, team: r.team as string | null, position: r.position as string | null });
    if (rows.length < PAGE) break;
  }
  return map;
}

type ConsensusInfo = { rank: number; position: string | null; team: string | null };

/** dynasty-rankings.json → normalized name → { consensus rank, position, team }. */
export function loadConsensus(): Map<string, ConsensusInfo> {
  const raw = readFileSync(resolve(REPO_ROOT, "src/lib/dynasty-rankings.json"), "utf8");
  const players = JSON.parse(raw) as Array<{ player: string; consensusRank: number; position?: string | null; team?: string | null }>;
  const m = new Map<string, ConsensusInfo>();
  for (const p of players) {
    const key = normalizeName(p.player);
    if (!m.has(key)) {
      const mapped = normalizeTeamAbbr(p.team ?? null);
      m.set(key, {
        rank: p.consensusRank,
        position: pos5(p.position ?? null),
        team: mapped && isNbaTeam(mapped) ? mapped : null,
      });
    }
  }
  return m;
}

function aggregate(logs: LogRow[]): Map<string, Aggregate> {
  const agg = new Map<string, Aggregate>();
  for (const r of logs) {
    let a = agg.get(r.player_id);
    if (!a) {
      a = { gp: 0, sumMin: 0, sumPts: 0, sumReb: 0, sumAst: 0, sumStl: 0, sumBlk: 0, sumTov: 0, sumFg3m: 0, sumFgm: 0, sumFga: 0, sumFtm: 0, sumFta: 0 };
      agg.set(r.player_id, a);
    }
    a.gp += 1;
    a.sumMin += n(r.min);
    a.sumPts += n(r.pts);
    a.sumReb += n(r.reb);
    a.sumAst += n(r.ast);
    a.sumStl += n(r.stl);
    a.sumBlk += n(r.blk);
    a.sumTov += n(r.tov);
    a.sumFg3m += n(r.fg3m);
    a.sumFgm += n(r.fgm);
    a.sumFga += n(r.fga);
    a.sumFtm += n(r.ftm);
    a.sumFta += n(r.fta);
  }
  return agg;
}

function buildStats(agg: Map<string, Aggregate>): PlayerStats[] {
  const out: PlayerStats[] = [];
  for (const [playerId, a] of agg) {
    if (a.gp === 0) continue;
    out.push({
      playerId,
      pts: a.sumPts / a.gp,
      fg3m: a.sumFg3m / a.gp,
      reb: a.sumReb / a.gp,
      ast: a.sumAst / a.gp,
      stl: a.sumStl / a.gp,
      blk: a.sumBlk / a.gp,
      tov: a.sumTov / a.gp,
      fgPct: a.sumFga === 0 ? 0 : a.sumFgm / a.sumFga,
      fga: a.sumFga / a.gp,
      ftPct: a.sumFta === 0 ? 0 : a.sumFtm / a.sumFta,
      fta: a.sumFta / a.gp,
    });
  }
  return out;
}

/**
 * Season-TOTALS feed for the totals value mode: counting stats and attempts are
 * the season sums; percentages are unchanged (their impact scales via the total
 * attempts). Same engine, but standardized against the totals pool — so a player
 * who plays more games gets more value, unlike per-game.
 */
function buildTotalsStats(agg: Map<string, Aggregate>): PlayerStats[] {
  const out: PlayerStats[] = [];
  for (const [playerId, a] of agg) {
    if (a.gp === 0) continue;
    out.push({
      playerId,
      pts: a.sumPts,
      fg3m: a.sumFg3m,
      reb: a.sumReb,
      ast: a.sumAst,
      stl: a.sumStl,
      blk: a.sumBlk,
      tov: a.sumTov,
      fgPct: a.sumFga === 0 ? 0 : a.sumFgm / a.sumFga,
      fga: a.sumFga, // total attempts
      ftPct: a.sumFta === 0 ? 0 : a.sumFtm / a.sumFta,
      fta: a.sumFta, // total attempts
    });
  }
  return out;
}

type TeamTotals = { mp: number; fga: number; fta: number; tov: number };

/**
 * Team totals for USG%, summed directly from this dataset's raw game logs —
 * each row already carries the team the player actually suited up for in that
 * game, so a mid-season trade is handled correctly on the team side for free
 * (unlike build-projection-values.ts, which has no game logs to sum from and
 * has to fall back to one fixed team per player).
 */
function computeTeamTotals(logs: LogRow[]): Map<string, TeamTotals> {
  const teams = new Map<string, TeamTotals>();
  for (const r of logs) {
    if (!r.team) continue;
    const cur = teams.get(r.team) ?? { mp: 0, fga: 0, fta: 0, tov: 0 };
    cur.mp += n(r.min);
    cur.fga += n(r.fga);
    cur.fta += n(r.fta);
    cur.tov += n(r.tov);
    teams.set(r.team, cur);
  }
  return teams;
}

/**
 * Standard NBA usage rate, mirroring models/minutes-allocator/prep_depth_chart.py
 * and build-projection-values.ts's exact formula so all three never drift:
 *   USG% = 100 * (FGA + 0.44*FTA + TOV) * (TeamMP/5) / (MP * (TeamFGA + 0.44*TeamFTA + TeamTOV))
 * Player side uses this dataset's season totals (agg, already gp-filtered);
 * team side uses whichever team the stat row itself resolves to (teamOf —
 * same lastGameTeam-first fallback the upsert's own `team` column uses), so
 * the USG% column and the TEAM column on screen never disagree about which
 * team a player's usage is measured against.
 */
function computeUsgById(
  agg: Map<string, Aggregate>,
  teamTotals: Map<string, TeamTotals>,
  teamOf: (playerId: string) => string | null,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [playerId, a] of agg) {
    const team = teamOf(playerId);
    const t = team ? teamTotals.get(team) : undefined;
    if (!t || a.sumMin <= 0) continue;
    const denom = t.fga + 0.44 * t.fta + t.tov;
    if (denom <= 0) continue;
    const num = a.sumFga + 0.44 * a.sumFta + a.sumTov;
    out.set(playerId, round1((100 * num * (t.mp / 5)) / (a.sumMin * denom)));
  }
  return out;
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

function runValidationGate(
  stats: PlayerStats[],
  agg: Map<string, Aggregate>,
  players: Map<string, { name: string }>,
  values: Map<number, RankedPlayerValues[]>,
): void {
  const ranked400 = values.get(400)!;
  const byId = new Map(ranked400.map((r) => [r.playerId, r]));
  const nameOf = (id: string) => players.get(id)?.name ?? id;

  // Top-15 log
  console.log(`\n── league_size 400: top 15 by value ──`);
  for (const r of ranked400.slice(0, 15)) {
    console.log(`${String(r.valueRank).padStart(2)}. ${nameOf(r.playerId).padEnd(26)} value=${r.value.toFixed(3)} minus1v=${r.minus1v.toFixed(3)}`);
  }

  // Baseline pts μ over the converged top-400 pool (= valueRank ≤ 400).
  const statById = new Map(stats.map((s) => [s.playerId, s]));
  const poolPts = ranked400.slice(0, Math.min(400, ranked400.length)).map((r) => statById.get(r.playerId)!.pts);
  const muPts = poolPts.reduce((a, b) => a + b, 0) / poolPts.length;
  console.log(`\nbaseline p/g μ (top-400 pool) = ${muPts.toFixed(3)} (ref ≈ ${REF_BASELINE_PTS_MU})`);

  // Per-player reference checks
  const failures: string[] = [];
  const normToId = new Map<string, string>();
  for (const id of byId.keys()) normToId.set(normalizeName(nameOf(id)), id);

  for (const [normName, ref] of Object.entries(REF_VALUES)) {
    const id = normToId.get(normName);
    if (!id) {
      failures.push(`reference player "${normName}" not found in feed`);
      continue;
    }
    const got = byId.get(id)!.value;
    const drift = Math.abs(got - ref);
    const ok = drift <= VALUE_TOLERANCE;
    console.log(`${normName.padEnd(26)} value=${got.toFixed(3)} ref=${ref} drift=${drift.toFixed(3)} ${ok ? "OK" : "FAIL"}`);
    if (!ok) failures.push(`${normName}: drift ${drift.toFixed(3)} > ${VALUE_TOLERANCE}`);
  }

  if (Math.abs(muPts - REF_BASELINE_PTS_MU) > 0.5) {
    failures.push(`baseline p/g μ ${muPts.toFixed(3)} far from ref ${REF_BASELINE_PTS_MU}`);
  }

  if (failures.length > 0) {
    throw new Error(`VALIDATION GATE FAILED:\n  - ${failures.join("\n  - ")}`);
  }
  console.log(`\n✓ validation gate passed (league_size 400 within tolerance ${VALUE_TOLERANCE})`);
}

export function pos5(position: string | null): string | null {
  if (!position) return null;
  const p = position.toUpperCase();
  if (["PG", "SG", "G"].includes(p)) return "G";
  if (["SF", "PF", "F"].includes(p)) return "F";
  if (p === "C") return "C";
  if (p === "G/F" || p === "F/C" || p === "C/F" || p === "F/G") return p === "F/G" ? "G/F" : p === "C/F" ? "F/C" : p;
  return p;
}

async function upsert(
  ds: Dataset,
  stats: PlayerStats[],
  agg: Map<string, Aggregate>,
  players: Map<string, { name: string; team: string | null; position: string | null }>,
  consensus: Map<string, ConsensusInfo>,
  lastGameTeam: Map<string, string>,
  values: Map<number, RankedPlayerValues[]>,
  totals: Map<number, RankedPlayerValues[]>,
  usgById: Map<string, number>,
): Promise<void> {
  const supabase = getServiceClient();
  const now = new Date().toISOString();

  const statRows = stats.map((s) => {
    const a = agg.get(s.playerId)!;
    const meta = players.get(s.playerId);
    const name = meta?.name ?? s.playerId;
    const cons = lookupWithNameAlias(consensus, normalizeName(name)) ?? null;
    return {
      player_id: s.playerId,
      season: ds.season,
      season_type: ds.type,
      name,
      // Team priority — player cat values always shows the team a player
      // actually accumulated that season's stats with, never today's roster:
      // 1. Last game log team — the team they actually finished the season
      //    with. This must win whenever it exists; a player's current/dynasty
      //    team can differ (trade, free agency, waiver) without that season's
      //    box scores changing which team they were on when they were played.
      // 2. nba_players snapshot — fallback for a player with zero game logs
      //    that season (e.g. injured all year).
      // 3. Consensus (current season only) — last resort only, for a player
      //    with no game logs AND no nba_players team on file (e.g. moved at
      //    the trade deadline and never suited up for either team that
      //    season). Historical seasons skip this because the consensus
      //    reflects today's roster, not where a player finished that season.
      //
      // PREVIOUSLY consensus was checked first for the current season, which
      // meant any player whose current team differs from where they actually
      // played (Nic Claxton BKN->CHI, Norman Powell MIA->CHI, Walker Kessler
      // UTA->LAL, Rui Hachimura LAL->LAC, Cole Anthony's ORL/MIL mismatch)
      // had their real season team silently overwritten by their current
      // roster team. Team-rosters and dynasty-rankings are the right place
      // for "current team" — this table is specifically the season's stats.
      team: lastGameTeam.get(s.playerId)
        ?? meta?.team
        ?? (ds.season === GATE.season ? (cons?.team ?? null) : null),
      // Consensus position wins when the player is ranked; else fall back to the
      // nba_players position. (Item 2.)
      position: cons?.position ?? pos5(meta?.position ?? null),
      headshot_id: s.playerId, // ESPN athlete id (page builds the ESPN headshot URL from this)
      g: a.gp,
      mpg: round1(a.sumMin / a.gp),
      pts: round1(s.pts),
      fg3m: round1(s.fg3m),
      reb: round1(s.reb),
      ast: round1(s.ast),
      stl: round1(s.stl),
      blk: round1(s.blk),
      tov: round1(s.tov),
      fga: round1(s.fga),
      fta: round1(s.fta),
      fg_pct: round3(s.fgPct),
      ft_pct: round3(s.ftPct),
      usg_pct: usgById.get(s.playerId) ?? null,
      consensus_rank: cons?.rank ?? null,
      updated_at: now,
    };
  });

  // index totals values by size+player for a parallel lookup
  const totIndex = new Map<string, RankedPlayerValues>();
  for (const [size, rows] of totals) for (const r of rows) totIndex.set(`${size}:${r.playerId}`, r);

  const valueRows: Record<string, unknown>[] = [];
  for (const [size, rows] of values) {
    for (const r of rows) {
      const t = totIndex.get(`${size}:${r.playerId}`) ?? null;
      valueRows.push({
        player_id: r.playerId,
        season: ds.season,
        season_type: ds.type,
        league_size: size,
        v_pts: round3(r.vPts),
        v_fg3: round3(r.vFg3),
        v_reb: round3(r.vReb),
        v_ast: round3(r.vAst),
        v_stl: round3(r.vStl),
        v_blk: round3(r.vBlk),
        v_fg: round3(r.vFg),
        v_ft: round3(r.vFt),
        v_to: round3(r.vTo),
        value: round3(r.value),
        minus1v: round3(r.minus1v),
        value_rank: r.valueRank,
        // totals-mode (null only if a player somehow lacks a totals row)
        v_pts_tot: t ? round3(t.vPts) : null,
        v_fg3_tot: t ? round3(t.vFg3) : null,
        v_reb_tot: t ? round3(t.vReb) : null,
        v_ast_tot: t ? round3(t.vAst) : null,
        v_stl_tot: t ? round3(t.vStl) : null,
        v_blk_tot: t ? round3(t.vBlk) : null,
        v_fg_tot: t ? round3(t.vFg) : null,
        v_ft_tot: t ? round3(t.vFt) : null,
        v_to_tot: t ? round3(t.vTo) : null,
        value_tot: t ? round3(t.value) : null,
        minus1v_tot: t ? round3(t.minus1v) : null,
        updated_at: now,
      });
    }
  }

  await batchUpsert(supabase, "season_player_stats", statRows, "player_id,season,season_type");
  await batchUpsert(supabase, "season_player_values", valueRows, "player_id,season,season_type,league_size");
  console.log(`  ✓ upserted ${statRows.length} stat rows + ${valueRows.length} value rows`);
}

export const round1 = (x: number) => Math.round(x * 10) / 10;
export const round3 = (x: number) => Math.round(x * 1000) / 1000;

export async function batchUpsert(
  supabase: ReturnType<typeof getServiceClient>,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<void> {
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`upsert ${table} failed: ${error.message}`);
  }
}

async function buildDataset(
  ds: Dataset,
  players: Map<string, { name: string; team: string | null; position: string | null }>,
  consensus: Map<string, ConsensusInfo>,
): Promise<void> {
  console.log(`\n══ ${ds.label}  (season ${ds.season} / ${ds.type}) ══`);
  const rawLogs = await fetchAllLogs(ds.season, ds.type);
  const logs = filterRealGames(rawLogs, ds);
  console.log(`  ${logs.length} game-log rows (of ${rawLogs.length} fetched)`);

  // Last team each player appeared for in this season's game logs (game_date is
  // YYYY-MM-DD so lexicographic comparison gives chronological order).
  const lastGameEntry = new Map<string, { date: string; team: string }>();
  for (const r of logs) {
    if (!r.team || !r.game_date) continue;
    const prev = lastGameEntry.get(r.player_id);
    if (!prev || r.game_date > prev.date) {
      lastGameEntry.set(r.player_id, { date: r.game_date, team: r.team });
    }
  }
  const lastGameTeam = new Map<string, string>(
    [...lastGameEntry.entries()].map(([id, e]) => [id, e.team]),
  );
  const agg = aggregate(logs);
  const stats = buildStats(agg);
  console.log(`  aggregated ${stats.length} players (the feed)`);
  if (stats.length === 0) {
    console.log("  (no players — skipping)");
    return;
  }

  // Sanity: no regular-season player should exceed 82 games once non-counting
  // games are removed. Surface any drift (e.g. a new exhibition label) loudly.
  if (ds.type === "regular") {
    const over = [...agg.entries()].filter(([, a]) => a.gp > 82);
    if (over.length > 0) {
      console.warn(`  ⚠ ${over.length} player(s) still >82 GP: ${over.map(([id, a]) => `${id}:${a.gp}`).join(", ")}`);
    }
  }

  const values = computeAllLeagueSizes(stats);
  assertFinite(values);

  // Totals mode: same engine over season totals (rewards volume/durability).
  const totals = computeAllLeagueSizes(buildTotalsStats(agg));
  assertFinite(totals);

  // The reference export only applies to the calibrated dataset (per-game); other
  // seasons / playoffs have no reference, so the gate would be meaningless there.
  if (ds.season === GATE.season && ds.type === GATE.type) {
    runValidationGate(stats, agg, players, values);
  }

  const matched = stats.filter((s) => lookupWithNameAlias(consensus, normalizeName(players.get(s.playerId)?.name ?? "")) != null).length;
  console.log(`  consensus matched for ${matched}/${stats.length} players`);

  // USG% — team totals summed from this dataset's own logs; player's team
  // resolved the same way the stat row's own TEAM column is (lastGameTeam
  // first, falling back to the nba_players snapshot).
  const teamTotals = computeTeamTotals(logs);
  const teamOf = (playerId: string) => lastGameTeam.get(playerId) ?? players.get(playerId)?.team ?? null;
  const usgById = computeUsgById(agg, teamTotals, teamOf);

  if (DRY_RUN) {
    console.log("  [DRY RUN] skipping upsert.");
    return;
  }
  await upsert(ds, stats, agg, players, consensus, lastGameTeam, values, totals, usgById);
}

async function main(): Promise<void> {
  loadEnv();
  const datasets = ONLY ? DATASETS.filter((d) => `${d.season}:${d.type}` === ONLY) : DATASETS;
  if (datasets.length === 0) throw new Error(`--only "${ONLY}" matched no dataset`);
  console.log(`Building ${datasets.length} dataset(s)${DRY_RUN ? " [DRY RUN]" : ""}: ${datasets.map((d) => d.label).join(", ")}`);

  const players = await fetchPlayers();
  const consensus = loadConsensus();

  for (const ds of datasets) {
    await buildDataset(ds, players, consensus);
  }
  console.log(`\n✓ done (${datasets.length} dataset${datasets.length === 1 ? "" : "s"})`);
}

// Guard against running main() as a side effect of importing filterRealGames/
// etc. into another script (e.g. build-player-trends.ts) — only run the build
// when this file is the actual entrypoint.
const isEntrypoint = process.argv[1] != null && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) {
  main().catch((e) => {
    console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
