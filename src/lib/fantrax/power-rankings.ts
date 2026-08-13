import type { LeagueAnalysis, ResolvedPlayer, TeamCategoryProfile } from "./analyze";
import type { FheCategory, LeaguePointsFormula } from "./league";
import { buildOptimalLineup, profileFromLineup, type LineupValueMode, type OptimalLineup } from "./lineup";

export type RankingsFormat = "roto" | "h2hcat" | "points" | "unconfirmed";

/**
 * Production format lock: Fantrax's own API can't distinguish rotisserie
 * from head-to-head-categories (both report scoringType "rotisserie" — see
 * league.ts) — only points-vs-categories is reliable. So the league's
 * manually-confirmed `format` tag (set in Settings, gated the same way
 * Standings/Edge already gate on it) is what actually decides Roto vs
 * H2H-categories; scoringMode alone only decides points vs everything else.
 * The design's prototype freely toggles all three tabs for demo purposes —
 * in production this is what locks it to the league's real format.
 */
export function deriveRankingsFormat(
  analysis: Pick<LeagueAnalysis, "league">,
  tags: { format: "roto" | "h2h"; formatConfirmed?: boolean },
): RankingsFormat {
  if (analysis.league.scoringMode === "points") return "points";
  if (!tags.formatConfirmed) return "unconfirmed";
  return tags.format === "h2h" ? "h2hcat" : "roto";
}

/** The design's depth-weighting table: how much an extra bench player's
 *  production actually counts, based on lineup cadence + which games cap is
 *  active. Weekly lineups barely move (one swap covers the whole week);
 *  daily lineups reward depth more, tempered by whichever cap applies. */
export function depthWeight(
  lineupCadence: "daily" | "weekly",
  format: RankingsFormat,
  capPos: boolean,
  capMatch: boolean,
): number {
  if (lineupCadence === "weekly") return 0.22;
  if (format === "roto") return capPos ? 0.55 : 0.9;
  return capMatch ? 0.55 : 1.0; // points or h2hcat
}

export function depthCaption(
  lineupCadence: "daily" | "weekly",
  format: RankingsFormat,
  capPos: boolean,
  capMatch: boolean,
  capPosN: number,
  capMatchN: number,
): string {
  if (lineupCadence === "weekly") {
    return "Weekly lineups mean depth barely moves the needle — your best starters carry the week. Reserve analysis is informational.";
  }
  if (format === "roto") {
    return capPos
      ? `A games cap of ${capPosN} per position rewards a strong bench for streaming, though the ceiling is capped. Worth checking a few deep.`
      : "Uncapped daily roto rewards streaming — with no games cap, depth is a real edge. Test your reserves all the way down.";
  }
  return capMatch
    ? `Depth matters, but the matchup cap of ${capMatchN} games limits how much your bench can add — a few quality reserves is plenty.`
    : "Depth swings hard here — daily H2H with no matchup cap means every extra roster spot is more games played. Stress-test your bench all the way down.";
}

/** Extends a slot-aware lineup with `depth` additional bench players, their
 *  category contribution scaled by `weight` — an approximation of "how many
 *  effective games this bench would actually play" rather than full value,
 *  matching the design's depth-weighting intent without a full games-
 *  available simulation. */
function extendLineup(lineup: OptimalLineup, depth: number, weight: number): OptimalLineup {
  if (depth <= 0) return lineup;
  const added = lineup.bench.slice(0, depth).map((player) => ({
    slot: "Bench+",
    player: weight === 1 ? player : { ...player, cats: scaleCats(player.cats, weight) },
  }));
  return { starters: [...lineup.starters, ...added], bench: lineup.bench.slice(depth), unplaceable: lineup.unplaceable };
}

function scaleCats(cats: Partial<Record<FheCategory, number>>, weight: number): Partial<Record<FheCategory, number>> {
  const out: Partial<Record<FheCategory, number>> = {};
  for (const [cat, v] of Object.entries(cats)) out[cat as FheCategory] = (v ?? 0) * weight;
  return out;
}

/**
 * Slot-aware, depth-weighted profile for ONE team. The building block both
 * `buildDepthWeightedProfiles` (below, all 30 teams, uniform) and Category
 * Edge (this team only, with its own valueMode/forcedIn overrides) use — so
 * the exact same depth+weight math applies whichever caller reaches it.
 *
 * This exists because of a real bug (Ash, 2026-08-12): Category Edge used to
 * build its OWN profile by hand — extending its bench with FULL, unweighted
 * value while every other team's profile stayed at depth 0 — so "Win %"
 * climbed toward 100% the deeper you went, comparing an ever-inflating
 * "me + N free bonus players" against opponents who never got the same
 * treatment. Depth has to extend every team's profile by the same weighted
 * amount for the comparison to mean anything.
 */
