/**
 * Shared, pure Real Salary Rankings model — Ash's consensus-anchored design
 * (2026-07-30, fifth revision): "Real salary rankings are a variation to
 * dynasty consensus" — majority of the weight stays on dynasty consensus
 * rank, modified by an Efficiency adjuster, rather than independently-
 * weighted factors. Reasoning: a manager can't just stack max-salary
 * max-production stars (Curry/Tatum/Embiid/...) onto one roster without
 * breaching the cap — value has to come from a MIX of cheap production and
 * star power, and Efficiency is what captures that trade-off as an
 * adjustment on top of the consensus anchor. This also makes the rank
 * robust to next season's salary jump for a player like Wembanyama: dynasty
 * consensus already reasons about the 3-5 year window, so leaning on it as
 * the majority weight means a single-season salary snapshot can't swing his
 * rank much.
 *
 * Fourth revision: Market Salary is QUANTILE-MAPPED onto the REAL observed
 * NBA salary distribution rather than derived from an abstract
 * value-over-replacement dollar scale. Ash's fix request (2026-07-30):
 * "market salary is not realistic and too flat... anchor it to the real
 * salaries [...] the market salary should follow the spread of real nba
 * players." A linear scale built from z-scores is inherently flatter than
 * real NBA pay, which is sharply top-heavy by CBA design (supermax deals can
 * reach ~35% of the cap). Quantile-mapping sidesteps that entirely: rank
 * players by the blended (consensus + efficiency) score, sort the SAME
 * population's ACTUAL salaries descending, and assign each player the real
 * salary sitting at his blended rank's position. The set of Market Salary
 * values in the output is therefore literally the set of real salaries in
 * the league, just reassigned by merit instead of by actual contract — it
 * inherits the real skew for free, no calibration constant to tune.
 *
 * Fifth revision: the Efficiency adjuster is itself a weighted blend of
 * CHEAPNESS (salary, inverted so low salary scores well) and Production,
 * weighted 60/40 toward cheapness by default (EFFICIENCY_BASE_SALARY_WEIGHT).
 * Previously Efficiency was production alone, which under-credits a player
 * like Cameron Boozer: his box-score production is still developing as a
 * rookie, but he's locked into 4 years of cheap rookie-scale salary — the
 * REAL asset in a real-salary format, independent of this year's stat line.
 * Ash (2026-07-30): "his dynasty value can really only go up in salary
 * leagues as his salary is low for the value he warrants... putting market
 * salary aside, the actual rankings are not quite delivering the expected
 * results." Safe from the earlier self-reference bug (a player's own salary
 * feeding his own price) because salaryZ only influences RANK POSITION —
 * the dollar figure a player lands on still comes from the independent real-
 * salary curve above, not from a formula involving his own salary directly.
 * See docs/real-salary-dynasty-rankings-brief.md §3.1.
 *
 * Deliberately framework-free and imported by BOTH:
 *   - scripts/build-real-salary-values.ts (server, computes the stored
 *     "Balanced" preset)
 *   - src/app/real-salary-rankings/_components/real-salary-table.tsx (client,
 *     recomputes instantly when the archetype toggle changes, using each
 *     row's stored z-components — no round trip needed)
 * Keeping the math in one place means both call sites can never drift apart.
 */
import { NBA_MINIMUM_SALARY, REAL_SALARY_CAP } from "../nba-cap";

// ── shared sizing constants (single source, importable server + client) ────

/** 30 teams x 16 roster spots — Ash's real leagues (2026-07-30). Note: this
 *  is a SEPARATE concept from the V-score engine's own baseline pool size
 *  (season_player_values is only precomputed at fixed sizes 250..450 — see
 *  build-real-salary-values.ts's SOURCE_LEAGUE_SIZE for why 450 is used for
 *  the underlying Minus1V statistics regardless of this number). */
export const POOL_SIZE = 480;
export const TEAMS = 30;
export const TOTAL_BUDGET = TEAMS * REAL_SALARY_CAP;

// ── rank -> z-score (Acklam's inverse-normal-CDF approximation) ────────────
// Lets an ordinal rank (consensus) sit on the same scale as a genuine
// z-score (Minus1V, and the derived Efficiency adjuster below). ~1.15e-9
// relative error — far more precise than this use case needs.
function invNormCDF(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
  const plow = 0.02425;
  const phigh = 1 - plow;

  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= phigh) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
      / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
    / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/** Converts a 1-based rank (1 = best) within a population of `poolSize` into
 *  a z-score-equivalent value. */
