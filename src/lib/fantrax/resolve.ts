import "server-only";
import { unstable_cache } from "next/cache";
import { createClient as createPublicClient } from "@supabase/supabase-js";
import { deriveFinalTake, type BlockOut, type SeasonHistoryEntry, type TrendTag } from "@/app/team-rosters/_components/trend-insight";
import { DYNASTY_RANKINGS, normalizePlayerName } from "@/lib/dynasty-rankings";
import { lookupWithNameAlias } from "@/lib/player-name-aliases";
import { playerIdentity } from "@/lib/player-identity/bundled";
import { getStats, getValuesForSize } from "@/lib/value/seasonal-data";
import { createAdminClient } from "@/utils/supabase/admin";
import type { Database, SeasonPlayerStats, SeasonPlayerValues } from "@/types/database";
import {
  buildTeamProfile, byLeagueValue, byPointsValue, categoryEdges, leagueValueOf, MIN_SAMPLE_GAMES,
  pointsValueOf, projectPointsStandings, projectRotoStandings, scoredOrDefault, suggestPointsTradeTargets,
  suggestTradeTargets, type CategoryEdge, type CatVRanks, type CatVSet,
  type LeagueAnalysis, type ResolvedPlayer, type StatLine, type TrendTags,
} from "./analyze";
import {
  CATEGORY_VALUE_COLUMN, FANTRAX_DATASETS, FHE_CATEGORIES,
  type FantraxDatasetKey, type FantraxLeague, type FheCategory, type LeaguePointsFormula, type LeagueRosterSpot,
} from "./league";

export { FANTRAX_DATASETS, type FantraxDatasetKey };

/**
 * Joins a Fantrax league to FHE's category values, through the player identity
 * registry.
 *
 * ── Migrated to fhe_id (Phase 3, 2026-08-03) ────────────────────────────────
 * This used to be a NAME join: Fantrax has its own id space with no overlap with
 * anything FHE held, so every roster import matched ~1,800 players by normalized
 * name and needed a runtime guard against duplicate names — the two Jalen
 * Johnsons that put a consensus-rank-10 player on the waiver board.
 *
 * It is now an exact id join end to end:
 *
 *     Fantrax player id -> player_identity.fantrax_id -> fhe_id
 *     fhe_id -> season_player_stats.fhe_id -> season_player_values
 *
 * `npm run fantrax:snapshot` + `npm run identity:build` link the ids ahead of
 * time (972 of Fantrax's 1,816 players, the rest being outside FHE's ecosystem),
 * so the work happens once at build time instead of on every league import.
 *
 * ── There is deliberately NO name fallback ──────────────────────────────────
 * A Fantrax player whose id the registry didn't link is unlinked for a REASON:
 * either he isn't in FHE's ecosystem at all (809 such), or the registry
 * blocked him as a duplicate name it couldn't safely resolve (35). Falling back
 * to a name join for exactly those players would reintroduce, precisely on the
 * population most likely to trigger it, the bug this migration removes. A blank
 * row is the correct answer.
 *
 * Coverage is layered across datasets because no single one covers a roster:
 *   • 2026-27 projections — the season being played, but omits unsigned free
 *     agents and anyone without a projection.
 *   • 2025-26 regular — real production, but blank for 2026 rookies and anyone
 *     who missed the season injured.
 * Whichever the caller picks leads; the other backfills.
 *
 * The dynasty board is still a name index here, but for consensus RANK only —
 * it carries no category values, so it can label a player the engine has never
 * scored without pretending to know his production.
 */

/** player_id → 1-based finish within the FULL baseline pool for one CatV flavor. */
type RankMap = Map<string, number>;
interface PoolRanks {
  perGame: { nineCatV: RankMap; minus1V: RankMap; eightCatV: RankMap };
  totals: { nineCatV: RankMap; minus1V: RankMap; eightCatV: RankMap };
}

interface DatasetIndex {
  key: FantraxDatasetKey;
  label: string;
  season: number;
  type: string;
  /** fhe_id → stats row. Rows without an fhe_id are simply not indexed. */
  byFheId: Map<string, SeasonPlayerStats>;
  /** player_id → values row */
  valuesById: Map<string, SeasonPlayerValues>;
  /** Rank of every player in the pool, precomputed once per dataset load rather
   *  than per resolved player — see rankOf() below. */
  ranks: PoolRanks;
}

