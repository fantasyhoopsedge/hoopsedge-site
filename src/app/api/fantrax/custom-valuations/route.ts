import { NextResponse } from "next/server";
import { FantraxError, isLeagueId } from "@/lib/fantrax/api";
import { authorizeFantrax } from "@/lib/fantrax/guard";
import { computeCustomLedger, computePickValuesLedger } from "@/lib/fantrax/custom-valuations";
import { deleteCustomValuations, getCustomValuations, saveCustomValuations } from "@/lib/fantrax/custom-valuations-store";
import { FANTRAX_DATASETS, type FantraxDatasetKey } from "@/lib/fantrax/resolve";
import type { SavedLeagueSettings } from "@/lib/fantrax/store";

/**
 * The custom league-asset ledger — "Would you like to customize the value
 * of your league assets?" (Ash, 2026-08-23).
 *
 *   GET  ?leagueId=… — read the cached ledger only, never recomputes (same
 *        read-only contract as getLiveBoard() for the rookie board).
 *   DELETE ?leagueId=… — "Reset": clears the cached ledger entirely (Ash,
 *        2026-08-25: "give an option to reset those values... user can run,
 *        reset or run again at any point"). The CALLER still has to flip
 *        useCustomValuations/useGeneratedPickValues back off via
 *        /api/fantrax/saved — this endpoint only clears the generated data,
 *        it doesn't touch league settings.
 *   POST { leagueId, teamId, dataset, settings, mode? } — the "Regenerate"
 *        action: runs computeCustomLedger() fresh and overwrites the cached
 *        row. `mode: "picksOnly"` (Ash, 2026-08-25: "a new button on the
 *        home screen... to generate the value of draft pick assets for
 *        dynasty and keeper leagues... used for leagues that apply the
 *        standard base asset values") runs computePickValuesLedger()
 *        instead — draft-pick values alone, for a league that isn't opting
 *        into full custom asset valuations. Both write the SAME
 *        (owner, leagueId) row — a league is either standard (at most a
 *        picksOnly doc) or custom (a full doc), never both at once, so
 *        sharing the row is correct, not a collision. Default "full",
 *        unchanged from before this field existed.
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

export async function DELETE(request: Request) {
  const auth = await authorizeFantrax();
  if (!auth.ok) return auth.response;

  const leagueId = (new URL(request.url).searchParams.get("leagueId") ?? "").trim();
  if (!isLeagueId(leagueId)) {
    return NextResponse.json({ error: "A valid leagueId is required." }, { status: 400 });
  }
  try {
    await deleteCustomValuations(auth.access.owner, leagueId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authorizeFantrax();
  if (!auth.ok) return auth.response;

  let body: { leagueId?: string; teamId?: string | null; dataset?: string; settings?: SavedLeagueSettings; mode?: "full" | "picksOnly" };
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
  const mode = body.mode ?? "full";

  try {
    if (mode === "picksOnly") {
      // Draft-pick values alone (real dynasty consensus rank / real-salary
      // rank at each pick slot) — never "custom" (customSalaryValues needs
      // this league's real rostered+FA pool to rank against, which this
      // path deliberately never loads; see computePickValuesLedger's own
      // doc). A dynasty league on custom-salary format that lands here
      // (settings.useCustomValuations off, but salaryFormat "custom")
      // still gets a real, correct number — just consensus-based, the same
      // fallback "standard" dynasty leagues already get everywhere else.
      const valueBasis = leagueType === "dynasty" && settings.salaryFormat === "real" ? "real" : "standard";
      const result = await computePickValuesLedger({
        leagueId: body.leagueId,
        teamId: body.teamId ?? null,
        dataset,
        leagueType,
        valueBasis,
        rookieSalaryScale: settings.rookieSalaryScale,
      });
      const doc = await saveCustomValuations(auth.access.owner, body.leagueId, { leagueId: body.leagueId, ...result });
      return NextResponse.json({ doc });
    }

    const valueBasis = leagueType === "dynasty"
      ? (settings.salaryFormat === "real" ? "real" : settings.salaryFormat === "custom" ? "custom" : "standard")
      : "standard";
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