export function rankToZ(rank: number, poolSize: number): number {
  const EPS = 1e-6;
  const percentile = Math.min(1 - EPS, Math.max(EPS, 1 - (rank - 0.5) / poolSize));
  return invNormCDF(percentile);
}

// ── manager archetypes ──────────────────────────────────────────────────────

export type Archetype = "balanced" | "contending" | "rebuilding";

export interface WeightPreset {
  consensus: number;
  efficiency: number;
  /**
   * Extra (signed) salary sub-weight applied ONLY to rookie-scale contracts
   * within Efficiency — added to EFFICIENCY_BASE_SALARY_WEIGHT before
   * blendScore runs, then renormalized against production so the two
   * sub-weights still sum to 1. Zero for Balanced ("balanced in type of
   * contract" — no reason to touch anything). Negative for Contending (less
   * interested in unproven rookie-scale assets specifically — production
   * counts for relatively more instead, since a contender wants proven
   * output). Positive for Rebuilding (more interested in rookie-scale
   * specifically — cheapness counts for relatively more, production less).
   * Non-rookie-scale contracts (Standard/Other — i.e. "cheap vet" deals) are
   * completely unaffected by this field at every archetype: "all scenarios
   * are interested in cheap vet contracts" the same amount. Ash
   * (2026-07-31): "the rookie scale vs vet contract logic will only come
   * into play for the contending vs rebuilding overlay."
   */
  rookieScaleAdjustment: number;
}

/**
 * Tuned 2026-07-30, CORRECTED 2026-07-31 (direction fix — see git history/
 * memory for the full writeup: Efficiency weight must RISE the more an
 * archetype prefers cheap/young assets over expensive proven ones, since
 * Efficiency is 60% cheapness and penalizes an expensive player's OWN score
 * directly). RETUNED twice more same day (Ash): first dropped Tanking
 * entirely and pulled the remaining three closer together, then landed here
 * — 77.5/22.5 / 70/30 / 62.5/37.5 — paired with a NEW rookie-scale-specific
 * adjustment (rookieScaleAdjustment above) so the consensus/efficiency split
 * alone no longer has to carry both "how much does cost matter overall" AND
 * "how much does contract TYPE matter" at once. Cheap veteran contracts are
 * valued identically across all three archetypes; only a rookie-scale
 * contract's cheapness counts for more/less depending on archetype.
 */
export const WEIGHT_PRESETS: Record<Archetype, WeightPreset> = {
  contending: { consensus: 0.775, efficiency: 0.225, rookieScaleAdjustment: -0.15 },
  balanced: { consensus: 0.70, efficiency: 0.30, rookieScaleAdjustment: 0 },
  rebuilding: { consensus: 0.625, efficiency: 0.375, rookieScaleAdjustment: 0.15 },
};

export const ARCHETYPE_LABELS: Record<Archetype, string> = {
  balanced: "Balanced",
  contending: "Contending",
  rebuilding: "Rebuilding",
};

export const ARCHETYPE_BLURB: Record<Archetype, string> = {
  balanced: "Consensus-anchored, balanced interest across contract types — cheap vets and rookie-scale deals both matter.",
  contending: "Still consensus-anchored, but less interested in unproven rookie-scale assets — pay for proven production, win-now.",
  rebuilding: "Cap efficiency matters more — more interested in rookie-scale assets on top of the usual preference for cheap veteran deals.",
};

/**
 * Base split of the Efficiency adjuster between cheapness (salary) and
 * Production before any archetype/contract-type adjustment — a cheap,
 * long-controlled contract is the real asset in this format even before a
 * young player's box score catches up; see module docstring's Cameron
 * Boozer example. See WeightPreset.rookieScaleAdjustment for how this shifts
 * per archetype for rookie-scale contracts specifically.
 */
export const EFFICIENCY_BASE_SALARY_WEIGHT = 0.6;

