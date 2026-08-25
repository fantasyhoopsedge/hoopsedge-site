/**
 * Base-value curve for DYNASTY trade valuation (Trade Edge's standard/real-
 * salary/custom-salary branches, trade-value.ts) — replaces rankToZ() as the
 * final rank -> value step for those three branches only. Never touches the
 * 9-cat production z-score engine (compute-values.ts) or Trade Edge's
 * redraft branch, which are correctly z-score-based and out of scope here.
 *
 * ── Why not rankToZ() ────────────────────────────────────────────────────
 * Backtesting against 85 real Angle Dynasty League trades (Ash, 2026-08-25)
 * surfaced a real defect: rankToZ() is signed and roughly symmetric around
 * the pool median, so trade-verdict.ts's ASSET_FLOOR_PCT_OF_TOP clamp made
 * EVERY below-replacement asset (anyone ranked worse than ~mid-pool) collapse
 * onto the exact same flat floor constant, regardless of how far below
 * replacement they actually were. Justin Champagnie (real-salary rank 251,
 * z=+0.136) and Bones Hyland (rank 287, z=-0.025 -> floored to 0.0625)
 * looked wildly apart in Trade Edge despite sitting 36 ranks apart in the
 * flattest part of the pool and carrying almost identical real salaries —
 * the floor was substituting for their true (small) value gap, not
 * reflecting it.
 *
 * ── The table (TABLE / tableValueAtRank) ─────────────────────────────────
 * TABLE is not a formula — it's extracted verbatim from "ALL ACCESS - BETA -
 * NBA Dynasty Trade Calculator (Categories) - July 2026.xlsx"'s own "Values"
 * sheet (rows 16-540, the 525 individually hand-valued players; rows 1-15,
 * the draft-pick tiers, are CATEGORIES_PICK_TIERS in trade-verdict.ts and
 * already ratio-transplant against this same curve's rank-1 value — see that
 * file's "Pick valuation" doc). Confirmed strictly monotonic non-increasing
 * across all 525 rows, and the pick tiers land EXACTLY on specific ranks in
 * this table (e.g. "2026 #23-30" = 55.0 = this table's own rank-259 value to
 * 13 decimal places) — i.e. the reference's picks and named players already
 * share one continuous value curve; this file is that curve's player half.
 *
 * ── Reshaping the top (the shipped curve, curveValueAtRank) ─────────────
 * Ash judged the reference table's own top end too steep (2026-08-25) —
 * rank 1 to rank 10 alone spans ~1590 to ~800, more than the entire rest of
 * the top 100 combined. Flattening it went through several rounds of
 * hand-specified reshaping, each validated against the real 85-trade
 * backtest through the ACTUAL shipped pipeline (computeBaseTradeValues +
 * unmodified computeTradeVerdict/pickEquivalentValue/rookieBoardRatio, real
 * rookie board included). The curve actually shipped here — "Pink" — is a
 * three-stage construction:
 *
 *   1. power065(r) = MAX_LIST_VALUE * (tableValueAtRank(r)/MAX_LIST_VALUE)^0.65
 *      — a straight power-law compression of the table curve, used verbatim
 *      for ranks 1-10.
 *   2. hybridA(r) — ranks 10-525: blends power065 and the table curve in
 *      LAMBDA space, weight decaying from 100% power at rank 10 to exactly
 *      25% power (75% table) at rank 87, reaching 0% (pure table) at rank
 *      525 — gamma solved once so lambda(87) lands exactly on 0.25.
 *   3. hybridB(r) — ranks 10-450: blends the same two curves in RATIO space
 *      instead (value = tableValueAtRank(r) * ratio(r)), smoothstep-
 *      interpolated through control points at ranks 10/50/87/250/450, with
 *      a genuinely FLAT ratio between 87 and 250 (a literal parallel run
 *      against the table curve on a log-value chart) before reconverging to
 *      1.0 (pure table) by rank 450.
 *   4. pink(r) — the shipped curve — runs exactly as hybridB through rank
 *      87, then smoothstep-narrows the hybridB/hybridA RATIO from its
 *      rank-87 value down to exactly 1.0 at rank 300 (one continuous
 *      interpolation, not two segments — checked the ratio is still
 *      meaningfully above 1.0 at rank 150, i.e. genuinely not touching
 *      hybridA yet: 1.24 at 150 vs. 1.30 at 87), then runs as the original
 *      table curve for every rank beyond 300 (hybridA has already
 *      reconverged there too).
 *
 * Verified zero monotonicity violations across all 525 table ranks (every
 * intermediate curve, and the final pink blend). Backtest results through
 * the real pipeline (85 trades): pink's BEST match rate across all fairness
 * thresholds is 48/85 (56%, the best of every curve tested, at threshold
 * 17%) vs. the unreshaped table curve's 43/85 (51%, at 14%). At the
 * currently-shipped 24% fairnessThresholdPct specifically, pink scores
 * 42/85 — slightly BELOW the unreshaped curve's 43/85 at that same
 * threshold — a real, known trade-off of reshaping the top end that Ash
 * accepted knowingly rather than a regression to chase; fairnessThresholdPct
 * was intentionally left at 0.24 rather than re-tuned to pink's own best
 * threshold.
 *
 * This is exactly the flattening Ash asked for: the curve still drops from
 * 1590 (rank 1) to single digits by rank 400+ — subjective, tightly-bunched
 * value below the top ~250 is already what the reference intends — but the
 * top ~90 ranks are now visibly less front-loaded than the reference's own
 * raw table.
 */
