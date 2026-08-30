import "server-only";
import { getCachedLeagueAnalysis } from "./league-cache";
import type { FantraxDatasetKey } from "./resolve";
import { pointsValueOf, scoredOrDefault, type StatLine } from "./analyze";
import type { FheCategory } from "./league";
import type { LeagueType, SalaryFormat } from "./league-tags";
import {
  getAgeByFheId, getContractByFheId, getDynastyRankByFheId, getRookieByFheId, getSalaryRankByFheId, getSophomoreByFheId,
} from "./roster-edge";
import { computeLeagueRankings } from "./league-rankings";
import type { SavedLeagueSettings } from "./store";
import { playerIdentity } from "../player-identity/bundled";
import { getStats, getValuesForSize } from "../value/seasonal-data";
import type { SeasonPlayerStats } from "@/types/database";

/**
 * Waiver Edge (Ash, 2026-08-29, revised 2026-08-31) — every free agent in a
 * connected league, ranked for that league's own scoring format. Unlike
 * League Rankings, this ONLY ever shows free agents (no rostered players, no
 * draft picks, no fantasy-team column).
 *
 * WaiverSeasonMode (its own doc, above) picks which season's raw stats drive
 * the whole table — 2026-27 Projections (default) or "Current Season",
 * which dynamically resolves between 2025-26 and 2026-27 actuals depending
 * on whether the latter has real games yet. This is a SEPARATE axis from
 * `dataset` (the connected league's own roster-resolution dataset) — this
 * file's free-agent stats have always been computed independently of it.
 *

 * CATV is the one category-value column the client renders — the viewer
 * picks Minus1V/8CatV/9CatV, and every flavor is derivable client-side from
 * what this returns: Minus1V and 9CatV come straight off season_player_values
 * (minus1v/value, per-game AND totals — CATV must follow the Totals/Per-game
 * toggle, so both are fetched), and 8CatV is just the mean of catsZ/
 * catsZTotals excluding TO (see analyze.ts's eightCatVOf — this reproduces
 * that exact formula without a stored column for it).
 *
 * LEAGUE RANK is this free agent's rank EXACTLY as League Rankings itself
 * would show it — same computeLeagueRankings() call, read off
 * values[activeBasis] (Ash, 2026-08-30: "pull the exact asset ranking
 * matching the league rankings"), not a separate re-derivation and NOT the
 * generated ledger's own raw tradeRank (league-rankings.ts deliberately
 * stopped trusting that field for the exact reason documented there — a
 * ledger-internal rank isn't consistent with the full combined pool every
 * other rank number on the site means). activeBasis is whichever of
 * standard consensus dynasty / real salary / redraft / custom is ACTUALLY
 * driving trade value for this league right now — the same basis Home's own
 * "Driving trade value: X" line names — so this works for every league that
 * shows "Asset values active" on Home, not just ones running a full custom
 * ledger: a standard dynasty league with no ledger at all still has an
 * activeBasis (standard), and computeLeagueRankings ranks every free agent
 * within it regardless. leagueValuesGenerated mirrors Home's own
 * hasGeneratedValues exactly (any ledger, full OR picksOnly, via
 * rankings.ledgerMode falling back to the settings flags — see Home's own
 * valuationMode) — gating DISPLAY (blank + banner) even though the rank
 * itself is technically computable without one, per Ash's original ask.
 *
 * Salary/Salary Rank reuse the same real-world fallback League Rankings'
 * AssetRow already uses for a free agent: a free agent's own IN-LEAGUE
 * salary/contract is always null (never rostered), so both real- and
 * custom-salary leagues read the player's real NBA contract instead.
 *
 * Free-agent CATV/raw-stat resolution mirrors league-rankings.ts's own
 * free-agent block (same identity-registry + season_player_values join,
 * same "Fantrax id, never name" rule — see that file's header for why a
 * name fallback would reintroduce the duplicate-Jaylin-Williams bug), but
 * is NOT a call into that module for those fields: League Rankings' own
 * free-agent path hardcodes isRookie/eightCatV/fpts/usgPct as unavailable
 * because it's grafted onto a pipeline built for rostered players first.
 * This file is free-agent-first, so it fills them in — computeLeagueRankings
 * is called ONLY for LEAGUE RANK's activeBasis/values, not for those fields.
 */