/** value = mean of the 9 category z-scores (sum/9); 8CatV re-averages over 8 by
 *  dropping the turnover z-score from the sum: (value·9 − v_to)/8 — same formula
 *  /seasonal-rankings uses, so 8CatV reads identically everywhere in FHE. */
function eightCatVOf(value: number | null, vTo: number | null): number | null {
  if (value == null || !Number.isFinite(value) || vTo == null || !Number.isFinite(vTo)) return null;
  return (value * 9 - vTo) / 8;
}

/** 1-based finish (best first) of every player in `rows` by `pick`, ignoring
 *  players `pick` returns null/NaN for — the "rank in dataset" every
 *  /seasonal-rankings column means, computed here so every resolved player in
 *  this league can look its own rank up in O(1). */
function rankOf(rows: SeasonPlayerValues[], pick: (v: SeasonPlayerValues) => number | null): RankMap {
  const withVal = rows
    .map((r) => ({ id: r.player_id, v: pick(r) }))
    .filter((x): x is { id: string; v: number } => x.v !== null && Number.isFinite(x.v));
  withVal.sort((a, b) => b.v - a.v);
  const map: RankMap = new Map();
  withVal.forEach((x, i) => map.set(x.id, i + 1));
  return map;
}

function buildPoolRanks(values: SeasonPlayerValues[]): PoolRanks {
  return {
    perGame: {
      nineCatV: rankOf(values, (v) => v.value),
      minus1V: rankOf(values, (v) => v.minus1v),
      eightCatV: rankOf(values, (v) => eightCatVOf(v.value, v.v_to)),
    },
    totals: {
      nineCatV: rankOf(values, (v) => v.value_tot),
      minus1V: rankOf(values, (v) => v.minus1v_tot),
      eightCatV: rankOf(values, (v) => eightCatVOf(v.value_tot, v.v_to_tot)),
    },
  };
}

async function loadDataset(
  spec: (typeof FANTRAX_DATASETS)[number],
  poolSize: number,
): Promise<DatasetIndex> {
  const [stats, values] = await Promise.all([
    getStats(spec.season, spec.type),
    getValuesForSize(spec.season, spec.type, poolSize),
  ]);
  const byFheId = new Map<string, SeasonPlayerStats>();
  for (const row of stats) if (row.fhe_id) byFheId.set(row.fhe_id, row);
  const valuesById = new Map<string, SeasonPlayerValues>();
  for (const row of values) valuesById.set(row.player_id, row);
  return {
    key: spec.key, label: spec.label, season: spec.season, type: spec.type,
    byFheId, valuesById, ranks: buildPoolRanks(values),
  };
}

/** consensus rank by normalized name, read fresh from the bundled board (never
 *  from a persisted rank number — see CLAUDE.md on rank reuse). */
function consensusIndex(): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of DYNASTY_RANKINGS) map.set(normalizePlayerName(p.player), p.consensusRank);
  return map;
}

const CAT_ACCESSOR: Record<FheCategory, keyof SeasonPlayerValues> = Object.fromEntries(
  FHE_CATEGORIES.map((cat) => [cat, CATEGORY_VALUE_COLUMN[cat] as keyof SeasonPlayerValues]),
) as Record<FheCategory, keyof SeasonPlayerValues>;
/** Totals-mode counterpart of CAT_ACCESSOR (v_pts_tot, v_fg3_tot, …) — same
 *  columns compute-values.ts standardizes against season totals rather than
 *  per-game, matching /seasonal-rankings' Totals toggle. */
const CAT_ACCESSOR_TOT: Record<FheCategory, keyof SeasonPlayerValues> = Object.fromEntries(
  FHE_CATEGORIES.map((cat) => [cat, `${CATEGORY_VALUE_COLUMN[cat]}_tot` as keyof SeasonPlayerValues]),
) as Record<FheCategory, keyof SeasonPlayerValues>;

function catsFromAccessor(
  values: SeasonPlayerValues,
  accessor: Record<FheCategory, keyof SeasonPlayerValues>,
): Partial<Record<FheCategory, number>> {
  const out: Partial<Record<FheCategory, number>> = {};
  for (const cat of FHE_CATEGORIES) {
    const v = values[accessor[cat]];
    if (typeof v === "number" && Number.isFinite(v)) out[cat] = v;
  }
  return out;
}

