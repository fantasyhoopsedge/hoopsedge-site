import { NextResponse } from "next/server";
import { FantraxError, isLeagueId } from "@/lib/fantrax/api";
import { authorizeFantrax } from "@/lib/fantrax/guard";
import { computeLeagueRankings } from "@/lib/fantrax/league-rankings";
import { FANTRAX_DATASETS, type FantraxDatasetKey } from "@/lib/fantrax/resolve";
import type { ContractRule, LeagueType, RookieSalaryTier, SalaryFormat } from "@/lib/fantrax/league-tags";

/**
 * League Rankings (Deep Edge) — every player/FA/pick in a connected league,
 * ranked four ways at once (custom generated / standard consensus dynasty /
 * real salary / redraft) — see league-rankings.ts's own doc for the shape.
 * Read-only: unlike custom-valuations' POST, there's nothing to
 * "regenerate" here (the custom basis reads whatever ledger already
 * exists — generation itself still happens from Trade Edge's asset-values
 * flow or the home-screen "Generate draft pick values" button).
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
  function parseJsonParam<T>(name: string): T | undefined {
    const raw = searchParams.get(name);
    if (!raw) return undefined;
    try { return JSON.parse(raw) as T; } catch { return undefined; }
  }
  const contractRules = parseJsonParam<ContractRule[]>("contractRules");
  const rookieSalaryScale = parseJsonParam<RookieSalaryTier[]>("rookieSalaryScale");

  try {
    const result = await computeLeagueRankings({
      leagueId, owner: auth.access.owner, teamId, dataset, leagueType,
      settings: { salaryFormat, keeperPolicy, realSalaryEfficiencyWeight, contractRules, rookieSalaryScale },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof FantraxError) {
      return NextResponse.json({ error: err.message }, { status: err.status === 404 ? 404 : 502 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
