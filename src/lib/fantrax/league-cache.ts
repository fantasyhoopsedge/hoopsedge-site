import "server-only";
import { unstable_cache } from "next/cache";
import {
  fetchDraftPicks, FantraxError, fetchDraftResults, fetchLeagueInfo, fetchPlayerIds, fetchStandings, fetchTeamRosters,
} from "./api";
import type { LeagueAnalysis } from "./analyze";
import { buildLeague } from "./league";
import { analyzeLeague, type FantraxDatasetKey } from "./resolve";

/**
 * The shared "fetch a Fantrax league, then join it against FHE's category
 * values" pipeline both /api/fantrax/league and /api/fantrax/roster-edge run
 * — six external Fantrax calls (getLeagueInfo/getTeamRosters/getStandings/
 * getDraftResults/getPlayerIds/getDraftPicks) plus analyzeLeague().
 *
 * Both routes carry `export const dynamic = "force-dynamic"` (needed — they
 * read searchParams per request). Per Next's own docs, force-dynamic is
 * DEFINED as setting `fetchCache = 'force-no-store'` on every fetch() in the
 * route: "forces all fetch requests to be re-fetched every request even if
 * they provide a 'force-cache' option." That silently defeated the
 * `next: {revalidate}` TTLs api.ts's fxGet() calls were already passing —
 * measured live: two IDENTICAL back-to-back requests to /api/fantrax/
 * roster-edge (same leagueId/dataset/teamId) cost 2.2s and 1.47s server-side
 * each, not just the first. Every Deep Edge tool re-fetches on its own mount,
 * so switching between Power Rankings/Roster Edge/Trade Edge/Category Edge —
 * or just an accidental double-render — paid that multi-second tax on Fantrax's
 * real servers every single time, with zero benefit from the caching the code
 * already documented as happening.
 *
 * unstable_cache sidesteps the route-segment fetchCache heuristic entirely —
 * explicit, already the established pattern here (real-salary-data.ts's
 * getRealSalaryValues/getRosterExtras). 60s matches ROSTER_TTL, the shortest
 * (most conservative) of the three sub-TTLs the individual fetches used
 * before — this doesn't relax any freshness the code already called
 * acceptable, it just makes it actually happen. Safe to share a cache across
 * every FHE user asking about the same league: Fantrax's league-scoped
 * endpoints are key-less by design (leagueId alone is a capability — see
 * api.ts's own header), so this data isn't user-secret; authorizeFantrax()
 * still gates access to the route itself on every request, unchanged.
 */
const LEAGUE_ANALYSIS_TTL = 60;

async function fetchAndAnalyze(
  leagueId: string,
  teamId: string | null,
  dataset: FantraxDatasetKey,
  leagueType: "redraft" | "keeper" | "dynasty",
): Promise<LeagueAnalysis> {
  const [info, rosters, standings, draft, playerIds, draftPicks] = await Promise.all([
    fetchLeagueInfo(leagueId),
    fetchTeamRosters(leagueId),
    fetchStandings(leagueId),
    // A league that hasn't drafted yet 404s here; that's informational, not fatal.
    fetchDraftResults(leagueId).catch(() => null),
    fetchPlayerIds("NBA"),
    // Redraft leagues simply have nothing to return here; a fetch failure
    // (undocumented endpoint) shouldn't take the whole page down with it.
    fetchDraftPicks(leagueId).catch(() => null),
  ]);

  if (!info?.leagueName) {
    throw new FantraxError("Fantrax returned no settings for that league ID. Check the code and try again.", 404);
  }

  const league = buildLeague(leagueId, info, rosters, standings, draft, playerIds, draftPicks);
  return analyzeLeague(league, teamId, dataset, leagueType);
}

export const getCachedLeagueAnalysis = unstable_cache(
  fetchAndAnalyze,
  ["fantrax-league-analysis"],
  { revalidate: LEAGUE_ANALYSIS_TTL },
);
