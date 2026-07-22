import { NextResponse, type NextRequest } from "next/server";
import { loadPublishedRows, DEFAULT_TIER } from "@/lib/role-context-store";

/**
 * Public read-only usage-role snapshot for a team, for the /team-rosters
 * "Depth Chart" pop-up. PUBLISHED tiers only, no auth. Only returns players
 * whose tier has actually been changed away from the default ("no_change")
 * — the pop-up only ever tags a player when there's something to say.
 *
 *   GET /api/nba/role-context?team=OKC
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const team = request.nextUrl.searchParams.get("team");
  if (!team) return NextResponse.json({ error: "team query param required" }, { status: 400 });

  try {
    const rows = await loadPublishedRows();
    const tagged = rows
      .filter((r) => r.team === team.toUpperCase() && r.tier !== DEFAULT_TIER)
      .map((r) => ({ player: r.player, tier: r.tier }));
    return NextResponse.json({ rows: tagged });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