import TABLE from "./dynasty-value-curve.json";

/** Log-linear decay rate fit over the table's last 100 points, used to
 *  extend the curve past its own 525 rows (a real-salary pool runs to ~562;
 *  a site-wide dynasty consensus board can run longer still). Anchored to
 *  continue exactly from TABLE[524]=4.8, not the regression's own intercept,
 *  so there's no discontinuity at the rank-525 boundary. */
const TAIL_DECAY_RATE = -0.015286744389834543;

/** The curve's own rank-1 value (1590, Wembanyama in the reference) — also
 *  the MaxList anchor CATEGORIES_PICK_TIERS/POINTS_PICK_TIERS ratio-transplant
 *  against in trade-verdict.ts's pickEquivalentValue(). */
export const MAX_LIST_VALUE: number = TABLE[0];

/** The unreshaped reference table, extended past its own 525 rows by the
 *  same tail-decay extrapolation as before. This is curve stage 0 — the
 *  input every reshaping stage below blends against — and is also what
 *  pink(r) itself becomes for every rank beyond PINK_END. */
function tableValueAtRank(rank: number): number {
  const r = Math.max(1, Math.round(rank));
  if (r <= TABLE.length) return TABLE[r - 1];
  const last = TABLE[TABLE.length - 1];
  return last * Math.exp(TAIL_DECAY_RATE * (r - TABLE.length));
}

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** Stage 1: straight power-law compression of the table curve. */
function power065(r: number): number {
  return MAX_LIST_VALUE * Math.pow(tableValueAtRank(r) / MAX_LIST_VALUE, 0.65);
}

/** Stage 2 ("Hybrid A"): lambda-space blend of power065 and the table curve,
 *  100% power at rank HYBRID_K1, exactly 25% power at rank HYBRID_CHECK,
 *  0% (pure table) at rank POOL_N — the table's own last row. */
const POOL_N = TABLE.length; // 525
const HYBRID_K1 = 10;
const HYBRID_CHECK = 87;
const HYBRID_TARGET_AT_CHECK = 0.25;
const HYBRID_GAMMA =
  Math.log(HYBRID_TARGET_AT_CHECK) / Math.log((POOL_N - HYBRID_CHECK) / (POOL_N - HYBRID_K1));

function hybridLambda(r: number): number {
  if (r <= HYBRID_K1) return 1;
  if (r >= POOL_N) return 0;
  const frac = (POOL_N - r) / (POOL_N - HYBRID_K1);
  return Math.pow(Math.max(0, frac), HYBRID_GAMMA);
}

function hybridA(r: number): number {
  if (r <= HYBRID_K1) return power065(r);
  const L = hybridLambda(r);
  return L * power065(r) + (1 - L) * tableValueAtRank(r);
}

/** Stage 3 ("Hybrid B"): ratio-space blend of the same two curves, with a
 *  genuinely flat (parallel) ratio segment between ranks 87 and 250. */
const HYBRID_B_R0 = power065(HYBRID_K1) / tableValueAtRank(HYBRID_K1);
const HYBRID_B_CTRL: [number, number][] = [
  [HYBRID_K1, HYBRID_B_R0],
  [50, 1.55],
  [87, 1.75],
  [250, 1.75], // flat vs. rank 87: the "parallel" stretch
  [450, 1.0], // fully reconverged with the table curve
];

function hybridBRatio(r: number): number {
  if (r <= HYBRID_B_CTRL[0][0]) return HYBRID_B_CTRL[0][1];
  if (r >= HYBRID_B_CTRL[HYBRID_B_CTRL.length - 1][0]) {
    return HYBRID_B_CTRL[HYBRID_B_CTRL.length - 1][1];
  }
  for (let i = 0; i < HYBRID_B_CTRL.length - 1; i++) {
    const [r0, v0] = HYBRID_B_CTRL[i];
    const [r1, v1] = HYBRID_B_CTRL[i + 1];
    if (r >= r0 && r <= r1) {
      const t = (r - r0) / (r1 - r0);
      return v0 + (v1 - v0) * smoothstep(t);
    }
  }
  return 1;
}

function hybridB(r: number): number {
  if (r <= HYBRID_K1) return power065(r);
  return tableValueAtRank(r) * hybridBRatio(r);
}

/** Stage 4 ("Pink") — the shipped curve: runs exactly as hybridB through
 *  rank PINK_START, then narrows the hybridB/hybridA ratio to exactly 1.0
 *  by rank PINK_END, then runs as the table curve beyond that. */
const PINK_START = 87;
const PINK_END = 300;
const PINK_RATIO_AT_START = hybridB(PINK_START) / hybridA(PINK_START);

function pink(r: number): number {
  if (r <= PINK_START) return hybridB(r);
  if (r >= PINK_END) return tableValueAtRank(r);
  const t = (r - PINK_START) / (PINK_END - PINK_START);
  const ratio = 1 + (PINK_RATIO_AT_START - 1) * (1 - smoothstep(t));
  return hybridA(r) * ratio;
}

/** 1-based rank (1 = best) within a population -> this curve's value for
 *  that rank. No poolSize parameter — the curve's shape is a property of
 *  the RANK itself, not the pool it was measured in — but every call site
 *  is written against trade-value.ts's RankToValue = (rank, poolSize) =>
 *  number, and TypeScript's structural typing accepts a shorter-arity
 *  function wherever that type is expected, so this drops in for rankToZ()
 *  without a wrapper. */
export function curveValueAtRank(rank: number): number {
  const r = Math.max(1, Math.round(rank));
  return pink(r);
}
