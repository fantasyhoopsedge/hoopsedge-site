import { FHE_CATEGORIES, type FheCategory, type FantraxLeague, type LeagueRosterSpot } from "./league";

/**
 * The math that turns a Fantrax league + FHE category values into league-anchored
 * insight. Pure functions only — every input is already resolved by resolve.ts,
 * so this file is the reviewable part of the feature.
 *
 * The central idea: the FHE value engine standardizes each of nine categories
 * into a z-score, and 9CatV is simply their mean. A league that scores only some
 * of those categories is therefore scored by the SAME numbers averaged over a
 * different subset — that's LeagueV. A 9-cat league gets exactly 9CatV back; an
 * 8-cat (punt-TO) league gets a genuinely different, correctly-scaled ranking
 * rather than 9CatV with a caveat attached.
 */

/** One rostered (or available) player, joined to FHE's value data. */
export interface ResolvedPlayer extends LeagueRosterSpot {
  /** FHE player id, or null when no dataset knows this player. */
  playerId: string | null;
  /** Which dataset supplied the category values. */
  source: "projection" | "regular" | null;
  /** Per-category z-scores from the league's baseline pool. */
  cats: Partial<Record<FheCategory, number>>;
  /** Mean z across the categories THIS league scores. */
  leagueV: number | null;
  /** Standard 9-category value, for comparison against the public rankings. */
  nineCatV: number | null;
  /** Dynasty consensus rank (bundled JSON, read fresh). */
  consensusRank: number | null;
  gamesPlayed: number | null;
  minutesPerGame: number | null;
  /**
   * Two players in this league's pool share this name and there's no safe way to
   * tell which one FHE's row belongs to, so no values were attached. See
   * resolve.ts — this is the difference between "we have no data" and "we have
   * data but it might be the wrong person's".
   */
  ambiguousName: boolean;
  /** Scored off a sample too small to mean anything (see MIN_SAMPLE_GAMES). */
  smallSample: boolean;
}

/**
 * Games below which a real-season line is treated as noise rather than signal.
 *
 * Per-game z-scores don't care about sample size, so a call-up who played 3
 * games at 22 minutes scores like a starter. Seven such players outranked every
 * genuine free agent on the first waiver board built here. FHE's own convention
 * is that minimum-games filtering is a DISPLAY concern that never enters the
 * value math (see compute-values.ts) — so this flags and filters, it never
 * changes a number. 20 games is a shade under the 25th percentile of the
 * 2025-26 dataset, which clears the call-up noise without touching rotation
 * players. Projections are exempt: their `g` is a projected full season.
 */
export const MIN_SAMPLE_GAMES = 20;

