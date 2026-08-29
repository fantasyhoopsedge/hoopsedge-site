/**
 * Trade Verdict — "is this trade fair, and who won it" — the one requirement
 * from the trade-agent "measures of success" review that Trade Edge never
 * built at all (see docs/trade-agent-gap-analysis.md §2, requirement 1).
 *
 * Backtesting FHE's existing surplus model against 85 real trades from a real
 * league (Angle Dynasty League, Downtown Fantasy Sports — see
 * data/downtown-fantasy-trade-analysis.csv) found only a 47% match rate
 * against what the league's own community voted was fair, on the 19 trades
 * involving only players (no picks). Root cause: summing player values
 * LINEARLY lets a package of several good-not-great players outscore one
 * true elite star, when real markets (and the real vote — 100% in the
 * clearest case) price a scarcity premium into concentrated star value that
 * a plain sum can't express.
 *
 * The fix ported here (Ash, 2026-08-21) comes from two real reference tools
 * — "ALL ACCESS - BETA - NBA Dynasty Trade Calculator" (categories + points
 * versions, July 2026), built on KeepTradeCut's "Raw Adjustment" methodology
 * (keeptradecut.com/frequently-asked-questions: "adding more mediocre talent
 * to one side of the deal can't bring you closer to evening out the trade...
 * you must trade quality to get quality"). Validated directly against the
 * dataset's worst miss before porting: Boston traded VJ Edgecombe + Ajay
 * Mitchell + Hugo González for Cooper Flagg, and the league voted 100% that
 * Flagg's side won. Using the reference's own raw values (950/400/185/78),
 * the adjustment scores Flagg at 238.2 vs. the three-player package's 89.7 —
 * a 2.65x swing that correctly flips our worst miss.
 *
 * ── The formula (adapted, not copied verbatim) ──────────────────────────────
 * The reference computes `Value * (0.1 + 0.04*(Value/MaxList)^8 +
 * 0.11*(Value/MaxTrade)^1.3 + 0.22*(Value/(MaxList+2000))^1.28)`, tuned
 * against its own all-positive 0-1590ish "trade value points" scale.
 * FHE's real valueModes include SIGNED z-scores (nineCatV/minus1V go
 * negative for a below-replacement player), which behave badly inside a
 * `(ratio)^8` term. This module substitutes PERCENTILE-WITHIN-POOL (via
 * ResolvedPlayer.catVRank where it exists, or a freshly-ranked pool for
 * surplusV/fpts, which have no precomputed rank) for `Value/MaxList` — same
 * tuned exponents, applied to a bounded [0,1] ratio instead of a raw
 * magnitude ratio that could be negative or unbounded. The reference's 4th
 * term's "+2000" denominator offset (a scale-specific dampener) has no
 * clean percentile analog and isn't needed for numerical stability once the
 * input is already bounded — dropped, using the same pool percentile as the
 * 1st term instead.
 *
 * `Value/MaxTrade` (the 3rd term) is now a LITERAL ratio, not a percentile
 * (Ash, 2026-08-25: "we changed the curve to move away from z-score... why
 * create something that isn't backed up by anything? go with [a literal
 * ratio]"). Dynasty's base value (curveValueAtRank, dynasty-value-curve.ts)
 * is always strictly positive now, so the sign problem that motivated the
 * original percentile substitution no longer applies there; redraft and the
 * keeper z-score blend still can go negative, so the ratio is computed
 * against each asset's ALREADY-FLOORED value (see "Non-negative asset
 * floor" below — never negative) rather than the true raw value, and the
 * denominator (the trade's own floored max) is guarded against ~0. This
 * means the top asset in a trade now gets EXACTLY ratio 1.0 for this term,
 * same as the reference — a real behavior change from the prior rank-based
 * percentile, which compressed every trade down to the same ordinal split
 * regardless of how large the actual value gap was.
 *
 * The multiplier still applies to the asset's real selected-mode value, so
 * "Adjusted Value" stays in the same units (z-score / dollars / fpts) as
 * every other number Trade Edge already shows — no new value system.
 *
 * ── Non-negative asset floor ─────────────────────────────────────────────
 * The reference tool's own "Value" column is a pure trade-asset scale — no
 * player, however bad, is worth less than a small positive floor, because a
 * roster spot is never a liability in a trade. FHE's underlying modes don't
 * have that property for free: nineCatV/eightCatV/minus1V are z-scores
 * centered on the pool average (a below-average rostered player is legitimately
 * negative), and surplusV is a real ROI figure that's SUPPOSED to go very
 * negative for a bad contract (see trade-edge.ts's computeLeagueSurplusValues
 * doc — that's a different, correct concept: cost-vs-production, not
 * trade-asset worth). Left alone, an adjustment multiplier (always positive)
 * applied to a negative raw value just carries the negative sign through
 * unchanged, which is exactly the "a player can have negative trade value"
 * outcome the reference model never allows. ASSET_FLOOR_PCT_OF_TOP clamps
 * the value that gets adjusted and summed — never the value used to RANK the
 * asset within the pool/trade, so a truly replacement-level or badly-overpaid
 * asset still correctly ranks at the bottom, it just bottoms out near a small
 * positive number instead of going negative, same as the reference.
 *
 * ── Pick valuation ───────────────────────────────────────────────────────
 * Draft picks carry zero value anywhere else in Trade Edge's trade math.
 * Rather than copying the reference's absolute pick values (another site's
 * numbers as gospel, and its "MaxList" isn't FHE's), each of its 15 pick
 * tiers is converted to a RATIO against that source's own #1-overall player
 * value, then that ratio is applied to FHE's OWN #1-ranked player's base
 * value (see pickEquivalentValue()). The reference only prices 2026/2027
 * picks; a flat ~0.8x/year decay (see YEAR_DECAY, derived from the
 * ~0.74-0.84x decay observed between the reference's own 2026 and 2027
 * rows) extrapolates further-out years.
 *
 * ── Base value (2026-08-23) ───────────────────────────────────────────────
 * This module used to call trade-edge.ts's valueOf() itself, keyed on a
 * TradeValueMode + an optional surplus map. It now takes a precomputed
 * `Map<fantraxId, number>` instead (see trade-value.ts's
 * computeBaseTradeValues) — base value is fully determined by the league's
 * own settings (league type, salary basis), not a mode the caller happens to
 * pass in, and this module doesn't need to know how that number was derived,
 * only that every asset already has one on a comparable scale. `family`
 * replaces `mode` for the one thing pick valuation still needs to know: which
 * reference tier table (categories vs. points) applies.
 *
 * ── Depth-aware adjustment (2026-08-29) ──────────────────────────────────
 * The formula above was tuned on/for a 12-14T league and over-penalizes
 * depth in deeper formats — see adjustmentMultiplier()'s own doc (below,
 * next to depthBlend()) for the full derivation and a concrete before/after
 * on a real trade. `poolSize` (leaguePlayers.length, already computed here)
 * now blends the multiplier toward flat 1.0 as the pool deepens past 300,
 * capped short of fully flat so a real star premium always survives.
 */
