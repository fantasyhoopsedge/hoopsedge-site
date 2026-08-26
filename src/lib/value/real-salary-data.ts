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
  fhe_id: string | null;
  full_name: string;
  dob: string | null;
  salary_yr2: number | null;
  salary_yr3: number | null;
  salary_yr4: number | null;
  contract_status: string | null;
  is_incoming_rookie: boolean;
  is_sophomore: boolean;
  /** The real, audited full contract — Pocaro's cap-sheet team-by-team
   *  rebuild (see the salary-roster-pipeline skill), NOT derived from
   *  summing salary_yr1..yr4. Those year-by-year columns can include a
   *  Qualifying Offer / RFA cap-hold estimate for a season AFTER the
   *  player's real deal already ends (salary_qo_years flags which), which
   *  silently inflated both the year count and the dollar total when
   *  getContractByFheId() used to derive "years/total remaining" by summing
   *  them instead of reading these two fields directly (Ash, 2026-08-27:
   *  Kyshawn George's rookie-scale deal read "3yr/$17.0M" on League
   *  Rankings/Trade Edge — 2 real years plus his 2028-29 QO estimate folded
   *  in as if it were a third contract year — against the audited "4yr/
   *  $14.3M" team-rosters itself already shows). Null for a player/team
   *  nba_roster hasn't been through that audit for yet. */
  contract_years: number | null;
  contract_total: number | null;
}

/**
 * Display-only roster fields for the filters (Class, Contract), the Age
 * column (computed fresh from dob on every request — not a persisted/stale
 * age_at_ingest snapshot), and the future-salary columns (2027-28/2028-29/
 * 2029-30) — a separate read from real_salary_values on purpose: none of
 * this feeds the ranking/pricing model, it's purely for display, so it
 * doesn't belong in the computed table or the build script. nba_roster caps
 * at salary_yr4 (2029-30) — a known gap (see
 * docs/real-salary-dynasty-rankings-brief.md) — so 2030-31 has no data
 * source at all; the table shows a dash for it.
 *
 * Joined on `fhe_id` (2026-08-04). `player_id` is null for brand-new incoming
 * rookies not yet linked to a resolved nba_players.id, which is why this used to
 * also carry `full_name` for a normalized-name fallback join. `fhe_id` covers
 * those rookies (619/619 of this table), so the fallback is gone. `full_name` is
 * kept only as the display name of last resort.
 */
export const getRosterExtras = unstable_cache(
  async () => {
    const PAGE = 1000;
    const supabase = createReadClient();
    const out: RosterExtra[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("nba_roster")
        .select("player_id,fhe_id,full_name,dob,salary_yr2,salary_yr3,salary_yr4,contract_status,is_incoming_rookie,is_sophomore,contract_years,contract_total")
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
