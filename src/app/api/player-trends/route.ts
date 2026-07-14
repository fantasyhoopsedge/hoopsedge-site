import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { SEASON_DATASETS } from "@/lib/value/seasons";

// Serves ONE player's block-level value trend from the nba_player_trends table
// (written by `npm run trends:build`). Each row's payload is byte-identical to
// one element of the old output/player-trends JSON artifact's `players` array,
// so the response shape is unchanged — but trends now update without a redeploy.
export const dynamic = "force-dynamic";

// World-readable data via a cookieless anon client (mirrors seasonal-data.ts).
// Per-player payloads are ~10-20KB — safely under Next's 2MB data-cache limit
// that ruled out caching the old whole-league file.
const getPlayerTrend = unstable_cache(
  async (playerId: string, season: number, type: string) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return null; // secret-less preview deploys still boot

    const supabase = createClient<Database>(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await supabase
      .from("nba_player_trends")
      .select("payload")
      .eq("season", season)
      .eq("season_type", type)
      .eq("player_id", playerId)
      .maybeSingle();
    // Throw on query errors so unstable_cache does NOT cache them — otherwise a
    // transient failure would pin a false "not found" for the full revalidate
    // window. A genuine missing row (data null, no error) is fine to cache.
    if (error) throw new Error(`nba_player_trends read failed: ${error.message}`);
    return data?.payload ?? null;
  },
  ["player-trends"],
  { revalidate: 900 },
);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get("player_id");
  const season = Number(searchParams.get("season"));
  const type = searchParams.get("type") ?? "";

  const validDataset = SEASON_DATASETS.some((d) => d.season === season && d.type === type);
  if (!playerId || !validDataset) {
    return Response.json({ error: "invalid player_id or dataset" }, { status: 400 });
  }

  let player: unknown;
  try {
    player = await getPlayerTrend(playerId, season, type);
  } catch {
    return Response.json({ error: "trends temporarily unavailable" }, { status: 503 });
  }
  if (!player) {
    return Response.json({ error: "player not found or trends not built" }, { status: 404 });
  }

  return Response.json(player);
}
