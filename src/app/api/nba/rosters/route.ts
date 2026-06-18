import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import type { NbaContract } from "@/types/database";

/**
 * Public read: active rosters — each player with their team and latest
 * contract (salary + FHE-derived FA fields), joined in-process by player_id.
 * Anon key, read-only. Optional ?team=ABV filter (e.g. ?team=BOS).
 *
 *   GET /api/nba/rosters
 *   GET /api/nba/rosters?team=LAL
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ContractSummary = Pick<
  NbaContract,
  | "salary_current"
  | "salary_y2"
  | "salary_y3"
  | "salary_y4"
  | "contract_note"
  | "free_agent_year"
  | "free_agent_status"
  | "is_two_way"
>;

export async function GET(request: NextRequest) {
  const team = request.nextUrl.searchParams.get("team");
  const supabase = await createClient();

  let playersQuery = supabase
    .from("nba_players")
    .select("id,full_name,team,position,is_active")
    .eq("is_active", true);
  if (team) playersQuery = playersQuery.eq("team", team.toUpperCase());
  playersQuery = playersQuery.order("team").order("full_name");

  const { data: players, error: playersError } = await playersQuery;
  if (playersError) {
    return NextResponse.json({ error: playersError.message }, { status: 500 });
  }

  // Attach each player's contract (one query, joined by player_id in-process).
  const { data: contracts, error: contractsError } = await supabase
    .from("nba_contracts")
    .select(
      "player_id,salary_current,salary_y2,salary_y3,salary_y4,contract_note,free_agent_year,free_agent_status,is_two_way",
    )
    .not("player_id", "is", null);
  if (contractsError) {
    return NextResponse.json({ error: contractsError.message }, { status: 500 });
  }

  const byPlayer = new Map<string, ContractSummary>();
  for (const c of contracts ?? []) {
    if (c.player_id) byPlayer.set(c.player_id, c);
  }

  const roster = (players ?? []).map((p) => ({
    ...p,
    contract: byPlayer.get(p.id) ?? null,
  }));

  return NextResponse.json({ count: roster.length, roster });
}