import type { ResolvedPlayer } from "./analyze";
import type { TeamDraftPick } from "./league";
import { DRAFT_BOARD } from "../rookie-board";
import { rankBy } from "../value/real-salary-model";

// ── percentile helpers ──────────────────────────────────────────────────────

const EPS = 1e-6;

/** 1-based rank (1 = best) within a population of `poolSize` -> a [0,1]
 *  percentile, rank 1 landing near 1.0. Same percentile formula rankToZ()
 *  uses in real-salary-model.ts, without the final normal-CDF step — this
 *  module needs the bounded ratio itself, not a z-score. */
function rankToPercentile(rank: number, poolSize: number): number {
  if (poolSize <= 0) return 0.5;
  return Math.min(1 - EPS, Math.max(EPS, 1 - (rank - 0.5) / poolSize));
}

/** Percentile of `value` among `allValues` (best = highest value = percentile
 *  near 1.0). Used for the 1st/4th terms' pool percentile (`poolPercentileOf`'s
 *  own fallback when an asset has no precomputed pool rank) — the 3rd term
 *  (`Value/MaxTrade`) is now a literal ratio, not a percentile; see
 *  `tradeRatioOf` below. */
function percentileWithin(value: number, allValues: readonly number[]): number {
  const n = allValues.length;
  if (n === 0) return 0.5;
  const rank = 1 + allValues.filter((v) => v > value).length;
  return rankToPercentile(rank, n);
}

/** The reference's own literal `Value/MaxTrade` ratio — `value` and every
 *  entry in `allValuesInTrade` are already-floored (never negative, see
 *  "Non-negative asset floor"), so this is always well-defined and in
 *  (0, 1]; the top asset in the trade lands on exactly 1.0, same as the
 *  reference. `maxInTrade <= EPS` (every asset in the trade floored to
 *  ~nothing, only reachable if hasTopValue was false — an empty/valueless
 *  pool) falls back to 0 rather than dividing by ~zero. */