// ── contract commitment class (sixth revision, 2026-08-02) ─────────────────
//
// A salary number alone can't say WHY a contract is cheap, and the two reasons
// are opposites. A rookie-scale deal is cheap because the CBA caps what a
// drafted player can be paid while the team holds four years of control — a
// genuine asset. A two-way / Exhibit-10 deal is cheap because the team hasn't
// committed at all: not on the 15-man roster, money not guaranteed, waivable
// on a whim. Feeding both through the same cheapness sub-score meant the
// $0.68M two-way minimum — the cheapest figure in the entire population, and
// therefore the single largest cheapness credit available — was handed to the
// players with the LEAST team commitment.
//
// Ash (2026-08-02): "rookies on two-ways should not jump over any rookies on a
// 4yr rookie scale deal ... standard rookie-scale deals indicate the player is
// more highly regarded by the team as fully contracted and should generally be
// prioritised over two-ways and exhibits ... a two-way player should not jump
// much at all." Observed before the fix: two-ways sitting +35 to +110 spots
// above their dynasty-consensus rank purely on the $0.7M cheapness credit.
//
// Seventh revision (2026-08-03) adds "unsigned". The dynasty board ranks players
// the roster of record doesn't contain — unsigned free agents (Kuminga, DeRozan,
// Beal, Ivey, ...) never enter the projection model at all, because Stage 1
// projects minutes ONTO a team. They were therefore invisible on this page
// despite carrying real dynasty value. They're admitted now with last season's
// ACTUAL production standing in for the missing projection, but an unsigned
// player has no cap hit: the figure sitting in nba_contracts is a cap hold or a
// last-known contract, not money anyone is paying him this season. So salary is
// null for them — no cheapness credit (same mechanism as a two-way), no Surplus,
// and they are kept out of the quantile salary curve entirely so they can't
// distort anyone else's Market Salary. Ash (2026-08-03): rank them, but don't
// invent a cap hit for them.
export type ContractClass = "rookie-scale" | "standard" | "non-guaranteed" | "unsigned";

/** nba_roster.contract_status -> ContractClass. Statuses come from
 *  roster_ingest.ts's deriveStatus(): Rookie Scale | Standard | Two-Way |
 *  Exhibit 10 | RFA | UFA | Draftee. Anything that isn't explicitly
 *  rookie-scale or explicitly non-guaranteed (including a missing status)
 *  falls back to "standard" — the neutral, pre-existing behaviour. */
export function contractClassOf(status: string | null | undefined): ContractClass {
  if (status === "Rookie Scale") return "rookie-scale";
  if (status === "Two-Way" || status === "Exhibit 10") return "non-guaranteed";
  return "standard";
}

/**
 * Fraction of the cheapness (salaryZ) sub-score a contract class actually
 * earns. Zero for non-guaranteed deals: their low number is the absence of an
 * asset, not a cheap one.
 *
 * The zeroed weight is NOT reassigned to production — production keeps its own
 * base share (1 - EFFICIENCY_BASE_SALARY_WEIGHT) either way, so the whole
 * Efficiency adjuster shrinks toward zero for a two-way instead of swinging
 * on a noisy projection. That is precisely "should not jump much at all": a
 * two-way lands at ~his consensus slot, nudged only by production.
 *
 * Class is only half the test — call cheapnessCredit() below rather than reading
 * this map directly, or you'll miss the sub-minimum dollar gate.
 */
export const CHEAPNESS_CREDIT: Record<ContractClass, number> = {
  "rookie-scale": 1,
  standard: 1,
  "non-guaranteed": 0,
  // No salary at all to be cheap with — see ContractClass's "unsigned" note.
  unsigned: 0,
};

