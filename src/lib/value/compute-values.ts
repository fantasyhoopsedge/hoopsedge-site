/**
 * BBM-style 9-category value engine for /seasonal-rankings.
 *
 * THE ONE RULE: the 9 category V-scores, Value, and Minus1V are z-scores
 * standardized against a BASELINE POOL. The pool = the top-N players by Value,
 * where N = league roster capacity (teams × roster spots). The league size IS
 * the baseline, so values are computed ONCE PER LEAGUE SIZE. Different size =
 * different baseline = different values for the same player. That is correct.
 *
 * Per-game/totals display and min-games/min-minutes filters live in the UI and
 * NEVER enter this math.
 *
 * Verified conventions (do not change without re-validating against the BBM
 * reference export — see scripts/build-seasonal-values.ts validation gate):
 *   • σ is the SAMPLE standard deviation (ddof = 1, divide by N−1).
 *   • League FG%/FT% averages are VOLUME-WEIGHTED (Σmakes / Σattempts over the
 *     pool), realized here as Σ(pct·att)/Σ(att).
 */

/**
 * Fixed menu of baseline pool sizes (total rostered players across the league).
 * The pool size IS the baseline, so values are computed once per size. 400 is
 * retained because the build's validation gate is calibrated against the BBM
 * reference at size 400.
 */
export const LEAGUE_SIZES = [250, 280, 300, 320, 340, 360, 380, 400, 420, 450] as const;
export type LeagueSize = (typeof LEAGUE_SIZES)[number];

/** Default pool shown on the page. */
export const CANONICAL_SIZE: LeagueSize = 400;

/** Iteration cap for pool convergence; real data converges in ~3–4 passes. */
const MAX_ITERS = 12;

/** Per-game raw stats one player needs to be scored. */
export interface PlayerStats {
  playerId: string;
  pts: number;
  fg3m: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fgPct: number; // Σfgm/Σfga over the player's own games
  fga: number; // per game
  ftPct: number;
  fta: number; // per game
}

/** The 9 category V-scores plus the two summary scores, for one player. */
export interface PlayerValues {
  playerId: string;
  vPts: number;
  vFg3: number;
  vReb: number;
  vAst: number;
  vStl: number;
  vBlk: number;
  vFg: number;
  vFt: number;
  vTo: number;
  value: number;
  minus1v: number;
}

/** Like PlayerValues but with a 1-based rank within the league size (by value desc). */
export interface RankedPlayerValues extends PlayerValues {
  valueRank: number;
}

// ── small numeric helpers ────────────────────────────────────────────────────

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation (ddof = 1). Returns 0 for n < 2 so callers divide-guard. */
function sampleStd(xs: number[], mu: number): number {
  const n = xs.length;
  if (n < 2) return 0;
  let acc = 0;
  for (const x of xs) {
    const d = x - mu;
    acc += d * d;
  }
  return Math.sqrt(acc / (n - 1));
}

/** z = (x − μ)/σ, with σ = 0 guarded to 0 (no NaN). */
function z(x: number, mu: number, sigma: number): number {
  if (sigma === 0) return 0;
  return (x - mu) / sigma;
}

/** Volume-weighted league percentage over the pool: Σ(pct·att)/Σ(att). */
function volumeWeightedPct(pool: PlayerStats[], pct: (p: PlayerStats) => number, att: (p: PlayerStats) => number): number {
  let num = 0;
  let den = 0;
  for (const p of pool) {
    num += pct(p) * att(p);
    den += att(p);
  }
  return den === 0 ? 0 : num / den;
}

// ── core V-score computation against a given baseline pool ────────────────────

/**
 * Score EVERY player in `players` against the baseline `pool`. Players outside
 * the pool still receive values — they just don't define the baseline.
 */