const catsFrom = (values: SeasonPlayerValues) => catsFromAccessor(values, CAT_ACCESSOR);
const catsFromTotals = (values: SeasonPlayerValues) => catsFromAccessor(values, CAT_ACCESSOR_TOT);

/**
 * Fantrax player id → canonical identity, from the registry.
 *
 * Built once at `npm run identity:build` time, where the duplicate-name problem
 * is solved properly: the registry blocks any Fantrax id whose name it cannot
 * safely attribute (35 of 1,816), and never mints identities for Fantrax's
 * out-of-ecosystem players (809). Anything left in this map is an exact link.
 *
 * Cached for an hour — it only changes when the registry is rebuilt.
 */
const getIdentityByFantraxId = unstable_cache(
  async (): Promise<Record<string, { fheId: string; name: string }>> => {
    // Service role, not anon: player_identity has RLS enabled with NO policies
    // (see its migration), so an anon read silently returns zero rows — which
    // presents as "no player matched" rather than as an error. This runs only
    // inside the already-authorized /api/fantrax route.
    const supabase = createAdminClient();
    const out: Record<string, { fheId: string; name: string }> = {};
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("player_identity")
        .select("fhe_id,display_name,fantrax_id")
        .not("fantrax_id", "is", null)
        .range(from, from + PAGE - 1);
      // Never swallow this. Returning an empty map on error makes every player
      // in the league look unlinked, which is indistinguishable from a genuine
      // coverage problem — exactly how the RLS mistake above hid itself.
      if (error) throw new Error(`player_identity read failed: ${error.message}`);
      const rows = data ?? [];
      for (const row of rows) {
        const fx = row.fantrax_id;
        if (fx) out[fx] = { fheId: row.fhe_id, name: row.display_name };
      }
      if (rows.length < PAGE) break;
    }
    return out;
  },
  ["fantrax-identity-map"],
  { revalidate: 3600, tags: ["player-identity"] },
);

/**
 * Resolve one Fantrax roster spot against the datasets, in the given priority
 * order. A player only counts as matched when the dataset has BOTH a stats row
 * (identity) and a values row (category z-scores) — a stats-only hit would
 * otherwise produce a player with a name and no numbers.
 */
