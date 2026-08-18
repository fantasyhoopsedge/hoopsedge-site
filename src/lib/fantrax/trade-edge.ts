import type { LeagueAnalysis, ResolvedPlayer, TeamCategoryProfile } from "./analyze";
import type { FheCategory, LeaguePointsFormula } from "./league";
import { buildDepthWeightedProfiles, buildDepthWeightedTeamProfile } from "./power-rankings";
import { LINEUP_VALUE_MODE_LABEL, type LineupValueMode } from "./lineup";

/**
 * Pure trade-simulation math for the Trade Edge tool: "if these players moved
 * between these two teams, what happens to the league?" Shares its lineup
 * logic with Category Edge/Power Rankings (buildDepthWeightedTeamProfile from
 * power-rankings.ts, the same depth+weight ladder those tools use) rather
 * than a flat re-implementation — a trade simulation that ignored roster
 * slots or depth could "improve" a team by acquiring a player who can't
 * actually crack the real lineup at the depth being assessed.
 */

/** The four ways a Deep Edge user can rank a player: three flavors of the
 *  FHE global category-value engine (always available, independent of the
 *  league's own scoring rules), plus the league's own real fantasy-points
 *  formula (only meaningful — and only offered — for a points-scored
 *  league). Distinct from LineupValueMode's "league" mode: Trade Edge asks
 *  the user to pick explicitly rather than defaulting to the connected
 *  league's own LeagueV, since a trade's "who's better" read should stay
 *  stable while the user tries different partners/teams. A plain alias of
 *  LineupValueMode (minus "league") rather than an independent type — same
 *  "Rank lineup by" set Category Edge/Roster Edge use, see
 *  UI_VALUE_MODE_OPTIONS in lineup.ts (Ash's consistency sweep, 2026-08-18). */
export type TradeValueMode = Exclude<LineupValueMode, "league">;

export const TRADE_VALUE_MODE_LABEL: Record<TradeValueMode, string> = {
  eightCatV: LINEUP_VALUE_MODE_LABEL.eightCatV, nineCatV: LINEUP_VALUE_MODE_LABEL.nineCatV,
  minus1V: LINEUP_VALUE_MODE_LABEL.minus1V, fpts: LINEUP_VALUE_MODE_LABEL.fpts,
};

/** TradeValueMode IS a LineupValueMode now (fpts is a first-class value
 *  there too — see lineupValueOf in lineup.ts) — this is just the identity,
 *  kept as a named function so existing call sites don't churn. */
export function lineupModeFor(mode: TradeValueMode): LineupValueMode {
  return mode;
}

/** This player's value under the chosen mode — the same number
 *  buildOptimalLineup ends up ranking by by construction (see
 *  lineupModeFor). Used for the player-card "value rank" and for
 *  summarizeAssets' give/receive totals. */
export function valueOf(p: ResolvedPlayer, mode: TradeValueMode): number | null {
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

export function summarizeAssets(players: ResolvedPlayer[], mode: TradeValueMode): TradeAssetSummary {
  const values = players.map((p) => valueOf(p, mode)).filter((v): v is number => v != null);
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
  const formula: LeaguePointsFormula | null = valueMode === "fpts" ? league.pointsFormula : null;
  const lineupMode = lineupModeFor(valueMode);

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
