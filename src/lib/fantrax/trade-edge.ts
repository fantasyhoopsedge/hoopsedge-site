import type { LeagueAnalysis, ResolvedPlayer, TeamCategoryProfile } from "./analyze";
import type { FheCategory, LeaguePointsFormula } from "./league";
import { buildDepthWeightedProfiles, buildDepthWeightedTeamProfile } from "./power-rankings";
import { LINEUP_VALUE_MODE_LABEL, type LineupValueMode } from "./lineup";
import { EFFICIENCY_BASE_SALARY_WEIGHT, rankBy, rankToZ } from "../value/real-salary-model";

/**
 * Pure trade-simulation math for the Trade Edge tool: "if these players moved
 * between these two teams, what happens to the league?" Shares its lineup
 * logic with Category Edge/Power Rankings (buildDepthWeightedTeamProfile from
 * power-rankings.ts, the same depth+weight ladder those tools use) rather
 * than a flat re-implementation — a trade simulation that ignored roster
 * slots or depth could "improve" a team by acquiring a player who can't
 * actually crack the real lineup at the depth being assessed.
 */

/** The five ways a Deep Edge user can rank a player: three flavors of the
 *  FHE global category-value engine (always available, independent of the
 *  league's own scoring rules), the league's own real fantasy-points
 *  formula (only meaningful — and only offered — for a points-scored
 *  league), plus a Trade-Edge-only fifth mode, `surplusV` — labeled "Trade
 *  Value" (see TRADE_VALUE_MODE_LABEL): reads off Trade Edge's base-value
 *  cascade (trade-value.ts's computeBaseTradeValues), which is a consensus
 *  rank / real-or-custom-salary blend / season projection depending on the
 *  league's own settings, not a mode the caller picks. Distinct from
 *  LineupValueMode's "league" mode: Trade Edge asks
 *  the user to pick explicitly rather than defaulting to the connected
 *  league's own LeagueV, since a trade's "who's better" read should stay
 *  stable while the user tries different partners/teams. Almost a plain
 *  alias of LineupValueMode (minus "league") — same "Rank lineup by" set
 *  Category Edge/Roster Edge use, see UI_VALUE_MODE_OPTIONS in lineup.ts
 *  (Ash's consistency sweep, 2026-08-18) — except `surplusV`, which is NOT
 *  a valid LineupValueMode on its own (lineup slotting has no notion of
 *  "surplus"); see lineupModeFor's fallback. */
export type TradeValueMode = Exclude<LineupValueMode, "league"> | "surplusV";

export const TRADE_VALUE_MODE_LABEL: Record<TradeValueMode, string> = {
  eightCatV: LINEUP_VALUE_MODE_LABEL.eightCatV, nineCatV: LINEUP_VALUE_MODE_LABEL.nineCatV,
  minus1V: LINEUP_VALUE_MODE_LABEL.minus1V, fpts: LINEUP_VALUE_MODE_LABEL.fpts,
  // Renamed from "Surplus $" (2026-08-23): this tag no longer means a
  // dynasty cost-vs-production surplus specifically — it reads off Trade
  // Edge's base-value cascade (trade-value.ts), which can be a consensus
  // rank, a real/custom-salary blend, or a season projection depending on
  // league type. "Trade Value" is the honest label for whichever one that is.
  surplusV: "Trade Value",
};

/** TradeValueMode is a LineupValueMode for every mode except `surplusV`
 *  (fpts is a first-class value there too — see lineupValueOf in lineup.ts).
 *  Trade value is a trade-asset valuation overlay, not a category-value
 *  system — it can't rank players into roster slots on its own, so lineup
 *  CONSTRUCTION (who actually starts) falls back to `fallback`, the same
 *  category mode Trade Edge's base-value cascade uses for its own
 *  production input (see trade-value.ts's categoryFallbackMode). */
export function lineupModeFor(mode: TradeValueMode, fallback: LineupValueMode): LineupValueMode {
  return mode === "surplusV" ? fallback : mode;
}

/** This player's value under the chosen mode — the same number
 *  buildOptimalLineup ends up ranking by by construction (see
 *  lineupModeFor), except `surplusV`, which reads off a precomputed
 *  league-wide map (see trade-value.ts's computeBaseTradeValues — a single
 *  player's base value can't be computed in isolation, it depends on the
 *  whole league's own settings and pool). Used for the player-card "value
 *  rank" and for summarizeAssets' give/receive totals. */
export function valueOf(p: ResolvedPlayer, mode: TradeValueMode, surplusByFantraxId?: ReadonlyMap<string, number>): number | null {
  if (mode === "surplusV") return surplusByFantraxId?.get(p.fantraxId) ?? null;
  if (mode === "fpts") return p.pointsValue;
  return p.catV?.perGame[mode] ?? null;
}

export interface TradeAssetSummary {
  count: number;
  /** Sum of valueOf() across the players who have one — null when none do. */
  totalValue: number | null;
  /** Mean dynasty consensus rank across the players FHE has ranked — lower is
   *  a better asset. Null when none are ranked. */
  avgConsensusRank: number | null;
  /** Sum of in-league salary across the players who carry one — null when
   *  the league doesn't play with salaries, or none of these players do. */
  totalSalary: number | null;
}

