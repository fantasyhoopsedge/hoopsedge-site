import type { TrendTag } from "@/app/team-rosters/_components/trend-insight";
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

/** Raw per-game counting/rate line, straight off season_player_stats. */
export interface StatLine {
  pts: number | null;
  fg3m: number | null;
  reb: number | null;
  ast: number | null;
  stl: number | null;
  blk: number | null;
  tov: number | null;
  fga: number | null;
  fg_pct: number | null;
  fta: number | null;
  ft_pct: number | null;
}

/** The three CatV flavors /seasonal-rankings offers, both per-game and totals-mode. */
export interface CatVSet {
  nineCatV: number | null;
  minus1V: number | null;
  eightCatV: number | null;
}

/** 1-based finish within the FULL baseline pool (not just this league's rostered
 *  players) — same "rank in dataset" every /seasonal-rankings column means. */
export interface CatVRanks {
  nineCatV: number | null;
  minus1V: number | null;
  eightCatV: number | null;
}

/** Blended consensus-vs-real-production trend read per CatV flavor — see
 *  team-rosters/_components/trend-insight.ts. Always read off 2025-26 real
 *  production (season 2026/regular), independent of which value dataset the
 *  connector is currently valuing the league against. */
export interface TrendTags {
  nineCatV: TrendTag | null;
  minus1V: TrendTag | null;
  eightCatV: TrendTag | null;
}

/** One rostered (or available) player, joined to FHE's value data. */
export interface ResolvedPlayer extends LeagueRosterSpot {
  /** FHE player id, or null when no dataset knows this player. */
  playerId: string | null;
  /** Which dataset supplied the category values. */
  source: "projection" | "regular" | null;
  /** Per-category z-scores from the league's baseline pool (per-game). Drives
   *  LeagueV and the Edge tool's category-fit scoring — those stay per-game
   *  regardless of the roster table's display toggle. */
  cats: Partial<Record<FheCategory, number>>;
  /** Same 9 z-scores, totals-standardized — display/coloring only when the
   *  roster table's Per Game/Totals toggle is set to Totals. */
  catsTotals: Partial<Record<FheCategory, number>>;
  /** Mean z across the categories THIS league scores. */
  leagueV: number | null;
  /** Standard 9-category value, for comparison against the public rankings.
   *  Per-game — kept for backward compat with existing callers; prefer
   *  catV.perGame.nineCatV in new code. */
  nineCatV: number | null;
  /** Dynasty consensus rank (bundled JSON, read fresh). */
  consensusRank: number | null;
  gamesPlayed: number | null;
  minutesPerGame: number | null;
  /** Raw per-game stat line, per-game and totals (totals = per-game line scaled
   *  by games — display only, never re-enters the value math). */
  statLine: StatLine | null;
  /** 9CatV/Minus1V/8CatV, per-game and totals-mode value sets. */
  catV: { perGame: CatVSet; totals: CatVSet } | null;
  /** Rank within the FULL baseline pool for each CatV flavor, per-game and totals. */
  catVRank: { perGame: CatVRanks; totals: CatVRanks } | null;
  /** Trend-tag signal per CatV flavor (real production vs. consensus, see trend-insight.ts). */
  trendTags: TrendTags | null;
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

/** Raw counting/rate totals across a team's projected lineup — the "Stat Totals"
 *  standings view, alongside the z-score-based roto `totals` above. FG%/FT% are
 *  attempt-weighted (makes/attempts summed, then divided), matching how a real
 *  roto league combines shooting percentages across a roster; every other stat
 *  is a plain sum of each starter's own total (per-game line × games). */
export interface TeamStatTotals {
  pts: number; fg3m: number; reb: number; ast: number; stl: number; blk: number; tov: number;
  fg_pct: number | null; ft_pct: number | null;
  gamesPlayed: number;
}

export interface TeamCategoryProfile {
  teamId: string;
  teamName: string;
  /** Summed z per category across the projected starting lineup. */
  totals: Partial<Record<FheCategory, number>>;
  /** Raw stat totals across the same lineup — see TeamStatTotals. */
  statTotals: TeamStatTotals;
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