/**
 * Cheapness credit for a contract, gating on the DOLLAR FIGURE as well as the
 * contract class (2026-08-03).
 *
 * The class check alone had a hole: a handful of rows carry `contract_status`
 * "Standard" with a salary far below what any full-season NBA contract can pay —
 * $0.085M (Tyler Smith), $0.091M (Peter Suder, Payton Sandfort), $0.268M (Didi
 * Louzada), $0.28M (Christian Koloko), $0.707M (EJ Liddell). Those are prorated,
 * partially-guaranteed or dead-money amounts, and because they are the SMALLEST
 * numbers in the entire population they were earning a LARGER cheapness credit
 * than the $0.679M two-way minimum the class gate exists to neutralize — the
 * same bug, arriving through a different door. Ash (2026-08-03): "these guys
 * should not get a cheapness credit similar to the two-way treatment."
 *
 * Test is "below the league minimum", which is unambiguous: nothing legitimate
 * falls between the two-way rate and NBA_MINIMUM_SALARY, and genuine minimum
 * contracts (exactly NBA_MINIMUM_SALARY) still earn full credit — a real
 * minimum deal IS a cheap asset and should keep counting as one.
 *
 * Note what this does NOT do: the figure stays on the row. These players keep a
 * displayed Salary and a real Surplus, exactly like a two-way. Only the cheapness
 * sub-score is zeroed, which shrinks the Efficiency adjuster toward zero rather
 * than reweighting it into production.
 *
 * `minSalary` defaults to NBA_MINIMUM_SALARY (real dollars) so every existing
 * caller is unaffected — but that constant is meaningless on a custom-salary
 * Fantrax league's own invented dollar unit (small integers like $1-$70,
 * confirmed live 2026-08-13, see formatCustomSalary's own doc). A caller on
 * that scale should pass its own floor (or 0 to disable the gate entirely) —
 * found 2026-08-23 wiring rookie-scale credit into trade-value.ts's
 * customSalaryValues: every custom-salary player was silently failing this
 * gate (all real-dollar minimums dwarf any custom integer), zeroing the
 * cheapness sub-score for the WHOLE league regardless of contract class. */
export function cheapnessCredit(cls: ContractClass, salary: number | null, minSalary: number = NBA_MINIMUM_SALARY): number {
  if (salary == null) return 0;
  if (salary < minSalary) return 0;
  return CHEAPNESS_CREDIT[cls];
}

// ── the model ────────────────────────────────────────────────────────────
//
//   EfficiencyZ = subw.salary·salaryZ + subw.production·productionZ  (salaryZ
//     is CHEAPNESS — rank ascending by salary, so a low actual salary scores
//     well; see EFFICIENCY_BASE_SALARY_WEIGHT)
//   BlendScore = wConsensus·consensusZ + wEfficiency·EfficiencyZ  (pure
//     z-space, no dollars — see module docstring for why salaryZ here is
//     still self-reference-safe despite depending on the player's own salary)
//   Rank = order by BlendScore descending
//   ExpectedCapHit ("Market Salary") = the REAL salary at that same rank
//     position in the population's own actual-salary distribution, sorted
//     descending (quantile mapping)
//   SurplusValue = ExpectedCapHit - actual salary
//
// Rank and Market Salary are still the same ordering (quantile mapping is
// monotonic), but Market Salary's VALUES now come directly from real
// contracts instead of a derived scale — see module docstring.

export interface RealSalaryFactors {
  playerId: string;
  consensusZ: number;
  /** null when there is NO production data anywhere — no projection and no
   *  completed-season line to carry forward. Zeroes the ENTIRE Efficiency
   *  adjuster (not just its production half), leaving consensus as the only
   *  thing that places him. See blendScore. */
  productionZ: number | null;
  /** Cheapness — rank-to-z of salary rank ASCENDING (cheapest = rank 1), so
   *  HIGH salaryZ means a LOW actual salary. See EFFICIENCY_BASE_SALARY_WEIGHT. */
  salaryZ: number;
  /** Actual 2026-27 cap hit, or null for an unsigned free agent — no roster
   *  row, therefore no cap hit to compare against. A null salary is excluded
   *  from the quantile curve and yields a null surplusValue. */
  salary: number | null;
  /** Team-commitment class from nba_roster.contract_status — drives both
   *  CHEAPNESS_CREDIT and WeightPreset.rookieScaleAdjustment. Optional;
   *  omitted means "standard", the neutral case. */
  contractClass?: ContractClass;
}

export interface RealSalaryComputed {
  playerId: string;
  expectedCapHit: number;
  /** null for an unsigned free agent — there is no actual salary to subtract. */
  surplusValue: number | null;
}

