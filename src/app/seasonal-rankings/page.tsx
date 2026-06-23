import { createClient } from "@/utils/supabase/server";
import type { SeasonPlayerStats, SeasonPlayerValues } from "@/types/database";
import { LEAGUE_SIZES, CANONICAL_SIZE } from "@/lib/value/compute-values";
import { SEASON_DATASETS, datasetFromKey, datasetKey } from "@/lib/value/seasons";
import rankings from "@/lib/dynasty-rankings.json";
import { SeasonalRankingsTable } from "./_components/seasonal-rankings-table";

// Age comes from the dynasty consensus, keyed by consensus rank (which every
// stat row already carries) — so no extra join or DB column is needed.
const AGE_BY_RANK: Record<number, number> = {};
for (const p of rankings as Array<{ consensusRank: number; age?: number }>) {
  if (typeof p.age === "number") AGE_BY_RANK[p.consensusRank] = p.age;
}

// Read live from Supabase on each request; the value sets are precomputed by
// scripts/build-seasonal-values.ts so there is no per-request math.
export const dynamic = "force-dynamic";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

// PostgREST caps a single response at ~1000 rows, so we page through one
// dataset (season + season_type) at a time.
async function fetchDataset<T>(
  supabase: SupabaseClient,
  table: "season_player_stats" | "season_player_values",
  season: number,
  seasonType: string,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("season", season)
      .eq("season_type", seasonType)
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}

export default async function SeasonalRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const dKey = typeof sp.d === "string" ? sp.d : undefined;
  const dataset = datasetFromKey(dKey);

  const supabase = await createClient();

  const [stats, values] = await Promise.all([
    fetchDataset<SeasonPlayerStats>(supabase, "season_player_stats", dataset.season, dataset.type),
    fetchDataset<SeasonPlayerValues>(supabase, "season_player_values", dataset.season, dataset.type),
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
      seasons={SEASON_DATASETS.map((d) => ({ key: datasetKey(d.season, d.type), label: d.label }))}
      activeSeason={datasetKey(dataset.season, dataset.type)}
      ageByRank={AGE_BY_RANK}
    />
  );
}