export function buildDepthWeightedTeamProfile(
  players: ResolvedPlayer[],
  teamId: string,
  teamName: string,
  positionSlots: Record<string, number>,
  scored: readonly FheCategory[],
  depth: number,
  weight: number,
  formula?: LeaguePointsFormula | null,
  options?: { valueMode?: LineupValueMode; forcedIn?: ReadonlySet<string>; exact?: boolean },
): TeamCategoryProfile {
  const base = buildOptimalLineup(players, positionSlots, formula, options);
  const extended = extendLineup(base, depth, weight);
  return profileFromLineup(teamId, teamName, extended, scored, formula);
}

/** Slot-aware, depth-weighted profiles for every team — the shared basis for
 *  all three Power Rankings tabs (and, at depth 0, identical to Category
 *  Edge's own per-team lineup, by construction).
 *
 *  `scored`/`positionSlots` default to the league's own auto-detected values
 *  but accept the Settings screen's user overrides — see buildLeagueProfiles()
 *  in lineup.ts for why this matters, not just cosmetics.
 *
 *  `exactTeamId` controls which teams get the exact branch-and-bound solver
 *  vs. the cheap greedy heuristic — omit it entirely and every team is
 *  solved exactly (today's behavior, unchanged for any caller that doesn't
 *  care). Pass a team id and ONLY that team is exact; pass `null` and every
 *  team goes greedy. This is what actually fixes the "Page Unresponsive"
 *  freeze on large leagues: the tool's whole point is comparing MY depth
 *  against the competition, which still needs every team extended by the
 *  same weighted depth for a fair Win% (unchanged), but most teams are only
 *  ever a competitive benchmark — they don't need branch-and-bound
 *  precision, just a good lineup, and greedy already guarantees that (see
 *  greedyAssignment's own note). Power Rankings passes its own team id so
 *  its displayed lineup never becomes an approximation; Category Edge
 *  passes `null` because it recomputes its own team exactly in a separate
 *  call regardless and splices it in, so solving it exactly here too would
 *  just be discarded work. */
export function buildDepthWeightedProfiles(
  analysis: LeagueAnalysis,
  depth: number,
  weight: number,
  overrides?: { scored?: readonly FheCategory[]; positionSlots?: Record<string, number>; exactTeamId?: string | null },
): TeamCategoryProfile[] {
  const { league } = analysis;
  const scored = overrides?.scored ?? league.categories.scored;
  const positionSlots = overrides?.positionSlots ?? league.positionSlots;
  const formula = league.scoringMode === "points" ? league.pointsFormula : null;
  const exactTeamId = overrides?.exactTeamId;
  return analysis.rosters.map((r) =>
    buildDepthWeightedTeamProfile(
      r.players, r.teamId, r.teamName, positionSlots, scored, depth, weight, formula,
      exactTeamId === undefined ? undefined : { exact: r.teamId === exactTeamId },
    ),
  );
}

// ── head-to-head simulation ──────────────────────────────────────────────

export interface CategoryMatchupResult {
  category: FheCategory;
  result: "win" | "loss" | "draw";
}
export interface H2HMatchup {
  opponentId: string;
  opponentName: string;
  categoryResults: CategoryMatchupResult[]; // empty for points mode
  wins: number;
  losses: number;
  draws: number;
  matchupResult: "win" | "loss" | "draw";
  /** Points mode only — "118.4 vs 112.1" style scoreline. */
  scoreline?: { mine: number; theirs: number };
}
export interface TeamH2HRecord {
  teamId: string;
  teamName: string;
  matchups: H2HMatchup[];
  totalWins: number;
  totalLosses: number;
  totalDraws: number;
  /** simulateH2HCategoryStandings: categoryWins / (categoryWins + categoryDraws
   *  + categoryLosses) — the plain win rate off the category ledger (draws
   *  don't count as half-wins here, unlike the matchup-record convention),
   *  e.g. 199-12-50 → 76.2%, not the ~78.5% a 0.5-per-draw weighting would
   *  give. Also what `rank` is sorted by for H2H-categories. Ash, 2026-08-12:
   *  matchup win% (win the majority of a week's categories) undersells a team
   *  that's winning categories lopsidedly — the category ledger is the more
   *  legible "how good is this team" number.
   *  simulateH2HPointsStandings: matchup win rate (totalWins + 0.5*totalDraws)
   *  / matchups — unchanged, since a points league has no category ledger to
   *  read this off instead. */
  winPct: number;
  categoryWins: number;
  categoryLosses: number;
  categoryDraws: number;
  rank: number;
}

/** Per-category standard deviation across the league's teams, for the
 *  H2H-categories draw epsilon (~12% of this, per the design spec). */
function categoryStdev(profiles: TeamCategoryProfile[], cat: FheCategory): number {
  const values = profiles.map((p) => statValue(p.statTotals, cat));
  const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length || 1);
  return Math.sqrt(variance);
}

function statValue(s: TeamCategoryProfile["statTotals"], cat: FheCategory): number {
  switch (cat) {
    case "PTS": return s.pts;
    case "FG3": return s.fg3m;
    case "REB": return s.reb;
    case "AST": return s.ast;
    case "STL": return s.stl;
    case "BLK": return s.blk;
    case "TO": return -s.tov; // fewer turnovers wins, same sign convention as v_to
    case "FG": return s.fg_pct ?? 0;
    case "FT": return s.ft_pct ?? 0;
  }
}

