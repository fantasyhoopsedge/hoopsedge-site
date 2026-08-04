import "server-only";
import { unstable_cache } from "next/cache";
import { createClient as createPublicClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { DYNASTY_RANKINGS, normalizePlayerName } from "@/lib/dynasty-rankings";
import { playerIdentity } from "@/lib/player-identity/bundled";
import { ROOKIE_BOARD, tierInfo } from "@/lib/rookie-board";
import type { Player } from "./roster-data";
import { deriveFinalTake, type BlockOut, type SeasonHistoryEntry, type TrendTag } from "./trend-insight";

// Live per-team roster for /team-rosters, joining sources into the UI's Player shape:
//   - nba_roster            → bio, position, contract, salary, draft, tags
//   - season_player_stats   → 2025-26 (season 2026) per-game 9-cat line
//   - season_player_values  → real 9-cat values (league_size 400, matches /seasonal-rankings)
//   - nba_player_trends     → block-level trend payloads → per-metric tones
//   - dynasty-rankings.json → consensus rank/tier/trend + master-source position
//   - rookie-board.json     → projected 9-cat star profile for incoming rookies
// PUBLIC + read-only → cookieless anon client cached 15 min (mirrors seasonal-data.ts).
//
// ── Joined on fhe_id (Phase 3, 2026-08-04) ──────────────────────────────────
// The two BUNDLED sources above (dynasty board, rookie board) are name-only
// files, and they used to be joined to the roster by normalized name with an
// alias map seeded in both directions. They now resolve through the player
// identity registry, so the name form each source happens to use stops
// mattering. `nba_roster.fhe_id` is 619/619, and the board join was measured to
// agree with the name join on all 475 rows either could resolve, with none
// gained or lost.
//
// Still name-keyed, deliberately:
//   - getSophomoreNames() returns a norm_name-keyed list that /api/nba/sophomores
//     serves to /dynasty-rankings. Re-keying it is that page's migration, not
//     this one. (getDraftYears() moved to fhe_id on 2026-08-04 along with its one
//     caller, /seasonal-rankings.)
//   - depth-chart-body.tsx matches the depth-chart JSON to players by name. It
//     is a CLIENT component, so resolving identities there would ship the ~230 KB
//     registry to the browser; the fix is an fhe_id in the depth-chart artifact
//     itself, at build time.

export const ROSTER_TAG = "team-rosters";
const ROSTER_SEASON = "2026-27";
const STATS_SEASON = 2026; // hoopR: 2026 = the 2025-26 season (latest full)
const PRIOR_STATS_SEASON = STATS_SEASON - 1; // 2025 = 2024-25, for the Prior tab
const PRIOR_PRIOR_STATS_SEASON = STATS_SEASON - 2; // 2024 = 2023-24, the anchor the Prior-mode arrow compares against
const VALUE_LEAGUE_SIZE = 400; // matches /seasonal-rankings default 1:1
const CACHE_OPTS = { revalidate: 900, tags: [ROSTER_TAG] };
const TRENDS_SEASON_TYPE = "regular";

/** The slice of an nba_player_trends payload the tone derivation needs. */
type TrendPayload = { blocks: BlockOut[]; seasonHistory: SeasonHistoryEntry[] };

/** Blended consensus-vs-real-value trend tag per metric for one player, or all-null if there's no trend/consensus data.
 * `isRookie` = first-year player in the charted (completed) season — the roster's is_sophomore flag (R6/R15). */
function tagsFrom(trend: TrendPayload | undefined, consensusRank: number, age: number | null, isRookie: boolean): { nine: TrendTag | null; m1: TrendTag | null; eight: TrendTag | null } {
  if (!trend) return { nine: null, m1: null, eight: null };
  const history = trend.seasonHistory ?? [];
  return {
    nine: deriveFinalTake(trend.blocks, history, age, "nineCatV", consensusRank, null, isRookie)?.tag ?? null,
    m1: deriveFinalTake(trend.blocks, history, age, "minus1V", consensusRank, null, isRookie)?.tag ?? null,
    eight: deriveFinalTake(trend.blocks, history, age, "eightCatV", consensusRank, null, isRookie)?.tag ?? null,
  };
}

function createReadClient() {
  return createPublicClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * Dynasty rows indexed by IDENTITY (Phase 3, 2026-08-04).
 *
 * This join decides a player's consensus rank, and a miss doesn't fail loudly —
 * it silently demotes a ranked player to the 999 fallback, which then feeds the
 * tone/BUY-SELL-HOLD derivation as if he were unranked. It used to be a
 * normalized-name lookup with every known nickname/legal-name pair seeded in as
 * an extra key in both directions, precisely because the roster CSV and the
 * dynasty board disagree about which form of a name to use (R2, trend-tag
 * audit). That alias-seeding is now unnecessary: both sides resolve to an
 * `fhe_id` first, so the name form each source happens to use stops mattering.
 *
 * Measured before switching: across all 619 roster rows the id join and the
 * name join agree on 475 and disagree on none — no row gains or loses a
 * consensus rank. The value is structural, not a fix to today's numbers.
 *
 * Board names are resolved through the registry once here; the board itself has
 * no id column (a hand-published list of names), which is why the name→identity
 * step exists at all. Server-only module, so the ~230 KB registry never reaches
 * the browser.
 */
const DYN_BY_FHE_ID = new Map<string, (typeof DYNASTY_RANKINGS)[number]>();
for (const d of DYNASTY_RANKINGS) {
  const res = playerIdentity().resolve({ name: d.player });
  if (res.kind === "matched" && !DYN_BY_FHE_ID.has(res.identity.fheId)) {
    DYN_BY_FHE_ID.set(res.identity.fheId, d);
  }
}

// Rookie board projected star profile → per-category z (CATS order), indexed by name.
// starTier() reproduces the star from these z's: 5★→1.3, 4★→0.65, 3★→0, 2★→-0.65, 1★→-1.3.
const STAR_Z: Record<number, number> = { 5: 1.3, 4: 0.65, 3: 0, 2: -0.65, 1: -1.3 };
const parseStar = (s: unknown): number => STAR_Z[Number(String(s ?? "").match(/\d/)?.[0]) as 1 | 2 | 3 | 4 | 5] ?? 0;
type RookieProj = { catVals: number[]; pos: string; boardRank: number; boardTier: number; boardTierLabel: string; boardTierColor: string };
/** "THE_UNTOUCHABLES_TIER" -> "The Untouchables". */
function humanizeTierLabel(raw: string): string {
  return raw
    .replace(/_TIER$/i, "")
    .split("_")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
/**
 * Rookie board, indexed by identity where one exists and by name otherwise.
 *
 * The name index is NOT vestigial here the way it is for the dynasty board: 2 of
 * the 58 board players (Noam Yaacov, Darrion Williams) are international
 * prospects the registry has no identity for at all, and dropping them would
 * blank the projected 9-cat profile the page shows for an incoming rookie. So
 * both indexes are built and identity is simply tried first.
 */
const ROOKIE_BY_FHE_ID = new Map<string, RookieProj>();
const ROOKIE_BY_NORM = new Map<string, RookieProj>(
  ROOKIE_BOARD.players.map((r) => [
    normalizePlayerName(r.name),
    {
      // CATS order: pts, reb, ast, stl, blk, 3pm, fg%, ft%, to
      catVals: [r.pts, r.reb, r.ast, r.stl, r.blk, r.tpm, r.fg, r.ft, r.to].map(parseStar),
      pos: r.pos ?? "",
      boardRank: r.rank,
      boardTier: r.tier,
      boardTierLabel: humanizeTierLabel(tierInfo(r.tier, ROOKIE_BOARD.tiers).label),
      boardTierColor: tierInfo(r.tier, ROOKIE_BOARD.tiers).color,
    },
  ]),
);
for (const r of ROOKIE_BOARD.players) {
  const res = playerIdentity().resolve({ name: r.name });
  const proj = ROOKIE_BY_NORM.get(normalizePlayerName(r.name));
  if (res.kind === "matched" && proj && !ROOKIE_BY_FHE_ID.has(res.identity.fheId)) {
    ROOKIE_BY_FHE_ID.set(res.identity.fheId, proj);
  }
}

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

function dynastyPoints(consensus: number): number {
  return Math.round(10000 * Math.exp(-(consensus - 1) / 90));
}

/** Coarse G/F/C for the position filter, from a dynasty-style position string. */
function groupOf(pos: string, fallback: "G" | "F" | "C"): "G" | "F" | "C" {
  const p = pos.toUpperCase();
  return p.startsWith("G") ? "G" : p.startsWith("F") ? "F" : p.startsWith("C") ? "C" : fallback;
}

/** value = mean of the 9 category z-scores, so value*9 = sum; minus1v = (sum - worst)/8. */
function derive(catVals: number[]) {
  const sum = catVals.reduce((a, b) => a + b, 0);
  const worst = catVals.length ? Math.min(...catVals) : 0;
  const to = catVals[8] ?? 0; // TO is the last CATS entry
  return { nineCat: sum / 9, minus1: (sum - worst) / 8, eightCat: (sum - to) / 8 };
}

/** Pool-wide rank (1 = best) by each metric across ALL players at the league size. Cached, shared across teams. */
const getPoolRanks = unstable_cache(
  async (): Promise<Record<string, { nine: number; m1: number; eight: number }>> => {
    const supabase = createReadClient();
    const rows: { player_id: string; value: number | null; minus1v: number | null; v_to: number | null }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from("season_player_values")
        .select("player_id,value,minus1v,v_to")
        .eq("season", STATS_SEASON)
        .eq("season_type", "regular")
        .eq("league_size", VALUE_LEAGUE_SIZE)
        .range(from, from + 999);
      if (!data?.length) break;
      rows.push(...(data as typeof rows));
      if (data.length < 1000) break;
    }
    const rankBy = (score: (r: (typeof rows)[number]) => number): Record<string, number> => {
      const m: Record<string, number> = {};
      [...rows].sort((a, b) => score(b) - score(a)).forEach((r, i) => (m[r.player_id] = i + 1));
      return m;
    };
    const nine = rankBy((r) => r.value ?? -999);
    const m1 = rankBy((r) => r.minus1v ?? -999);
    const eight = rankBy((r) => ((r.value ?? 0) * 9 - (r.v_to ?? 0)) / 8);
    const out: Record<string, { nine: number; m1: number; eight: number }> = {};
    for (const r of rows) out[r.player_id] = { nine: nine[r.player_id], m1: m1[r.player_id], eight: eight[r.player_id] };
    return out;
  },
  ["team-roster-pool-ranks"],
  CACHE_OPTS,
);

/** Same as getPoolRanks but for the 2024-25 (Prior) season — powers the compare
 * tool's dynamic Prior-mode Minus1V rank. Cached, shared across teams. */
const getPriorPoolRanks = unstable_cache(
  async (): Promise<Record<string, { nine: number; m1: number; eight: number }>> => {
    const supabase = createReadClient();
    const rows: { player_id: string; value: number | null; minus1v: number | null; v_to: number | null }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from("season_player_values")
        .select("player_id,value,minus1v,v_to")
        .eq("season", PRIOR_STATS_SEASON)
        .eq("season_type", "regular")
        .eq("league_size", VALUE_LEAGUE_SIZE)
        .range(from, from + 999);
      if (!data?.length) break;
      rows.push(...(data as typeof rows));
      if (data.length < 1000) break;
    }
    const rankBy = (score: (r: (typeof rows)[number]) => number): Record<string, number> => {
      const m: Record<string, number> = {};
      [...rows].sort((a, b) => score(b) - score(a)).forEach((r, i) => (m[r.player_id] = i + 1));
      return m;
    };
    const nine = rankBy((r) => r.value ?? -999);
    const m1 = rankBy((r) => r.minus1v ?? -999);
    const eight = rankBy((r) => ((r.value ?? 0) * 9 - (r.v_to ?? 0)) / 8);
    const out: Record<string, { nine: number; m1: number; eight: number }> = {};
    for (const r of rows) out[r.player_id] = { nine: nine[r.player_id], m1: m1[r.player_id], eight: eight[r.player_id] };
    return out;
  },
  ["team-roster-pool-ranks-prior"],
  CACHE_OPTS,
);

/** Same as getPoolRanks but for the 2023-24 season — the anchor the Prior-mode arrow
 * compares the Prior (2024-25) season against. Cached, shared across teams. */
const getPriorPriorPoolRanks = unstable_cache(
  async (): Promise<Record<string, { nine: number; m1: number; eight: number }>> => {
    const supabase = createReadClient();
    const rows: { player_id: string; value: number | null; minus1v: number | null; v_to: number | null }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from("season_player_values")
        .select("player_id,value,minus1v,v_to")
        .eq("season", PRIOR_PRIOR_STATS_SEASON)
        .eq("season_type", "regular")
        .eq("league_size", VALUE_LEAGUE_SIZE)
        .range(from, from + 999);
      if (!data?.length) break;
      rows.push(...(data as typeof rows));
      if (data.length < 1000) break;
    }
    const rankBy = (score: (r: (typeof rows)[number]) => number): Record<string, number> => {
      const m: Record<string, number> = {};
      [...rows].sort((a, b) => score(b) - score(a)).forEach((r, i) => (m[r.player_id] = i + 1));
      return m;
    };
    const nine = rankBy((r) => r.value ?? -999);
    const m1 = rankBy((r) => r.minus1v ?? -999);
    const eight = rankBy((r) => ((r.value ?? 0) * 9 - (r.v_to ?? 0)) / 8);
    const out: Record<string, { nine: number; m1: number; eight: number }> = {};
    for (const r of rows) out[r.player_id] = { nine: nine[r.player_id], m1: m1[r.player_id], eight: eight[r.player_id] };
    return out;
  },
  ["team-roster-pool-ranks-prior-prior"],
  CACHE_OPTS,
);