export function summarizeAssets(players: ResolvedPlayer[], mode: TradeValueMode, surplusByFantraxId?: ReadonlyMap<string, number>): TradeAssetSummary {
  const values = players.map((p) => valueOf(p, mode, surplusByFantraxId)).filter((v): v is number => v != null);
  const ranks = players.map((p) => p.consensusRank).filter((v): v is number => v != null);
  const salaries = players.map((p) => p.salary).filter((v): v is number => v != null);
  return {
    count: players.length,
    totalValue: values.length > 0 ? values.reduce((a, b) => a + b, 0) : null,
    avgConsensusRank: ranks.length > 0 ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null,
    totalSalary: salaries.length > 0 ? salaries.reduce((a, b) => a + b, 0) : null,
  };
}

/**
 * RETIRED (2026-08-23) — no longer called anywhere in Trade Edge. Superseded
 * by trade-value.ts's computeBaseTradeValues, which reuses real-salary-
 * model.ts's ACTUAL blendScore/WEIGHT_PRESETS (this function's own doc below
 * explains why it originally avoided that reuse — the concern was
 * `contractClass`/NBA_MINIMUM_SALARY specifically, which the new module
 * still avoids the same way, just while reusing blendScore itself for the
 * custom-salary case). Also, this function conflates a real cost-vs-
 * production ROI figure (correctly negative for a bad contract) with
 * trade-asset value (never negative) — see trade-value.ts's module doc for
 * the full writeup of why Trade Edge stopped using surplus as its base
 * value. Left here, unexported from anywhere active, in case a future pass
 * wants to surface Surplus $ again as a secondary info stat (not the trade-
 * math input) — see trade-value.ts's own module doc.
 *
 * League-specific surplus value: production value vs. actual in-league
 * salary, for the CONNECTED league's own rostered pool (all teams — the same
 * population VAL RK/DYN RK already rank within) — a simpler cousin of
 * /real-salary-rankings' site-wide model (see real-salary-model.ts), scoped
 * to one Fantrax league's own real-or-custom salary numbers instead of the
 * FHE global consensus pool. Deliberately does NOT reuse that model's
 * computeMarketValue/blendScore/cheapnessCredit: those hardcode
 * NBA_MINIMUM_SALARY and a rookie-scale/two-way ContractClass, both
 * real-NBA-dollar / roster-status assumptions that don't hold for a
 * salaryFormat:"custom" league (an arbitrary commissioner-defined dollar
 * unit) or for Fantrax's own contract labels (no reliable rookie-scale
 * signal). Reuses only the genuinely generic pieces: rankToZ (rank -> a
 * comparable z-score) and rankBy.
 *
 * Method: rank the league's own rostered players by `baseMode` (whichever
 * category value the league would otherwise default to — never `"surplusV"`
 * itself, that would be circular) and convert to a production z-score;
 * separately rank salaried players cheapest-first and convert to a
 * cheapness z-score the same way; blend them at the site-wide model's own
 * 60/40 cheapness/production split (EFFICIENCY_BASE_SALARY_WEIGHT, kept for
 * conceptual consistency); sort by the blend descending and quantile-map
 * that order onto the league's own real salary curve (sorted descending) —
 * i.e. "what he'd be paid here if pay followed merit". surplus = expected -
 * actual. A player with no salary on file (unsigned/no roster spot) is
 * excluded from the curve and gets no entry in the returned map, matching
 * the site-wide model's own unsigned-player handling (see RealSalaryComputed).
 */
export function computeLeagueSurplusValues(
  players: ResolvedPlayer[],
  baseMode: Exclude<TradeValueMode, "surplusV">,
): Map<string, number> {
  const poolSize = players.length;
  const productionRank = rankBy(
    players.map((p) => ({ playerId: p.fantraxId, p })),
    ({ p }) => valueOf(p, baseMode) ?? -Infinity,
  );
  const salariedRows = players.filter((p) => p.salary != null).map((p) => ({ playerId: p.fantraxId, p }));
  const cheapnessRank = rankBy(salariedRows, ({ p }) => -(p.salary as number));

  const blend = players.map((p) => {
    const productionZ = rankToZ(productionRank.get(p.fantraxId) ?? poolSize, poolSize);
    const hasSalary = p.salary != null;
    const cheapnessZ = hasSalary ? rankToZ(cheapnessRank.get(p.fantraxId) ?? salariedRows.length, salariedRows.length) : 0;
    const cheapWeight = hasSalary ? EFFICIENCY_BASE_SALARY_WEIGHT : 0;
    const productionWeight = hasSalary ? 1 - EFFICIENCY_BASE_SALARY_WEIGHT : 1;
    return { fantraxId: p.fantraxId, salary: p.salary, blendScore: cheapWeight * cheapnessZ + productionWeight * productionZ };
  });

  const byBlend = [...blend].sort((a, b) => b.blendScore - a.blendScore);
  const salaryCurve = players.map((p) => p.salary).filter((s): s is number => s != null).sort((a, b) => b - a);
  const lastBlend = byBlend.length - 1;
  const lastCurve = salaryCurve.length - 1;

  const surplus = new Map<string, number>();
  byBlend.forEach((row, i) => {
    if (row.salary == null || lastCurve < 0) return; // no cap hit to compare against
    const expected = salaryCurve[lastBlend <= 0 ? 0 : Math.round((i * lastCurve) / lastBlend)];
    surplus.set(row.fantraxId, expected - row.salary);
  });
  return surplus;
}

