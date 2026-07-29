import "server-only";
import { unstable_cache } from "next/cache";
import { createClient as createPublicClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { DYNASTY_RANKINGS, normalizePlayerName } from "@/lib/dynasty-rankings";
import { nameKeyCandidates } from "@/lib/player-name-aliases";
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

// Dynasty rows (veterans) indexed by the pipeline's normalized name.
const DYN_BY_NORM = new Map(DYNASTY_RANKINGS.map((d) => [normalizePlayerName(d.player), d]));

// R2 (trend-tag audit): the roster CSV and the dynasty list occasionally use
// different name forms for the same player (nickname vs. legal name — see
// src/lib/player-name-aliases.ts); a missed join silently demotes a ranked
// player to the 999 fallback. Seed every known nickname/legal-name pair as an
// extra key, in whichever direction dynasty-rankings.json happens to use, so
// a lookup by either form succeeds regardless of which source changes first.
for (const [norm, row] of [...DYN_BY_NORM.entries()]) {
  for (const altKey of nameKeyCandidates(norm)) {
    if (!DYN_BY_NORM.has(altKey)) DYN_BY_NORM.set(altKey, row);
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

/** Every current roster player's draft year, keyed by normalized name. Draft year is a
 * fixed historical fact (unlike is_sophomore, which only describes TODAY's status), so
 * this lets a caller derive "was this player a rookie/sophomore in season N" for ANY
 * season N — used by /seasonal-rankings, which shows historical per-season stat rows
 * (hoopR season N covers the (N-1)/N year; a player is a rookie in season draftYear+1,
 * a sophomore in season draftYear+2). Only covers players still on a 2026-27 roster. */
export const getDraftYears = unstable_cache(
  async (): Promise<Record<string, number>> => {
    const supabase = createReadClient();
    const { data } = await supabase
      .from("nba_roster")
      .select("norm_name,draft_year")
      .eq("season", ROSTER_SEASON)
      .not("draft_year", "is", null);
    const out: Record<string, number> = {};
    for (const r of data ?? []) {
      if (r.draft_year != null) out[r.norm_name] = r.draft_year;
    }
    return out;
  },
  ["team-roster-draft-years"],
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

  const ids = roster.map((r) => r.player_id).filter((v): v is string => v != null);

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

  // Consensus rank + age gate the tone derivation (age drives the aging-decline
  // read — see trend-insight.ts), so resolve them once per row first.
  const consensusByRow = roster.map((r) => DYN_BY_NORM.get(r.norm_name)?.consensusRank ?? 999);
  const ageByRow = roster.map((r) => ageFromDob(r.dob) ?? Math.round(r.age_at_ingest ?? DYN_BY_NORM.get(r.norm_name)?.age ?? 0));
  const tags = roster.map((r, i) => tagsFrom(r.player_id ? trendsById.get(r.player_id) : undefined, consensusByRow[i], ageByRow[i], r.is_sophomore === true));

  return roster.map((r, i): Player => {
    const st = r.player_id ? statsById.get(r.player_id) : undefined;
    const val = r.player_id ? valuesById.get(r.player_id) : undefined;
    const priorSt = r.player_id ? priorStatsById.get(r.player_id) : undefined;
    const priorVal = r.player_id ? priorValuesById.get(r.player_id) : undefined;
    const rank = r.player_id ? poolRanks[r.player_id] : undefined;
    const priorRank = r.player_id ? priorPoolRanks[r.player_id] : undefined;
    const priorPriorRank = r.player_id ? priorPriorPoolRanks[r.player_id] : undefined;
    const priorPriorSt = r.player_id ? priorPriorStatsById.get(r.player_id) : undefined;
    const dyn = DYN_BY_NORM.get(r.norm_name);
    const trendTags = tags[i];
    const rookie = r.is_incoming_rookie ? ROOKIE_BY_NORM.get(r.norm_name) : undefined;

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
      id: r.player_id ?? `n_${r.norm_name.replace(/\s+/g, "-")}`,
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
