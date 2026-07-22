"use client";

import type { Player } from "./roster-data";
import { DepthChartBody } from "./depth-chart-body";

/** Mobile-only inline depth chart — replaces the roster list (not the whole
 * page) when the "Depth Chart" topbar button is toggled on a phone. Desktop
 * and tablet keep the DepthChartModal pop-up (same DepthChartBody content,
 * different chrome — see that file). No width cap here: it just fills the
 * same content column every other section of this page uses. */
export function DepthChartInline({
  team,
  teamName,
  players,
}: {
  team: string;
  teamName: string;
  players: Player[];
}) {
  return <DepthChartBody team={team} teamName={teamName} players={players} />;
}