/**
 * Depth-weighted, slot-aware profiles for every team, with `exactRosters`
 * substituted in and solved exactly (branch-and-bound) for whichever teams
 * it names — everyone else is the cheap greedy depth-weighted profile
 * buildDepthWeightedProfiles already computes. Trade Edge calls this twice
 * per render (once for the untraded league, once with the two trading
 * teams' post-trade rosters), always naming exactly the two trading teams,
 * so both sides of the comparison get the branch-and-bound precision Ash's
 * own convention reserves for "the team whose exact lineup you're showing"
 * (see buildDepthWeightedProfiles' own exactTeamId doc).
 */
function depthWeightedProfilesWithOverrides(
  analysis: LeagueAnalysis,
  depth: number,
  weight: number,
  formula: LeaguePointsFormula | null,
  valueMode: LineupValueMode,
  scored: readonly FheCategory[],
  positionSlots: Record<string, number>,
  exactRosters: Map<string, ResolvedPlayer[]>,
): TeamCategoryProfile[] {
  const base = buildDepthWeightedProfiles(analysis, depth, weight, { scored, positionSlots, exactTeamId: null });
  return base.map((p) => {
    const override = exactRosters.get(p.teamId);
    if (!override) return p;
    return buildDepthWeightedTeamProfile(
      override, p.teamId, p.teamName, positionSlots, scored, depth, weight, formula, { valueMode, exact: true },
    );
  });
}

export interface TradeProfiles {
  before: TeamCategoryProfile[];
  after: TeamCategoryProfile[];
}

/**
 * Before/after team profiles for a two-team trade, at the given roster depth
 * (0 = best lineup only, 1..5 = "+N" bench reserves, weighted per
 * depthWeight()) and value mode. Only the two trading teams' rosters differ
 * between `before` and `after`; every other team's profile is identical
 * across both (still solved fresh each call, since JS objects aren't
 * diffable by identity here, but numerically the same), so a caller can diff
 * the two team-by-team.
 */
export function tradeProfiles(
  analysis: LeagueAnalysis,
  teamAId: string,
  teamBId: string,
  sendFromA: ReadonlySet<string>,
  sendFromB: ReadonlySet<string>,
  depth: number,
  weight: number,
  valueMode: TradeValueMode,
  overrides?: { scored?: readonly FheCategory[]; positionSlots?: Record<string, number> },
): TradeProfiles {
  const { league } = analysis;
  const scored = overrides?.scored ?? league.categories.scored;
  const positionSlots = overrides?.positionSlots ?? league.positionSlots;
  // categoryFallback is what lineup CONSTRUCTION falls back to when valueMode
  // is "surplusV" (see lineupModeFor) — computed from the resulting lineupMode
  // rather than raw valueMode so a points league that fell back to "fpts"
  // still gets its real formula wired through, exactly like picking "fpts"
  // directly already does.
  const categoryFallback: LineupValueMode = league.scoringMode === "points" ? "fpts" : (scored.length === 8 ? "eightCatV" : "nineCatV");
  const lineupMode = lineupModeFor(valueMode, categoryFallback);
  const formula: LeaguePointsFormula | null = lineupMode === "fpts" ? league.pointsFormula : null;

  const rosterA = analysis.rosters.find((r) => r.teamId === teamAId);
  const rosterB = analysis.rosters.find((r) => r.teamId === teamBId);

  const before = depthWeightedProfilesWithOverrides(
    analysis, depth, weight, formula, lineupMode, scored, positionSlots,
    new Map([
      ...(rosterA ? [[teamAId, rosterA.players]] as const : []),
      ...(rosterB ? [[teamBId, rosterB.players]] as const : []),
    ]),
  );

  const outgoingA = rosterA?.players.filter((p) => sendFromA.has(p.fantraxId)) ?? [];
  const outgoingB = rosterB?.players.filter((p) => sendFromB.has(p.fantraxId)) ?? [];
  const newAPlayers = rosterA ? [...rosterA.players.filter((p) => !sendFromA.has(p.fantraxId)), ...outgoingB] : [];
  const newBPlayers = rosterB ? [...rosterB.players.filter((p) => !sendFromB.has(p.fantraxId)), ...outgoingA] : [];

  const after = depthWeightedProfilesWithOverrides(
    analysis, depth, weight, formula, lineupMode, scored, positionSlots,
    new Map([
      ...(rosterA ? [[teamAId, newAPlayers]] as const : []),
      ...(rosterB ? [[teamBId, newBPlayers]] as const : []),
    ]),
  );

  return { before, after };
}
