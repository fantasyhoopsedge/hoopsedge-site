/**
 * Trade Edge's base-value cascade — "what is this asset actually worth,
 * before any star-concentration adjustment" (see trade-verdict.ts for what
 * happens after). Determined entirely by the connected league's own
 * settings, not a freely-chosen mode: a real-salary dynasty league values
 * its assets differently than a redraft league, and letting a user pick an
 * unrelated mode (e.g. raw 9-Cat production in a real-salary league) was the
 * root cause investigated 2026-08-23 — Joel Embiid's Surplus $ (-64, a cost-
 * vs-production ROI figure, correctly negative for an overpaid contract) was
 * being read as his trade-asset value (which should never be negative — a
 * roster spot is never a liability in a trade).
 *
 * Five branches, one per how a league actually establishes worth:
 *  - Redraft: season projections per the league's scoring format (the
 *    existing TradeValueMode category value), or Minus1V if the user prefers
 *    that lens — a genuine valuation choice for this branch only, not a
 *    cosmetic sort option (Ash, 2026-08-23: "alternatively minus1 if the
 *    user prefers to evaluate assets based on that").
 *  - Standard dynasty (no salary data): dynasty consensus rank alone.
 *  - Real-salary dynasty: the SAME blended value /real-salary-rankings
 *    already computes site-wide (consensus rank + a cheapness/production
 *    Efficiency adjuster — real-salary-model.ts's blendScore), read via its
 *    already-fetched rank rather than recomputed.
 *  - Custom-salary dynasty: the identical blendScore methodology, computed
 *    fresh against THIS league's own custom salary curve (no site-wide table
 *    exists for a commissioner's invented dollar unit).
 *  - Keeper: no keeper-count data exists anywhere (not from Fantrax, not
 *    stored in this repo) — blends the Redraft and Dynasty-equivalent values
 *    by `keeperPolicy` (the only available signal, a user-set Settings
 *    field) as a fraction of the roster. First-pass heuristic, not a
 *    validated curve — see computeKeeperWeight.
 *
 * Every branch lands on a directly comparable scale. Redraft (genuine catV
 * z-scores) and a keeper league's blend with it stay on rankToZ() — signed,
 * pool-relative, exactly as before. A pure dynasty league's three branches
 * (standard/real/custom) use curveValueAtRank() instead (dynasty-value-
 * curve.ts, 2026-08-25): the reference tool's own hand-authored, always-
 * positive List Value table, not a z-score. See that module's doc for why —
 * in short, rankToZ's floor-collision bug (two similarly-salaried players
 * reading identically in Trade Edge because both fell below
 * ASSET_FLOOR_PCT_OF_TOP) doesn't exist on a curve that's already strictly
 * positive and shaped for exactly this purpose. A rank must be converted
 * using the SIZE OF THE POPULATION IT WAS COMPUTED WITHIN — production and
 * custom-salary ranks are local to this league's own roster pool
 * (leaguePoolSize), but consensus rank and the real-salary rank are BOTH
 * site-wide rankings and need the site-wide population size instead. Mixing
 * these up silently distorts the blend (see getConsensusPoolSize/
 * getSalaryRankByFheId's own doc comments in roster-edge.ts).
 */
import type { ResolvedPlayer } from "./analyze";
import type { ContractRule, LeagueType } from "./league-tags";
import { valueOf, type TradeValueMode } from "./trade-edge";
import {
  blendScore,
  rankBy,
  rankToZ,
  WEIGHT_PRESETS,
  type RealSalaryFactors,
  type WeightPreset,
} from "../value/real-salary-model";
import { curveValueAtRank } from "../value/dynasty-value-curve";

/** rankToZ (keeper blend, still z-scale) or curveValueAtRank (pure dynasty,
 *  List Value scale) — the one thing that differs between the two paths
 *  through the SAME three branches below. */
type RankToValue = (rank: number, poolSize: number) => number;

// ── contract-label rules (2026-08-23) ───────────────────────────────────
//
// See ContractRule's own doc (league-tags.ts) for why this is per-league
// house-rule data, not a global decoder. Both helpers below are deliberately
// tolerant — an unparseable or unmatched label just falls through to
// "standard" (today's behavior), never a crash or a silently-wrong number.