function resolveOne(
  spot: LeagueRosterSpot,
  order: DatasetIndex[],
  consensus: Map<string, number>,
  scored: readonly FheCategory[],
  identityByFantraxId: Record<string, { fheId: string; name: string }>,
  pointsFormula: LeaguePointsFormula | null,
): ResolvedPlayer {
  const norm = normalizePlayerName(spot.name);
  const consensusRank = lookupWithNameAlias(consensus, norm) ?? null;
  const identity = identityByFantraxId[spot.fantraxId];
  // Unlinked means the registry either doesn't know him or refused to guess.
  // Either way there is no safe join — see the file header on why there is no
  // name fallback.
  const ambiguousName = !identity;

  const blank: ResolvedPlayer = {
    ...spot,
    playerId: null,
    fheId: identity?.fheId ?? null,
    source: null,
    cats: {},
    catsTotals: {},
    leagueV: null,
    pointsValue: null,
    nineCatV: null,
    consensusRank,
    gamesPlayed: null,
    minutesPerGame: null,
    usgPct: null,
    statLine: null,
    catV: null,
    catVRank: null,
    trendTags: null,
    ambiguousName,
    smallSample: false,
    isRookie: false, // corrected by applyTrendTags() once the bio index is available
  };
  if (!identity) return blank;

  // A current NBA free agent (player_identity.currentTeam === "FA" — not on
  // any team's roster right now) with no row in the PRIMARY dataset has no
  // business being backfilled with a stale REAL-production row from the
  // fallback dataset (Ash, 2026-08-31: Cameron Payne — waived by PHI mid-
  // season, current_team "FA" — was showing 22 GP / 7.4 PTS on a 2026-27
  // outlook table purely because his 22 real games from BEFORE the waiver
  // still sit in season_player_stats(2026, regular), the fallback dataset
  // when he (correctly) has no 2027/projection row at all). The layered-
  // coverage fallback below (order = [primary, fallback], "whichever the
  // caller picks leads; the other backfills") stays exactly as designed for
  // everyone still actually on a roster — a rostered player simply missing a
  // projection row still legitimately backfills with his real games. This
  // only closes the one case the design never intended: patching a missing
  // PROJECTION with a free agent's OLD real production, which reads as "he's
  // active" when player_identity is quite sure he isn't.
  const isCurrentFreeAgent = playerIdentity().byFheId(identity.fheId)?.currentTeam === "FA";

  for (const [i, ds] of order.entries()) {
    if (isCurrentFreeAgent && i > 0 && ds.type !== "projection") continue;
    const stats = ds.byFheId.get(identity.fheId);
    if (!stats) continue;
    const values = ds.valuesById.get(stats.player_id);
    if (!values) continue;
    const cats = catsFrom(values);
    const catsTotals = catsFromTotals(values);
    const isProjection = ds.type === "projection";

    const statLine: StatLine = {
      pts: stats.pts, fg3m: stats.fg3m, reb: stats.reb, ast: stats.ast, stl: stats.stl,
      blk: stats.blk, tov: stats.tov, fga: stats.fga, fg_pct: stats.fg_pct,
      fta: stats.fta, ft_pct: stats.ft_pct,
    };
    const catV: { perGame: CatVSet; totals: CatVSet } = {
      perGame: { nineCatV: values.value, minus1V: values.minus1v, eightCatV: eightCatVOf(values.value, values.v_to) },
      totals: {
        nineCatV: values.value_tot, minus1V: values.minus1v_tot,
        eightCatV: eightCatVOf(values.value_tot, values.v_to_tot),
      },
    };
    const catVRank: { perGame: CatVRanks; totals: CatVRanks } = {
      perGame: {
        nineCatV: ds.ranks.perGame.nineCatV.get(stats.player_id) ?? null,
        minus1V: ds.ranks.perGame.minus1V.get(stats.player_id) ?? null,
        eightCatV: ds.ranks.perGame.eightCatV.get(stats.player_id) ?? null,
      },
      totals: {
        nineCatV: ds.ranks.totals.nineCatV.get(stats.player_id) ?? null,
        minus1V: ds.ranks.totals.minus1V.get(stats.player_id) ?? null,
        eightCatV: ds.ranks.totals.eightCatV.get(stats.player_id) ?? null,
      },
    };

    return {
      ...spot,
      playerId: stats.player_id,
      fheId: identity.fheId,
      source: isProjection ? "projection" : "regular",
      cats,
      catsTotals,
      leagueV: leagueValueOf(cats, scored),
      pointsValue: pointsFormula ? pointsValueOf(statLine, pointsFormula) : null,
      nineCatV: values.value,
      consensusRank,
      gamesPlayed: stats.g,
      minutesPerGame: stats.mpg,
      usgPct: stats.usg_pct,
      statLine,
      catV,
      catVRank,
      trendTags: null, // filled in by applyTrendTags() — needs an async batch query
      ambiguousName: false,
      smallSample: !isProjection && (stats.g ?? 0) < MIN_SAMPLE_GAMES,
      isRookie: false, // corrected by applyTrendTags() once the bio index is available
    };
  }
  return blank;
}

// ── trend tags ──────────────────────────────────────────────────────────────

// Trend tags always read off real 2025-26 production, independent of which
// value dataset (projection vs. actual) the connector is currently valuing the
// league against — a trend tag is a "is his real production trending up or
// down vs. the market" read, which projections don't have an answer to yet.
const TRENDS_SEASON = 2026;
const TRENDS_TYPE = "regular";

/** This season's incoming NBA draft class (2026 = drafted June 2026, playing
 *  their rookie season in 2026-27 — see roster-edge.ts's own REAL_SALARY_SEASON
 *  for the season-numbering convention this mirrors). Read off player_identity's
 *  own draftYear (Ash, 2026-08-31: the dynasty board's own isRookie flag is
 *  stale for a real 70 of the 120 real 2026 draft-class players — e.g. Emanuel
 *  Sharp/Tyler Bilodeau/Izaiyah Nelson all show isRookie:false on the board
 *  despite player_identity correctly knowing draft_year:2026 for all three —
 *  so isRookie below is derived from the registry, never the board's own flag). */