export function blendScore(r: RealSalaryFactors, preset: WeightPreset, minSalary: number = NBA_MINIMUM_SALARY): number {
  // No production data at all (2026-08-03): the whole Efficiency adjuster goes
  // to zero, so consensus is the only thing placing him. (Not identical to his
  // published slot — a zero adjuster still ranks against neighbours who have
  // non-zero ones — but he moves for no reason of his own.) Deliberately not
  // "keep the cheapness half" — crediting a cheap contract while silently
  // treating unknown production as league-average would float a player we know
  // nothing about above players whose production is measured and poor. Same
  // principle as CHEAPNESS_CREDIT's two-way gate: absent evidence must not read
  // as positive evidence. Consensus is the only thing we actually know here.
  if (r.productionZ == null) return preset.consensus * r.consensusZ;

  const cls = r.contractClass ?? "standard";
  const baseSalaryWeight = EFFICIENCY_BASE_SALARY_WEIGHT
    + (cls === "rookie-scale" ? preset.rookieScaleAdjustment : 0);
  // Production's share is derived from the BASE weight, so gating cheapness
  // (CHEAPNESS_CREDIT) shrinks Efficiency rather than reweighting it into
  // production — see CHEAPNESS_CREDIT. Identical to the old formula for both
  // rookie-scale and standard deals, where the credit is 1.
  const salaryWeight = baseSalaryWeight * cheapnessCredit(cls, r.salary, minSalary);
  const productionWeight = 1 - baseSalaryWeight;
  const efficiencyZ = salaryWeight * r.salaryZ + productionWeight * r.productionZ;
  return preset.consensus * r.consensusZ + preset.efficiency * efficiencyZ;
}

/**
 * Fixed pool membership: top `poolSize` by consensusZ (i.e. by dynasty
 * consensus rank) — the "roster-worthy universe" for this format. Not used
 * by computeMarketValue itself (which quantile-maps over whatever rows it's
 * given), but exported for callers that want to know/display how many of
 * the scoreable population actually fit the format's roster capacity.
 */
export function selectPool(rows: RealSalaryFactors[], poolSize: number): Set<string> {
  const sorted = [...rows].sort((a, b) => b.consensusZ - a.consensusZ);
  return new Set(sorted.slice(0, poolSize).map((r) => r.playerId));
}

/**
 * Ranks `rows` by the blended (consensus + efficiency) score, then assigns
 * each player the REAL salary sitting at that same rank position in the
 * population's own sorted-descending actual-salary list — i.e. "what would
 * he earn if pay followed merit instead of his actual contract." See module
 * docstring for why this replaces the earlier value-over-replacement scale.
 */
export function computeMarketValue(
  rows: RealSalaryFactors[],
  preset: WeightPreset,
): RealSalaryComputed[] {
  const byBlend = [...rows].sort((a, b) => blendScore(b, preset) - blendScore(a, preset));
  // The curve is built ONLY from players who actually have a cap hit — an
  // unsigned free agent contributes no real contract to reassign. Curve
  // positions are then taken by PERCENTILE rather than by raw index so every
  // ranked player still lands somewhere on the real distribution even though
  // the curve is shorter than the population. When no unsigned rows are present
  // curve.length === rows.length and this reduces exactly to the previous
  // `salaryCurve[i]`.
  const salaryCurve = rows
    .filter((r): r is RealSalaryFactors & { salary: number } => r.salary != null)
    .map((r) => r.salary)
    .sort((a, b) => b - a);
  const lastBlend = byBlend.length - 1;
  const lastCurve = salaryCurve.length - 1;

  return byBlend.map((r, i) => {
    const expectedCapHit = lastCurve < 0
      ? 0
      : salaryCurve[lastBlend <= 0 ? 0 : Math.round((i * lastCurve) / lastBlend)];
    return {
      playerId: r.playerId,
      expectedCapHit,
      surplusValue: r.salary == null ? null : expectedCapHit - r.salary,
    };
  });
}

/** 1-based ranks (1 = best) by descending `key(row)`. */
export function rankBy<T extends { playerId: string }>(
  rows: T[],
  key: (r: T) => number,
): Map<string, number> {
  const sorted = [...rows].sort((a, b) => key(b) - key(a));
  const out = new Map<string, number>();
  sorted.forEach((r, i) => out.set(r.playerId, i + 1));
  return out;
}

