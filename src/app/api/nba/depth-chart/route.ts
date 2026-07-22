import { NextResponse, type NextRequest } from "next/server";
import { loadPublishedRows, TIER_VALUES } from "@/lib/depth-chart-store";

/**
 * Public read-only depth-chart snapshot for a team, for the /team-rosters
 * "Depth Chart" pop-up. PUBLISHED tiers only (never the admin's WIP draft),
 * no auth — this is the same projected-2026-27 role/minutes/usage picture
 * the /admin/depth-chart tool edits, just the read side for visitors.
 *
 *   GET /api/nba/depth-chart?team=OKC
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const team = request.nextUrl.searchParams.get("team");
  if (!team) return NextResponse.json({ error: "team query param required" }, { status: 400 });

  try {
    const rows = await loadPublishedRows();
    const teamRows = rows
      .filter((r) => r.team === team.toUpperCase() && r.tier !== "cut")
      .map((r) => ({
        player: r.player,
        pos: r.pos,
        tier: TIER_VALUES.includes(r.tier) ? r.tier : "reserve",
        projMpg: r.projMpg,
        projGames: r.projGames,
        usg: r.usg,
      }));
    return NextResponse.json({ rows: teamRows });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
