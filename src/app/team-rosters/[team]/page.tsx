import { notFound } from "next/navigation";
import "../_components/roster-tokens.css";
import { TeamRostersShell } from "../_components/team-rosters-shell";
import { getTeamAgeRank, getTeamRoster } from "../_components/roster-live-data";
import { TEAMS } from "../_components/roster-data";

export async function generateStaticParams() {
  return TEAMS.map((t) => ({ team: t.abbr }));
}

export default async function TeamRosterPage({ params }: { params: Promise<{ team: string }> }) {
  const { team: teamParam } = await params;
  const team = teamParam.toUpperCase();
  if (!TEAMS.some((t) => t.abbr === team)) notFound();

  const [players, ageRank] = await Promise.all([getTeamRoster(team), getTeamAgeRank(team)]);
  return <TeamRostersShell key={team} team={team} players={players} ageRank={ageRank} />;
}