/** Leading letters of a Fantrax contract label ("E26-27" -> "E"), uppercased
 *  for a case-insensitive match against ContractRule.prefix. */
function contractPrefix(contract: string | null | undefined): string | null {
  if (!contract) return null;
  const m = contract.match(/^([A-Za-z]+)/);
  return m ? m[1].toUpperCase() : null;
}

/** A contract label's trailing year range as an absolute hoopR-style season
 *  number — "E26-27" -> 2027, matching this repo's own "2026 = the 2025-26
 *  season" convention (client.ts's CURRENT_SEASON doc) and confirmed against
 *  a real constitution's own worked example ("F24-25 -> contract will end on
 *  season 2024-2025"): the label's SECOND two-digit year is always the
 *  contract's final season. */
function contractExpirySeason(contract: string | null | undefined): number | null {
  if (!contract) return null;
  const m = contract.match(/(\d{2})-(\d{2})$/);
  if (!m) return null;
  return 2000 + parseInt(m[2], 10);
}

function ruleFor(contract: string | null | undefined, rules: readonly ContractRule[]): ContractRule | null {
  const prefix = contractPrefix(contract);
  if (!prefix) return null;
  return rules.find((r) => r.prefix.toUpperCase() === prefix) ?? null;
}

/** Same shape as WEIGHT_PRESETS.balanced (real-salary-model.ts), the fixed
 *  default this module already blends with — but with a real, nonzero
 *  rookieScaleAdjustment instead of balanced's 0. Trade Edge has no
 *  archetype selector to pick a preset from, so this borrows the site-wide
 *  model's own "rebuilding" magnitude (+0.15) as the closest precedented
 *  number rather than inventing a fresh one — a rookie-scale contract
 *  deserves the SAME extra cheapness credit here as it would there. */
const ROOKIE_SCALE_PRESET: WeightPreset = { consensus: 0.70, efficiency: 0.30, rookieScaleAdjustment: 0.15 };

/** A contract with a KNOWN, FIXED horizon and no renewal path is worth less
 *  as a dynasty trade chip than its raw production/consensus profile implies
 *  — most severely as the fixed expiry closes in. Expressed as a SUBTRACTIVE
 *  penalty (never a multiply): the base value can legitimately be negative
 *  (a below-average player), and multiplying a negative number by a
 *  fraction < 1 would perversely make him look BETTER, not worse — the same
 *  sign hazard trade-verdict.ts's own non-negative floor was built to avoid.
 *  Subtracting a positive penalty lowers the value regardless of its sign.
 *  `PENALTY_SCALE` (one z-unit) is a documented starting constant, not
 *  backtested — there's no real-trade dataset yet for expiring-contract
 *  discounts the way trade-verdict.ts's star-concentration curve had. Used
 *  only on the keeper-blend path (rankToValue = rankToZ), where the output
 *  is still genuinely signed and a subtraction is safe. */
const EXPIRING_PENALTY_SCALE = 1.0;

/** Curve-scale analog of the same idea: expressed as a FRACTION of the
 *  player's own curve value rather than a flat subtraction. A flat
 *  subtraction doesn't port — 1.0 point is nothing off a 1590 Wembanyama and
 *  would zero out (or invert the ranking of) a 3-point replacement player.
 *  Safe here specifically because curveValueAtRank's output is always
 *  strictly positive (unlike rankToZ's), so a multiplicative discount can
 *  never flip a bad value into a better-looking one the way it would on a
 *  signed z-score (see EXPIRING_PENALTY_SCALE's own doc, and
 *  trade-verdict.ts's non-negative-floor doc for the same hazard). Not
 *  backtested, same as EXPIRING_PENALTY_SCALE — a documented starting point. */
const EXPIRING_PENALTY_MAX_FRACTION = 0.35;

function expiringRemainingFraction(rule: ContractRule, contract: string | null | undefined, currentSeason: number): number {
  const maxYears = rule.maxYears ?? 1;
  const expiry = contractExpirySeason(contract);
  if (expiry == null || maxYears <= 0) return 0; // unparseable label -> treat as fully expiring now
  const yearsRemaining = Math.max(0, expiry - currentSeason);
  return Math.min(1, (yearsRemaining + 1) / maxYears);
}

function expiringDiscount(rule: ContractRule, contract: string | null | undefined, currentSeason: number): number {
  return (1 - expiringRemainingFraction(rule, contract, currentSeason)) * EXPIRING_PENALTY_SCALE;
}

