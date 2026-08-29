import "server-only";
import { getCachedLeagueAnalysis } from "./league-cache";
import type { FantraxDatasetKey } from "./resolve";
import { pointsValueOf, scoredOrDefault, type StatLine } from "./analyze";
import type { FheCategory } from "./league";
import type { LeagueType, SalaryFormat } from "./league-tags";
import {
  getAgeByFheId, getContractByFheId, getDynastyRankByFheId, getRookieByFheId, getSalaryRankByFheId, getSophomoreByFheId,
} from "./roster-edge";
import { getCustomValuations } from "./custom-valuations-store";
import { playerIdentity } from "../player-identity/bundled";
import { createAdminClient } from "../../utils/supabase/admin";

/**
 * Waiver Edge (Ash, 2026-08-29, revised 2026-08-30) — every free agent in a
 * connected league, ranked for that league's own scoring format. Unlike
 * League Rankings, this ONLY ever shows free agents (no rostered players, no
 * draft picks, no fantasy-team column).
 *
 * CATV is the one category-value column the client renders — the viewer
 * picks Minus1V/8CatV/9CatV, and every flavor is derivable client-side from
 * what this returns: Minus1V and 9CatV come straight off season_player_values
 * (minus1v/value, per-game AND totals — CATV must follow the Totals/Per-game
 * toggle, so both are fetched), and 8CatV is just the mean of catsZ/
 * catsZTotals excluding TO (see analyze.ts's eightCatVOf — this reproduces
 * that exact formula without a stored column for it).
 *
 * League Rank is this free agent's rank within the LEAGUE'S OWN generated
 * custom-valuations ledger (custom-valuations-store.ts's LedgerRow.tradeRank,
 * keyed by the raw Fantrax id — no identity resolution needed there, unlike
 * everything else in this file). Deliberately NOT a re-derived number the
 * way League Rankings' four basis tabs are: a ledger is generated (or not)
 * per league by the commissioner/GM, so a league that hasn't run "Generate
 * custom valuations" from Trade Edge yet has no ledger at all — every row's
 * leagueRank comes back null and leagueValuesGenerated is false, so the page
 * can say so instead of silently showing an empty column. A "picksOnly"
 * ledger (the standard/real-salary "generate draft pick values" flow) never
 * carries player rows either — see CustomValuationsDoc.mode's own doc — so
 * it counts as "not generated" here too.
 *
 * Salary/Salary Rank reuse the same real-world fallback League Rankings'
 * AssetRow already uses for a free agent: a free agent's own IN-LEAGUE
 * salary/contract is always null (never rostered), so both real- and
 * custom-salary leagues read the player's real NBA contract instead.
 *
 * Free-agent resolution mirrors league-rankings.ts's own free-agent block
 * (same identity-registry + season_player_values join, same "Fantrax id,
 * never name" rule — see that file's header for why a name fallback would
 * reintroduce the duplicate-Jaylin-Williams bug), but is NOT a call into
 * that module: League Rankings' free-agent path hardcodes isRookie/eightCatV/
 * fpts/usgPct as unavailable because it's grafted onto a pipeline built for
 * rostered players first. This is free-agent-first, so it fills them in.
 */

const REAL_SALARY_SEASON = 2027; // matches league-rankings.ts / roster-edge.ts's own constant

export interface WaiverEdgeSettings {
  salaryFormat: SalaryFormat;
}

export interface WaiverEdgeInput {
  leagueId: string;
  /** Row owner for the custom-valuations ledger lookup — same `owner` every
   *  other Fantrax route reads off authorizeFantrax(). */
  owner: string;
  teamId: string | null;
  dataset: FantraxDatasetKey;
  leagueType: LeagueType;
  settings: WaiverEdgeSettings;
}

export interface WaiverAssetRow {
  key: string;
  fantraxId: string;
  name: string;
  pos: string | null;
  nbaTeam: string | null;
  isRookie: boolean;
  isSophomore: boolean;
  age: number | null;
  dynRank: number | null;
  gamesPlayed: number | null;
  minutesPerGame: number | null;
  usgPct: number | null;
  /** Mean of all 9 per-game category z-scores (season_player_values.value). */
  nineCatV: number | null;
  /** Drops each player's OWN weakest per-game category, not a fixed one. */
  minus1V: number | null;
  /** Totals-standardized counterparts of the two above — same columns
   *  /seasonal-rankings' own Totals toggle reads (value_tot/minus1v_tot). */
  nineCatVTotals: number | null;
  minus1VTotals: number | null;
  /** This league's own points formula, per-game — null for a categories
   *  league, and null for a player with no resolvable per-game line. */
  fpts: number | null;
  catsRaw: Partial<Record<FheCategory, number>>;
  catsZ: Partial<Record<FheCategory, number>>;
  catsZTotals: Partial<Record<FheCategory, number>>;
  /** Rank within this league's own generated custom-valuations ledger — see
   *  this file's header. Null whenever leagueValuesGenerated is false, OR
   *  the ledger exists but never priced this specific player. */
  leagueRank: number | null;
  /** Real-world NBA current salary — a free agent's in-league salary is
   *  always null, so this is the fallback both real- and custom-salary
   *  leagues read (see this file's header). Null outside those two formats
   *  or for a player nba_roster has no contract audit for. */
  salary: number | null;
  /** Site-wide Real Salary Rankings rank — real-salary leagues only. */
  salaryRank: number | null;
}