/** Average age (salaried players only) per team, ranked youngest-first. Cached, shared across teams. */
const getLeagueAgeRanks = unstable_cache(
  async (): Promise<Record<string, { rank: number; total: number }>> => {
    const supabase = createReadClient();
    const rows: { team: string; dob: string | null; age_at_ingest: number | null; salary_yr1: number | null }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from("nba_roster")
        .select("team,dob,age_at_ingest,salary_yr1")
        .eq("season", ROSTER_SEASON)
        .range(from, from + 999);
      if (!data?.length) break;
      rows.push(...(data as typeof rows));
      if (data.length < 1000) break;
    }
    const agesByTeam = new Map<string, number[]>();
    for (const r of rows) {
      if (r.salary_yr1 == null) continue; // only salaried players count toward a team's average age
      const age = ageFromDob(r.dob) ?? Math.round(r.age_at_ingest ?? 0);
      if (!age) continue;
      if (!agesByTeam.has(r.team)) agesByTeam.set(r.team, []);
      agesByTeam.get(r.team)!.push(age);
    }
    const avgs = [...agesByTeam.entries()]
      .map(([team, ages]) => ({ team, avgAge: ages.reduce((a, b) => a + b, 0) / ages.length }))
      .sort((a, b) => a.avgAge - b.avgAge); // youngest first
    const total = avgs.length;
    const out: Record<string, { rank: number; total: number }> = {};
    avgs.forEach((t, i) => (out[t.team] = { rank: i + 1, total }));
    return out;
  },
  ["team-roster-age-ranks"],
  CACHE_OPTS,
);

