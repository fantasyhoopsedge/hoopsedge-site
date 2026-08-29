import { NextResponse } from "next/server";
import { FantraxError, isLeagueId } from "@/lib/fantrax/api";
import { authorizeFantrax } from "@/lib/fantrax/guard";
import { computeWaiverEdge } from "@/lib/fantrax/waiver-edge";
import { FANTRAX_DATASETS, type FantraxDatasetKey } from "@/lib/fantrax/resolve";
import type { ContractRule, LeagueType, SalaryFormat } from "@/lib/fantrax/league-tags";

/**
 * Waiver Edge (Deep Edge) — every free agent in a connected league, ranked
 * for that league's own scoring format. See waiver-edge.ts's own header for
 * why this is a standalone module rather than a League Rankings variant.
 *
 *   GET ?leagueId=…&teamId=…&dataset=2027:projection&leagueType=dynasty
 *       &salaryFormat=real&keeperPolicy=…&realSalaryEfficiencyWeight=…
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeFantrax();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const leagueId = (searchParams.get("leagueId") ?? "").trim();
  if (!isLeagueId(leagueId)) {
    return NextResponse.json({ error: "A valid leagueId is required." }, { status: 400 });
  }
  const teamId = searchParams.get("teamId")?.trim() || null;
  const datasetParam = searchParams.get("dataset") ?? FANTRAX_DATASETS[0].key;
  const dataset = FANTRAX_DATASETS.find((d) => d.key === datasetParam)?.key as FantraxDatasetKey | undefined;
  if (!dataset) {
    return NextResponse.json({ error: "Unknown dataset." }, { status: 400 });
  }
  const leagueTypeParam = searchParams.get("leagueType");
  const leagueType: LeagueType = leagueTypeParam === "keeper" || leagueTypeParam === "dynasty" ? leagueTypeParam : "redraft";
  const salaryFormatParam = searchParams.get("salaryFormat");
  const salaryFormat: SalaryFormat = salaryFormatParam === "real" || salaryFormatParam === "custom" ? salaryFormatParam : "none";
  const keeperPolicy = searchParams.get("keeperPolicy") ?? undefined;
  const weightParam = searchParams.get("realSalaryEfficiencyWeight");
  const realSalaryEfficiencyWeight = weightParam != null && weightParam !== "" ? Number(weightParam) : undefined;
  const contractRulesParam = searchParams.get("contractRules");
  let contractRules: ContractRule[] | undefined;
  if (contractRulesParam) {
    try { contractRules = JSON.parse(contractRulesParam) as ContractRule[]; } catch { contractRules = undefined; }
  }

  try {
    const result = await computeWaiverEdge({
      leagueId, teamId, dataset, leagueType,
      settings: { salaryFormat, keeperPolicy, realSalaryEfficiencyWeight, contractRules },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof FantraxError) {
      return NextResponse.json({ error: err.message }, { status: err.status === 404 ? 404 : 502 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