// ── player-card value verdict (2026-07-31) ─────────────────────────────────
//
// Ash's 11-rule classifier for the one-line "value asset" callout shown on
// each player's real-salary quick-view card, evaluated TOP TO BOTTOM,
// first-match-wins (rule 5's "any asset value" and rules 6-11's overlapping
// bands only make sense read as a priority list, not independent
// conditions). `delta` is consensusRank - valueRank (same sign convention as
// the table's own Δ/Vs Consensus column: positive = moved UP from consensus,
// i.e. a real-salary bargain relative to his dynasty stock).
//
// One deliberate resolution of an apparent contradiction in the spec: rules
// 10 ("equal or down") and 11 ("equal or up") both nominally cover delta===0
// for the same surplus band/rank tier. Every OTHER equal-delta case in the
// spec (rule 8) maps to "Similar value asset," so delta===0 is treated as
// belonging to rule 11 here (down is rule 10's exclusively, delta<0 strict) —
// keeps the two rules non-overlapping and consistent with rule 8's own
// equal-delta → "Similar" mapping.
//
// Coverage-tested against the full 513-player pool across all 3 archetypes
// (2026-07-31): the 11 rules alone left ~20% unmatched — players with no
// consensus rank at all (delta null), and, the larger real gap, POSITIVE
// surplus paired with a DOWN move vs consensus (a bargain by dollars that
// still slipped a spot or two in the blend — not a contradiction, just a
// combination rules 1-5 never covered). Ash's fill-in (2026-07-31): every
// unmatched case gets the same "Similar value asset" verdict already used by
// rules 8/11 — a fair neutral default when the signal is mixed or there's no
// real consensus baseline to compare against. Makes this function total: it
// always returns a verdict now, never null.
const M = 1_000_000;

export type ValueVerdictTone = "positive" | "negative" | "neutral";
export interface ValueVerdict {
  text: string;
  tone: ValueVerdictTone;
}

function similarVerdict(playerName: string): ValueVerdict {
  return { text: `Similar value asset. ${playerName} has similar value in real salary formats`, tone: "neutral" };
}

export function deriveValueVerdict(
  playerName: string,
  /** null for an unsigned free agent — every rule below is a surplus band, so
   *  with no cap hit there is nothing to band. Falls through to the same
   *  neutral fill-in every other unmatched case uses. */
  surplusValue: number | null,
  /** consensusRank - valueRank; null when the player has no consensus rank
   *  to compare against (e.g. unranked) — falls through to the neutral
   *  "Similar value" fill-in below, same as every other unmatched case. */
  delta: number | null,
  valueRank: number,
): ValueVerdict {
  if (delta == null || surplusValue == null) return similarVerdict(playerName);

  if (surplusValue > 0) {
    if (delta >= 0 && valueRank <= 100) {
      if (surplusValue > 25 * M) return { text: `Elite value asset. ${playerName} has substantially more value in real salary formats`, tone: "positive" };
      if (surplusValue > 15 * M) return { text: `Excellent value asset. ${playerName} has genuinely more value in real salary formats`, tone: "positive" };
      return { text: `Great value asset. ${playerName} has slightly more value in real salary formats`, tone: "positive" };
    }
    if (delta >= 0 && valueRank > 100 && valueRank <= 250) {
      return { text: `Solid value asset. ${playerName} has more value in real salary formats`, tone: "positive" };
    }
    if (delta > 0) {
      return { text: `Value asset. ${playerName} is marginally more valuable in real salary formats`, tone: "positive" };
    }
    // Fill-in: positive surplus but moved DOWN vs consensus — a real, common
    // combination (Luka Doncic, Anthony Edwards, Cade Cunningham, ... all
    // land here) that rules 1-5 never anticipated. Mixed signal → neutral.
    return similarVerdict(playerName);
  }

  // surplusValue <= 0
  const mild = surplusValue >= -15 * M; // between -$15M and $0M
  const severe = surplusValue < -15 * M; // lower than -$15M
  if (valueRank <= 150) {
    if (severe && delta < 0) return { text: `Distressed value asset. ${playerName} has substantially lower value in real salary formats`, tone: "negative" };
    if (mild && delta < 0) return { text: `Depressed value asset. ${playerName} has depressed value in real salary formats`, tone: "negative" };
    if (mild && delta === 0) return similarVerdict(playerName);
    // Fill-in: e.g. mild-negative-with-up-consensus, or severe-negative with
    // flat/up consensus — mixed signal → neutral.
    return similarVerdict(playerName);
  }
  // outside top 150
  if (severe && delta < 0) return { text: `Negative value asset. ${playerName} has substantially lower value in real salary formats`, tone: "negative" };
  if (mild && delta < 0) return { text: `Poorer value asset. ${playerName} has worse value in real salary formats`, tone: "negative" };
  if (mild && delta >= 0) return similarVerdict(playerName);
  // Fill-in: severe-negative with flat/up consensus outside top 150.
  return similarVerdict(playerName);
}