/** This team's youngest-to-oldest rank among all 30 teams (salaried players only), or null if unavailable. */
export async function getTeamAgeRank(team: string): Promise<{ rank: number; total: number } | null> {
  const ranks = await getLeagueAgeRanks();
  return ranks[team.toUpperCase()] ?? null;
}

/** Every current sophomore's normalized name, league-wide. Cached, shared across pages —
 * used to tag "SOPHOMORE" on /dynasty-rankings, which has no DB access of its own
 * (dynasty-rankings.json is a build-time bundle; see CLAUDE.md's data-provenance note). */
export const getSophomoreNames = unstable_cache(
  async (): Promise<string[]> => {
    const supabase = createReadClient();
    const { data } = await supabase
      .from("nba_roster")
      .select("norm_name")
      .eq("season", ROSTER_SEASON)
      .eq("is_sophomore", true);
    return (data ?? []).map((r) => r.norm_name);
  },
  ["team-roster-sophomore-names"],
  CACHE_OPTS,
);

/** Every current roster player's draft year, keyed by `fhe_id`. Draft year is a
 * fixed historical fact (unlike is_sophomore, which only describes TODAY's status), so
 * this lets a caller derive "was this player a rookie/sophomore in season N" for ANY
 * season N — used by /seasonal-rankings, which shows historical per-season stat rows
 * (hoopR season N covers the (N-1)/N year; a player is a rookie in season draftYear+1,
 * a sophomore in season draftYear+2). Only covers players still on a 2026-27 roster.
 *
 * Re-keyed from norm_name to fhe_id (Phase 3, 2026-08-04). Measured across all 12
 * datasets first: the id join loses nobody and gains three per season — Herbert
 * Jones, Cameron Johnson and Ronald Holland II, whose stat rows carry their legal
 * names while the roster carries the nicknames. This function has exactly one
 * caller, so the key changed rather than a second key being added. */