export interface WaiverEdgeResult {
  assets: WaiverAssetRow[];
  family: "categories" | "points";
  /** Categories this league actually scores, FHE_CATEGORIES order — the
   *  client's 8CatV option only ever excludes TO regardless of this (that's
   *  the fixed, universal definition of 8CatV — see analyze.ts), but this
   *  still flags a genuinely unusual league (e.g. one that doesn't score
   *  BLK) so the client can note it. */
  scoredCategories: FheCategory[];
  positionSlots: Record<string, number>;
  salaryFormat: SalaryFormat;
  /** False when this league has no FULL custom-valuations ledger yet (never
   *  generated, or only a picksOnly one) — every row's leagueRank is null in
   *  that case, and the page shows an alert rather than a silently empty
   *  column. */
  leagueValuesGenerated: boolean;
}

/** Canonicalizes Fantrax position eligibility down to G/F/C/G-F/F-C/etc —
 *  same collapsing convention league-rankings.ts's own positionGroup() uses,
 *  duplicated here (rather than imported) since that one isn't exported and
 *  this module has no other reason to depend on league-rankings.ts. */
function positionGroup(eligible: string[] | undefined): string | null {
  if (!eligible || eligible.length === 0) return null;
  let g = false, f = false, c = false;
  for (const raw of eligible) {
    const e = raw.toUpperCase();
    if (e === "PG" || e === "SG" || e === "G") g = true;
    else if (e === "SF" || e === "PF" || e === "F") f = true;
    else if (e === "C") c = true;
  }
  const parts = [g && "G", f && "F", c && "C"].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join("/") : null;
}

