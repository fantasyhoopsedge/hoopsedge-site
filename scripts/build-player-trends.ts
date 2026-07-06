/**
 * Build per-player, per-2-week-block value trends (9CatV / Minus1V / 8CatV).
 *
 *   npm run trends:build                     # ALL datasets, write JSON
 *   npm run trends:build -- --only 2026:regular
 *   npm run trends:build -- --dry-run        # compute + log, NO file write
 *
 * Pipeline (per dataset):
 *   1. Load the FROZEN 400-player baseline pool from the already-built
 *      season_player_stats / season_player_values tables (league_size 400) —
 *      the exact same pool /seasonal-rankings uses. Never recomputed per block.
 *   2. Load display-eligible players (season_player_stats: g>10 && mpg>10).
 *   3. Fetch the season's real (non-exhibition) game logs, derive 12 two-week
 *      block boundaries anchored to the season's actual first game date.
 *   4. Per player, per block: aggregate that block's games into a per-game
 *      PlayerStats line, then score it against the frozen pool via the
 *      UNMODIFIED compute-values.ts engine. Blocks with <2 games are stale and
 *      carry forward the last fresh block's values instead of being computed.
 *   5. Compute rolling windows (last2/last4/last6/seasonAvg) by RE-SUMMING raw
 *      per-game totals over each window (2/4/6 blocks, or expanding 0..i for
 *      seasonAvg) and scoring that ONCE against the pool — not by averaging
 *      the per-block z-scores from step 4. This is what makes seasonAvg at
 *      the final block reconcile exactly with the site's official season-long
 *      value (season_player_values): same aggregation, same pool, same engine.
 *      Also derives a trend label (rising/declining/stable) per metric, per
 *      block, from last2 vs. seasonAvg relative to the player's own volatility.
 *   6. Also pull up to 3 seasons (2024/2025/2026) of each player's ALREADY-COMPUTED
 *      real value (season_player_values — never recomputed) as `seasonHistory`,
 *      so trend-insight.ts can tell a genuine multi-season decline (e.g. an aging
 *      star whose minutes/production have fallen every year) apart from a
 *      single-season injury dip that just needs the block-level data above.
 *   7. Write output/player-trends/{season}-{type}.json.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getServiceClient, loadEnv } from "./nba-data/client";
import { computeValuesAgainstPool, type PlayerStats } from "../src/lib/value/compute-values";
import { SEASON_DATASETS, type SeasonType, type SeasonDataset as Dataset } from "../src/lib/value/seasons";
import { filterRealGames, type LogRow } from "./build-seasonal-values";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const onlyArgIdx = argv.indexOf("--only");
const ONLY = onlyArgIdx >= 0 ? argv[onlyArgIdx + 1] : null;

// ── constants ─────────────────────────────────────────────────────────────────
const POOL_LEAGUE_SIZE = 400;
const MIN_GAMES_DISPLAY = 10;
const MIN_MPG_DISPLAY = 10;
const BLOCK_COUNT = 12;
const BLOCK_DAYS = 14;
const LAST_BLOCK_START_DAY = (BLOCK_COUNT - 1) * BLOCK_DAYS; // 154
const MIN_GAMES_FRESH = 2;

type MetricKey = "nineCatV" | "minus1V" | "eightCatV";
const METRICS: MetricKey[] = ["nineCatV", "minus1V", "eightCatV"];

type RollingWindows = { last2: number | null; last4: number | null; last6: number | null; seasonAvg: number | null };
type Trend = "rising" | "declining" | "stable" | null;
// cumRank: this player's rank (1 = best) by rolling.seasonAvg among all display-eligible
// players AT THIS BLOCK — filled in by attachCumRanks() after every player is assembled.
type MetricBlock = { blockValue: number | null; rolling: RollingWindows; trend: Trend; cumRank: number | null };
type BlockOut = {
  block: number;
  dateRange: [string, string];
  gamesInBlock: number;
  stale: boolean;
  nineCatV: MetricBlock;
  minus1V: MetricBlock;
  eightCatV: MetricBlock;
  staleFractionLast2: number;
};
/** One prior/current season's real, already-computed value line (from season_player_values — never recomputed here). */
type SeasonHistoryEntry = {
  season: number;
  team: string | null;
  gp: number;
  mpg: number;
  nineCatV: number;
  minus1V: number;
  eightCatV: number;
};
type PlayerTrendOut = {
  playerId: string;
  player: string;
  team: string | null;
  position: string | null;
  consensusRank: number | null;
  gamesPlayed: number;
  mpg: number;
  blocks: BlockOut[];
  /** Up to 3 seasons (oldest first) — powers the age/aging-decline read in trend-insight.ts. */
  seasonHistory: SeasonHistoryEntry[];
};

