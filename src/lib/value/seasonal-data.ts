import "server-only";
import { unstable_cache } from "next/cache";
import { createClient as createPublicClient } from "@supabase/supabase-js";
import type { Database, PointsLeagueValues, SeasonPlayerStats, SeasonPlayerValues } from "@/types/database";

// Shared server-side data layer for /seasonal-rankings, used by both the page
// (initial render) and the on-demand values API route (Player Pool switches).
//
// The value sets are precomputed by scripts/build-seasonal-values.ts and are
// PUBLIC (identical for every visitor), so we read them with a cookieless anon
// client and cache each slice for 15 minutes. After a `seasonal:build`, refreshed
// data appears within the window — or immediately via
// revalidateTag(SEASONAL_TAG).

export const SEASONAL_TAG = "seasonal-rankings";
const CACHE_OPTS = { revalidate: 900, tags: [SEASONAL_TAG] };

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
// trip; any remaining pages are fetched CONCURRENTLY rather than sequentially.
async function fetchPaged<T>(
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

/** Player stats for a dataset (season + type). Cached 15 min. */
export const getStats = unstable_cache(
  async (season: number, seasonType: string) =>
    fetchPaged<SeasonPlayerStats>(createReadClient(), "season_player_stats", season, seasonType),
  ["seasonal-stats"],
  CACHE_OPTS,
);

/**
 * Value rows for ONE league size of a dataset (~600 rows, a single page). Cached
 * 15 min per (season, type, size) — the unit the client loads on demand when the
 * Player Pool changes, keeping each payload small.
 */
export const getValuesForSize = unstable_cache(
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

/** Index value rows by player_id for O(1) lookup in the table. */
export function indexValuesById(rows: SeasonPlayerValues[]): Record<string, SeasonPlayerValues> {
  const map: Record<string, SeasonPlayerValues> = {};
  for (const v of rows) map[v.player_id] = v;
  return map;
}

/**
 * Points-league values for a dataset (season + type) — built by
 * scripts/build-points-league-values.ts. Unlike season_player_values there is
 * no league_size fan-out (a flat weighted-sum score has no baseline pool to be
 * relative to), so this is one small query per dataset, not per size. Summer
 * League datasets have no rows here by design (excluded from that build) —
 * callers get back an empty array, not an error.
 */
export const getPointsLeagueValues = unstable_cache(
  async (season: number, seasonType: string) => {
    const { data } = await createReadClient()
      .from("points_league_values")
      .select("*")
      .eq("season", season)
      .eq("season_type", seasonType)
      .range(0, 1499);
    return (data ?? []) as PointsLeagueValues[];
  },
  ["seasonal-points-league-values"],
  CACHE_OPTS,
);

/** Index points-league rows by player_id for O(1) lookup in the table. */
export function indexPointsById(rows: PointsLeagueValues[]): Record<string, PointsLeagueValues> {
  const map: Record<string, PointsLeagueValues> = {};
  for (const v of rows) map[v.player_id] = v;
  return map;
}