function tradeRatioOf(value: number, allValuesInTrade: readonly number[]): number {
  const maxInTrade = allValuesInTrade.length > 0 ? Math.max(...allValuesInTrade) : 0;
  if (maxInTrade <= EPS) return 0;
  return Math.min(1, value / maxInTrade);
}

/** Depth-aware dampening (Ash, 2026-08-29): the reference formula's severity
 *  — a stud reading near 100% while role players read 10-20% — was
 *  calibrated on/for a 12-14T league (poolSize ~250-300) and over-penalizes
 *  depth in deeper formats. Real illustration that drove this: Anthony
 *  Edwards (rank 7, raw 880) for Franz Wagner + Isaiah Hartenstein + Ausar
 *  Thompson (ranks ~30/79/~100, raw 460/170/195) scores 58.7% variance
 *  (clearly Edwards' side wins) under the unmodified formula — a fair read
 *  for a 12T/300-pool league, where Ash confirmed that read is correct.
 *  But in a 30T/450-pool league Ash votes this trade "very fair" — deep
 *  formats reward roster DEPTH ("you're likely to compete with 3 top-100
 *  assets vs. 1 top-10 asset"), which the flat, pool-size-blind formula
 *  can't express.
 *
 *  depthBlend(poolSize) linearly ramps 0 (pool <= DEPTH_BLEND_START, i.e.
 *  every 12-14T league — formula unchanged) to DEPTH_BLEND_MAX (pool >=
 *  DEPTH_BLEND_END) and blends the raw multiplier toward flat 1.0 (pure
 *  raw-value comparison) by that fraction. DEPTH_BLEND_MAX is 0.85, not
 *  1.0, so a real star-concentration premium always survives, even at the
 *  deepest leagues — full-flatten was considered and rejected (Ash,
 *  2026-08-29: wants a residual premium at 450+, not zero). Calibrated
 *  directly against the Edwards illustration above (raw ratios, not the
 *  percentile/tradeRatio substitutions below, since that's the form Ash's
 *  own reference calculator uses): 58.7% at pool 300 (unchanged) -> 23.8%
 *  at 350 -> 13.3% at 400 -> 8.2% at 450 (comfortably under
 *  fairnessThresholdPct, i.e. reads "Fair" — matches Ash's vote).
 *
 *  Re-swept against the real 85-trade backtest (Ash, 2026-08-29 — the
 *  Angle Dynasty League is itself a 30T/16-roster-spot league, poolSize 480
 *  ideal -> clamped to 450 by resolvePoolSize(), i.e. it sits at
 *  DEPTH_BLEND_END, DEPTH_BLEND_MAX applied): overall accuracy flat at
 *  44-45/85 (52-53%) across a wide 8%-20% plateau (up from Pink's 42/85 at
 *  its own 18%), meaning this specific re-sweep didn't force a threshold
 *  move — see computeTradeVerdict()'s own doc below for the SEPARATE
 *  precision-driven move to 12% that followed the same day. */
const DEPTH_BLEND_START = 300;
const DEPTH_BLEND_END = 450;
const DEPTH_BLEND_MAX = 0.85;

function depthBlend(poolSize: number): number {
  const t = (poolSize - DEPTH_BLEND_START) / (DEPTH_BLEND_END - DEPTH_BLEND_START);
  return Math.min(1, Math.max(0, t)) * DEPTH_BLEND_MAX;
}

/** The reference's tuned adjustment multiplier. `poolPct` (bounded [0,1]
 *  percentile, see module doc) feeds both the 1st and 4th terms (the
 *  reference's own "+2000"-dampened 4th term has no percentile analog and
 *  isn't needed for stability here — dropped). `tradeRatio` is the literal
 *  `Value/MaxTrade` ratio (see tradeRatioOf), matching the reference exactly.
 *  `poolSize` blends the result toward flat 1.0 as the league gets deeper —
 *  see depthBlend() above. */
function adjustmentMultiplier(poolPct: number, tradeRatio: number, poolSize: number): number {
  const raw = 0.1 + 0.04 * poolPct ** 8 + 0.11 * tradeRatio ** 1.3 + 0.22 * poolPct ** 1.28;
  const blend = depthBlend(poolSize);
  return (1 - blend) * raw + blend * 1.0;
}

// ── pool ranking ─────────────────────────────────────────────────────────