export const getDraftYears = unstable_cache(
  async (): Promise<Record<string, number>> => {
    const supabase = createReadClient();
    const { data } = await supabase
      .from("nba_roster")
      .select("fhe_id,draft_year")
      .eq("season", ROSTER_SEASON)
      .not("draft_year", "is", null);
    const out: Record<string, number> = {};
    for (const r of data ?? []) {
      if (r.draft_year != null && r.fhe_id) out[r.fhe_id] = r.draft_year;
    }
    return out;
  },
  ["team-roster-draft-years-by-fhe-id"],
  CACHE_OPTS,
);

/** Per-year cap hits (Year 1 = 2026-27), extrapolating 2029-30 for a mid-contract deal that runs that far. */
function resolveSalaryYears(r: {
  salary_yr1: number | null; salary_yr2: number | null; salary_yr3: number | null; salary_yr4: number | null;
  salary_yr5: number | null; salary_yr6: number | null;
  fa_year: number | null; salary_estimated_years: string | null;
}): { years: (number | null)[]; estimated: string | null } {
  const years = [r.salary_yr1, r.salary_yr2, r.salary_yr3, r.salary_yr4, r.salary_yr5, r.salary_yr6];
  let estimated = r.salary_estimated_years;
  // current.csv only reaches 2028-29, so a deal running to 2029-30 (FA year > 2029)
  // has a null yr4 — extrapolate it from the yr2→yr3 raise so the table reaches 2029-30.
  if (years[3] == null && r.fa_year != null && r.fa_year >= 2030 && years[1] != null && years[2] != null) {
    years[3] = years[2] + (years[2] - years[1]);
    estimated = [estimated, "2029-30"].filter(Boolean).join(", ");
  }
  return { years, estimated };
}

