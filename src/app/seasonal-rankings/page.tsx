import { createClient } from "@/utils/supabase/server";
import type { SeasonPlayerStats, SeasonPlayerValues } from "@/types/database";
import { LEAGUE_SIZES, CANONICAL_SIZE } from "@/lib/value/compute-values";
import { SeasonalRankingsTable } from "./_components/seasonal-rankings-table";

// Read live from Supabase on each request; the value sets are precomputed by
// scripts/build-seasonal-values.ts so there is no per-request math.
export const dynamic = "force-dynamic";

export default async function SeasonalRankingsPage() {
  const supabase = await createClient();

  const [statsRes, valuesRes] = await Promise.all([
    supabase.from("season_player_stats").select("*"),
    supabase.from("season_player_values").select("*"),
  ]);

  const stats = (statsRes.data ?? []) as SeasonPlayerStats[];
  const values = (valuesRes.data ?? []) as SeasonPlayerValues[];

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