/** Every asset's rank within `leaguePlayers` by base value. Computed once
 *  per verdict, not per-asset, to avoid re-sorting the pool for every
 *  player. A player with no entry in `baseValueByFantraxId` ranks last
 *  (-Infinity), same as before. */
function poolRanksFor(
  leaguePlayers: readonly ResolvedPlayer[],
  baseValueByFantraxId: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
  return rankBy(
    leaguePlayers.map((p) => ({ playerId: p.fantraxId, p })),
    ({ p }) => baseValueByFantraxId.get(p.fantraxId) ?? -Infinity,
  );
}

// ── pick valuation ───────────────────────────────────────────────────────

export interface PickTier {
  minPick: number;
  maxPick: number;
  /** tier value ÷ that source's own #1-overall player value. */
  ratio: number;
}

/** Reference: "ALL ACCESS - BETA - NBA Dynasty Trade Calculator (Categories
 *  - July 2026)", Values sheet rows 1-15, ÷ MaxList (Victor Wembanyama,
 *  1590). Used for `family: "categories"` — every base value EXCEPT a points
 *  league's fpts, since the source's own player list is category-weighted.
 *  Exported so callers building an artifact/report can enumerate the SAME
 *  bracket boundaries directly (2028+ reuses the LAST_TABLE_YEAR=2027 shape,
 *  see ratioForPick's own year-clamp) rather than duplicating the numbers. */
export const CATEGORIES_PICK_TIERS: Record<number, PickTier[]> = {
  2026: [
    { minPick: 1, maxPick: 2, ratio: 770 / 1590 },
    { minPick: 3, maxPick: 4, ratio: 590 / 1590 },
    { minPick: 5, maxPick: 7, ratio: 280 / 1590 },
    { minPick: 8, maxPick: 12, ratio: 125 / 1590 },
    { minPick: 13, maxPick: 22, ratio: 85 / 1590 },
    { minPick: 23, maxPick: 30, ratio: 55 / 1590 },
    { minPick: 31, maxPick: 39, ratio: 40 / 1590 },
    { minPick: 40, maxPick: 60, ratio: 20 / 1590 },
    // 3rd/4th-round bucket — a dynasty league whose rookie draft runs past
    // 2 rounds (some draft rookies AND free agents in the same event) can
    // hold a real pick past #60. Without this, ratioForPick's fallback
    // (averageRatioForRound) finds ZERO tiers overlapping that round and
    // silently prices the pick at ratio 0 — not a missing number, a WRONG
    // one (Ash, 2026-08-25: "i added an extra bucket for leagues where
    // draft picks go to 4 rounds... draft picks exceed pick 60"). Ratio
    // continues this table's own exact halving pattern (40->20 was already
    // an exact half; 20->10 matches it), same convention as the 2027 row.
    { minPick: 61, maxPick: 100, ratio: 10 / 1590 },
  ],
  2027: [
    { minPick: 1, maxPick: 3, ratio: 500 / 1590 },
    { minPick: 4, maxPick: 8, ratio: 200 / 1590 },
    { minPick: 9, maxPick: 12, ratio: 100 / 1590 },
    { minPick: 13, maxPick: 18, ratio: 85 / 1590 },
    { minPick: 19, maxPick: 29, ratio: 55 / 1590 },
    { minPick: 30, maxPick: 45, ratio: 40 / 1590 },
    { minPick: 46, maxPick: 60, ratio: 20 / 1590 },
    { minPick: 61, maxPick: 100, ratio: 10 / 1590 }, // see the 2026 row's own doc above
  ],
};

/** Same reference, points-league version — Values sheet ÷ MaxList (Victor
 *  Wembanyama, 1777.83). Used only for `family: "points"`. */
const POINTS_PICK_TIERS: Record<number, PickTier[]> = {
  2026: [
    { minPick: 1, maxPick: 2, ratio: 740 / 1777.8273512041 },
    { minPick: 3, maxPick: 4, ratio: 680 / 1777.8273512041 },
    { minPick: 5, maxPick: 7, ratio: 500 / 1777.8273512041 },
    { minPick: 8, maxPick: 12, ratio: 340 / 1777.8273512041 },
    { minPick: 13, maxPick: 22, ratio: 200 / 1777.8273512041 },
    { minPick: 23, maxPick: 30, ratio: 130 / 1777.8273512041 },
    { minPick: 31, maxPick: 39, ratio: 80 / 1777.8273512041 },
    { minPick: 40, maxPick: 60, ratio: 40 / 1777.8273512041 },
    { minPick: 61, maxPick: 100, ratio: 20 / 1777.8273512041 }, // see CATEGORIES_PICK_TIERS' own doc on this 3rd/4th-round bucket
  ],
  2027: [
    { minPick: 1, maxPick: 3, ratio: 500 / 1777.8273512041 },
    { minPick: 4, maxPick: 8, ratio: 380 / 1777.8273512041 },
    { minPick: 9, maxPick: 12, ratio: 300 / 1777.8273512041 },
    { minPick: 13, maxPick: 18, ratio: 210 / 1777.8273512041 },
    { minPick: 19, maxPick: 29, ratio: 150 / 1777.8273512041 },
    { minPick: 30, maxPick: 45, ratio: 80 / 1777.8273512041 },
    { minPick: 46, maxPick: 60, ratio: 40 / 1777.8273512041 },
    { minPick: 61, maxPick: 100, ratio: 20 / 1777.8273512041 },
  ],
};

