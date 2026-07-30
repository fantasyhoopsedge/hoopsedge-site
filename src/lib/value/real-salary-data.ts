import "server-only";
import { unstable_cache } from "next/cache";
import { createClient as createPublicClient } from "@supabase/supabase-js";
import type { Database, RealSalaryValues } from "@/types/database";

// Cached, cookieless data layer for /real-salary-rankings — mirrors
// src/lib/value/seasonal-data.ts's pattern exactly (public/world-readable data,
// 15-min cache, unstable_cache forbids cookies()/headers() so a plain anon
// client is used instead of the request-bound server client).

export const REAL_SALARY_TAG = "real-salary-rankings";
const CACHE_OPTS = { revalidate: 900, tags: [REAL_SALARY_TAG] };

function createReadClient() {
  return createPublicClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}

/** All Real Salary Value rows for a season (~450-550 rows, one page). */
export const getRealSalaryValues = unstable_cache(
  async (season: number) => {
    const PAGE = 1000;
    const supabase = createReadClient();
    const first = await supabase
      .from("real_salary_values")
      .select("*", { count: "exact" })
      .eq("season", season)
      .range(0, PAGE - 1);
    if (first.error || !first.data) return [];

    const out: RealSalaryValues[] = [...(first.data as RealSalaryValues[])];
    const total = first.count ?? out.length;
    if (total <= PAGE) return out;

    const pageCount = Math.ceil(total / PAGE);
    const rest = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, i) => {
        const from = (i + 1) * PAGE;
        return supabase
          .from("real_salary_values")
          .select("*")
          .eq("season", season)
          .range(from, from + PAGE - 1);
      }),
    );
    for (const r of rest) if (r.data) out.push(...(r.data as RealSalaryValues[]));
    return out;
  },
  ["real-salary-values"],
  CACHE_OPTS,
);

const ROSTER_SEASON = "2026-27";

export interface RosterExtra {
  player_id: string | null;
  full_name: string;
  salary_yr2: number | null;
  salary_yr3: number | null;
  salary_yr4: number | null;
  contract_status: string | null;
  is_incoming_rookie: boolean;
  is_sophomore: boolean;
}

/**
 * Display-only roster fields for the filters (Class, Contract) and the
 * future-salary columns (2027-28/2028-29/2029-30) — a separate read from
 * real_salary_values on purpose: none of this feeds the ranking/pricing
 * model, it's purely for display, so it doesn't belong in the computed
 * table or the build script. nba_roster caps at salary_yr4 (2029-30) — a
 * known gap (see docs/real-salary-dynasty-rankings-brief.md) — so 2030-31
 * has no data source at all; the table shows a dash for it.
 *
 * Includes full_name deliberately: player_id is null for brand-new
 * incoming rookies (not yet linked to a resolved nba_players.id — same gap
 * documented in build-real-salary-values.ts's loadSalaries()), so the
 * caller needs a normalized-name fallback join, not player_id alone.
 */
export const getRosterExtras = unstable_cache(
  async () => {
    const PAGE = 1000;
    const supabase = createReadClient();
    const out: RosterExtra[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("nba_roster")
        .select("player_id,full_name,salary_yr2,salary_yr3,salary_yr4,contract_status,is_incoming_rookie,is_sophomore")
        .eq("season", ROSTER_SEASON)
        .range(from, from + PAGE - 1);
      if (error || !data?.length) break;
      out.push(...(data as RosterExtra[]));
      if (data.length < PAGE) break;
    }
    return out;
  },
  ["real-salary-roster-extras"],
  CACHE_OPTS,
);