type DisplayRow = {
  player_id: string;
  name: string;
  team: string | null;
  position: string | null;
  consensus_rank: number | null;
  g: number;
  mpg: number;
};

// ── pool + display-eligible loading (reuse existing precomputed tables) ───────

/** The frozen 400-player pool: the exact converged pool /seasonal-rankings uses. */
async function loadPool(season: number, seasonType: SeasonType): Promise<PlayerStats[]> {
  const supabase = getServiceClient();
  // season_player_values @ league_size=400 stores EVERY player in the feed
  // scored against the 400-pool baseline, not just the pool itself — the pool
  // membership is exactly the rows with value_rank <= 400 (top-N by Value).
  const { data: poolRows, error: poolErr } = await supabase
    .from("season_player_values")
    .select("player_id")
    .eq("season", season)
    .eq("season_type", seasonType)
    .eq("league_size", POOL_LEAGUE_SIZE)
    .lte("value_rank", POOL_LEAGUE_SIZE);
  if (poolErr) throw new Error(`pool fetch failed: ${poolErr.message}`);
  const poolIds = (poolRows ?? []).map((r) => r.player_id as string);
  if (poolIds.length === 0) {
    throw new Error(
      `no season_player_values rows for ${season}:${seasonType} @ league_size ${POOL_LEAGUE_SIZE} — run npm run seasonal:build first`,
    );
  }

  const stats: PlayerStats[] = [];
  const PAGE = 1000;
  for (let i = 0; i < poolIds.length; i += PAGE) {
    const chunk = poolIds.slice(i, i + PAGE);
    const { data, error } = await supabase
      .from("season_player_stats")
      .select("player_id,pts,fg3m,reb,ast,stl,blk,tov,fga,fta,fg_pct,ft_pct")
      .eq("season", season)
      .eq("season_type", seasonType)
      .in("player_id", chunk);
    if (error) throw new Error(`pool stats fetch failed: ${error.message}`);
    for (const r of data ?? []) {
      stats.push({
        playerId: r.player_id as string,
        pts: r.pts ?? 0,
        fg3m: r.fg3m ?? 0,
        reb: r.reb ?? 0,
        ast: r.ast ?? 0,
        stl: r.stl ?? 0,
        blk: r.blk ?? 0,
        tov: r.tov ?? 0,
        fgPct: r.fg_pct ?? 0,
        fga: r.fga ?? 0,
        ftPct: r.ft_pct ?? 0,
        fta: r.fta ?? 0,
      });
    }
  }
  return stats;
}

/** Season-long display filter (independent of pool membership). */
async function loadDisplayEligibleStats(season: number, seasonType: SeasonType): Promise<DisplayRow[]> {
  const supabase = getServiceClient();
  const out: DisplayRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("season_player_stats")
      .select("player_id,name,team,position,consensus_rank,g,mpg")
      .eq("season", season)
      .eq("season_type", seasonType)
      .gt("g", MIN_GAMES_DISPLAY)
      .gt("mpg", MIN_MPG_DISPLAY)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`display-eligible fetch failed: ${error.message}`);
    const rows = (data ?? []) as DisplayRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Up to 3 seasons of ALREADY-COMPUTED real value (season_player_values — never
 * recomputed here) per player, for the multi-season aging/decline read in
 * trend-insight.ts. Missing seasons (rookie, out of the league that year, or
 * simply not in the top-400 pool that year) are just absent from the array.
 */
