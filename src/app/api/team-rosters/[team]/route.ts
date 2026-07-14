import { getTeamRoster } from "@/app/team-rosters/_components/roster-live-data";
import { TEAMS } from "@/app/team-rosters/_components/roster-data";

// Exposes the same rich per-team Player[] the /team-rosters/[team] page
// renders server-side (nba_roster + season_player_stats +
// season_player_values + nba_player_trends + dynasty-rankings.json +
// rookie-board.json — see roster-live-data.ts), so the compare modal can
// fetch OTHER teams' rosters client-side without a full page navigation.
// getTeamRoster() is "server-only" but that only blocks client-bundle
// imports — Route Handlers run server-side, same as Server Components.
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ team: string }> }) {
  const { team: teamParam } = await params;
  const team = teamParam.toUpperCase();
  if (!TEAMS.some((t) => t.abbr === team)) {
    return Response.json({ error: "unknown team" }, { status: 404 });
  }

  const players = await getTeamRoster(team);
  return Response.json(players);
}