const CURRENT_ROOKIE_DRAFT_YEAR = 2026;

function createTrendsClient() {
  return createPublicClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}

type TrendPayload = { blocks: BlockOut[]; seasonHistory: SeasonHistoryEntry[] };

/** normalized name → age, from the bundled dynasty board (read fresh, never
 *  persisted — same convention as consensusIndex() above). Board-sourced AGE
 *  only — isRookie is NOT read from here (see CURRENT_ROOKIE_DRAFT_YEAR's own
 *  doc for why applyTrendTags derives it from player_identity instead). */
function dynastyBioIndex(): Map<string, { age: number | null }> {
  const map = new Map<string, { age: number | null }>();
  for (const p of DYNASTY_RANKINGS) map.set(normalizePlayerName(p.player), { age: p.age });
  return map;
}

/**
 * One batched nba_player_trends query for every distinct playerId across the
 * WHOLE league (every roster plus the waiver board) — a single round trip
 * rather than one per team, since Fantrax leagues run to 30 teams and this
 * would otherwise be 30 separate queries per page load.
 */
async function fetchTrendPayloads(ids: string[]): Promise<Map<string, TrendPayload>> {
  const trendsById = new Map<string, TrendPayload>();
  if (ids.length === 0) return trendsById;

  const supabase = createTrendsClient();
  const { data } = await supabase
    .from("nba_player_trends")
    .select("player_id, payload")
    .eq("season", TRENDS_SEASON)
    .eq("season_type", TRENDS_TYPE)
    .in("player_id", ids);

  for (const row of data ?? []) {
    const payload = row.payload as unknown as TrendPayload;
    if (payload?.blocks) trendsById.set(row.player_id, payload);
  }
  return trendsById;
}

/** Attaches a trendTags read to every already-resolved player that has a
 *  playerId, from the ALREADY-FETCHED trendsById map (see fetchTrendPayloads
 *  above). Players with no FHE data, or no trend payload built for them yet,
 *  keep trendTags: null — same "absence, not a zero" convention as the rest
 *  of this module. Pure/sync so it can run per roster without another round trip. */
function applyTrendTags(
  players: ResolvedPlayer[],
  trendsById: Map<string, TrendPayload>,
  bio: Map<string, { age: number | null }>,
): ResolvedPlayer[] {
  return players.map((p) => {
    // AGE is a name-keyed dynasty-board lookup. isRookie is NOT — it's
    // p.fheId's own draftYear off the identity registry (see
    // CURRENT_ROOKIE_DRAFT_YEAR's doc for why), independent of both the
    // board lookup and the playerId/trend-payload join below — set it
    // regardless of whether this player has a trend read, so a rookie with
    // no trend history yet (the normal case: no real production to trend)
    // still gets the right headshot source order (see ResolvedPlayer.isRookie).
    const age = (lookupWithNameAlias(bio, normalizePlayerName(p.name)) ?? { age: null }).age;
    const isRookie = playerIdentity().byFheId(p.fheId)?.draftYear === CURRENT_ROOKIE_DRAFT_YEAR;
    if (!p.playerId) return { ...p, isRookie };
    const trend = trendsById.get(p.playerId);
    if (!trend) return { ...p, isRookie };
    const tagOf = (metric: "nineCatV" | "minus1V" | "eightCatV"): TrendTag | null =>
      deriveFinalTake(trend.blocks, trend.seasonHistory ?? [], age, metric, p.consensusRank, null, isRookie)?.tag ?? null;
    const trendTags: TrendTags = { nineCatV: tagOf("nineCatV"), minus1V: tagOf("minus1V"), eightCatV: tagOf("eightCatV") };
    return { ...p, trendTags, isRookie };
  });
}

/** How many available players to score for the waiver board. Scoring all ~1,360
 *  free agents is wasted work when the board only ever shows the top slice. */
const WAIVER_BOARD_SIZE = 60;