export async function computeWaiverEdge(input: WaiverEdgeInput): Promise<WaiverEdgeResult> {
  const { leagueId, owner, teamId, dataset, leagueType, settings } = input;
  const analysis = await getCachedLeagueAnalysis(leagueId, teamId, dataset, leagueType === "redraft" ? "redraft" : leagueType);
  const admin = createAdminClient();

  const [ageByFheId, sophomoreByFheId, contractByFheId, salaryRank, customDoc] = await Promise.all([
    getAgeByFheId(),
    getSophomoreByFheId(),
    getContractByFheId(),
    getSalaryRankByFheId(),
    getCustomValuations(owner, leagueId),
  ]);
  const dynastyRankByFheId = getDynastyRankByFheId();
  const rookieByFheId = getRookieByFheId();
  const salaryRankByFheId = salaryRank.rankByFheId;

  const leagueValuesGenerated = customDoc != null && customDoc.mode !== "picksOnly";
  const leagueRankByFantraxId = new Map<string, number>();
  if (leagueValuesGenerated) {
    for (const row of customDoc!.rows) {
      if (row.fantraxId && row.tradeRank != null) leagueRankByFantraxId.set(row.fantraxId, row.tradeRank);
    }
  }

  const family: "categories" | "points" = analysis.league.scoringMode === "points" ? "points" : "categories";
  const scored = scoredOrDefault(analysis.league.categories.scored);
  const pointsFormula = analysis.league.pointsFormula;

  const idx = playerIdentity();
  const rawFAs = analysis.league.freeAgents ?? [];
  const espnIdByFantraxId = new Map<string, string>();
  const fheIdByFantraxId = new Map<string, string>();
  for (const fa of rawFAs) {
    // Fantrax id, never name — see this file's header.
    const r = idx.resolve({ fantraxId: fa.fantraxId });
    if (r.kind === "matched" && r.identity.espnId) {
      espnIdByFantraxId.set(fa.fantraxId, r.identity.espnId);
      fheIdByFantraxId.set(fa.fantraxId, r.identity.fheId);
    }
  }
  const espnIds = [...new Set(espnIdByFantraxId.values())];

  const assets: WaiverAssetRow[] = [];

  if (espnIds.length > 0) {
    const [{ data: svRows, error }, { data: statRows, error: statError }] = await Promise.all([
      admin
        .from("season_player_values")
        // Spelled out (not built from CATEGORY_VALUE_COLUMN) so Supabase's
        // typed client can parse this as a literal select string. The _tot
        // columns are the Totals-mode counterparts CATV's Totals toggle needs.
        .select("player_id,value,minus1v,v_pts,v_fg3,v_reb,v_ast,v_stl,v_blk,v_fg,v_ft,v_to,value_tot,minus1v_tot,v_pts_tot,v_fg3_tot,v_reb_tot,v_ast_tot,v_stl_tot,v_blk_tot,v_fg_tot,v_ft_tot,v_to_tot")
        .eq("season", REAL_SALARY_SEASON).eq("season_type", "projection").eq("league_size", 450)
        .in("player_id", espnIds),
      admin
        .from("season_player_stats")
        .select("player_id,g,mpg,usg_pct,pts,fg3m,reb,ast,stl,blk,tov,fga,fg_pct,fta,ft_pct")
        .eq("season", REAL_SALARY_SEASON).eq("season_type", "projection")
        .in("player_id", espnIds),
    ]);
    if (error) throw new Error(error.message);
    if (statError) throw new Error(statError.message);

    const valueByEspnId = new Map((svRows ?? []).map((row) => {
      const catsZ: Partial<Record<FheCategory, number>> = {};
      const catsZTotals: Partial<Record<FheCategory, number>> = {};
      if (row.v_pts != null) catsZ.PTS = row.v_pts;
      if (row.v_fg3 != null) catsZ.FG3 = row.v_fg3;
      if (row.v_reb != null) catsZ.REB = row.v_reb;
      if (row.v_ast != null) catsZ.AST = row.v_ast;
      if (row.v_stl != null) catsZ.STL = row.v_stl;
      if (row.v_blk != null) catsZ.BLK = row.v_blk;
      if (row.v_fg != null) catsZ.FG = row.v_fg;
      if (row.v_ft != null) catsZ.FT = row.v_ft;
      if (row.v_to != null) catsZ.TO = row.v_to;
      if (row.v_pts_tot != null) catsZTotals.PTS = row.v_pts_tot;
      if (row.v_fg3_tot != null) catsZTotals.FG3 = row.v_fg3_tot;
      if (row.v_reb_tot != null) catsZTotals.REB = row.v_reb_tot;
      if (row.v_ast_tot != null) catsZTotals.AST = row.v_ast_tot;
      if (row.v_stl_tot != null) catsZTotals.STL = row.v_stl_tot;
      if (row.v_blk_tot != null) catsZTotals.BLK = row.v_blk_tot;
      if (row.v_fg_tot != null) catsZTotals.FG = row.v_fg_tot;
      if (row.v_ft_tot != null) catsZTotals.FT = row.v_ft_tot;
      if (row.v_to_tot != null) catsZTotals.TO = row.v_to_tot;
      return [row.player_id, {
        nineCatV: row.value, minus1V: row.minus1v, catsZ,
        nineCatVTotals: row.value_tot, minus1VTotals: row.minus1v_tot, catsZTotals,
      }] as const;
    }));
    const statByEspnId = new Map((statRows ?? []).map((r) => [r.player_id as string, r]));

    for (const fa of rawFAs) {
      const espnId = espnIdByFantraxId.get(fa.fantraxId);
      const fheId = fheIdByFantraxId.get(fa.fantraxId);
      if (!espnId) continue;
      const v = valueByEspnId.get(espnId);
      if (!v || v.nineCatV == null) continue;
      const stat = statByEspnId.get(espnId);

      const catsRaw: Partial<Record<FheCategory, number>> = stat ? {
        PTS: stat.pts ?? undefined, FG3: stat.fg3m ?? undefined, REB: stat.reb ?? undefined,
        AST: stat.ast ?? undefined, STL: stat.stl ?? undefined, BLK: stat.blk ?? undefined,
        FG: stat.fg_pct ?? undefined, FT: stat.ft_pct ?? undefined, TO: stat.tov ?? undefined,
      } : {};
      const statLine: StatLine | null = stat ? {
        pts: stat.pts, fg3m: stat.fg3m, reb: stat.reb, ast: stat.ast, stl: stat.stl, blk: stat.blk,
        tov: stat.tov, fga: stat.fga, fg_pct: stat.fg_pct, fta: stat.fta, ft_pct: stat.ft_pct,
      } : null;
      const fpts = family === "points" && statLine && pointsFormula ? pointsValueOf(statLine, pointsFormula) : null;
      const contractInfo = fheId ? contractByFheId[fheId] : undefined;

      assets.push({
        key: fa.fantraxId, fantraxId: fa.fantraxId, name: fa.name,
        pos: positionGroup(fa.eligible), nbaTeam: fa.nbaTeam && fa.nbaTeam !== "(N/A)" ? fa.nbaTeam : null,
        isRookie: fheId ? rookieByFheId[fheId] ?? false : false,
        isSophomore: fheId ? sophomoreByFheId[fheId] ?? false : false,
        age: fheId ? ageByFheId[fheId] ?? null : null,
        dynRank: fheId ? dynastyRankByFheId[fheId] ?? null : null,
        gamesPlayed: stat?.g ?? null, minutesPerGame: stat?.mpg ?? null, usgPct: stat?.usg_pct ?? null,
        nineCatV: v.nineCatV, minus1V: v.minus1V,
        nineCatVTotals: v.nineCatVTotals, minus1VTotals: v.minus1VTotals,
        fpts,
        catsRaw, catsZ: v.catsZ, catsZTotals: v.catsZTotals,
        leagueRank: leagueRankByFantraxId.get(fa.fantraxId) ?? null,
        salary: contractInfo?.currentSalary ?? null,
        salaryRank: fheId ? salaryRankByFheId[fheId] ?? null : null,
      });
    }
  }

  return {
    assets,
    family,
    scoredCategories: [...scored],
    positionSlots: analysis.league.positionSlots ?? {},
    salaryFormat: settings.salaryFormat,
    leagueValuesGenerated,
  };
}