function expiringDiscountFraction(rule: ContractRule, contract: string | null | undefined, currentSeason: number): number {
  return (1 - expiringRemainingFraction(rule, contract, currentSeason)) * EXPIRING_PENALTY_MAX_FRACTION;
}

export type ValueBasis = "standard" | "real" | "custom";
/** The one legitimate base-value CHOICE (not just display sort) — see
 *  module doc's Redraft branch. Only meaningful for leagueType "redraft" (or
 *  the redraft-shaped half of a keeper blend). */
export type RedraftBaseMode = "native" | "minus1V";

export interface BaseValueInputs {
  players: readonly ResolvedPlayer[];
  leagueType: LeagueType;
  valueBasis: ValueBasis;
  /** The league's native scoring-format category value — nineCatV/eightCatV
   *  for a categories league, fpts for a points league. Never "surplusV". */
  categoryFallbackMode: Exclude<TradeValueMode, "surplusV">;
  redraftBaseMode: RedraftBaseMode;
  /** analysis.league.poolSize — THIS league's own roster capacity
   *  (teamCount x maxTotalPlayers), used for every rank computed WITHIN this
   *  league's own roster (production, custom salary). */
  leaguePoolSize: number;
  /** Dynasty board's own player count (getConsensusPoolSize()) — the
   *  population consensusRank was drawn from. Site-wide, not this league's. */
  consensusPoolSize: number;
  /** fhe_id -> site-wide Real Salary Rankings rank (getSalaryRankByFheId()).
   *  Undefined when the league isn't real-salary or the enrichment hasn't
   *  loaded yet. */
  realSalaryRankByFheId: ReadonlyMap<string, number> | undefined;
  /** Population size those ranks were computed within (site-wide, not this
   *  league's pool) — see getSalaryRankByFheId's own doc. */
  realSalaryPoolSize: number | undefined;
  /** Settings' keeperPolicy field: "all" | "10" .. "1" | undefined. */
  keeperPolicy: string | undefined;
  totalRosterSlots: number;
  /** This league's own contract-label prefix scheme — see ContractRule's
   *  doc. Empty/undefined = every contract "standard", today's behavior. */
  contractRules: readonly ContractRule[] | undefined;
  /** Absolute hoopR-style season number "now" is being valued relative to
   *  (e.g. 2027 for the 2026-27 season) — the reference point
   *  expiringDiscount() measures a fixed-length contract's remaining years
   *  against. Should match the connected dataset's own season, not any
   *  particular contract label. */
  currentSeason: number;
}

/** "all" -> fully dynasty-weighted; a numeric policy -> that many keeper
 *  slots as a fraction of the roster (Ash's "3-4 is practically redraft,
 *  8-10 is practically dynasty" anchors, expressed as a continuous ratio
 *  rather than two hardcoded thresholds — no keeper-count data exists to
 *  validate a more specific curve against, so this is a first-pass, tunable
 *  starting point, not a backtested model like trade-verdict.ts's
 *  adjustment). Unparseable/missing policy reads as "not a keeper league"
 *  (weight 0), matching how a redraft league behaves. */
export function computeKeeperWeight(policy: string | undefined, totalRosterSlots: number): number {
  if (policy === "all") return 1;
  const n = policy != null ? Number(policy) : NaN;
  if (!Number.isFinite(n) || totalRosterSlots <= 0) return 0;
  return Math.max(0, Math.min(1, n / totalRosterSlots));
}

function consensusZOf(p: ResolvedPlayer, consensusPoolSize: number, rankToValue: RankToValue): number | null {
  if (p.consensusRank == null) return null;
  return rankToValue(p.consensusRank, consensusPoolSize);
}

/** Standard-dynasty / consensus-only branch, and the fallback for a
 *  real-salary player the site-wide table doesn't cover. */
function consensusOnlyValues(
  players: readonly ResolvedPlayer[],
  consensusPoolSize: number,
  rankToValue: RankToValue,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of players) {
    const z = consensusZOf(p, consensusPoolSize, rankToValue);
    if (z != null) out.set(p.fantraxId, z);
  }
  return out;
}