const LAST_TABLE_YEAR = 2027;
/** Neither reference prices 2028+. Derived from the ~0.74x (categories) /
 *  ~0.84x (points) round-1 ratio decay observed between the reference's own
 *  2026 and 2027 rows — rounded to one flat, documented approximation
 *  rather than a separately tuned curve per year. */
const YEAR_DECAY = 0.8;

/** Pick-count-weighted average ratio across every tier overlapping
 *  [roundMin, roundMax] — used for a future/unordered pick (round+year only,
 *  no exact slot: TeamDraftPick.overallPick is undefined for any year past
 *  the league's current season, see league.ts's own doc on the field). */
function averageRatioForRound(tiers: readonly PickTier[], roundMin: number, roundMax: number): number {
  let weighted = 0;
  let count = 0;
  for (const t of tiers) {
    const lo = Math.max(t.minPick, roundMin);
    const hi = Math.min(t.maxPick, roundMax);
    if (lo > hi) continue;
    const width = hi - lo + 1;
    weighted += width * t.ratio;
    count += width;
  }
  return count > 0 ? weighted / count : 0;
}

// ── rookie board tie-in (2026-08-23) ────────────────────────────────────
//
// CATEGORIES_PICK_TIERS[2026] is a generic pick-SLOT bracket table —
// "whoever the #4 pick turns out to be is worth X." FHE already has a real
// answer to "who": the rookie board (rookie-board.ts, /draft-board) ranks
// AND TIERS this exact draft class. Once the board covers a pick's slot
// (this year's class only — see ROOKIE_BOARD_DRAFT_YEAR, since there's no
// board yet for a class that hasn't been scouted), its own 8 tiers replace
// the generic bracket lookup — reusing CATEGORIES_PICK_TIERS[2026]'s own 8
// ratios (already tier-shaped: 8 descending brackets, same count as the
// board's own 8 tiers) rather than inventing new numbers. Every other year,
// and any pick beyond the board's own coverage, falls through to the
// original generic-bracket behavior unchanged.
const ROOKIE_BOARD_DRAFT_YEAR = 2026;

/** Deliberately modest (Ash, 2026-08-23: "slight value weight to the players
 *  at the top of the tier vs the bottom") — a tier's best prospect reads
 *  ~7.5% above the tier's base value, its weakest ~7.5% below, linearly
 *  interpolated by rank position within the tier. Safely small: every
 *  adjacent pair of reference tier values differs by far more than this
 *  15% total spread, so it can never cross into a neighboring tier's band. */
const WITHIN_TIER_SPREAD = 0.15;

/** null when this pick slot falls outside the board's own coverage (58
 *  ranked prospects as of the 2026-06-27 board) — the caller falls back to
 *  the generic bracket table exactly as before. */
