import { NextResponse } from "next/server";
import {
  FantraxError, fetchDraftResults, fetchLeagueInfo, fetchPlayerIds, fetchStandings,
  fetchTeamRosters, isLeagueId,
} from "@/lib/fantrax/api";
import { authorizeFantrax } from "@/lib/fantrax/guard";
import { buildLeague } from "@/lib/fantrax/league";
import { analyzeLeague, FANTRAX_DATASETS, type FantraxDatasetKey } from "@/lib/fantrax/resolve";
import { getAgeByFheId, getContractByFheId, getDynastyRankByFheId, getSalaryRankByFheId } from "@/lib/fantrax/roster-edge";

/**
 * Same league analysis /api/fantrax/league builds, plus the salary-rank/
 * contract enrichment only Roster Edge needs (see roster-edge.ts's own
 * header for why that's not folded into the shared route/ResolvedPlayer).
 *
 *   GET /api/fantrax/roster-edge?leagueId=…&teamId=…&dataset=2027:projection
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SETTINGS_TTL = 300;
const ROSTER_TTL = 60;
const PLAYER_IDS_TTL = 3600;

export async function GET(request: Request) {
  const auth = await authorizeFantrax();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const leagueId = (searchParams.get("leagueId") ?? "").trim();
  const teamId = searchParams.get("teamId")?.trim() || null;
  const datasetParam = searchParams.get("dataset") ?? FANTRAX_DATASETS[0].key;
  const leagueTypeParam = searchParams.get("leagueType");
  const leagueType: "redraft" | "keeper" | "dynasty" =
    leagueTypeParam === "keeper" || leagueTypeParam === "dynasty" ? leagueTypeParam : "redraft";

  if (!isLeagueId(leagueId)) {
    return NextResponse.json(
      { error: "That doesn't look like a Fantrax league ID (16 letters/numbers)." },
      { status: 400 },
    );
  }
  const dataset = FANTRAX_DATASETS.find((d) => d.key === datasetParam)?.key as FantraxDatasetKey | undefined;
  if (!dataset) {
    return NextResponse.json({ error: "Unknown dataset." }, { status: 400 });
  }

  try {
    const [info, rosters, standings, draft, playerIds] = await Promise.all([
      fetchLeagueInfo(leagueId, { next: { revalidate: SETTINGS_TTL } }),
      fetchTeamRosters(leagueId, { next: { revalidate: ROSTER_TTL } }),
      fetchStandings(leagueId, { next: { revalidate: ROSTER_TTL } }),
      fetchDraftResults(leagueId, { next: { revalidate: ROSTER_TTL } }).catch(() => null),
      fetchPlayerIds("NBA", { next: { revalidate: PLAYER_IDS_TTL } }),
    ]);

    if (!info?.leagueName) {
      return NextResponse.json(
        { error: "Fantrax returned no settings for that league ID. Check the code and try again." },
        { status: 404 },
      );
    }

    const league = buildLeague(leagueId, info, rosters, standings, draft, playerIds);
    const [analysis, salaryRankByFheId, contractByFheId, ageByFheId] = await Promise.all([
      analyzeLeague(league, teamId, dataset, leagueType),
      getSalaryRankByFheId(),
      getContractByFheId(),
      getAgeByFheId(),
    ]);
    const dynastyRankByFheId = getDynastyRankByFheId();
    return NextResponse.json({ ...analysis, salaryRankByFheId, contractByFheId, dynastyRankByFheId, ageByFheId });
  } catch (err) {
    if (err instanceof FantraxError) {
      return NextResponse.json({ error: err.message }, { status: err.status === 404 ? 404 : 502 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
