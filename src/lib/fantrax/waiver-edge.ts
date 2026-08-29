import "server-only";
import { getCachedLeagueAnalysis } from "./league-cache";
import type { FantraxDatasetKey } from "./resolve";
import { pointsValueOf, scoredOrDefault, type StatLine } from "./analyze";
import type { FheCategory } from "./league";
import type { LeagueType } from "./league-tags";
import { getAgeByFheId, getDynastyRankByFheId, getRookieByFheId, getSophomoreByFheId } from "./roster-edge";
import { playerIdentity } from "../player-identity/bundled";
import { createAdminClient } from "../../utils/supabase/admin";

/**
 * Waiver Edge (Ash, 2026-08-29) — every free agent in a connected league,
 * ranked for that league's own scoring format. Unlike League Rankings, this
 * ONLY ever shows free agents (no rostered players, no draft picks, no
 * fantasy-team column) — so there's no trade-value machinery here, just the
 * category z-scores/points value a free agent needs to be ranked and
 * filtered.
 *
 * The ranking metric itself is intentionally NOT fixed server-side. This
 * returns each free agent's full per-category z-score line (catsZ) plus the
 * two precomputed flavors that can't be reconstructed from it client-side —
 * Minus1V (drops each PLAYER'S OWN worst category, not a fixed one) and FPTS
 * (the league's own points formula, not z-score-based at all) — and lets the
 * client compute any FIXED-category-punt total on the fly from catsZ
 * (Σ included z ÷ count included). That's exactly what 8CatV already is
 * (drop TO for everyone, see analyze.ts's eightCatVOf) — just generalized to
 * whichever categories the viewer punts, with zero extra round trips per
 * click.
 *
 * Free-agent resolution mirrors league-rankings.ts's own free-agent block
 * (same identity-registry + season_player_values join, same "Fantrax id,
 * never name" rule — see that file's header for why a name fallback would
 * reintroduce the duplicate-Jaylin-Williams bug), but is NOT a call into
 * that module: League Rankings' free-agent path hardcodes isRookie/eightCatV/
 * fpts as unavailable because it's grafted onto a pipeline built for rostered
 * players first. This is free-agent-first, so it fills all three in.
 */

const REAL_SALARY_SEASON = 2027; // matches league-rankings.ts / roster-edge.ts's own constant

export interface WaiverEdgeInput {
  leagueId: string;
  teamId: string | null;
  dataset: FantraxDatasetKey;
  leagueType: LeagueType;
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
  /** Mean of all 9 category z-scores (season_player_values.value). */
  nineCatV: number | null;
  /** Drops each player's OWN weakest category, not a fixed one — see this
   *  file's header. Only ever meaningful with NO categories manually
   *  punted; the client stops reading it the moment a punt is active. */
  minus1V: number | null;
  /** This league's own points formula, per-game — null for a categories
   *  league, and null for a player with no resolvable per-game line. */
  fpts: number | null;
  catsRaw: Partial<Record<FheCategory, number>>;
  catsZ: Partial<Record<FheCategory, number>>;
}

export interface WaiverEdgeResult {
  assets: WaiverAssetRow[];
  family: "categories" | "points";
  /** Categories this league actually scores, FHE_CATEGORIES order — drives
   *  the client's default punt set (whatever's NOT in here starts punted,
   *  reproducing "8-cat league defaults to 8CatV" without hardcoding TO). */
  scoredCategories: FheCategory[];
  positionSlots: Record<string, number>;
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
  const { leagueId, teamId, dataset, leagueType } = input;
  const analysis = await getCachedLeagueAnalysis(leagueId, teamId, dataset, leagueType === "redraft" ? "redraft" : leagueType);
  const admin = createAdminClient();

  const [ageByFheId, sophomoreByFheId] = await Promise.all([getAgeByFheId(), getSophomoreByFheId()]);
  const dynastyRankByFheId = getDynastyRankByFheId();
  const rookieByFheId = getRookieByFheId();

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
        // typed client can parse this as a literal select string.
        .select("player_id,value,minus1v,v_pts,v_fg3,v_reb,v_ast,v_stl,v_blk,v_fg,v_ft,v_to")
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
      if (row.v_pts != null) catsZ.PTS = row.v_pts;
      if (row.v_fg3 != null) catsZ.FG3 = row.v_fg3;
      if (row.v_reb != null) catsZ.REB = row.v_reb;
      if (row.v_ast != null) catsZ.AST = row.v_ast;
      if (row.v_stl != null) catsZ.STL = row.v_stl;
      if (row.v_blk != null) catsZ.BLK = row.v_blk;
      if (row.v_fg != null) catsZ.FG = row.v_fg;
      if (row.v_ft != null) catsZ.FT = row.v_ft;
      if (row.v_to != null) catsZ.TO = row.v_to;
      return [row.player_id, { nineCatV: row.value, minus1V: row.minus1v, catsZ }] as const;
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

      assets.push({
        key: fa.fantraxId, fantraxId: fa.fantraxId, name: fa.name,
        pos: positionGroup(fa.eligible), nbaTeam: fa.nbaTeam && fa.nbaTeam !== "(N/A)" ? fa.nbaTeam : null,
        isRookie: fheId ? rookieByFheId[fheId] ?? false : false,
        isSophomore: fheId ? sophomoreByFheId[fheId] ?? false : false,
        age: fheId ? ageByFheId[fheId] ?? null : null,
        dynRank: fheId ? dynastyRankByFheId[fheId] ?? null : null,
        gamesPlayed: stat?.g ?? null, minutesPerGame: stat?.mpg ?? null, usgPct: stat?.usg_pct ?? null,
        nineCatV: v.nineCatV, minus1V: v.minus1V, fpts,
        catsRaw, catsZ: v.catsZ,
      });
    }
  }

  return {
    assets,
    family,
    scoredCategories: [...scored],
    positionSlots: analysis.league.positionSlots ?? {},
  };
}