function rookieBoardRatio(overallPick: number): number | null {
  // Beyond the board's own coverage (currently 58 ranked prospects, out of
  // 60 possible picks): inherit the board's own worst-ranked prospect's
  // value rather than falling through to ratioForPick's flat, un-gradiented
  // bracket lookup. That fallback doesn't know about the within-tier
  // gradient applied to the picks just above it, so it can (and did, on a
  // 58-deep board: picks 59-60 read HIGHER than pick 58) read above the
  // board's own bottom prospect — a monotonicity break a real draft-value
  // curve should never have (found 2026-08-23 auditing OBG's pick order).
  const maxBoardRank = DRAFT_BOARD.length > 0 ? Math.max(...DRAFT_BOARD.map((p) => p.rank)) : 0;
  const effectiveRank = maxBoardRank > 0 ? Math.min(overallPick, maxBoardRank) : overallPick;
  const player = DRAFT_BOARD.find((p) => p.rank === effectiveRank);
  if (!player) return null;
  const tierRatios = CATEGORIES_PICK_TIERS[ROOKIE_BOARD_DRAFT_YEAR]?.map((t) => t.ratio);
  const baseRatio = tierRatios?.[player.tier - 1];
  if (baseRatio == null) return null; // more board tiers than reference brackets — fail safe, not silently wrong

  const tierRanks = DRAFT_BOARD.filter((p) => p.tier === player.tier).map((p) => p.rank);
  const n = tierRanks.length;
  if (n <= 1) return baseRatio;
  const tierStart = Math.min(...tierRanks);
  const t = (player.rank - tierStart) / (n - 1); // 0 = top of tier, 1 = bottom of tier
  return baseRatio * (1 + WITHIN_TIER_SPREAD / 2 - WITHIN_TIER_SPREAD * t);
}

function ratioForPick(pick: TeamDraftPick, table: Record<number, PickTier[]>, family: "categories" | "points"): number {
  if (family === "categories" && pick.year === ROOKIE_BOARD_DRAFT_YEAR && pick.overallPick != null) {
    const boardRatio = rookieBoardRatio(pick.overallPick);
    if (boardRatio != null) return boardRatio; // no year-decay — this IS the current draft class
  }
  const roundMin = (pick.round - 1) * 30 + 1;
  const roundMax = pick.round * 30;
  const year = Math.min(pick.year, LAST_TABLE_YEAR);
  const decay = YEAR_DECAY ** Math.max(0, pick.year - LAST_TABLE_YEAR);
  const tiers = table[year] ?? table[LAST_TABLE_YEAR];
  if (pick.overallPick != null) {
    const hit = tiers.find((t) => pick.overallPick! >= t.minPick && pick.overallPick! <= t.maxPick);
    if (hit) return hit.ratio * decay;
  }
  return averageRatioForRound(tiers, roundMin, roundMax) * decay;
}

/** A draft pick's value in the SAME units as the base value map — the
 *  ratio-transplant described in the module doc. `topValue` is the
 *  #1-ranked player's base value in `leaguePlayers` (i.e. this league's own
 *  top asset, not the reference's). Null when the pool has no valued
 *  players at all (nothing to scale against). */
export function pickEquivalentValue(
  pick: TeamDraftPick,
  leaguePlayers: readonly ResolvedPlayer[],
  baseValueByFantraxId: ReadonlyMap<string, number>,
  family: "categories" | "points",
): number | null {
  const table = family === "points" ? POINTS_PICK_TIERS : CATEGORIES_PICK_TIERS;
  const ratio = ratioForPick(pick, table, family);
  let topValue = -Infinity;
  for (const p of leaguePlayers) {
    const v = baseValueByFantraxId.get(p.fantraxId);
    if (v != null && v > topValue) topValue = v;
  }
  if (!Number.isFinite(topValue)) return null;
  return ratio * topValue;
}

// ── the verdict ──────────────────────────────────────────────────────────

export interface TradeVerdictAsset {
  label: string;
  rawValue: number;
  adjustedValue: number;
}
export interface TradeVerdictSide {
  assets: TradeVerdictAsset[];
  rawTotal: number;
  adjustedTotal: number;
}
export interface TradeVerdict {
  sideA: TradeVerdictSide;
  sideB: TradeVerdictSide;
  winner: "A" | "B" | "Fair";
  /** |A-B| / ((A+B)/2) on adjusted totals — same shape as the reference's own
   *  Variance metric. */
  variancePct: number;
  /** Positive = side B needs this much more adjusted value to even the
   *  trade; negative = side A does. Mirrors the reference's own
   *  "Value Adjusted Needed" (its sheet's H3). */
  valueAdjustedNeeded: number;
}

interface VerdictAssetInput {
  label: string;
  player?: ResolvedPlayer;
  pick?: TeamDraftPick;
}