async function fetchSeasonHistory(playerIds: string[]): Promise<Map<string, SeasonHistoryEntry[]>> {
  const supabase = getServiceClient();
  const HISTORY_SEASONS = [2024, 2025, 2026];
  const out = new Map<string, SeasonHistoryEntry[]>();
  if (playerIds.length === 0) return out;

  for (const season of HISTORY_SEASONS) {
    const [statsRes, valuesRes] = await Promise.all([
      supabase.from("season_player_stats").select("player_id,team,g,mpg").eq("season", season).eq("season_type", "regular").in("player_id", playerIds),
      supabase
        .from("season_player_values")
        .select("player_id,value,minus1v,v_to")
        .eq("season", season)
        .eq("season_type", "regular")
        .eq("league_size", POOL_LEAGUE_SIZE)
        .in("player_id", playerIds),
    ]);
    const valuesById = new Map((valuesRes.data ?? []).map((v) => [v.player_id, v]));
    for (const s of statsRes.data ?? []) {
      const v = valuesById.get(s.player_id);
      if (!v) continue; // not in that season's pool feed — skip rather than fabricate a value
      const entry: SeasonHistoryEntry = {
        season,
        team: s.team,
        gp: s.g,
        mpg: s.mpg,
        nineCatV: v.value ?? 0,
        minus1V: v.minus1v ?? 0,
        eightCatV: ((v.value ?? 0) * 9 - (v.v_to ?? 0)) / 8,
      };
      const arr = out.get(s.player_id) ?? [];
      arr.push(entry);
      out.set(s.player_id, arr);
    }
  }
  for (const arr of out.values()) arr.sort((a, b) => a.season - b.season);
  return out;
}