function isPercentCat(cat: FheCategory): boolean {
  return cat === "FG" || cat === "FT";
}

export function simulateH2HCategoryStandings(
  profiles: TeamCategoryProfile[],
  scored: readonly FheCategory[],
): TeamH2HRecord[] {
  const stdevByCat = new Map(scored.map((c) => [c, categoryStdev(profiles, c)]));

  const records: TeamH2HRecord[] = profiles.map((mine) => {
    const matchups: H2HMatchup[] = profiles
      .filter((p) => p.teamId !== mine.teamId)
      .map((opp) => {
        const categoryResults: CategoryMatchupResult[] = scored.map((cat) => {
          const a = statValue(mine.statTotals, cat);
          const b = statValue(opp.statTotals, cat);
          const epsilon = isPercentCat(cat) ? 0.003 : 0.12 * (stdevByCat.get(cat) ?? 0);
          const diff = a - b;
          const result: CategoryMatchupResult["result"] = Math.abs(diff) < epsilon ? "draw" : diff > 0 ? "win" : "loss";
          return { category: cat, result };
        });
        const wins = categoryResults.filter((r) => r.result === "win").length;
        const losses = categoryResults.filter((r) => r.result === "loss").length;
        const draws = categoryResults.filter((r) => r.result === "draw").length;
        const matchupResult: H2HMatchup["matchupResult"] = wins > losses ? "win" : losses > wins ? "loss" : "draw";
        return { opponentId: opp.teamId, opponentName: opp.teamName, categoryResults, wins, losses, draws, matchupResult };
      });

    const totalWins = matchups.filter((m) => m.matchupResult === "win").length;
    const totalLosses = matchups.filter((m) => m.matchupResult === "loss").length;
    const totalDraws = matchups.filter((m) => m.matchupResult === "draw").length;
    const categoryWins = matchups.reduce((sum, m) => sum + m.wins, 0);
    const categoryLosses = matchups.reduce((sum, m) => sum + m.losses, 0);
    const categoryDraws = matchups.reduce((sum, m) => sum + m.draws, 0);
    const categoryTotal = categoryWins + categoryDraws + categoryLosses || 1;
    return {
      teamId: mine.teamId, teamName: mine.teamName, matchups,
      totalWins, totalLosses, totalDraws,
      winPct: categoryWins / categoryTotal,
      categoryWins, categoryLosses, categoryDraws,
      rank: 0,
    };
  });

  records.sort((a, b) =>
    b.winPct - a.winPct || (b.totalWins - a.totalWins) || (b.categoryWins - a.categoryWins) || a.teamName.localeCompare(b.teamName),
  );
  records.forEach((r, i) => { r.rank = i + 1; });
  return records;
}

export function simulateH2HPointsStandings(profiles: TeamCategoryProfile[]): TeamH2HRecord[] {
  const perGame = (p: TeamCategoryProfile) => (p.statTotals.gamesPlayed > 0 ? (p.pointsTotal ?? 0) / p.statTotals.gamesPlayed : 0);

  const records: TeamH2HRecord[] = profiles.map((mine) => {
    const mineScore = perGame(mine);
    const matchups: H2HMatchup[] = profiles
      .filter((p) => p.teamId !== mine.teamId)
      .map((opp) => {
        const theirScore = perGame(opp);
        const matchupResult: H2HMatchup["matchupResult"] = mineScore === theirScore ? "draw" : mineScore > theirScore ? "win" : "loss";
        return {
          opponentId: opp.teamId, opponentName: opp.teamName, categoryResults: [],
          wins: matchupResult === "win" ? 1 : 0, losses: matchupResult === "loss" ? 1 : 0, draws: matchupResult === "draw" ? 1 : 0,
          matchupResult, scoreline: { mine: mineScore, theirs: theirScore },
        };
      });
    const totalWins = matchups.filter((m) => m.matchupResult === "win").length;
    const totalLosses = matchups.filter((m) => m.matchupResult === "loss").length;
    const totalDraws = matchups.filter((m) => m.matchupResult === "draw").length;
    const denom = matchups.length || 1;
    return {
      teamId: mine.teamId, teamName: mine.teamName, matchups,
      totalWins, totalLosses, totalDraws,
      winPct: (totalWins + 0.5 * totalDraws) / denom,
      categoryWins: 0, categoryLosses: 0, categoryDraws: 0,
      rank: 0,
    };
  });

  records.sort((a, b) =>
    b.totalWins - a.totalWins || b.winPct - a.winPct || perGame(profiles.find((p) => p.teamId === b.teamId)!) - perGame(profiles.find((p) => p.teamId === a.teamId)!),
  );
  records.forEach((r, i) => { r.rank = i + 1; });
  return records;
}
