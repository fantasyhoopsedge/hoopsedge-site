import type { CategoryEdge, LeagueAnalysis, ResolvedPlayer, TeamCategoryProfile } from "./analyze";
import { categoryEdges, projectRotoStandings } from "./analyze";
import type { FheCategory, LeaguePointsFormula } from "./league";
import { buildDepthWeightedProfiles, buildDepthWeightedTeamProfile } from "./power-rankings";
import type { LineupValueMode } from "./lineup";

/**
 * Waiver Edge's "Add/Drop Simulator" — the single-team analog of Trade
 * Edge's tradeProfiles() (trade-edge.ts): "if my roster changed like this,
 * what happens to MY team's standing?" Deliberately NOT server-only — every
 * function this calls (buildDepthWeightedProfiles, categoryEdges,
 * projectRotoStandings) is already called client-side by Power Rankings/
 * Trade Edge, so this runs entirely in the browser off a LeagueAnalysis the
 * page already fetched (no extra route, no extra round trip per tweak).
 *
 * Add candidates come from LeagueAnalysis.waiverBoard (resolve.ts's own
 * top-60-by-value free agent pool — see WAIVER_BOARD_SIZE) rather than
 * Waiver Edge's own full free-agent table, because only waiverBoard rows are
 * already full ResolvedPlayer objects (eligible/cats/catV/pointsValue) —
 * what buildOptimalLineup actually needs to slot them into a real lineup.
 * A free agent outside that top-60 pool simply isn't simulatable; the page
 * says so rather than guessing at a lineup-relevant value for them.
 */

export interface AddDropProfiles {
  before: TeamCategoryProfile[];
  after: TeamCategoryProfile[];
}

/**
 * `before` = the league exactly as analyzed, with MY team solved exactly
 * (branch-and-bound, not greedy) for precision — everyone else greedy, same
 * "exactTeamId" convention buildDepthWeightedProfiles already documents.
 * `after` = identical except MY team's own roster swaps `dropIds` out for
 * `addPlayers`, resolved exactly the same way. Every other team's profile is
 * numerically identical between the two — a caller diffs team-by-team.
 */
export function addDropProfiles(
  analysis: LeagueAnalysis,
  myTeamId: string,
  dropIds: ReadonlySet<string>,
  addPlayers: ResolvedPlayer[],
  depth: number,
  weight: number,
  valueMode: LineupValueMode,
  overrides?: { scored?: readonly FheCategory[]; positionSlots?: Record<string, number> },
): AddDropProfiles {
  const { league } = analysis;
  const scored = overrides?.scored ?? league.categories.scored;
  const positionSlots = overrides?.positionSlots ?? league.positionSlots;
  const formula: LeaguePointsFormula | null = valueMode === "fpts" ? league.pointsFormula : null;
  const myRoster = analysis.rosters.find((r) => r.teamId === myTeamId);

  const before = buildDepthWeightedProfiles(analysis, depth, weight, { scored, positionSlots, exactTeamId: myTeamId, valueMode });

  const afterMyPlayers = [
    ...(myRoster?.players.filter((p) => !dropIds.has(p.fantraxId)) ?? []),
    ...addPlayers,
  ];
  const afterMyProfile = buildDepthWeightedTeamProfile(
    afterMyPlayers, myTeamId, myRoster?.teamName ?? "My team", positionSlots, scored, depth, weight, formula,
    { valueMode, exact: true },
  );
  const after = before.map((p) => (p.teamId === myTeamId ? afterMyProfile : p));

  return { before, after };
}

export interface CategoryDelta {
  category: FheCategory;
  rankBefore: number;
  rankAfter: number;
  /** rankBefore - rankAfter: positive = improved (moved to a better/lower rank). */
  delta: number;
}

/** Every scored category's rank movement for one team between two profile
 *  sets — the input to "which categories improve/worsen" (Waiver Edge's
 *  simulator result). Categories with no movement are still included;
 *  callers filter/sort/cap as needed. */
export function categoryDeltas(
  myTeamId: string,
  before: TeamCategoryProfile[],
  after: TeamCategoryProfile[],
  scored: readonly FheCategory[],
): CategoryDelta[] {
  const beforeEdges = categoryEdges(myTeamId, before, projectRotoStandings(before, scored), scored);
  const afterEdges = categoryEdges(myTeamId, after, projectRotoStandings(after, scored), scored);
  const afterByCat = new Map<FheCategory, CategoryEdge>(afterEdges.map((e) => [e.category, e]));
  return beforeEdges
    .map((b) => {
      const a = afterByCat.get(b.category);
      if (!a) return null;
      return { category: b.category, rankBefore: b.rank, rankAfter: a.rank, delta: b.rank - a.rank };
    })
    .filter((d): d is CategoryDelta => d !== null);
}