/** Mean of the z-scores for exactly the categories a league scores. */
export function leagueValueOf(
  cats: Partial<Record<FheCategory, number>>,
  scored: readonly FheCategory[],
): number | null {
  if (scored.length === 0) return null;
  let sum = 0;
  let n = 0;
  for (const cat of scored) {
    const v = cats[cat];
    if (typeof v === "number" && Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  // Require every scored category — a partial mean silently flatters players
  // whose missing category is their weakest.
  return n === scored.length ? sum / n : null;
}

export interface TeamCategoryProfile {
  teamId: string;
  teamName: string;
  /** Summed z per category across the projected starting lineup. */
  totals: Partial<Record<FheCategory, number>>;
  /** Players counted in `totals`, best LeagueV first. */
  starters: ResolvedPlayer[];
  /** Rostered players with no FHE data — the analysis can't see them. */
  unmatched: number;
  rosterSize: number;
}

/**
 * A team's category totals from the lineup it would actually run.
 *
 * Only active slots accumulate stats, so a 20-man roster in a 6-start league is
 * not 20 players' worth of production. Counting the whole roster would reward
 * hoarding; counting exactly the active slots is the honest proxy for "the
 * lineup this manager rolls out". `starterCount` therefore comes from the
 * league's own maxTotalActivePlayers.
 */
export function buildTeamProfile(
  teamId: string,
  teamName: string,
  players: ResolvedPlayer[],
  starterCount: number,
  scored: readonly FheCategory[],
): TeamCategoryProfile {
  const ranked = players
    .filter((p) => p.leagueV !== null)
    .sort((a, b) => (b.leagueV ?? 0) - (a.leagueV ?? 0));
  const starters = ranked.slice(0, Math.max(1, starterCount));

  const totals: Partial<Record<FheCategory, number>> = {};
  for (const cat of scored) {
    let sum = 0;
    for (const p of starters) sum += p.cats[cat] ?? 0;
    totals[cat] = sum;
  }

  return {
    teamId,
    teamName,
    totals,
    starters,
    unmatched: players.filter((p) => p.playerId === null).length,
    rosterSize: players.length,
  };
}

export interface RotoStandingRow {
  teamId: string;
  teamName: string;
  /** Roto points earned per category (teamCount for first down to 1 for last). */
  points: Partial<Record<FheCategory, number>>;
  /** 1-based finish per category. */
  ranks: Partial<Record<FheCategory, number>>;
  totalPoints: number;
  projectedRank: number;
}

/**
 * Standard rotisserie scoring applied to projected category totals: in each
 * category the best team gets `teams` points and the worst gets 1, ties split
 * the pot evenly (as Fantrax does). Higher totals win every category — turnovers
 * included, because v_to is already sign-flipped upstream.
 */
export function projectRotoStandings(
  profiles: TeamCategoryProfile[],
  scored: readonly FheCategory[],
): RotoStandingRow[] {
  const n = profiles.length;
  const rows: RotoStandingRow[] = profiles.map((p) => ({
    teamId: p.teamId,
    teamName: p.teamName,
    points: {},
    ranks: {},
    totalPoints: 0,
    projectedRank: 0,
  }));
  const byId = new Map(rows.map((r) => [r.teamId, r]));

  for (const cat of scored) {
    const ordered = [...profiles].sort((a, b) => (b.totals[cat] ?? 0) - (a.totals[cat] ?? 0));
    let i = 0;
    while (i < ordered.length) {
      // Group ties so they share both the rank and the average of their points.
      let j = i;
      while (j + 1 < ordered.length && (ordered[j + 1].totals[cat] ?? 0) === (ordered[i].totals[cat] ?? 0)) j += 1;
      const sharedPoints = Array.from({ length: j - i + 1 }, (_, k) => n - (i + k)).reduce((a, b) => a + b, 0) / (j - i + 1);
      for (let k = i; k <= j; k += 1) {
        const row = byId.get(ordered[k].teamId);
        if (!row) continue;
        row.points[cat] = sharedPoints;
        row.ranks[cat] = i + 1;
        row.totalPoints += sharedPoints;
      }
      i = j + 1;
    }
  }

  rows.sort((a, b) => b.totalPoints - a.totalPoints || a.teamName.localeCompare(b.teamName));
  rows.forEach((r, i) => { r.projectedRank = i + 1; });
  return rows;
}

export interface CategoryEdge {
  category: FheCategory;
  /** The team's summed z in this category. */
  total: number;
  /** Mean summed z across all teams. */
  leagueMean: number;
  /** 1-based finish among all teams. */
  rank: number;
  /** Roto points projected in this category. */
  points: number;
}

/** Per-category strength/weakness read for one team, best rank first. */
export function categoryEdges(
  teamId: string,
  profiles: TeamCategoryProfile[],
  standings: RotoStandingRow[],
  scored: readonly FheCategory[],
): CategoryEdge[] {
  const mine = profiles.find((p) => p.teamId === teamId);
  const row = standings.find((s) => s.teamId === teamId);
  if (!mine || !row) return [];
  return scored
    .map((cat) => {
      const totals = profiles.map((p) => p.totals[cat] ?? 0);
      return {
        category: cat,
        total: mine.totals[cat] ?? 0,
        leagueMean: totals.reduce((a, b) => a + b, 0) / (totals.length || 1),
        rank: row.ranks[cat] ?? 0,
        points: row.points[cat] ?? 0,
      };
    })
    .sort((a, b) => a.rank - b.rank);
}

export interface LeagueAnalysis {
  league: FantraxLeague;
  /** Dataset the values came from. */
  dataset: { season: number; type: string; label: string };
  myTeamId: string | null;
  rosters: { teamId: string; teamName: string; players: ResolvedPlayer[] }[];
  profiles: TeamCategoryProfile[];
  standings: RotoStandingRow[];
  edges: CategoryEdge[];
  /** Best available players by LeagueV. */
  waiverBoard: ResolvedPlayer[];
  coverage: {
    rostered: number;
    matched: number;
    /** Rostered players no FHE dataset knows. */
    unmatched: string[];
    /** Rostered players deliberately left unjoined because a namesake exists. */
    ambiguous: string[];
  };
}

/** Sort helper shared by the roster table and the waiver board. */
export const byLeagueValue = (a: ResolvedPlayer, b: ResolvedPlayer): number =>
  (b.leagueV ?? Number.NEGATIVE_INFINITY) - (a.leagueV ?? Number.NEGATIVE_INFINITY);

/** Categories a league scores, or all nine when it somehow reports none. */
export function scoredOrDefault(scored: readonly FheCategory[]): readonly FheCategory[] {
  return scored.length > 0 ? scored : FHE_CATEGORIES;
}