function realSalaryValues(
  players: readonly ResolvedPlayer[],
  rankByFheId: ReadonlyMap<string, number>,
  poolSize: number,
  consensusPoolSize: number,
  rankToValue: RankToValue,
): Map<string, number> {
  const fallback = consensusOnlyValues(players, consensusPoolSize, rankToValue);
  const out = new Map<string, number>();
  for (const p of players) {
    const rank = p.fheId != null ? rankByFheId.get(p.fheId) : undefined;
    if (rank != null) {
      out.set(p.fantraxId, rankToValue(rank, poolSize));
    } else {
      // Not in the site-wide Real Salary pool (e.g. outside FHE's ecosystem)
      // — fall back to consensus rather than dropping the asset entirely.
      const z = fallback.get(p.fantraxId);
      if (z != null) out.set(p.fantraxId, z);
    }
  }
  return out;
}

/** Custom-salary dynasty branch — computed fresh per league, reusing the
 *  SAME blendScore/WEIGHT_PRESETS methodology /real-salary-rankings runs
 *  site-wide (see module doc). `contractClass`/rookie-scale credit and the
 *  expiring-contract discount are both opt-in via `contractRules` — with no
 *  rules configured this is byte-identical to the original version (every
 *  contract defaults to "standard" inside blendScore, exactly as when
 *  Fantrax's lack of a contract-status field made this unconditional). */
function customSalaryValues(
  players: readonly ResolvedPlayer[],
  categoryFallbackMode: Exclude<TradeValueMode, "surplusV">,
  leaguePoolSize: number,
  consensusPoolSize: number,
  contractRules: readonly ContractRule[],
  currentSeason: number,
  rankToValue: RankToValue,
): Map<string, number> {
  const salariedRows = players.filter((p) => p.salary != null);
  const cheapnessRank = rankBy(
    salariedRows.map((p) => ({ playerId: p.fantraxId, p })),
    ({ p }) => -(p.salary as number),
  );

  // consensusZ/productionZ/salaryZ feed blendScore()'s own internal
  // weighting (shared with the site-wide /real-salary-rankings model) and
  // are used ONLY to produce a rank order here — they stay z-scale
  // (rankToZ) regardless of rankToValue, which applies solely to the FINAL
  // per-player output a few lines down.
  const rows: (RealSalaryFactors & { rule: ContractRule | null })[] = players.map((p) => {
    const consensusRank = p.consensusRank ?? consensusPoolSize; // no rank -> treat as last place, not a crash
    const rank = cheapnessRank.get(p.fantraxId);
    const rule = ruleFor(p.contract, contractRules);
    return {
      playerId: p.fantraxId,
      consensusZ: rankToZ(consensusRank, consensusPoolSize),
      productionZ: valueOf(p, categoryFallbackMode),
      // Irrelevant when salary is null — blendScore's cheapnessCredit()
      // zeroes the whole cheapness sub-weight for those rows directly off
      // `salary`, not off this z-score.
      salaryZ: rank != null ? rankToZ(rank, salariedRows.length) : 0,
      salary: p.salary,
      contractClass: rule?.kind === "rookieScale" ? "rookie-scale" : undefined,
      rule,
    };
  });

  const blendRank = rankBy(
    rows.map((r) => ({ playerId: r.playerId, r })),
    // minSalary 0: blendScore's cheapnessCredit() defaults to gating on
    // NBA_MINIMUM_SALARY (real dollars, ~$1.36M) — every custom-salary
    // number here is a small integer, always below that, so without this
    // override EVERY player's cheapness sub-score silently zeroed out
    // regardless of contract class (found 2026-08-23 verifying this exact
    // rookie-scale bump against real data). This league's own $1 minimum
    // bid rule (see the constitution) is already the real cheapness floor.
    ({ r }) => blendScore(r, r.contractClass === "rookie-scale" ? ROOKIE_SCALE_PRESET : WEIGHT_PRESETS.balanced, 0),
  );
  const rowByFantraxId = new Map(rows.map((r) => [r.playerId, r]));
  // z-scale (keeper blend): subtract a flat penalty — safe, since a negative
  // z legitimately means below-replacement and subtraction never flips its
  // sign. Curve scale (pure dynasty): multiply by a fraction instead — the
  // curve is always positive, where a flat subtraction would be meaningless
  // at one end of the curve and destructive at the other (see
  // EXPIRING_PENALTY_MAX_FRACTION's own doc).
  const isCurveScale = rankToValue === curveValueAtRank;
  const out = new Map<string, number>();
  for (const p of players) {
    const rank = blendRank.get(p.fantraxId);
    if (rank == null) continue;
    const value = rankToValue(rank, leaguePoolSize);
    const row = rowByFantraxId.get(p.fantraxId);
    if (row?.rule?.kind === "expiring") {
      const discounted = isCurveScale
        ? value * (1 - expiringDiscountFraction(row.rule, p.contract, currentSeason))
        : value - expiringDiscount(row.rule, p.contract, currentSeason);
      out.set(p.fantraxId, discounted);
    } else {
      out.set(p.fantraxId, value);
    }
  }
  return out;
}