async function fetchSeasonLogs(season: number, seasonType: SeasonType): Promise<LogRow[]> {
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

// ── block boundary derivation ─────────────────────────────────────────────────

function dayOffset(dateStr: string, minDateStr: string): number {
  return Math.floor((Date.parse(dateStr) - Date.parse(minDateStr)) / 86400000);
}

/** Block 0-10 are 14-day windows; block 11 is open-ended (day>=154 through the last game). */
function assignBlock(dateStr: string, minDateStr: string): number {
  const d = Math.max(0, dayOffset(dateStr, minDateStr));
  if (d >= LAST_BLOCK_START_DAY) return BLOCK_COUNT - 1;
  return Math.floor(d / BLOCK_DAYS);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Real date range covered by each block, from the actual games played (not synthetic boundaries). */
function computeBlockDateRanges(logs: LogRow[], minDateStr: string): [string, string][] {
  const acc: { min: string | null; max: string | null }[] = Array.from({ length: BLOCK_COUNT }, () => ({
    min: null,
    max: null,
  }));
  for (const r of logs) {
    if (!r.game_date) continue;
    const b = assignBlock(r.game_date, minDateStr);
    const cur = acc[b];
    if (cur.min === null || r.game_date < cur.min) cur.min = r.game_date;
    if (cur.max === null || r.game_date > cur.max) cur.max = r.game_date;
  }
  return acc.map((rr, i) => {
    if (rr.min && rr.max) return [rr.min, rr.max] as [string, string];
    // No games logged in this block yet (e.g. mid-season build run) — nominal boundary.
    const start = addDays(minDateStr, i * BLOCK_DAYS);
    const end = addDays(minDateStr, i * BLOCK_DAYS + BLOCK_DAYS - 1);
    return [start, end] as [string, string];
  });
}

// ── per-player, per-block aggregation ─────────────────────────────────────────

type BlockAgg = {
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
const emptyAgg = (): BlockAgg => ({
  gp: 0, sumMin: 0, sumPts: 0, sumReb: 0, sumAst: 0, sumStl: 0, sumBlk: 0, sumTov: 0,
  sumFg3m: 0, sumFgm: 0, sumFga: 0, sumFtm: 0, sumFta: 0,
});
const n = (v: number | null) => (v == null ? 0 : v);

function aggregateByPlayerBlock(logs: LogRow[], minDateStr: string): Map<string, BlockAgg[]> {
  const out = new Map<string, BlockAgg[]>();
  for (const r of logs) {
    if (!r.game_date) continue;
    const b = assignBlock(r.game_date, minDateStr);
    let arr = out.get(r.player_id);
    if (!arr) {
      arr = Array.from({ length: BLOCK_COUNT }, emptyAgg);
      out.set(r.player_id, arr);
    }
    const a = arr[b];
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
  return out;
}

function statsFromAgg(playerId: string, a: BlockAgg): PlayerStats {
  return {
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
  };
}

// ── per-block value computation (the ONLY reuse of the core engine) ──────────

type RawBlock = {
  gamesInBlock: number;
  stale: boolean;
  fresh: Record<MetricKey, number> | null;
};

function computeRawBlocks(playerId: string, blockAggs: BlockAgg[] | undefined, pool: PlayerStats[]): RawBlock[] {
  const arr = blockAggs ?? Array.from({ length: BLOCK_COUNT }, emptyAgg);
  return arr.map((a) => {
    const gamesInBlock = a.gp;
    if (gamesInBlock < MIN_GAMES_FRESH) {
      return { gamesInBlock, stale: true, fresh: null };
    }
    const stats = statsFromAgg(playerId, a);
    const [pv] = computeValuesAgainstPool([stats], pool);
    const nineCatV = pv.value;
    const minus1V = pv.minus1v;
    const eightCatV = (pv.value * 9 - pv.vTo) / 8; // drop TO, matches roster-live-data.ts convention
    return { gamesInBlock, stale: false, fresh: { nineCatV, minus1V, eightCatV } };
  });
}

/** Stale blocks carry forward the last fresh block's value; leading stale blocks stay null. */
function carryForward(raw: RawBlock[]): Record<MetricKey, (number | null)[]> {
  const out: Record<MetricKey, (number | null)[]> = { nineCatV: [], minus1V: [], eightCatV: [] };
  const last: Record<MetricKey, number | null> = { nineCatV: null, minus1V: null, eightCatV: null };
  for (const b of raw) {
    for (const m of METRICS) {
      if (b.fresh) last[m] = b.fresh[m];
      out[m].push(last[m]);
    }
  }
  return out;
}

/**
 * Sums raw per-game totals over a trailing window of blocks (or an expanding
 * 0..idx window when `window` is idx+1), the same shape aggregate() /
 * build-seasonal-values.ts produces from the full season's game logs. Summing
 * games — not averaging already-computed block z-scores — is what makes a
 * rolling/cumulative value here mathematically the same computation as the
 * site's official season-long value once the window covers the whole season.
 */
function sumBlockAggs(blockAggs: BlockAgg[], endIdx: number, window: number): BlockAgg {
  const start = Math.max(0, endIdx - window + 1);
  const out = emptyAgg();
  for (const a of blockAggs.slice(start, endIdx + 1)) {
    out.gp += a.gp;
    out.sumMin += a.sumMin;
    out.sumPts += a.sumPts;
    out.sumReb += a.sumReb;
    out.sumAst += a.sumAst;
    out.sumStl += a.sumStl;
    out.sumBlk += a.sumBlk;
    out.sumTov += a.sumTov;
    out.sumFg3m += a.sumFg3m;
    out.sumFgm += a.sumFgm;
    out.sumFga += a.sumFga;
    out.sumFtm += a.sumFtm;
    out.sumFta += a.sumFta;
  }
  return out;
}

/** Re-derives per-game stats from a (possibly multi-block) summed aggregate and scores it ONCE against the pool — no games, no value. */
function valueFromAgg(playerId: string, agg: BlockAgg, pool: PlayerStats[]): Record<MetricKey, number> | null {
  if (agg.gp === 0) return null;
  const stats = statsFromAgg(playerId, agg);
  const [pv] = computeValuesAgainstPool([stats], pool);
  return { nineCatV: pv.value, minus1V: pv.minus1v, eightCatV: (pv.value * 9 - pv.vTo) / 8 };
}

function meanOf(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample stdev (ddof=1), matching compute-values.ts's convention. 0 for n<2. */
function sampleStdOf(xs: number[], mu: number): number {
  if (xs.length < 2) return 0;
  let acc = 0;
  for (const x of xs) {
    const d = x - mu;
    acc += d * d;
  }
  return Math.sqrt(acc / (xs.length - 1));
}

/** rising/declining vs. the player's OWN block-to-block volatility so far — not league-wide. */
function classifyTrend(seriesSoFar: number[], last2: number | null, seasonAvg: number | null): Trend {
  if (seriesSoFar.length < 2 || last2 == null || seasonAvg == null) return "stable";
  const mu = meanOf(seriesSoFar);
  const sd = sampleStdOf(seriesSoFar, mu);
  if (sd === 0) return "stable";
  const diff = last2 - seasonAvg;
  if (diff > 0.5 * sd) return "rising";
  if (diff < -0.5 * sd) return "declining";
  return "stable";
}

function staleFractionAt(raw: RawBlock[], idx: number): number {
  const start = Math.max(0, idx - 1);
  const window = raw.slice(start, idx + 1);
  const staleCount = window.filter((b) => b.stale).length;
  return staleCount / window.length;
}

function assemblePlayer(
  row: DisplayRow,
  blockAggs: BlockAgg[] | undefined,
  pool: PlayerStats[],
  ranges: [string, string][],
  seasonHistory: SeasonHistoryEntry[],
): PlayerTrendOut {
  const raw = computeRawBlocks(row.player_id, blockAggs, pool);
  const carried = carryForward(raw);
  const aggs = blockAggs ?? Array.from({ length: BLOCK_COUNT }, emptyAgg);

  const blocks: BlockOut[] = raw.map((b, i) => {
    // Rolling/cumulative windows re-aggregate raw game totals over the window
    // and score ONCE against the pool (not an average of per-block z-scores) —
    // seasonAvg at the final block is therefore the same computation as the
    // site's official season-long value, and reconciles with it exactly.
    const last2Val = valueFromAgg(row.player_id, sumBlockAggs(aggs, i, 2), pool);
    const last4Val = valueFromAgg(row.player_id, sumBlockAggs(aggs, i, 4), pool);
    const last6Val = valueFromAgg(row.player_id, sumBlockAggs(aggs, i, 6), pool);
    const cumVal = valueFromAgg(row.player_id, sumBlockAggs(aggs, i, i + 1), pool); // expanding window = all blocks 0..i

    const metricBlocks = {} as Record<MetricKey, MetricBlock>;
    for (const m of METRICS) {
      const series = carried[m];
      const blockValue = series[i];
      const rolling: RollingWindows = {
        last2: last2Val ? last2Val[m] : null,
        last4: last4Val ? last4Val[m] : null,
        last6: last6Val ? last6Val[m] : null,
        seasonAvg: cumVal ? cumVal[m] : null,
      };
      const seriesSoFar = series.slice(0, i + 1).filter((v): v is number => v != null);
      const trend = classifyTrend(seriesSoFar, rolling.last2, rolling.seasonAvg);
      metricBlocks[m] = { blockValue, rolling, trend, cumRank: null }; // filled in by attachCumRanks()
    }
    return {
      block: i,
      dateRange: ranges[i],
      gamesInBlock: b.gamesInBlock,
      stale: b.stale,
      nineCatV: metricBlocks.nineCatV,
      minus1V: metricBlocks.minus1V,
      eightCatV: metricBlocks.eightCatV,
      staleFractionLast2: staleFractionAt(raw, i),
    };
  });

  return {
    playerId: row.player_id,
    player: row.name,
    team: row.team,
    position: row.position,
    consensusRank: row.consensus_rank,
    gamesPlayed: row.g,
    mpg: row.mpg,
    blocks,
    seasonHistory,
  };
}

/**
 * Cross-sectional rank (1 = best) of rolling.seasonAvg among all display-eligible
 * players, computed independently per block per metric — mutates each player's
 * blocks in place. Run AFTER every player has been assembled (needs the full field).
 */
function attachCumRanks(players: PlayerTrendOut[]): void {
  for (let i = 0; i < BLOCK_COUNT; i++) {
    for (const m of METRICS) {
      const rows = players
        .map((p) => ({ block: p.blocks[i], v: p.blocks[i][m].rolling.seasonAvg }))
        .filter((r): r is { block: BlockOut; v: number } => r.v != null)
        .sort((a, b) => b.v - a.v);
      rows.forEach((r, idx) => {
        r.block[m].cumRank = idx + 1;
      });
    }
  }
}

// ── output ─────────────────────────────────────────────────────────────────────

function writeOutput(ds: Dataset, players: PlayerTrendOut[]): void {
  const dir = resolve(REPO_ROOT, "output/player-trends");
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${ds.season}-${ds.type}.json`);
  writeFileSync(
    path,
    JSON.stringify({ season: ds.season, seasonType: ds.type, generatedAt: new Date().toISOString(), players }),
  );
  console.log(`  wrote ${path} (${players.length} players)`);
}

async function buildTrendsForDataset(ds: Dataset): Promise<void> {
  console.log(`\n== ${ds.label} (season ${ds.season}/${ds.type}) ==`);

  const pool = await loadPool(ds.season, ds.type);
  console.log(`  pool: ${pool.length} players (league_size ${POOL_LEAGUE_SIZE})`);

  const displayRows = await loadDisplayEligibleStats(ds.season, ds.type);
  console.log(`  display-eligible: ${displayRows.length} players (g>${MIN_GAMES_DISPLAY} & mpg>${MIN_MPG_DISPLAY})`);
  if (displayRows.length === 0) {
    console.log("  (no display-eligible players -- skipping)");
    return;
  }

  const rawLogs = await fetchSeasonLogs(ds.season, ds.type);
  const logs = filterRealGames(rawLogs, ds);
  console.log(`  ${logs.length} game-log rows (of ${rawLogs.length} fetched)`);

  const datesWithGames = logs.map((r) => r.game_date).filter((d): d is string => d != null);
  if (datesWithGames.length === 0) {
    console.log("  (no dated game logs -- skipping)");
    return;
  }
  const minDate = datesWithGames.reduce((a, b) => (b < a ? b : a));

  const ranges = computeBlockDateRanges(logs, minDate);
  console.log(`  block boundaries (season start ${minDate}):`);
  ranges.forEach((r, i) => console.log(`    block ${String(i).padStart(2)}: ${r[0]} .. ${r[1]}`));

  const byPlayerBlock = aggregateByPlayerBlock(logs, minDate);

  const historyByPlayer = await fetchSeasonHistory(displayRows.map((r) => r.player_id));
  console.log(`  season history: ${historyByPlayer.size} players have >=1 prior/current season row`);

  const players: PlayerTrendOut[] = displayRows.map((row) =>
    assemblePlayer(row, byPlayerBlock.get(row.player_id), pool, ranges, historyByPlayer.get(row.player_id) ?? []),
  );
  attachCumRanks(players);

  if (DRY_RUN) {
    const sample = players[0];
    if (sample) {
      console.log(`  sample player: ${sample.player}`);
      console.log(JSON.stringify(sample, null, 2));
    }
    console.log("  [DRY RUN] skipping write");
    return;
  }

  writeOutput(ds, players);
}

async function main(): Promise<void> {
  loadEnv();
  const datasets = ONLY ? SEASON_DATASETS.filter((d) => `${d.season}:${d.type}` === ONLY) : SEASON_DATASETS;
  if (datasets.length === 0) throw new Error(`--only "${ONLY}" matched no dataset`);
  console.log(
    `Building player trends for ${datasets.length} dataset(s)${DRY_RUN ? " [DRY RUN]" : ""}: ${datasets.map((d) => d.label).join(", ")}`,
  );

  for (const ds of datasets) {
    await buildTrendsForDataset(ds);
  }
  console.log(`\ndone (${datasets.length} dataset${datasets.length === 1 ? "" : "s"})`);
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
