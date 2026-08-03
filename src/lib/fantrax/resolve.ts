import "server-only";
import { DYNASTY_RANKINGS, normalizePlayerName } from "@/lib/dynasty-rankings";
import { isNbaTeam, normalizeTeamAbbr } from "@/lib/nba-teams";
import { lookupWithNameAlias } from "@/lib/player-name-aliases";
import { getStats, getValuesForSize } from "@/lib/value/seasonal-data";
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
 * Joins a Fantrax league to FHE's category values.
 *
 * Identity is the whole game here, and it is a NAME join — Fantrax has its own
 * player-id space with no overlap with nba.com ids. Every lookup therefore goes
 * through normalizePlayerName() plus the nickname/legal-name alias map, exactly
 * as CLAUDE.md requires of anything joining an outside source to FHE data.
 *
 * Coverage is layered because no single dataset covers a whole roster:
 *   • 2026-27 projections — the season being played, but it omits unsigned
 *     free agents and anyone without a projection.
 *   • 2025-26 regular — real production, but blank for 2026 rookies and for
 *     players who missed the season injured (Lillard, Haliburton, Irving…).
 * Whichever the caller picks leads; the other backfills. Measured against the
 * 30-team test league on 2026-08-03: 386/422 from projections alone, 412/422
 * from last season alone, 419/422 (99.3%) layered. The last three were
 * genuinely off both value datasets, and surface in the UI as "no data" rather
 * than as zeroes.
 *
 * The dynasty board is a THIRD name index here but not a fourth fallback: it
 * carries a consensus rank, not category values, so it can label a player the
 * value engine has never scored (a just-drafted rookie) without pretending to
 * know his production.
 */

interface DatasetIndex {
  key: FantraxDatasetKey;
  label: string;
  season: number;
  type: string;
  /** normalized name → stats row */
  byName: Map<string, SeasonPlayerStats>;
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
  const byName = new Map<string, SeasonPlayerStats>();
  for (const row of stats) byName.set(normalizePlayerName(row.name), row);
  const valuesById = new Map<string, SeasonPlayerValues>();
  for (const row of values) valuesById.set(row.player_id, row);
  return { key: spec.key, label: spec.label, season: spec.season, type: spec.type, byName, valuesById };
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
 * Fantrax player ids that must NOT be name-joined, because another player in the
 * same league pool shares their name.
 *
 * This is not hypothetical: the 30-team test league carries two Jalen Johnsons
 * (Atlanta's, rostered; and a teamless free agent) and two Jaylin Williamses
 * (OKC's, rostered; and a teamless free agent). A pure name join handed the
 * free-agent duplicates the star's z-scores and floated them to the top of the
 * waiver board — a consensus-rank-10 player apparently sitting unowned.
 *
 * The tiebreak is the NBA team, which Fantrax supplies and prints as "(N/A)" for
 * anyone without one. Within an ambiguous group, if exactly one entry has a real
 * NBA team, that entry is the player everyone means and the rest are blocked. If
 * none or several do, nobody in the group can be told apart, so all are blocked
 * — better a blank row than a confidently wrong one.
 *
 * Deliberately scoped to duplicated names only: team is NOT a general match
 * requirement, because FHE's rows carry the team a player produced for while
 * Fantrax carries the team he's on now, and every offseason move would look like
 * a mismatch.
 */
function blockedAmbiguousIds(spots: LeagueRosterSpot[]): Set<string> {
  const groups = new Map<string, LeagueRosterSpot[]>();
  for (const spot of spots) {
    const key = normalizePlayerName(spot.name);
    const group = groups.get(key);
    if (group) group.push(spot);
    else groups.set(key, [spot]);
  }

  const blocked = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const identifiable = group.filter((s) => isNbaTeam(normalizeTeamAbbr(s.nbaTeam)));
    if (identifiable.length === 1) {
      for (const s of group) if (s.fantraxId !== identifiable[0].fantraxId) blocked.add(s.fantraxId);
    } else {
      for (const s of group) blocked.add(s.fantraxId);
    }
  }
  return blocked;
}


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
  blocked: Set<string>,
): ResolvedPlayer {
  const norm = normalizePlayerName(spot.name);
  const consensusRank = lookupWithNameAlias(consensus, norm) ?? null;
  const ambiguousName = blocked.has(spot.fantraxId);

  const blank: ResolvedPlayer = {
    ...spot,
    playerId: null,
    source: null,
    cats: {},
    leagueV: null,
    nineCatV: null,
    // An ambiguous name can't safely claim a consensus rank either — that's the
    // same name join by a different route.
    consensusRank: ambiguousName ? null : consensusRank,
    gamesPlayed: null,
    minutesPerGame: null,
    ambiguousName,
    smallSample: false,
  };
  if (ambiguousName) return blank;

  for (const ds of order) {
    const stats = lookupWithNameAlias(ds.byName, norm);
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

  // Ambiguity is a property of the whole pool, so it must be computed across
  // rosters AND free agents — the duplicate pairs seen so far are one rostered
  // player and one unowned namesake.
  const blocked = blockedAmbiguousIds([
    ...league.rosters.flatMap((r) => r.players),
    ...league.freeAgents,
  ]);

  const rosters = league.rosters.map((r) => ({
    teamId: r.teamId,
    teamName: r.teamName,
    players: r.players.map((p) => resolveOne(p, order, consensus, scored, blocked)).sort(byLeagueValue),
  }));

  // Only active slots accumulate, so the projected lineup is the league's own
  // active-slot count (falling back to the roster limit for leagues that don't
  // declare one).
  const starterCount = league.maxActivePlayers || Math.min(10, league.maxTotalPlayers);
  const profiles = rosters.map((r) => buildTeamProfile(r.teamId, r.teamName, r.players, starterCount, scored));
  const standings = projectRotoStandings(profiles, scored);
  const edges = myTeamId ? categoryEdges(myTeamId, profiles, standings, scored) : [];

  const waiverBoard = league.freeAgents
    .map((p) => resolveOne(p, order, consensus, scored, blocked))
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
