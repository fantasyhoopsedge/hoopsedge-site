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
 * surplusV/fpts, which have no precomputed rank) for `Value/MaxList`, and
 * PERCENTILE-WITHIN-THIS-TRADE for `Value/MaxTrade` — same tuned exponents,
 * applied to a bounded [0,1] ratio instead of a raw magnitude ratio that
 * could be negative or unbounded. The reference's 4th term's "+2000"
 * denominator offset (a scale-specific dampener) has no clean percentile
 * analog and isn't needed for numerical stability once the input is already
 * bounded — dropped, using the same pool percentile as the 1st term instead.
 * The multiplier still applies to the asset's real selected-mode value, so
 * "Adjusted Value" stays in the same units (z-score / dollars / fpts) as
 * every other number Trade Edge already shows — no new value system.
 *
 * ── Pick valuation ───────────────────────────────────────────────────────
 * Draft picks carry zero value anywhere else in Trade Edge's trade math.
 * Rather than copying the reference's absolute pick values (another site's
 * numbers as gospel, and its "MaxList" isn't FHE's), each of its 15 pick
 * tiers is converted to a RATIO against that source's own #1-overall player
 * value, then that ratio is applied to FHE's OWN #1-ranked player's value in
 * the currently selected mode — see pickEquivalentValue(). The reference
 * only prices 2026/2027 picks; a flat ~0.8x/year decay (see YEAR_DECAY,
 * derived from the ~0.74-0.84x decay observed between the reference's own
 * 2026 and 2027 rows) extrapolates further-out years.
 */
import type { ResolvedPlayer } from "./analyze";
import type { TeamDraftPick } from "./league";
import { rankBy } from "../value/real-salary-model";
import { valueOf, type TradeValueMode } from "./trade-edge";

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
 *  near 1.0). Used for "how dominant is this asset within THIS TRADE" —
 *  the reference's `Value/MaxTrade` term, adapted the same way as the pool
 *  percentile above. */
function percentileWithin(value: number, allValues: readonly number[]): number {
  const n = allValues.length;
  if (n === 0) return 0.5;
  const rank = 1 + allValues.filter((v) => v > value).length;
  return rankToPercentile(rank, n);
}

/** The reference's tuned adjustment multiplier, adapted to run on bounded
 *  percentiles instead of raw value ratios (see module doc). `poolPct` feeds
 *  both the 1st and 4th terms (the reference's own "+2000"-dampened 4th term
 *  has no percentile analog and isn't needed for stability here — dropped). */
function adjustmentMultiplier(poolPct: number, tradePct: number): number {
  return 0.1 + 0.04 * poolPct ** 8 + 0.11 * tradePct ** 1.3 + 0.22 * poolPct ** 1.28;
}

// ── pool ranking (mode-aware) ───────────────────────────────────────────────

/** Every asset's rank within `leaguePlayers` for `mode` — reuses the
 *  precomputed catVRank for the three category modes; freshly ranks the pool
 *  for surplusV/fpts, which have no precomputed rank. Computed once per
 *  verdict, not per-asset, to avoid re-sorting the pool for every player. */
function poolRanksFor(
  leaguePlayers: readonly ResolvedPlayer[],
  mode: TradeValueMode,
  surplusByFantraxId: ReadonlyMap<string, number> | undefined,
): ReadonlyMap<string, number> {
  if (mode === "eightCatV" || mode === "nineCatV" || mode === "minus1V") {
    const out = new Map<string, number>();
    for (const p of leaguePlayers) {
      const r = p.catVRank?.perGame[mode];
      if (r != null) out.set(p.fantraxId, r);
    }
    return out;
  }
  return rankBy(
    leaguePlayers.map((p) => ({ playerId: p.fantraxId, p })),
    ({ p }) => valueOf(p, mode, surplusByFantraxId) ?? -Infinity,
  );
}

// ── pick valuation ───────────────────────────────────────────────────────

interface PickTier {
  minPick: number;
  maxPick: number;
  /** tier value ÷ that source's own #1-overall player value. */
  ratio: number;
}

/** Reference: "ALL ACCESS - BETA - NBA Dynasty Trade Calculator (Categories
 *  - July 2026)", Values sheet rows 1-15, ÷ MaxList (Victor Wembanyama,
 *  1590). Used for eightCatV/nineCatV/minus1V/surplusV — the category-value
 *  family — since the source's own player list is category-weighted. */
const CATEGORIES_PICK_TIERS: Record<number, PickTier[]> = {
  2026: [
    { minPick: 1, maxPick: 2, ratio: 770 / 1590 },
    { minPick: 3, maxPick: 4, ratio: 590 / 1590 },
    { minPick: 5, maxPick: 7, ratio: 280 / 1590 },
    { minPick: 8, maxPick: 12, ratio: 125 / 1590 },
    { minPick: 13, maxPick: 22, ratio: 85 / 1590 },
    { minPick: 23, maxPick: 30, ratio: 55 / 1590 },
    { minPick: 31, maxPick: 39, ratio: 40 / 1590 },
    { minPick: 40, maxPick: 60, ratio: 20 / 1590 },
  ],
  2027: [
    { minPick: 1, maxPick: 3, ratio: 500 / 1590 },
    { minPick: 4, maxPick: 8, ratio: 200 / 1590 },
    { minPick: 9, maxPick: 12, ratio: 100 / 1590 },
    { minPick: 13, maxPick: 18, ratio: 85 / 1590 },
    { minPick: 19, maxPick: 29, ratio: 55 / 1590 },
    { minPick: 30, maxPick: 45, ratio: 40 / 1590 },
    { minPick: 46, maxPick: 60, ratio: 20 / 1590 },
  ],
};