  let pts = 0, fg3m = 0, reb = 0, ast = 0, stl = 0, blk = 0, tov = 0, gamesPlayed = 0;
  let fgm = 0, fga = 0, ftm = 0, fta = 0;
  for (const p of starters) {
    const s = p.statLine;
    const g = p.gamesPlayed ?? 0;
    if (!s || g <= 0) continue;
    gamesPlayed += g;
    pts += (s.pts ?? 0) * g;
    fg3m += (s.fg3m ?? 0) * g;
    reb += (s.reb ?? 0) * g;
    ast += (s.ast ?? 0) * g;
    stl += (s.stl ?? 0) * g;
    blk += (s.blk ?? 0) * g;
    tov += (s.tov ?? 0) * g;
    const fgaTot = (s.fga ?? 0) * g;
    const ftaTot = (s.fta ?? 0) * g;
    fga += fgaTot;
    fta += ftaTot;
    fgm += fgaTot * (s.fg_pct ?? 0);
    ftm += ftaTot * (s.ft_pct ?? 0);
  }

  return {
    teamId,
    teamName,
    totals,
    statTotals: {
      pts, fg3m, reb, ast, stl, blk, tov, gamesPlayed,
      fg_pct: fga > 0 ? fgm / fga : null,
      ft_pct: fta > 0 ? ftm / fta : null,
    },
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
  /** Edge tool: trade targets from other rosters that fill this team's weak
   *  categories. Empty when there's no team selected or nothing to fix. */
  tradeSuggestions: TradeSuggestion[];
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

// ── Edge: trade-target suggestions ──────────────────────────────────────────

/** Trend tags that read as a buy-low signal — real production is trending up
 *  faster than the market (consensus) has priced in. */
const BUY_LOW_TAGS = new Set<TrendTag>(["breaking-out", "surging", "climbing", "developing", "outproducing"]);
/** Trend tags that read as a sell-risk signal — production is trending down,
 *  or the player's age/availability makes the current profile unreliable. */
const SELL_RISK_TAGS = new Set<TrendTag>(["fading", "plunging", "cratering", "aging-decline", "washed"]);

/** How much a buy-low/sell-risk trend tag moves a target's fit score, on the
 *  same z-score-ish scale as the category averages the rest of the score is built from. */
const TREND_ADJUSTMENT = 0.2;
/** Max dynasty-consensus tie-break bonus (asset value, not fit) — kept small on
 *  purpose so it only breaks ties between comparably-fitting targets rather than
 *  overriding the category-fit read that's the point of this tool. */
const DYNASTY_BONUS_MAX = 0.3;
const DYNASTY_BONUS_POOL = 450;

export interface TradeSuggestion {
  target: ResolvedPlayer;
  targetTeamId: string;
  targetTeamName: string;
  /** Average z across the categories the target helps, plus trend/dynasty adjustments. */
  fitScore: number;
  /** Weak categories (for my team) the target is above-average in, best first. */
  helps: FheCategory[];
  /** A same-tier piece from my own roster this target could realistically be won
   *  for — nearest LeagueV match among my roster's "surplus" players, or null if
   *  every one of my players is already suggested against a higher-fit target. */
  suggestedGiveUp: ResolvedPlayer | null;
}

/** Rank thresholds shared with the UI's strong/weak edge coloring (fx-edge.strong/.weak). */
const strongRank = (teamCount: number) => Math.ceil(teamCount / 3);
const weakRank = (teamCount: number) => Math.ceil((teamCount * 2) / 3);

/** Mean z across a subset of categories for one player, ignoring categories the
 *  player has no data for (rather than treating them as 0, which would flatter
 *  a thin bench player over one who's simply missing a stat). */
function meanZ(cats: Partial<Record<FheCategory, number>>, subset: readonly FheCategory[]): number | null {
  let sum = 0, n = 0;
  for (const cat of subset) {
    const v = cats[cat];
    if (typeof v === "number" && Number.isFinite(v)) { sum += v; n += 1; }
  }
  return n > 0 ? sum / n : null;
}

/**
 * Suggests players on OTHER rosters who'd plug this team's weakest categories,
 * paired with a same-value piece from the team's own roster likely to be
 * tradeable for them.
 *
 * The read is deliberately simple and explainable: rank this team's categories
 * by roto finish (same thresholds the Category Profile panel already colors
 * strong/weak), then score every other team's rostered player by their average
 * z across the WEAK categories — a player who's a plus in FT%/STL (this team's
 * gaps) but only replacement-level elsewhere scores well even if his overall
 * value is modest, because he's solving the actual problem.
 *
 * Two league-context signals adjust that raw fit score without overriding it:
 *   - Trend tag: a buy-low tag (surging/climbing/breaking-out/…) nudges the
 *     score up — real production is outrunning the market read, so it's a
 *     better time to acquire; a sell-risk tag nudges it down for the opposite
 *     reason. Read off the target's 9CatV trend tag, since that's the
 *     general-purpose signal regardless of which categories this league scores.
 *   - Dynasty consensus: in a dynasty league, a small tie-break bonus favors
 *     the better long-term dynasty asset — capped low (DYNASTY_BONUS_MAX) so it
 *     only separates comparably-fitting targets, never substitutes for fit.
 *
 * The suggested return piece is this team's own best "surplus" player — strong
 * in the categories already covered, weak in the ones needing help — nearest in
 * LeagueV to the target, so the pairing reads as a realistic even-value trade
 * rather than a wish-list swap. Each of the team's players is suggested at most
 * once, against its single best-fitting target.
 */
export function suggestTradeTargets(
  myTeamId: string,
  rosters: { teamId: string; teamName: string; players: ResolvedPlayer[] }[],
  edges: CategoryEdge[],
  scored: readonly FheCategory[],
  opts: { isDynasty: boolean; limit?: number },
): TradeSuggestion[] {
  const mine = rosters.find((r) => r.teamId === myTeamId);
  if (!mine || edges.length === 0) return [];
  const teamCount = rosters.length;

  const weakCats = edges.filter((e) => e.rank > weakRank(teamCount)).map((e) => e.category);
  const strongCats = edges.filter((e) => e.rank <= strongRank(teamCount)).map((e) => e.category);
  if (weakCats.length === 0) return []; // nothing to fix

  // My own tradeable surplus, best fit-for-trading first: strong in what I have
  // plenty of, weak in what I actually need — i.e. the players most redundant
  // with my own roster's shape, and therefore most sensible to deal away.
  const myChips = mine.players
    .filter((p) => p.playerId !== null && p.leagueV !== null)
    .map((p) => ({ p, surplus: (meanZ(p.cats, strongCats) ?? 0) - (meanZ(p.cats, weakCats) ?? 0) }))
    .sort((a, b) => b.surplus - a.surplus)
    .map((x) => x.p);

  const candidates = rosters
    .filter((r) => r.teamId !== myTeamId)
    .flatMap((r) => r.players.map((p) => ({ p, teamId: r.teamId, teamName: r.teamName })))
    .filter(({ p }) => p.playerId !== null && !p.ambiguousName && p.leagueV !== null);

  const scoredCandidates = candidates
    .map(({ p, teamId, teamName }) => {
      const fit = meanZ(p.cats, weakCats);
      if (fit === null) return null;
      let adjusted = fit;
      const tag = p.trendTags?.nineCatV ?? null;
      if (tag && BUY_LOW_TAGS.has(tag)) adjusted += TREND_ADJUSTMENT;
      else if (tag && SELL_RISK_TAGS.has(tag)) adjusted -= TREND_ADJUSTMENT;
      if (opts.isDynasty && p.consensusRank !== null) {
        adjusted += DYNASTY_BONUS_MAX * Math.max(0, 1 - p.consensusRank / DYNASTY_BONUS_POOL);
      }
      const helps = weakCats
        .filter((cat) => (p.cats[cat] ?? -Infinity) > 0)
        .sort((a, b) => (p.cats[b] ?? 0) - (p.cats[a] ?? 0));
      return { target: p, targetTeamId: teamId, targetTeamName: teamName, fitScore: adjusted, helps };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && x.fitScore > 0)
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, opts.limit ?? 10);

  const usedChips = new Set<string>();
  return scoredCandidates.map((c): TradeSuggestion => {
    let best: ResolvedPlayer | null = null;
    let bestDelta = Infinity;
    for (const chip of myChips) {
      if (usedChips.has(chip.fantraxId)) continue;
      const delta = Math.abs((chip.leagueV ?? 0) - (c.target.leagueV ?? 0));
      if (delta < bestDelta) { bestDelta = delta; best = chip; }
    }
    if (best) usedChips.add(best.fantraxId);
    return { ...c, suggestedGiveUp: best };
  });
}