/** Trade Edge's fairness call: sums each side's assets (players + picks)
 *  through the star-concentration-aware adjustment, and reads a winner off
 *  the totals. `fairnessThresholdPct` mirrors the reference's own
 *  green/red Variance indicator; its exact cutoff wasn't visible in the
 *  workbook's formulas (its own conditional-formatting rule fires at a flat
 *  5%, but that's calibrated to the workbook's literal raw-ratio formula,
 *  which this module doesn't run — see the "formula" section of this file's
 *  doc). Re-tuned 2026-08-25 after switching dynasty base values from
 *  rankToZ to the List Value curve (dynasty-value-curve.ts): swept every
 *  threshold from 2%-100% against the 85-trade backtest
 *  (data/downtown-fantasy-trade-analysis.csv), through THIS module's own
 *  unmodified pickEquivalentValue/rookieBoardRatio (real rookie board, not a
 *  synthetic approximation) — 22% and 24% tied for the plateau's peak, 43/85
 *  (51%), at the time.
 *
 *  Re-tuned AGAIN the same day after reshaping the curve's top end (the
 *  "Pink" blend — see dynasty-value-curve.ts's doc): flattening the top
 *  compresses the value spread between assets, which mechanically shrinks
 *  the variance% a genuinely fair trade produces, so the old 24% no longer
 *  sits on the accuracy plateau. Re-swept against the same 85-trade
 *  backtest with Pink live — 16-18% is now the plateau (47-48/85, 55-56%),
 *  with 17% the single-point peak (48/85); 18% ships as the threshold
 *  instead of the exact peak, one point off it but on the same plateau, to
 *  avoid over-fitting a single trade's wobble on an 85-trade sample. 24%
 *  drops to 42/85 (49%) under Pink — below even the unreshaped curve's
 *  43/85, confirming the old threshold was calibrated to a curve shape that
 *  no longer ships. Re-tune again if the base-value scale changes further.
 *
 *  Re-swept 2026-08-29 after the curve revert + depthBlend() change (see
 *  that function's own doc) — 18% still sat on the accuracy plateau (44/85,
 *  52%, same as the 44-45/85 plateau spanning ~3%-20%), so no forced move at
 *  that point.
 *
 *  Moved 18% -> 12% the same day for a different reason: overall accuracy is
 *  flat across the whole 8%-20% band on this sample, so it doesn't
 *  discriminate — but PRECISION of the "Fair" call itself (of every trade
 *  the model calls Fair, how many really were) rises meaningfully as the
 *  threshold drops: 57% at 18%, 58% at 15%, 65% at 12% and at 10% (identical
 *  — no trade in the 85-trade sample has variance in the (10%,12%] gap, so
 *  10% buys nothing over 12% here). Ash wants the "Fair" label to read as
 *  more trustworthy for users, which is exactly what precision measures;
 *  12% gets the full gain 10% would without cutting any deeper than the
 *  data supports. Recall of genuinely-fair trades drops correspondingly
 *  (57%->49%) — a real, accepted trade-off: fewer trades get called Fair,
 *  but the ones that do are more likely to actually be Fair. Re-tune again
 *  if the base-value scale changes further. */