export async function analyzeLeague(
  league: FantraxLeague,
  myTeamId: string | null,
  datasetKey: FantraxDatasetKey = "2027:projection",
  leagueType: "redraft" | "keeper" | "dynasty" = "redraft",
): Promise<LeagueAnalysis> {
  const isPoints = league.scoringMode === "points";
  const scored = scoredOrDefault(league.categories.scored);
  const pointsFormula = league.pointsFormula;

  const primarySpec = FANTRAX_DATASETS.find((d) => d.key === datasetKey) ?? FANTRAX_DATASETS[0];
  const fallbackSpec = FANTRAX_DATASETS.find((d) => d.key !== primarySpec.key)!;
  const [primary, fallback] = await Promise.all([
    loadDataset(primarySpec, league.poolSize),
    loadDataset(fallbackSpec, league.poolSize),
  ]);
  const order = [primary, fallback];
  const consensus = consensusIndex();

  // Fantrax id → identity. Duplicate names were already resolved (or refused)
  // when the registry was built, so nothing has to be recomputed per import.
  const identityByFantraxId = await getIdentityByFantraxId();

  const byValue = isPoints ? byPointsValue : byLeagueValue;
  const hasValue = (p: ResolvedPlayer) => (isPoints ? p.pointsValue !== null : p.leagueV !== null);

  let rosters = league.rosters.map((r) => ({
    teamId: r.teamId,
    teamName: r.teamName,
    players: r.players
      .map((p) => resolveOne(p, order, consensus, scored, identityByFantraxId, pointsFormula))
      .sort(byValue),
  }));

  // Only active slots accumulate, so the projected lineup is the league's own
  // active-slot count (falling back to the roster limit for leagues that don't
  // declare one).
  const starterCount = league.maxActivePlayers || Math.min(10, league.maxTotalPlayers);
  const profiles = rosters.map((r) => buildTeamProfile(r.teamId, r.teamName, r.players, starterCount, scored, pointsFormula));

  // Points leagues have no category dimension: standings are a flat points
  // sort, and category edges (what Edge tool's category-mode path targets)
  // simply don't exist.
  let edges: CategoryEdge[] = [];
  const standings = isPoints
    ? projectPointsStandings(profiles)
    : (() => {
        const rotoStandings = projectRotoStandings(profiles, scored);
        edges = myTeamId ? categoryEdges(myTeamId, profiles, rotoStandings, scored) : [];
        return rotoStandings;
      })();

  let waiverBoard = league.freeAgents
    .map((p) => resolveOne(p, order, consensus, scored, identityByFantraxId, pointsFormula))
    // Small samples are excluded here rather than de-ranked: a 3-game call-up
    // isn't a better pickup than every real free agent, and showing him as one
    // discredits the whole board.
    .filter((p) => hasValue(p) && !p.smallSample)
    .sort(byValue)
    .slice(0, WAIVER_BOARD_SIZE);

  // Trend tags need one more round trip — ONE query for every distinct
  // playerId across the whole league, not one per team — so they're layered
  // on after every roster/waiver-board player is otherwise resolved.
  const trendIds = Array.from(new Set(
    [...rosters.flatMap((r) => r.players), ...waiverBoard].map((p) => p.playerId).filter((id): id is string => id !== null),
  ));
  const trendsById = await fetchTrendPayloads(trendIds);
  const bio = dynastyBioIndex();
  rosters = rosters.map((r) => ({ ...r, players: applyTrendTags(r.players, trendsById, bio) }));
  waiverBoard = applyTrendTags(waiverBoard, trendsById, bio);

  const tradeSuggestions = myTeamId
    ? (isPoints
        ? suggestPointsTradeTargets(myTeamId, rosters, { isDynasty: leagueType === "dynasty" })
        : suggestTradeTargets(myTeamId, rosters, edges, scored, { isDynasty: leagueType === "dynasty" }))
    : [];

  const allRostered = rosters.flatMap((r) => r.players);
  return {
    league,
    dataset: { season: primary.season, type: primary.type, label: primary.label },
    myTeamId,
    rosters,
    profiles,
    standings,
    edges,
    waiverBoard,
    tradeSuggestions,
    coverage: {
      rostered: allRostered.length,
      matched: allRostered.filter((p) => p.playerId !== null).length,
      unmatched: allRostered.filter((p) => p.playerId === null && !p.ambiguousName).map((p) => p.name).sort(),
      ambiguous: allRostered.filter((p) => p.ambiguousName).map((p) => p.name).sort(),
    },
  };
}