async function fetchTeamRoster(team: string): Promise<Player[]> {
  const supabase = createReadClient();

  const { data: roster } = await supabase
    .from("nba_roster")
    .select("*")
    .eq("season", ROSTER_SEASON)
    .eq("team", team.toUpperCase());
  if (!roster?.length) return [];

  /**
   * The ESPN id to read stats/values/trends under.
   *
   * `nba_roster.player_id` is null for 129 of 619 rows — brand-new incoming
   * rookies, who are on a roster before they are in `nba_players`. The registry
   * already knows the ESPN id for 121 of those 129, so ask it rather than
   * treating the null as "this player has no data".
   *
   * Today this rescues nothing measurable: none of those 121 have a stat row in
   * 2024, 2025 or 2026 regular season, because they have not played an NBA game.
   * It matters the day one of them does — `player_id` stays null until the next
   * roster CSV ingest, while `fhe_id` links him the moment his first box score
   * lands. That gap is exactly the rookie hand-off in
   * docs/player-identity-layer.md §3.4, and it costs nothing to close: the
   * registry is a bundled snapshot, so this is a map lookup, not a round trip.
   */
  const espnIdOf = (r: { player_id: string | null; fhe_id: string | null }): string | null =>
    r.player_id ?? (r.fhe_id ? playerIdentity().byFheId(r.fhe_id)?.espnId ?? null : null);

  const pidByRow = roster.map(espnIdOf);
  const ids = pidByRow.filter((v): v is string => v != null);

  const [statsRes, valuesRes, priorStatsRes, priorValuesRes, priorPriorStatsRes, trendsRes, poolRanks, priorPoolRanks, priorPriorPoolRanks] = await Promise.all([
    ids.length
      ? supabase
          .from("season_player_stats")
          .select("player_id,g,mpg,pts,reb,ast,stl,blk,tov,fg3m,fg_pct,ft_pct")
          .eq("season", STATS_SEASON)
          .eq("season_type", "regular")
          .in("player_id", ids)
      : Promise.resolve({ data: [] as never[] }),
    ids.length
      ? supabase
          .from("season_player_values")
          .select("player_id,value,minus1v,v_pts,v_reb,v_ast,v_stl,v_blk,v_fg3,v_fg,v_ft,v_to")
          .eq("season", STATS_SEASON)
          .eq("season_type", "regular")
          .eq("league_size", VALUE_LEAGUE_SIZE)
          .in("player_id", ids)
      : Promise.resolve({ data: [] as never[] }),
    ids.length
      ? supabase
          .from("season_player_stats")
          .select("player_id,g,mpg,pts,reb,ast,stl,blk,tov,fg3m,fg_pct,ft_pct")
          .eq("season", PRIOR_STATS_SEASON)
          .eq("season_type", "regular")
          .in("player_id", ids)
      : Promise.resolve({ data: [] as never[] }),
    ids.length
      ? supabase
          .from("season_player_values")
          .select("player_id,v_pts,v_reb,v_ast,v_stl,v_blk,v_fg3,v_fg,v_ft,v_to")
          .eq("season", PRIOR_STATS_SEASON)
          .eq("season_type", "regular")
          .eq("league_size", VALUE_LEAGUE_SIZE)
          .in("player_id", ids)
      : Promise.resolve({ data: [] as never[] }),
    ids.length
      ? supabase
          .from("season_player_stats")
          .select("player_id,g,mpg")
          .eq("season", PRIOR_PRIOR_STATS_SEASON)
          .eq("season_type", "regular")
          .in("player_id", ids)
      : Promise.resolve({ data: [] as never[] }),
    ids.length
      ? supabase
          .from("nba_player_trends")
          .select("player_id,payload")
          .eq("season", STATS_SEASON)
          .eq("season_type", TRENDS_SEASON_TYPE)
          .in("player_id", ids)
      : Promise.resolve({ data: [] as never[] }),
    getPoolRanks(),
    getPriorPoolRanks(),
    getPriorPriorPoolRanks(),
  ]);

  const statsById = new Map((statsRes.data ?? []).map((s) => [s.player_id, s]));
  const priorStatsById = new Map((priorStatsRes.data ?? []).map((s) => [s.player_id, s]));
  const priorPriorStatsById = new Map((priorPriorStatsRes.data ?? []).map((s) => [s.player_id, s]));
  const priorValuesById = new Map((priorValuesRes.data ?? []).map((v) => [v.player_id, v]));
  const valuesById = new Map((valuesRes.data ?? []).map((v) => [v.player_id, v]));
  const trendsById = new Map((trendsRes.data ?? []).map((t) => [t.player_id, t.payload as unknown as TrendPayload]));

  // The board rows for this roster, resolved by identity. Name is not consulted:
  // every one of the 619 roster rows carries an fhe_id, and the id join was
  // measured to agree with the name join on all 475 rows either could resolve.
  const dynByRow = roster.map((r) => (r.fhe_id ? DYN_BY_FHE_ID.get(r.fhe_id) : undefined));

  // Consensus rank + age gate the tone derivation (age drives the aging-decline
  // read — see trend-insight.ts), so resolve them once per row first.
  const consensusByRow = dynByRow.map((d) => d?.consensusRank ?? 999);
  const ageByRow = roster.map((r, i) => ageFromDob(r.dob) ?? Math.round(r.age_at_ingest ?? dynByRow[i]?.age ?? 0));
  const tags = roster.map((r, i) => tagsFrom(pidByRow[i] ? trendsById.get(pidByRow[i]!) : undefined, consensusByRow[i], ageByRow[i], r.is_sophomore === true));

  return roster.map((r, i): Player => {
    const pid = pidByRow[i];
    const st = pid ? statsById.get(pid) : undefined;
    const val = pid ? valuesById.get(pid) : undefined;
    const priorSt = pid ? priorStatsById.get(pid) : undefined;
    const priorVal = pid ? priorValuesById.get(pid) : undefined;
    const rank = pid ? poolRanks[pid] : undefined;
    const priorRank = pid ? priorPoolRanks[pid] : undefined;
    const priorPriorRank = pid ? priorPriorPoolRanks[pid] : undefined;
    const priorPriorSt = pid ? priorPriorStatsById.get(pid) : undefined;
    const dyn = dynByRow[i];
    const trendTags = tags[i];
    // Identity first, board name as the fallback — see ROOKIE_BY_FHE_ID on why
    // the name index survives here and not for the dynasty board.
    const rookie = r.is_incoming_rookie
      ? (r.fhe_id ? ROOKIE_BY_FHE_ID.get(r.fhe_id) : undefined) ?? ROOKIE_BY_NORM.get(r.norm_name)
      : undefined;

    // Position from the master source: dynasty consensus (veterans) → rookie board
    // (incoming rookies) → nba_roster coarse G/F/C.
    const pos = dyn?.position ?? rookie?.pos ?? r.position ?? "";
    const fallbackGroup: "G" | "F" | "C" = r.position === "C" ? "C" : r.position === "F" ? "F" : "G";
    const group = groupOf(pos, fallbackGroup);

    // Category values: real season_player_values, else the rookie-board projection, else empty.
    let catVals: number[];
    let nineCat: number, minus1: number, eightCat: number;
    let projected = false;
    if (val) {
      catVals = [val.v_pts, val.v_reb, val.v_ast, val.v_stl, val.v_blk, val.v_fg3, val.v_fg, val.v_ft, val.v_to].map((v) => v ?? 0);
      nineCat = val.value ?? 0;
      minus1 = val.minus1v ?? 0;
      eightCat = ((val.value ?? 0) * 9 - (val.v_to ?? 0)) / 8;
    } else if (rookie) {
      catVals = rookie.catVals;
      ({ nineCat, minus1, eightCat } = derive(catVals));
      projected = true;
    } else {
      catVals = [];
      nineCat = minus1 = eightCat = 0;
    }

    const consensus = dyn?.consensusRank ?? 999;
    const tag: Player["tag"] = r.is_incoming_rookie ? "rookie" : r.is_sophomore ? "soph" : null;
    const dir: Player["dir"] = dyn?.trend === "up" ? "up" : dyn?.trend === "down" ? "down" : "flat";
    const draft: Player["draft"] = r.is_incoming_rookie
      ? {
          year: r.draft_year ?? 2026,
          pick: r.draft_pick ?? null,
          boardRank: rookie?.boardRank ?? null,
          boardTier: rookie?.boardTier ?? null,
          boardTierLabel: rookie?.boardTierLabel ?? null,
          boardTierColor: rookie?.boardTierColor ?? null,
        }
      : null;
    const { years: salaryYears, estimated } = resolveSalaryYears(r);

    // Real 2024-25 line for the Prior tab. null/empty when the player has no
    // prior-season row (rookies, or a player who didn't play that season).
    const priorPg: Player["priorPg"] = priorSt
      ? {
          pts: priorSt.pts ?? 0,
          reb: priorSt.reb ?? 0,
          ast: priorSt.ast ?? 0,
          stl: priorSt.stl ?? 0,
          blk: priorSt.blk ?? 0,
          tpm: priorSt.fg3m ?? 0,
          fgp: priorSt.fg_pct ?? 0,
          ftp: priorSt.ft_pct ?? 0,
          to: priorSt.tov ?? 0,
        }
      : null;
    const priorCatVals: number[] = priorVal
      ? [priorVal.v_pts, priorVal.v_reb, priorVal.v_ast, priorVal.v_stl, priorVal.v_blk, priorVal.v_fg3, priorVal.v_fg, priorVal.v_ft, priorVal.v_to].map(
          (v) => v ?? 0,
        )
      : [];

    return {
      // `id` deliberately unchanged: it is a DISPLAY/React key that other
      // surfaces already persist and compare, so re-keying it is a separate
      // decision from re-keying the joins. fheId is added alongside rather than
      // replacing it.
      id: r.player_id ?? `n_${r.norm_name.replace(/\s+/g, "-")}`,
      fheId: r.fhe_id ?? null,
      name: r.full_name,
      team: r.team,
      jersey: Number(r.jersey) || 0,
      pos,
      group,
      age: ageByRow[i],
      gp: st?.g ?? 0,
      mpg: st?.mpg ?? 0,
      priorMpg: priorSt?.mpg ?? 0,
      tag,
      salary: r.salary_yr1 ?? 0,
      thru: String(r.fa_year ?? (r.contract_years ? 2026 + r.contract_years - 1 : 2026)),
      contractYears: r.contract_years,
      contractTotal: r.contract_total,
      contractStatus: r.contract_status,
      contractYearPosition: r.contract_year_position,
      salaryYears,
      estimatedYears: estimated,
      qoYears: r.salary_qo_years,
      dynasty: dynastyPoints(consensus),
      change: dyn ? (dir !== "flat" && dyn.trendDelta ? String(dyn.trendDelta) : "—") : "",
      dir,
      dirDelta: dyn?.trendDelta ?? null,
      consensus,
      tier: dyn?.tier ?? null,
      draft,
      pg: {
        pts: st?.pts ?? 0,
        reb: st?.reb ?? 0,
        ast: st?.ast ?? 0,
        stl: st?.stl ?? 0,
        blk: st?.blk ?? 0,
        tpm: st?.fg3m ?? 0,
        fgp: st?.fg_pct ?? 0,
        ftp: st?.ft_pct ?? 0,
        to: st?.tov ?? 0,
      },
      catVals,
      priorPg,
      priorCatVals,
      priorGp: priorSt?.g ?? 0,
      nineCat,
      minus1,
      eightCat,
      rankNineCat: rank?.nine ?? null,
      rankMinus1: rank?.m1 ?? null,
      rankEightCat: rank?.eight ?? null,
      priorRankNineCat: priorRank?.nine ?? null,
      priorRankMinus1: priorRank?.m1 ?? null,
      priorRankEightCat: priorRank?.eight ?? null,
      priorPriorRankNineCat: priorPriorRank?.nine ?? null,
      priorPriorRankMinus1: priorPriorRank?.m1 ?? null,
      priorPriorRankEightCat: priorPriorRank?.eight ?? null,
      priorPriorGp: priorPriorSt?.g ?? 0,
      priorPriorMpg: priorPriorSt?.mpg ?? 0,
      tagNineCat: trendTags.nine,
      tagMinus1: trendTags.m1,
      tagEightCat: trendTags.eight,
      projected,
    };
  });
}

/** Cached per-team roster (15 min). Sorted by dynasty value, best first. */
export const getTeamRoster = unstable_cache(
  async (team: string): Promise<Player[]> => {
    const players = await fetchTeamRoster(team);
    return players.sort((a, b) => b.dynasty - a.dynasty);
  },
  ["team-roster"],
  CACHE_OPTS,
);