function dynastyValues(
  players: readonly ResolvedPlayer[],
  valueBasis: ValueBasis,
  categoryFallbackMode: Exclude<TradeValueMode, "surplusV">,
  leaguePoolSize: number,
  consensusPoolSize: number,
  realSalaryRankByFheId: ReadonlyMap<string, number> | undefined,
  realSalaryPoolSize: number | undefined,
  contractRules: readonly ContractRule[],
  currentSeason: number,
  rankToValue: RankToValue,
): Map<string, number> {
  if (valueBasis === "real" && realSalaryRankByFheId && realSalaryPoolSize) {
    return realSalaryValues(players, realSalaryRankByFheId, realSalaryPoolSize, consensusPoolSize, rankToValue);
  }
  if (valueBasis === "custom") {
    return customSalaryValues(players, categoryFallbackMode, leaguePoolSize, consensusPoolSize, contractRules, currentSeason, rankToValue);
  }
  return consensusOnlyValues(players, consensusPoolSize, rankToValue);
}

function redraftValues(
  players: readonly ResolvedPlayer[],
  categoryFallbackMode: Exclude<TradeValueMode, "surplusV">,
  redraftBaseMode: RedraftBaseMode,
): Map<string, number> {
  const mode = redraftBaseMode === "minus1V" ? "minus1V" : categoryFallbackMode;
  const out = new Map<string, number>();
  for (const p of players) {
    const v = valueOf(p, mode);
    if (v != null) out.set(p.fantraxId, v);
  }
  return out;
}

/** The single entry point Trade Edge should call for base value — see
 *  module doc for the five branches. */
export function computeBaseTradeValues(inputs: BaseValueInputs): Map<string, number> {
  const {
    players, leagueType, valueBasis, categoryFallbackMode, redraftBaseMode,
    leaguePoolSize, consensusPoolSize, realSalaryRankByFheId, realSalaryPoolSize,
    keeperPolicy, totalRosterSlots, contractRules, currentSeason,
  } = inputs;

  if (leagueType === "redraft") {
    return redraftValues(players, categoryFallbackMode, redraftBaseMode);
  }

  const dynasty = (rankToValue: RankToValue) => dynastyValues(
    players, valueBasis, categoryFallbackMode, leaguePoolSize, consensusPoolSize,
    realSalaryRankByFheId, realSalaryPoolSize, contractRules ?? [], currentSeason, rankToValue,
  );

  // A pure dynasty league (100% dynasty weight, nothing to blend against a
  // z-scored redraft value) uses the List Value curve. A keeper league that
  // blends dynasty-equivalent values with genuine redraft z-scores below
  // keeps rankToZ, so the two things being averaged stay on the same scale.
  if (leagueType === "dynasty") return dynasty(curveValueAtRank);

  // Keeper: blend redraft and dynasty-equivalent values by keeperWeight.
  const weight = computeKeeperWeight(keeperPolicy, totalRosterSlots);
  if (weight <= 0) return redraftValues(players, categoryFallbackMode, redraftBaseMode);
  if (weight >= 1) return dynasty(curveValueAtRank);

  const redraft = redraftValues(players, categoryFallbackMode, redraftBaseMode);
  const dyn = dynasty(rankToZ);
  const out = new Map<string, number>();
  for (const p of players) {
    const r = redraft.get(p.fantraxId);
    const d = dyn.get(p.fantraxId);
    if (r == null && d == null) continue;
    out.set(p.fantraxId, (1 - weight) * (r ?? d!) + weight * (d ?? r!));
  }
  return out;
}
