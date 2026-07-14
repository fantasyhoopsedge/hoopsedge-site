import { NextResponse } from "next/server";
import { getSophomoreNames } from "@/app/team-rosters/_components/roster-live-data";

/**
 * Public read: normalized names of every current-season sophomore, league-wide.
 * Lets client-only pages like /dynasty-rankings (no DB access of its own —
 * dynasty-rankings.json is a build-time bundle) tag SOPHOMORE next to ROOKIE.
 *
 *   GET /api/nba/sophomores
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const names = await getSophomoreNames();
  return NextResponse.json({ names });
}
