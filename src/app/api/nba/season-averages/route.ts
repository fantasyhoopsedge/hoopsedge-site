import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

/**
 * Public read: per-game season averages for ONE player across the seasons we
 * carry (current + prior 3), aggregated from nba_player_game_logs into the
 * nba_season_averages materialized view. Anon key, read-only.
 *
 *   GET /api/nba/season-averages?player_id=3945274
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const playerId = request.nextUrl.searchParams.get("player_id");
  if (!playerId) {
    return NextResponse.json(
      { error: "Missing required query param: player_id" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("nba_season_averages")
    .select("*")
    .eq("player_id", playerId)
    .order("season", { ascending: false })
    .order("season_type", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ player_id: playerId, season_averages: data });
}
