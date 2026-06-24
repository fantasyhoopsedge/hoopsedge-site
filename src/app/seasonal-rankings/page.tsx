import { unstable_cache } from "next/cache";
import { createClient as createPublicClient } from "@supabase/supabase-js";
import type { Database, SeasonPlayerStats, SeasonPlayerValues } from "@/types/database";
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

// The value sets are precomputed by scripts/build-seasonal-values.ts and are
// PUBLIC (identical for every visitor), so we read them with a cookieless anon
// client and cache each dataset for 15 minutes (see getDataset below). After a
// `seasonal:build`, refreshed data appears within the window — or immediately
// via revalidateTag("seasonal-rankings").
export const dynamic = "force-dynamic";

// Cookieless client → safe to call inside unstable_cache (which forbids
// cookies()/headers()). No auth session needed; this data is world-readable.
function createReadClient() {
  return createPublicClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}

type SupabaseClient = ReturnType<typeof createReadClient>;

// PostgREST caps a single response at ~1000 rows. The first page is fetched with
// an exact count, so a single-page table (e.g. stats, ~600 rows) costs ONE round
// trip; for a multi-page table (values = ~600 players × 10 league sizes ≈ 6 pages)
// the remaining pages are fetched CONCURRENTLY rather than sequentially. This is
// the season-switch hot path — sequential paging was ~6 serial round trips.
async function fetchDataset<T>(
  supabase: SupabaseClient,
  table: "season_player_stats" | "season_player_values",
  season: number,
  seasonType: string,
): Promise<T[]> {
  const PAGE = 1000;
  const first = await supabase
    .from(table)
    .select("*", { count: "exact" })
    .eq("season", season)
    .eq("season_type", seasonType)
    .range(0, PAGE - 1);
  if (first.error || !first.data) return [];

  const out: T[] = [...(first.data as T[])];
  const total = first.count ?? out.length;
  if (total <= PAGE) return out;

  // Fetch every remaining page in parallel.
  const pageCount = Math.ceil(total / PAGE);
  const rest = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, i) => {
      const from = (i + 1) * PAGE;
      return supabase
        .from(table)
        .select("*")
        .eq("season", season)
        .eq("season_type", seasonType)
        .range(from, from + PAGE - 1);
    }),
  );
  for (const r of rest) if (r.data) out.push(...(r.data as T[]));
  return out;
}

// Caching is split into per-table / per-league-size entries: the Next.js Data
// Cache rejects any single entry over 2MB, and the full values payload (~600
// players × 10 sizes) is ~3.5MB. Each slice below is well under the limit, and
// the slices are fetched concurrently, so a warm season switch skips Supabase
// entirely. All share the "seasonal-rankings" tag for one-shot revalidation.
const CACHE_OPTS = { revalidate: 900, tags: ["seasonal-rankings"] };

const getStats = unstable_cache(
  async (season: number, seasonType: string) =>
    fetchDataset<SeasonPlayerStats>(createReadClient(), "season_player_stats", season, seasonType),
  ["seasonal-stats"],
  CACHE_OPTS,
);

// One cache entry per league size — each is a single page (~600 rows < the 1000
// PostgREST cap), so no internal paging is needed.
const getValuesForSize = unstable_cache(
  async (season: number, seasonType: string, size: number) => {
    const { data } = await createReadClient()
      .from("season_player_values")
      .select("*")
      .eq("season", season)
      .eq("season_type", seasonType)
      .eq("league_size", size)
      .range(0, 1499);
    return (data ?? []) as SeasonPlayerValues[];
  },
  ["seasonal-values-size"],
  CACHE_OPTS,
);

export default async function SeasonalRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const dKey = typeof sp.d === "string" ? sp.d : undefined;
  const dataset = datasetFromKey(dKey);

  const [stats, ...valueChunks] = await Promise.all([
    getStats(dataset.season, dataset.type),
    ...LEAGUE_SIZES.map((size) => getValuesForSize(dataset.season, dataset.type, size)),
  ]);
  const values = valueChunks.flat();

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