export function computeValuesAgainstPool(players: PlayerStats[], pool: PlayerStats[]): PlayerValues[] {
  // Counting-stat pool moments.
  const muPts = mean(pool.map((p) => p.pts));
  const sdPts = sampleStd(pool.map((p) => p.pts), muPts);
  const muFg3 = mean(pool.map((p) => p.fg3m));
  const sdFg3 = sampleStd(pool.map((p) => p.fg3m), muFg3);
  const muReb = mean(pool.map((p) => p.reb));
  const sdReb = sampleStd(pool.map((p) => p.reb), muReb);
  const muAst = mean(pool.map((p) => p.ast));
  const sdAst = sampleStd(pool.map((p) => p.ast), muAst);
  const muStl = mean(pool.map((p) => p.stl));
  const sdStl = sampleStd(pool.map((p) => p.stl), muStl);
  const muBlk = mean(pool.map((p) => p.blk));
  const sdBlk = sampleStd(pool.map((p) => p.blk), muBlk);
  const muTo = mean(pool.map((p) => p.tov));
  const sdTo = sampleStd(pool.map((p) => p.tov), muTo);

  // Percentage impact = (pct − leagueAvg)·attempts; standardized over the pool.
  const Lfg = volumeWeightedPct(pool, (p) => p.fgPct, (p) => p.fga);
  const Lft = volumeWeightedPct(pool, (p) => p.ftPct, (p) => p.fta);
  const fgImpact = (p: PlayerStats) => (p.fga === 0 ? 0 : (p.fgPct - Lfg) * p.fga);
  const ftImpact = (p: PlayerStats) => (p.fta === 0 ? 0 : (p.ftPct - Lft) * p.fta);
  const poolFgImpacts = pool.map(fgImpact);
  const poolFtImpacts = pool.map(ftImpact);
  const muFgImp = mean(poolFgImpacts);
  const sdFgImp = sampleStd(poolFgImpacts, muFgImp);
  const muFtImp = mean(poolFtImpacts);
  const sdFtImp = sampleStd(poolFtImpacts, muFtImp);

  return players.map((p) => {
    const vPts = z(p.pts, muPts, sdPts);
    const vFg3 = z(p.fg3m, muFg3, sdFg3);
    const vReb = z(p.reb, muReb, sdReb);
    const vAst = z(p.ast, muAst, sdAst);
    const vStl = z(p.stl, muStl, sdStl);
    const vBlk = z(p.blk, muBlk, sdBlk);
    // Turnovers are negated: fewer turnovers => positive value.
    const vTo = -z(p.tov, muTo, sdTo);
    const vFg = z(fgImpact(p), muFgImp, sdFgImp);
    const vFt = z(ftImpact(p), muFtImp, sdFtImp);

    const nine = [vPts, vFg3, vReb, vAst, vStl, vBlk, vFg, vFt, vTo];
    const sum = nine.reduce((a, b) => a + b, 0);
    const value = sum / 9;
    const minus1v = (sum - Math.min(...nine)) / 8;

    return { playerId: p.playerId, vPts, vFg3, vReb, vAst, vStl, vBlk, vFg, vFt, vTo, value, minus1v };
  });
}

function topNIds(values: PlayerValues[], n: number): Set<string> {
  const ranked = [...values].sort((a, b) => b.value - a.value);
  return new Set(ranked.slice(0, n).map((v) => v.playerId));
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * Compute values for one league size N via iterative pool convergence:
 *   1. Seed pool = entire feed; score everyone.
 *   2. Take top-N by Value; re-derive the baseline over those N; re-score all.
 *   3. Repeat until the top-N membership set is stable (or MAX_ITERS).
 *   4. Score the whole feed against the converged pool; rank 1-based by Value.
 * Guard: if feed ≤ N, the pool is the entire feed (no iteration possible).
 */
export function computeLeagueValues(players: PlayerStats[], n: number): RankedPlayerValues[] {
  const byId = new Map(players.map((p) => [p.playerId, p]));
  let values: PlayerValues[];

  if (players.length <= n) {
    values = computeValuesAgainstPool(players, players);
  } else {
    let poolIds: string[] = players.map((p) => p.playerId); // seed = all
    let prevTop: Set<string> | null = null;
    values = computeValuesAgainstPool(players, players);

    for (let i = 0; i < MAX_ITERS; i++) {
      const pool = poolIds.map((id) => byId.get(id)!).filter(Boolean);
      values = computeValuesAgainstPool(players, pool);
      const top = topNIds(values, n);
      if (prevTop && sameSet(prevTop, top)) break;
      prevTop = top;
      poolIds = [...top];
    }
    // `values` is already scored against the converged pool (the last poolIds).
  }

  const ranked = [...values].sort((a, b) => b.value - a.value);
  return ranked.map((v, i) => ({ ...v, valueRank: i + 1 }));
}

/** Compute values for every league size in LEAGUE_SIZES. */
export function computeAllLeagueSizes(players: PlayerStats[]): Map<number, RankedPlayerValues[]> {
  const out = new Map<number, RankedPlayerValues[]>();
  for (const n of LEAGUE_SIZES) out.set(n, computeLeagueValues(players, n));
  return out;
}