const REAL_SALARY_SEASON = 2027; // matches league-rankings.ts / roster-edge.ts's own constant

/**
 * Which season's raw stats/CATV drives the free-agent table — INDEPENDENT of
 * `dataset` (that's the connected league's own roster-resolution dataset;
 * this file's free-agent stats have always been computed separately, see
 * this file's header). Two viewer-facing options (Ash, 2026-08-31):
 *
 *   "projection" — 2026-27 Projections (REAL_SALARY_SEASON/"projection"),
 *     the default. Fixed — always this one dataset.
 *   "current"    — "Current Season", which dynamically resolves to whichever
 *     season actually has real games: REAL_SALARY_SEASON/"regular" (2026-27)
 *     once the season has real games in season_player_stats, else
 *     REAL_SALARY_SEASON-1/"regular" (2025-26, the last completed season)
 *     during the off-season. See loadSeasonStats() for the resolution.
 */
export type WaiverSeasonMode = "projection" | "current";

export interface WaiverEdgeSettings {
  salaryFormat: SalaryFormat;
  keeperPolicy: string | undefined;
  realSalaryEfficiencyWeight: number | undefined;
  contractRules: SavedLeagueSettings["contractRules"];
  rookieSalaryScale: SavedLeagueSettings["rookieSalaryScale"];
  /** Same flags Home's own "Assets not valued" banner reads — see this
   *  file's header on why leagueValuesGenerated needs them as a fallback. */
  useCustomValuations: boolean | undefined;
  useGeneratedPickValues: boolean | undefined;
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
  seasonMode: WaiverSeasonMode;
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
  /** Same rank League Rankings shows for this player under its own
   *  activeBasis — see this file's header. Null whenever
   *  leagueValuesGenerated is false. */
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
  /** Mirrors Home's own hasGeneratedValues exactly ("Asset values active"
   *  vs. "Assets not valued") — true whenever ANY ledger has been generated
   *  for this league, full or picksOnly. See this file's header. */
  leagueValuesGenerated: boolean;
  /** Every fantraxId League Rankings ranks under its own activeBasis —
   *  rostered players and free agents alike, not just the free agents
   *  `assets` covers. Empty when leagueValuesGenerated is false. Lets the
   *  Add/Drop Simulator show a rostered drop-candidate's league rank too,
   *  which `assets` (free agents only) can't. */
  leagueRankByFantraxId: Record<string, number>;
  /** Which season "current" actually resolved to this call ("2025-26" or
   *  "2026-27") — see WaiverSeasonMode's own doc. Always "2026-27" when
   *  seasonMode was "projection". Lets the client label the toggle
   *  correctly without re-deriving the same resolution client-side. */
  currentSeasonLabel: string;
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

/** hoopR-style season number -> display label, e.g. 2027 -> "2026-27" (see
 *  CLAUDE.md's numbering convention: season N is the (N-1)-N NBA season). */
function seasonLabel(season: number): string {
  return `${season - 1}-${String(season).slice(-2)}`;
}

/**
 * Resolves WaiverSeasonMode to an actual (season, seasonType) pair + its
 * stat rows, reusing seasonal-data.ts's cached getStats() (same 15-min
 * cache/public client resolve.ts's own loadDataset() already reads through,
 * so this costs no extra DB load beyond what's already warm for every other
 * consumer of that season).
 *
 * "current" tries REAL_SALARY_SEASON/"regular" (2026-27) FIRST — once the
 * season has real games, season_player_stats has rows there and this is the
 * whole point ("once the 2026-27 season starts, the current season will
 * shift to display 2026-27 actual stats," Ash 2026-08-31). Empty during the
 * off-season (today: 2026-08-31, no 2026-27 games played yet), so it falls
 * back to REAL_SALARY_SEASON-1/"regular" (2025-26, the last completed
 * season) — no separate "has the season started" flag to maintain; the data
 * itself is the signal, the same way every other in-season data refresh on
 * this site works.
 */
async function loadSeasonStats(
  mode: WaiverSeasonMode,
): Promise<{ season: number; seasonType: string; label: string; statRows: SeasonPlayerStats[] }> {
  if (mode === "projection") {
    const statRows = await getStats(REAL_SALARY_SEASON, "projection");
    return { season: REAL_SALARY_SEASON, seasonType: "projection", label: seasonLabel(REAL_SALARY_SEASON), statRows };
  }
  const nextSeasonRows = await getStats(REAL_SALARY_SEASON, "regular");
  if (nextSeasonRows.length > 0) {
    return { season: REAL_SALARY_SEASON, seasonType: "regular", label: seasonLabel(REAL_SALARY_SEASON), statRows: nextSeasonRows };
  }
  const priorSeason = REAL_SALARY_SEASON - 1;
  const priorSeasonRows = await getStats(priorSeason, "regular");
  return { season: priorSeason, seasonType: "regular", label: seasonLabel(priorSeason), statRows: priorSeasonRows };
}

export async function computeWaiverEdge(input: WaiverEdgeInput): Promise<WaiverEdgeResult> {
  const { leagueId, owner, teamId, dataset, leagueType, settings, seasonMode } = input;
  const analysis = await getCachedLeagueAnalysis(leagueId, teamId, dataset, leagueType === "redraft" ? "redraft" : leagueType);

  const [ageByFheId, sophomoreByFheId, contractByFheId, salaryRank, rankings, seasonStats] = await Promise.all([
    getAgeByFheId(),
    getSophomoreByFheId(),
    getContractByFheId(),
    getSalaryRankByFheId(),
    // Only for activeBasis/values — see this file's header for why LEAGUE
    // RANK reads League Rankings' own computation rather than the raw
    // generated-ledger tradeRank.
    computeLeagueRankings({ leagueId, owner, teamId, dataset, leagueType, settings }),
    loadSeasonStats(seasonMode),
  ]);
  const { season, seasonType, label: currentSeasonLabel, statRows: allStatRows } = seasonStats;
  const dynastyRankByFheId = getDynastyRankByFheId();
  const rookieByFheId = getRookieByFheId();
  const salaryRankByFheId = salaryRank.rankByFheId;

  // Same precedence Home's own "Assets not valued" banner uses
  // (deep-edge/home/page.tsx's valuationMode): the ledger's own `mode` wins
  // when present, but a doc with no mode (predates that field) or a stale
  // leftover row falls back to the settings flags — never doc-existence
  // alone, which would read a stale/reset-but-undeleted row as "generated".
  const valuationMode: "full" | "picksOnly" | null =
    rankings.ledgerMode ?? (settings.useCustomValuations ? "full" : settings.useGeneratedPickValues ? "picksOnly" : null);
  const leagueValuesGenerated = valuationMode != null;
  const activeValues = rankings.values[rankings.activeBasis];
  const leagueRankByFantraxId: Record<string, number> = {};
  if (leagueValuesGenerated) {
    for (const [key, rv] of Object.entries(activeValues)) leagueRankByFantraxId[key] = rv.rank;
  }

  const family: "categories" | "points" = analysis.league.scoringMode === "points" ? "points" : "categories";
  const scored = scoredOrDefault(analysis.league.categories.scored);
  const pointsFormula = analysis.league.pointsFormula;

  const idx = playerIdentity();
  const rawFAs = analysis.league.freeAgents ?? [];
  const fheIdByFantraxId = new Map<string, string>();
  for (const fa of rawFAs) {
    // Fantrax id, never name — see this file's header.
    const r = idx.resolve({ fantraxId: fa.fantraxId });
    if (r.kind === "matched" && r.identity.fheId) {
      fheIdByFantraxId.set(fa.fantraxId, r.identity.fheId);
    }
  }
  const fheIds = [...new Set(fheIdByFantraxId.values())];

  const assets: WaiverAssetRow[] = [];

  if (fheIds.length > 0) {
    // Resolve fhe_id -> season_player_stats FIRST, then join season_player_values
    // on THAT row's own player_id — never assume player_id === espnId. A 2026
    // draft-class free agent has no pre-existing hoopR history, so
    // build-projection-values.ts's own resolvePlayers() (see that file's header)
    // keys their row by the Summer League 2026 fallback id (sl-<nbaComId>), not
    // their ESPN id. Confirmed via direct DB check 2026-08-29: Cameron Boozer/
    // Darryn Peterson/AJ Dybantsa all have a 2027/projection row, keyed
    // sl-1643409/sl-1643408/sl-1643407 respectively — not their espn_id
    // (5041935/5041955/5142718).
    //
    // Both fetches are the SAME cached, public-client helpers resolve.ts's own
    // loadDataset() reads through (seasonal-data.ts, 15-min cache) — reused
    // rather than a fresh per-request admin-client query, now that `season`/
    // `seasonType` vary with seasonMode (see loadSeasonStats). allStatRows is
    // the WHOLE season's rows (not filtered by fheIds up front — cheaper to
    // index the ~600-row cached dataset locally than to build a fresh
    // `.in("fhe_id", …)` query for every distinct seasonMode/free-agent-set
    // combination).
    const svRows = await getValuesForSize(season, seasonType, 450);
    const statByFheId = new Map(allStatRows.filter((r) => r.fhe_id).map((r) => [r.fhe_id as string, r]));

    const valueByPlayerId = new Map(svRows.map((row) => {
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

    for (const fa of rawFAs) {
      const fheId = fheIdByFantraxId.get(fa.fantraxId);
      if (!fheId) continue;
      const stat = statByFheId.get(fheId);
      if (!stat) continue;
      const v = valueByPlayerId.get(stat.player_id);
      if (!v || v.nineCatV == null) continue;

      const catsRaw: Partial<Record<FheCategory, number>> = {
        PTS: stat.pts ?? undefined, FG3: stat.fg3m ?? undefined, REB: stat.reb ?? undefined,
        AST: stat.ast ?? undefined, STL: stat.stl ?? undefined, BLK: stat.blk ?? undefined,
        FG: stat.fg_pct ?? undefined, FT: stat.ft_pct ?? undefined, TO: stat.tov ?? undefined,
      };
      const statLine: StatLine = {
        pts: stat.pts, fg3m: stat.fg3m, reb: stat.reb, ast: stat.ast, stl: stat.stl, blk: stat.blk,
        tov: stat.tov, fga: stat.fga, fg_pct: stat.fg_pct, fta: stat.fta, ft_pct: stat.ft_pct,
      };
      const fpts = family === "points" && pointsFormula ? pointsValueOf(statLine, pointsFormula) : null;
      const contractInfo = contractByFheId[fheId];

      assets.push({
        key: fa.fantraxId, fantraxId: fa.fantraxId, name: fa.name,
        pos: positionGroup(fa.eligible), nbaTeam: fa.nbaTeam && fa.nbaTeam !== "(N/A)" ? fa.nbaTeam : null,
        isRookie: rookieByFheId[fheId] ?? false,
        isSophomore: sophomoreByFheId[fheId] ?? false,
        age: ageByFheId[fheId] ?? null,
        dynRank: dynastyRankByFheId[fheId] ?? null,
        gamesPlayed: stat.g, minutesPerGame: stat.mpg, usgPct: stat.usg_pct,
        nineCatV: v.nineCatV, minus1V: v.minus1V,
        nineCatVTotals: v.nineCatVTotals, minus1VTotals: v.minus1VTotals,
        fpts,
        catsRaw, catsZ: v.catsZ, catsZTotals: v.catsZTotals,
        leagueRank: leagueRankByFantraxId[fa.fantraxId] ?? null,
        salary: contractInfo?.currentSalary ?? null,
        salaryRank: salaryRankByFheId[fheId] ?? null,
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
    leagueRankByFantraxId,
    currentSeasonLabel,
  };
}
