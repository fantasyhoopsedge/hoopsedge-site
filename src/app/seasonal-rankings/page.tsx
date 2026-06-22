import { createClient } from "@/utils/supabase/server";
import type { SeasonPlayerStats, SeasonPlayerValues } from "@/types/database";
import { LEAGUE_SIZES, CANONICAL_SIZE } from "@/lib/value/compute-values";
import { SeasonalRankingsTable } from "./_components/seasonal-rankings-table";

// Read live from Supabase on each request; the value sets are precomputed by
// scripts/build-seasonal-values.ts so there is no per-request math.
export const dynamic = "force-dynamic";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// PostgREST caps a single response at ~1000 rows; the value table holds one row
// per player × league size, so we page through it.
async function fetchAll<T>(supabase: SupabaseClient, table: "season_player_stats" | "season_player_values"): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + PAGE - 1);
    if (error || !data) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}

export default async function SeasonalRankingsPage() {
  const supabase = await createClient();

  const [stats, values] = await Promise.all([
    fetchAll<SeasonPlayerStats>(supabase, "season_player_stats"),
    fetchAll<SeasonPlayerValues>(supabase, "season_player_values"),
  ]);

  // Group value rows by league size: { [size]: { [player_id]: row } }.
  const valuesBySize: Record<number, Record<string, SeasonPlayerValues>> = {};
  for (const size of LEAGUE_SIZES) valuesBySize[size] = {};
  for (const v of values) {
    (valuesBySize[v.league_size] ??= {})[v.player_id] = v;
  }

  return (
    <SeasonalRankingsTable
      players={stats}
      valuesBySize={valuesBySize}
      leagueSizes={[...LEAGUE_SIZES]}
      canonicalSize={CANONICAL_SIZE}
    />
  );
}
