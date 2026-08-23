import { NextResponse } from "next/server";
import { FantraxError, isLeagueId } from "@/lib/fantrax/api";
import { authorizeFantrax } from "@/lib/fantrax/guard";
import { computeCustomLedger } from "@/lib/fantrax/custom-valuations";
import { getCustomValuations, saveCustomValuations } from "@/lib/fantrax/custom-valuations-store";
import { FANTRAX_DATASETS, type FantraxDatasetKey } from "@/lib/fantrax/resolve";
import type { SavedLeagueSettings } from "@/lib/fantrax/store";

/**
 * The custom league-asset ledger — "Would you like to customize the value
 * of your league assets?" (Ash, 2026-08-23).
 *
 *   GET  ?leagueId=… — read the cached ledger only, never recomputes (same
 *        read-only contract as getLiveBoard() for the rookie board).
 *   POST { leagueId, teamId, dataset, settings } — the "Regenerate" action:
 *        runs computeCustomLedger() fresh and overwrites the cached row.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeFantrax();
  if (!auth.ok) return auth.response;

  const leagueId = (new URL(request.url).searchParams.get("leagueId") ?? "").trim();
  if (!isLeagueId(leagueId)) {
    return NextResponse.json({ error: "A valid leagueId is required." }, { status: 400 });
  }
  try {
    const doc = await getCustomValuations(auth.access.owner, leagueId);
    return NextResponse.json({ doc });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authorizeFantrax();
  if (!auth.ok) return auth.response;

  let body: { leagueId?: string; teamId?: string | null; dataset?: string; settings?: SavedLeagueSettings };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (!body.leagueId || !isLeagueId(body.leagueId)) {
    return NextResponse.json({ error: "A valid leagueId is required." }, { status: 400 });
  }
  if (!body.settings) {
    return NextResponse.json({ error: "League settings are required to generate custom valuations." }, { status: 400 });
  }
  const dataset = FANTRAX_DATASETS.find((d) => d.key === body.dataset)?.key as FantraxDatasetKey | undefined
    ?? FANTRAX_DATASETS[0].key;

  const { settings } = body;
  const leagueType = settings.leagueType ?? "redraft";
  const valueBasis = leagueType === "dynasty"
    ? (settings.salaryFormat === "real" ? "real" : settings.salaryFormat === "custom" ? "custom" : "standard")
    : "standard";

  try {
    const result = await computeCustomLedger({
      leagueId: body.leagueId,
      teamId: body.teamId ?? null,
      dataset,
      leagueType,
      valueBasis,
      salaryFormat: settings.salaryFormat ?? "none",
      contractRules: settings.contractRules,
      rookieSalaryScale: settings.rookieSalaryScale,
      keeperPolicy: settings.keeperPolicy,
      realSalaryEfficiencyWeight: settings.realSalaryEfficiencyWeight,
    });
    const doc = await saveCustomValuations(auth.access.owner, body.leagueId, { leagueId: body.leagueId, ...result });
    return NextResponse.json({ doc });
  } catch (err) {
    if (err instanceof FantraxError) {
      return NextResponse.json({ error: err.message }, { status: err.status === 404 ? 404 : 502 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