/** Same reference, points-league version — Values sheet ÷ MaxList (Victor
 *  Wembanyama, 1777.83). Used only for `fpts` mode. */
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
  ],
  2027: [
    { minPick: 1, maxPick: 3, ratio: 500 / 1777.8273512041 },
    { minPick: 4, maxPick: 8, ratio: 380 / 1777.8273512041 },
    { minPick: 9, maxPick: 12, ratio: 300 / 1777.8273512041 },
    { minPick: 13, maxPick: 18, ratio: 210 / 1777.8273512041 },
    { minPick: 19, maxPick: 29, ratio: 150 / 1777.8273512041 },
    { minPick: 30, maxPick: 45, ratio: 80 / 1777.8273512041 },
    { minPick: 46, maxPick: 60, ratio: 40 / 1777.8273512041 },
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

function ratioForPick(pick: TeamDraftPick, table: Record<number, PickTier[]>): number {
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

/** A draft pick's value in the SAME units as `mode` (z-score / dollars /
 *  fpts) — the ratio-transplant described in the module doc. `topValue` is
 *  the #1-ranked player's value in `leaguePlayers` under `mode` (i.e. this
 *  league's own top asset, not the reference's). Null when the pool has no
 *  valued players at all (nothing to scale against). */
export function pickEquivalentValue(
  pick: TeamDraftPick,
  leaguePlayers: readonly ResolvedPlayer[],
  mode: TradeValueMode,
  surplusByFantraxId: ReadonlyMap<string, number> | undefined,
): number | null {
  const table = mode === "fpts" ? POINTS_PICK_TIERS : CATEGORIES_PICK_TIERS;
  const ratio = ratioForPick(pick, table);
  let topValue = -Infinity;
  for (const p of leaguePlayers) {
    const v = valueOf(p, mode, surplusByFantraxId);
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
  fantraxId?: string; // players only — used to look up catVRank/surplus
  player?: ResolvedPlayer;
  pick?: TeamDraftPick;
}

/** Trade Edge's fairness call: sums each side's assets (players + picks)
 *  through the star-concentration-aware adjustment, and reads a winner off
 *  the totals. `fairnessThresholdPct` mirrors the reference's own
 *  green/red Variance indicator; its exact cutoff wasn't visible in the
 *  workbook's formulas, so 18% is a starting default meant to be tuned
 *  against the 85-trade backtest (scripts/backtest-surplus-model.ts), not a
 *  value carried over from the reference itself. */
export function computeTradeVerdict(
  sideAAssets: readonly VerdictAssetInput[],
  sideBAssets: readonly VerdictAssetInput[],
  leaguePlayers: readonly ResolvedPlayer[],
  mode: TradeValueMode,
  surplusByFantraxId: ReadonlyMap<string, number> | undefined,
  fairnessThresholdPct = 0.18,
): TradeVerdict {
  const poolRanks = poolRanksFor(leaguePlayers, mode, surplusByFantraxId);
  const poolSize = leaguePlayers.length;

  function rawValueOf(a: VerdictAssetInput): number | null {
    if (a.player) return valueOf(a.player, mode, surplusByFantraxId);
    if (a.pick) return pickEquivalentValue(a.pick, leaguePlayers, mode, surplusByFantraxId);
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
    const poolValues = leaguePlayers.map((p) => valueOf(p, mode, surplusByFantraxId)).filter((v): v is number => v != null);
    return percentileWithin(raw, poolValues);
  }

  const allRaw = [...sideAAssets, ...sideBAssets]
    .map(rawValueOf)
    .filter((v): v is number => v != null);

  function buildSide(assets: readonly VerdictAssetInput[]): TradeVerdictSide {
    const built: TradeVerdictAsset[] = [];
    for (const a of assets) {
      const raw = rawValueOf(a);
      if (raw == null) continue;
      const poolPct = poolPercentileOf(a, raw);
      const tradePct = percentileWithin(raw, allRaw);
      const adjusted = raw * adjustmentMultiplier(poolPct, tradePct);
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
  // even though almost nothing actually changed hands. Below a floor scaled
  // to the pool's own top asset (found while validating this module against
  // 85 real trades — several near-zero trades the community called "Fair"
  // were reading 200%+ variance and getting called for whichever side was
  // merely non-negative), treat the trade as Fair outright rather than let
  // the ratio decide.
  let topValue = -Infinity;
  for (const p of leaguePlayers) {
    const v = valueOf(p, mode, surplusByFantraxId);
    if (v != null && v > topValue) topValue = v;
  }
  const negligibleFloor = Number.isFinite(topValue) ? Math.abs(topValue) * 0.03 : 0;
  const winner: TradeVerdict["winner"] =
    Math.abs(diff) < negligibleFloor || variancePct < fairnessThresholdPct ? "Fair" : diff > 0 ? "A" : "B";

  return { sideA, sideB, winner, variancePct, valueAdjustedNeeded: -diff };
}
