import "server-only";
import { unstable_cache } from "next/cache";
import { DYNASTY_RANKINGS, normalizePlayerName } from "@/lib/dynasty-rankings";
import { lookupWithNameAlias } from "@/lib/player-name-aliases";
import { getStats, getValuesForSize } from "@/lib/value/seasonal-data";
import { createAdminClient } from "@/utils/supabase/admin";
import type { SeasonPlayerStats, SeasonPlayerValues } from "@/types/database";
import {
  buildTeamProfile, byLeagueValue, categoryEdges, leagueValueOf, MIN_SAMPLE_GAMES,
  projectRotoStandings, scoredOrDefault, type LeagueAnalysis, type ResolvedPlayer,
} from "./analyze";
import {
  CATEGORY_VALUE_COLUMN, FANTRAX_DATASETS, FHE_CATEGORIES,
  type FantraxDatasetKey, type FantraxLeague, type FheCategory, type LeagueRosterSpot,
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

interface DatasetIndex {
  key: FantraxDatasetKey;
  label: string;
  season: number;
  type: string;
  /** fhe_id → stats row. Rows without an fhe_id are simply not indexed. */
  byFheId: Map<string, SeasonPlayerStats>;
  /** player_id → values row */
  valuesById: Map<string, SeasonPlayerValues>;
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
  return { key: spec.key, label: spec.label, season: spec.season, type: spec.type, byFheId, valuesById };
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

function catsFrom(values: SeasonPlayerValues): Partial<Record<FheCategory, number>> {
  const out: Partial<Record<FheCategory, number>> = {};
  for (const cat of FHE_CATEGORIES) {
    const v = values[CAT_ACCESSOR[cat]];
    if (typeof v === "number" && Number.isFinite(v)) out[cat] = v;
  }
  return out;
}

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
    source: null,
    cats: {},
    leagueV: null,
    nineCatV: null,
    // An ambiguous name can't safely claim a consensus rank either — that's the
    // same name join by a different route.
    consensusRank,
    gamesPlayed: null,
    minutesPerGame: null,
    ambiguousName,
    smallSample: false,
  };
  if (!identity) return blank;

  for (const ds of order) {
    const stats = ds.byFheId.get(identity.fheId);
    if (!stats) continue;
    const values = ds.valuesById.get(stats.player_id);
    if (!values) continue;
    const cats = catsFrom(values);
    const isProjection = ds.type === "projection";
    return {
      ...spot,
      playerId: stats.player_id,
      source: isProjection ? "projection" : "regular",
      cats,
      leagueV: leagueValueOf(cats, scored),
      nineCatV: values.value,
      consensusRank,
      gamesPlayed: stats.g,
      minutesPerGame: stats.mpg,
      ambiguousName: false,
      smallSample: !isProjection && (stats.g ?? 0) < MIN_SAMPLE_GAMES,
    };
  }
  return blank;
}

/** How many available players to score for the waiver board. Scoring all ~1,360
 *  free agents is wasted work when the board only ever shows the top slice. */
const WAIVER_BOARD_SIZE = 60;

export async function analyzeLeague(
  league: FantraxLeague,
  myTeamId: string | null,
  datasetKey: FantraxDatasetKey = "2027:projection",
): Promise<LeagueAnalysis> {
  const scored = scoredOrDefault(league.categories.scored);

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

  const rosters = league.rosters.map((r) => ({
    teamId: r.teamId,
    teamName: r.teamName,
    players: r.players.map((p) => resolveOne(p, order, consensus, scored, identityByFantraxId)).sort(byLeagueValue),
  }));

  // Only active slots accumulate, so the projected lineup is the league's own
  // active-slot count (falling back to the roster limit for leagues that don't
  // declare one).
  const starterCount = league.maxActivePlayers || Math.min(10, league.maxTotalPlayers);
  const profiles = rosters.map((r) => buildTeamProfile(r.teamId, r.teamName, r.players, starterCount, scored));
  const standings = projectRotoStandings(profiles, scored);
  const edges = myTeamId ? categoryEdges(myTeamId, profiles, standings, scored) : [];

  const waiverBoard = league.freeAgents
    .map((p) => resolveOne(p, order, consensus, scored, identityByFantraxId))
    // Small samples are excluded here rather than de-ranked: a 3-game call-up
    // isn't a better pickup than every real free agent, and showing him as one
    // discredits the whole board.
    .filter((p) => p.leagueV !== null && !p.smallSample)
    .sort(byLeagueValue)
    .slice(0, WAIVER_BOARD_SIZE);

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
    coverage: {
      rostered: allRostered.length,
      matched: allRostered.filter((p) => p.playerId !== null).length,
      unmatched: allRostered.filter((p) => p.playerId === null && !p.ambiguousName).map((p) => p.name).sort(),
      ambiguous: allRostered.filter((p) => p.ambiguousName).map((p) => p.name).sort(),
    },
  };
}
