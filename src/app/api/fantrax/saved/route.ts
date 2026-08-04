import { NextResponse } from "next/server";
import { isLeagueId } from "@/lib/fantrax/api";
import { authorizeFantrax } from "@/lib/fantrax/guard";
import { deleteLeague, listLeagues, saveLeague, type SavedLeague } from "@/lib/fantrax/store";

/**
 * The user's linked leagues.
 *
 *   GET    — list them.
 *   POST   — link/update one: { leagueId, leagueName, teamId, teamName, settings }.
 *   DELETE — unlink one: ?leagueId=…
 *
 * No Secret ID passes through here; see src/lib/fantrax/store.ts.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await authorizeFantrax();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ leagues: await listLeagues(auth.access.owner) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authorizeFantrax();
  if (!auth.ok) return auth.response;

  let body: Omit<SavedLeague, "savedAt">;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (!body?.leagueId || !isLeagueId(body.leagueId)) {
    return NextResponse.json({ error: "A valid leagueId is required." }, { status: 400 });
  }
  if (!body.settings) {
    return NextResponse.json({ error: "Import the league settings before saving." }, { status: 400 });
  }

  try {
    const saved = await saveLeague(auth.access.owner, {
      leagueId: body.leagueId,
      leagueName: body.leagueName ?? "Fantrax league",
      teamId: body.teamId ?? null,
      teamName: body.teamName ?? null,
      settings: body.settings,
    });
    return NextResponse.json({ ok: true, league: saved });
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
    await deleteLeague(auth.access.owner, leagueId);
    return NextResponse.json({ ok: true, leagues: await listLeagues(auth.access.owner) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