export function computeTradeVerdict(
  sideAAssets: readonly VerdictAssetInput[],
  sideBAssets: readonly VerdictAssetInput[],
  leaguePlayers: readonly ResolvedPlayer[],
  baseValueByFantraxId: ReadonlyMap<string, number>,
  family: "categories" | "points",
  fairnessThresholdPct = 0.12,
): TradeVerdict {
  const poolRanks = poolRanksFor(leaguePlayers, baseValueByFantraxId);
  const poolSize = leaguePlayers.length;

  let topValue = -Infinity;
  for (const p of leaguePlayers) {
    const v = baseValueByFantraxId.get(p.fantraxId);
    if (v != null && v > topValue) topValue = v;
  }
  const hasTopValue = Number.isFinite(topValue);
  /** See module doc, "Non-negative asset floor". 2% of the pool's own top
   *  asset — small enough to leave every genuinely above-replacement player
   *  untouched, large enough that a badly-overpaid or below-replacement
   *  asset reads as "nearly worthless" rather than "zero" (a hard 0 floor
   *  would make every bench-level asset in a trade look identical). */
  const ASSET_FLOOR_PCT_OF_TOP = 0.02;
  const assetFloor = hasTopValue ? Math.abs(topValue) * ASSET_FLOOR_PCT_OF_TOP : 0;

  function rawValueOf(a: VerdictAssetInput): number | null {
    if (a.player) return baseValueByFantraxId.get(a.player.fantraxId) ?? null;
    if (a.pick) return pickEquivalentValue(a.pick, leaguePlayers, baseValueByFantraxId, family);
    return null;
  }
  function poolPercentileOf(a: VerdictAssetInput, raw: number): number {
    if (a.player) {
      const rank = poolRanks.get(a.player.fantraxId);
      if (rank != null) return rankToPercentile(rank, poolSize);
    }
    // Picks (and any player missing a pool rank) fall back to a value-based
    // percentile against the same pool's raw values, keeping the ratio on
    // the same bounded [0,1] scale rather than skipping the term entirely.
    const poolValues = [...baseValueByFantraxId.values()];
    return percentileWithin(raw, poolValues);
  }

  // Floored (never-negative) values for every asset in THIS trade — the
  // denominator (MaxTrade) and every numerator for the literal Value/MaxTrade
  // ratio both read off this list, so the top asset in the trade lands on
  // EXACTLY 1.0 for that term, same as the reference (see tradeRatioOf).
  const allFlooredInTrade = [...sideAAssets, ...sideBAssets]
    .map(rawValueOf)
    .filter((v): v is number => v != null)
    .map((v) => Math.max(v, assetFloor));

  function buildSide(assets: readonly VerdictAssetInput[]): TradeVerdictSide {
    const built: TradeVerdictAsset[] = [];
    for (const a of assets) {
      const trueRaw = rawValueOf(a);
      if (trueRaw == null) continue;
      // poolPct ranks against the TRUE value, so a below-replacement or
      // badly-overpaid asset still lands at the bottom of the pool — only
      // the magnitude that gets adjusted and summed (raw, below) is floored.
      const poolPct = poolPercentileOf(a, trueRaw);
      const raw = Math.max(trueRaw, assetFloor);
      const tradeRatio = tradeRatioOf(raw, allFlooredInTrade);
      const adjusted = raw * adjustmentMultiplier(poolPct, tradeRatio, poolSize);
      built.push({ label: a.label, rawValue: raw, adjustedValue: adjusted });
    }
    return {
      assets: built,
      rawTotal: built.reduce((s, a) => s + a.rawValue, 0),
      adjustedTotal: built.reduce((s, a) => s + a.adjustedValue, 0),
    };
  }

  const sideA = buildSide(sideAAssets);
  const sideB = buildSide(sideBAssets);
  const diff = sideA.adjustedTotal - sideB.adjustedTotal;
  const denom = (sideA.adjustedTotal + sideB.adjustedTotal) / 2;
  const variancePct = denom !== 0 ? Math.abs(diff) / Math.abs(denom) : 0;

  // A ratio-based variance breaks down when either side is near zero (e.g. a
  // late pick for a small FAAB amount, which this module has no value for
  // yet) — dividing two tiny numbers can read as an arbitrarily large %
  // even though almost nothing actually changed hands.
  //
  // FIXED (2026-08-23): this used to compare `diff` against a floor scaled
  // to the POOL's single most valuable player (topValue * 3%) — reasonable-
  // sounding, but wrong on two counts. First, comparing the wrong operand:
  // `diff` is small whenever the two sides are close in value, which is
  // supposed to be the FAIR case anyway — this doesn't distinguish "both
  // sides are genuinely worthless" from "both sides are large and roughly
  // equal" (a real, correctly-Fair trade the percentage check below already
  // handles). Second, and the one that actually mattered in practice:
  // topValue is a single outlier (the league's own Jokić-tier player), so
  // 3% of it is still large relative to almost every ORDINARY trade — most
  // real players, even good rotation ones, land well under that in a
  // percentile-bounded z-score scale. Backtested against 85 real Downtown
  // Fantasy Sports trades (Angle Dynasty League, a real-salary league — base
  // value must be the real-salary rank, not a raw z-score, to reproduce
  // this): the old floor swallowed the correct call on the clear majority of
  // player-only misses, including several the league voted 90-100% one-sided
  // on, because BOTH sides' adjusted totals — while meaningfully different
  // from each other — sat under 3% of the pool's best player regardless.
  //
  // Replaced with what the comment above actually describes wanting to
  // catch: a trade where NEITHER side has a single asset worth more than the
  // floor a below-replacement asset gets clamped to (assetFloor) — i.e.
  // nothing of real value changed hands on EITHER side, not merely "the two
  // sides happen to be close." A trade with any genuinely-valued asset on
  // either side always reaches the percentage check below instead.
  const bothSidesWorthless = sideAAssets.every((a) => {
    const v = rawValueOf(a);
    return v == null || v <= assetFloor;
  }) && sideBAssets.every((a) => {
    const v = rawValueOf(a);
    return v == null || v <= assetFloor;
  });
  const winner: TradeVerdict["winner"] =
    bothSidesWorthless || variancePct < fairnessThresholdPct ? "Fair" : diff > 0 ? "A" : "B";

  return { sideA, sideB, winner, variancePct, valueAdjustedNeeded: -diff };
}
