import { NextResponse } from "next/server";
import { FantraxError, isLeagueId } from "@/lib/fantrax/api";
import { authorizeFantrax } from "@/lib/fantrax/guard";
import { getCachedLeagueAnalysis } from "@/lib/fantrax/league-cache";
import { FANTRAX_DATASETS, type FantraxDatasetKey } from "@/lib/fantrax/resolve";
import { getAgeByFheId, getConsensusPoolSize, getContractByFheId, getDynastyRankByFheId, getSalaryRankByFheId, getSophomoreByFheId } from "@/lib/fantrax/roster-edge";

/**
 * Same league analysis /api/fantrax/league builds, plus the salary-rank/
 * contract enrichment only Roster Edge needs (see roster-edge.ts's own
 * header for why that's not folded into the shared route/ResolvedPlayer).
 *
 *   GET /api/fantrax/roster-edge?leagueId=…&teamId=…&dataset=2027:projection
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const [analysis, { rankByFheId: salaryRankByFheId, poolSize: realSalaryPoolSize }, contractByFheId, ageByFheId, sophomoreByFheId] = await Promise.all([
      getCachedLeagueAnalysis(leagueId, teamId, dataset, leagueType),
      getSalaryRankByFheId(),
      getContractByFheId(),
      getAgeByFheId(),
      getSophomoreByFheId(),
    ]);
    const dynastyRankByFheId = getDynastyRankByFheId();
    const consensusPoolSize = getConsensusPoolSize();
    return NextResponse.json({
      ...analysis,
      salaryRankByFheId,
      realSalaryPoolSize,
      contractByFheId,
      dynastyRankByFheId,
      consensusPoolSize,
      ageByFheId,
      sophomoreByFheId,
    });
  } catch (err) {
    if (err instanceof FantraxError) {
      return NextResponse.json({ error: err.message }, { status: err.status === 404 ? 404 : 502 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
