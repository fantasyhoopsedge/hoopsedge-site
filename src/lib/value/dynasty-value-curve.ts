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
 * ── Reverted the top-end reshape (2026-08-29) ────────────────────────────
 * Ranks 1-10's steepness (1590 -> ~800) previously went through several
 * rounds of hand-specified reshaping ("Pink" — a power-law/table hybrid
 * blend) to flatten it. Backtesting confirmed Pink improved the trade-
 * verdict match rate at its OWN best threshold, but Ash found the reshaped
 * curve didn't behave as expected in practice and asked to revert to the
 * original, unreshaped reference table (2026-08-29) — curveValueAtRank now
 * returns tableValueAtRank(r) directly, with no reshaping stage.
 *
 * The "raw adjustment gets less severe as the league gets deeper" behavior
 * this reshape was chasing now lives in trade-verdict.ts's depth-aware
 * adjustmentMultiplier() instead — leveling the TRADE FAIRNESS CALL as the
 * player pool deepens, rather than leveling the base value curve itself.
 * That keeps this curve a single, pool-size-independent scale (module
 * invariant, unchanged) and moves the depth sensitivity to the one place
 * that actually varies by league: the trade verdict, which already knows
 * the league's poolSize.
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

/** The reference table itself, extended past its own 525 rows by a
 *  log-linear tail-decay extrapolation fit over its last 100 points (see
 *  TAIL_DECAY_RATE above). This is the curve curveValueAtRank() returns
 *  directly — no reshaping stage. */
function tableValueAtRank(rank: number): number {
  const r = Math.max(1, Math.round(rank));
  if (r <= TABLE.length) return TABLE[r - 1];
  const last = TABLE[TABLE.length - 1];
  return last * Math.exp(TAIL_DECAY_RATE * (r - TABLE.length));
}

/** 1-based rank (1 = best) within a population -> this curve's value for
 *  that rank. No poolSize parameter — the curve's shape is a property of
 *  the RANK itself, not the pool it was measured in — but every call site
 *  is written against trade-value.ts's RankToValue = (rank, poolSize) =>
 *  number, and TypeScript's structural typing accepts a shorter-arity
 *  function wherever that type is expected, so this drops in for rankToZ()
 *  without a wrapper. */
export function curveValueAtRank(rank: number): number {
  return tableValueAtRank(rank);
}
