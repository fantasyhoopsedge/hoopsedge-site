import type { FheCategory, LeaguePointsFormula } from "./league";
import type { LeagueAnalysis, ResolvedPlayer, TeamCategoryProfile } from "./analyze";

/**
 * Slot-constrained "best lineup" selection — what buildTeamProfile()
 * (analyze.ts) deliberately does NOT do: that function takes a flat top-N by
 * value with no regard for which positions those players can actually fill.
 * Category Edge and Power Rankings both need the real answer to "who's
 * actually in my starting lineup", so both call this one function rather
 * than risk reporting two different rosters for the same team.
 *
 * Exact maximum-value assignment (branch-and-bound), not a greedy heuristic
 * — this took two attempts to get right, both real bugs rather than
 * approximation trade-offs:
 *   1. An early version filled slots in whatever order
 *      Object.entries(positionSlots) happened to iterate (typically
 *      PG,SG,SF,PF,C) — a 3-position-eligible player could lose all three
 *      slots to higher-value single-position players processed earlier,
 *      then lose Flex too, purely because of iteration order.
 *   2. Recomputing scarcity dynamically (most-constrained-slot-next) fixed
 *      that, but a concrete counter-example (Ash, 2026-08-11) showed even
 *      dynamic greedy isn't enough: the true best lineup can require
 *      reassigning an ALREADY-picked player to a different slot they're also
 *      eligible for, to free up their original slot for someone better —
 *      e.g. moving a forward from SF to PF so SF opens up for a
 *      guard-forward greedy had already passed over. No single-pass
 *      slot-at-a-time algorithm can discover that; it requires evaluating
 *      combinations, not one slot in isolation.
 * Branch-and-bound (see solveOptimalAssignment below) finds the true optimum
 * by construction — sorted-descending candidate order plus an admissible
 * upper-bound prune keeps it fast for realistic roster sizes (~13-20
 * players, ~6-10 slots), with a size-capped fallback to scarcity-greedy
 * (see greedyAssignment) to guard against pathological inputs where nearly
 * every player is eligible for nearly every slot.
 */

/** Active, position-flexible slots — count toward the starting lineup, accept
 *  any eligible player regardless of specific position. */
const GENERIC_ACTIVE_SLOTS = new Set(["flx", "flex", "util"]);
/** Non-active roster capacity — Bench, IR, and Minors/taxi-squad spots exist
 *  to hold players who are NOT in the scoring lineup. Filling these as if
 *  they were active slots (the bug this set fixes, 2026-08-11) silently
 *  counted bench/IR/Minors players' production into team totals — real
 *  Fantrax scoring never does that; only active slots play. These slots are
 *  simply never expanded, so whoever occupies them falls through to
 *  OptimalLineup.bench naturally, same as anyone who doesn't make the cut. */
const RESERVE_SLOTS = new Set(["res", "ir", "be", "bench", "na", "minors", "min", "taxi"]);

function isGenericSlot(slot: string): boolean {
  return GENERIC_ACTIVE_SLOTS.has(slot.toLowerCase());
}

export interface LineupAssignment {
  slot: string;
  player: ResolvedPlayer;
}

export interface OptimalLineup {
  starters: LineupAssignment[];
  /** Rostered players not selected into the lineup, best value first —
   *  includes anyone parked on Bench/IR/Minors, not just cut players. */
  bench: ResolvedPlayer[];
  /** Manually forced-in players (see `options.forcedIn`) who couldn't be
   *  placed — every slot they're eligible for was already claimed by other
   *  forced-in players first. Surfaced so the UI can flag an impossible
   *  manual lineup instead of silently dropping the player or crashing. */
  unplaceable: ResolvedPlayer[];
}

/** Which value drives "best lineup" selection. "league" is LeagueV — the
 *  mean z across exactly this league's scored categories, the same number
 *  that drives its roto/H2H standings. The three CatV flavors let the user
 *  ask "who would I start under a generic 9-cat/8-cat/Minus1V lens instead"
 *  — a deliberately different question, not a replacement default. "fpts"
 *  ranks by the league's real fantasy-points formula — only meaningful for
 *  a points-scored league, same as an explicit `formula` already forces
 *  below, just selectable without a caller having to also thread the
 *  formula through (see UI_VALUE_MODE_OPTIONS). */
export type LineupValueMode = "league" | "nineCatV" | "eightCatV" | "minus1V" | "fpts";

function lineupValueOf(p: ResolvedPlayer, formula: LeaguePointsFormula | null | undefined, mode: LineupValueMode): number | null {
  if (formula || mode === "fpts") return p.pointsValue; // points-mode leagues always rank by points, regardless of mode
  if (mode === "league") return p.leagueV;
  return p.catV?.perGame[mode] ?? null;
}

/** Shared "Rank lineup by" label/order for Category Edge, Roster Edge, and
 *  Trade Edge — 8-Cat, 9-Cat, Minus1V, FPTS, in that fixed order (Ash's own
 *  ordering; consistency sweep across all three tools, 2026-08-18). "league"
 *  is deliberately excluded — none of the three expose it as a user choice.
 *  FPTS should be passed to SegmentedControl's disabledOptions whenever the
 *  connected league isn't points-scored (it has no real fantasy-points
 *  formula to rank by there). */
export const LINEUP_VALUE_MODE_LABEL: Record<LineupValueMode, string> = {
  league: "League", eightCatV: "8-Cat", nineCatV: "9-Cat", minus1V: "Minus1V", fpts: "FPTS",
};
export const UI_VALUE_MODE_OPTIONS: { value: Exclude<LineupValueMode, "league">; label: string }[] = [
  { value: "eightCatV", label: LINEUP_VALUE_MODE_LABEL.eightCatV },
  { value: "nineCatV", label: LINEUP_VALUE_MODE_LABEL.nineCatV },
  { value: "minus1V", label: LINEUP_VALUE_MODE_LABEL.minus1V },
  { value: "fpts", label: LINEUP_VALUE_MODE_LABEL.fpts },
];

function isEligible(slot: string, p: ResolvedPlayer): boolean {
  return isGenericSlot(slot) || p.eligible.some((e) => e.toLowerCase() === slot.toLowerCase());
}

/** A "must include" bonus for forced-in players, large enough that any
 *  solution including all of them always outscores any solution excluding
 *  even one — so the same optimizer that finds the best combination for
 *  everyone else also finds the best SLOT for a forced-in player relative to
 *  everyone else, rather than a separate pre-pass greedily claiming
 *  whichever slot looks scarce first. Real LeagueV/CatV magnitudes are
 *  small (roughly -3..+3), so this can't be out-bid by any realistic value
 *  swing; when two forced players compete for the one slot both fit, the
 *  bonus cancels out and the real underlying value decides, which is what
 *  you want. */
const FORCED_BONUS = 1_000_000;

/** Hard ceiling on backtracking calls for the exact solver (see
 *  solveOptimalAssignment) — found necessary 2026-08-19 chasing a "Page
 *  Unresponsive" freeze on Trade Edge's depth toggle: the `pool.length *
 *  slots.length > 400` size cap in buildOptimalLineup only bounds the
 *  SEARCH SPACE, not how well the admissible upper-bound prune cuts it down.
 *  It cuts fast when values are spread out, but real deep-league benches
 *  cluster tightly (many bench players within a few hundredths of LeagueV of
 *  each other) combined with multi-position eligibility (PG/SG/Flx/Util all
 *  on one card) — exactly the "nearly every player eligible for nearly every
 *  slot" case this file already calls out as the greedy fallback's reason to
 *  exist. Benchmarked: an 18-player/16-slot roster (product 288, comfortably
 *  under the 400 cutoff) with clustered values didn't finish in 60+ seconds.
 *  This budget bails to the caller's greedy fallback instead once the exact
 *  search has done enough work that it's clearly not converging fast, which
 *  keeps the common case (spread-out values, most rosters) exact while
 *  putting a hard, roster-size-independent ceiling on the worst case. */
const BACKTRACK_BUDGET = 20_000;

/** Exact solver: try every slot/player combination via branch-and-bound
 *  rather than one slot at a time, so a globally-better arrangement that
 *  requires reassigning an already-picked player is never missed (see file
 *  header). Candidates per slot are pre-sorted by value descending, so the
 *  very first full path explored is already near-optimal — the upper-bound
 *  prune then discards the rest fast in practice. Returns null if the
 *  BACKTRACK_BUDGET is exhausted before the search completes, signaling the
 *  caller to fall back to greedyAssignment rather than block indefinitely. */
function solveOptimalAssignment(
  slots: string[],
  pool: ResolvedPlayer[],
  rankValue: (p: ResolvedPlayer) => number | null,
): (ResolvedPlayer | null)[] | null {
  const n = slots.length;
  if (n === 0) return [];

  const values = pool.map((p) => rankValue(p) ?? -Infinity);
  const candidatesPerSlot = slots.map((slot) =>
    pool
      .map((_, pi) => pi)
      .filter((pi) => isEligible(slot, pool[pi]))
      .sort((a, b) => values[b] - values[a]),
  );

  const used = new Array<boolean>(pool.length).fill(false);
  const current = new Array<number | null>(n).fill(null);
  let best: { assignment: (number | null)[]; total: number } = { assignment: new Array(n).fill(null), total: -Infinity };
  let calls = 0;
  let budgetExceeded = false;

  // Admissible upper bound: best still-unused candidate's value per
  // remaining slot, ignoring that two slots might both want the same
  // player. Over-counting only makes the bound looser (never wrongly
  // prunes a valid better solution), which is all "admissible" requires.
  function upperBound(slotIdx: number): number {
    let bound = 0;
    for (let i = slotIdx; i < n; i++) {
      for (const pi of candidatesPerSlot[i]) {
        if (!used[pi]) { bound += Math.max(0, values[pi]); break; }
      }
    }
    return bound;
  }

  function backtrack(slotIdx: number, total: number) {
    if (budgetExceeded) return;
    if (++calls > BACKTRACK_BUDGET) { budgetExceeded = true; return; }
    if (slotIdx === n) {
      if (total > best.total) best = { assignment: [...current], total };
      return;
    }
    if (total + upperBound(slotIdx) <= best.total) return; // provably can't beat the best found so far
    let anyCandidate = false;
    for (const pi of candidatesPerSlot[slotIdx]) {
      if (used[pi]) continue;
      anyCandidate = true;
      used[pi] = true;
      current[slotIdx] = pi;
      backtrack(slotIdx + 1, total + values[pi]);
      used[pi] = false;
      current[slotIdx] = null;
      if (budgetExceeded) return;
    }
    // Only leave a slot empty when literally no unused eligible player
    // exists — fielding a full lineup always beats sitting a slot out in
    // real fantasy scoring, so this is never a voluntary choice.
    if (!anyCandidate) backtrack(slotIdx + 1, total);
  }
  backtrack(0, 0);

  if (budgetExceeded) return null;
  return best.assignment.map((pi) => (pi === null ? null : pool[pi]));
}

/** Scarcity-ordered greedy fallback for pathologically large inputs (see
 *  size cap below) — the exact solver's own predecessor, kept only as a
 *  safety valve since it's still meaningfully better than a fixed slot
 *  order, even though it doesn't guarantee the true optimum. */
function greedyAssignment(
  slots: string[],
  pool: ResolvedPlayer[],
  rankValue: (p: ResolvedPlayer) => number | null,
): (ResolvedPlayer | null)[] {
  const remaining = new Set(pool);
  const assignment = new Array<ResolvedPlayer | null>(slots.length).fill(null);
  const openSlotIdx = slots.map((_, i) => i); // indices into `slots`/`assignment`, not the strings — safe when slot names repeat (e.g. two "Flx" instances)

  while (openSlotIdx.length > 0) {
    let bestPos = 0;
    let bestCount = Infinity;
    for (let i = 0; i < openSlotIdx.length; i++) {
      const slot = slots[openSlotIdx[i]];
      const count = isGenericSlot(slot) ? remaining.size : [...remaining].filter((p) => isEligible(slot, p)).length;
      if (count < bestCount) { bestCount = count; bestPos = i; }
    }
    const slotIdx = openSlotIdx[bestPos];
    const slot = slots[slotIdx];
    let pick: ResolvedPlayer | null = null;
    let bestV = -Infinity;
    for (const p of remaining) {
      if (!isEligible(slot, p)) continue;
      const v = rankValue(p) ?? -Infinity;
      if (v > bestV) { pick = p; bestV = v; }
    }
    if (pick) { assignment[slotIdx] = pick; remaining.delete(pick); }
    openSlotIdx.splice(bestPos, 1);
  }
  return assignment;
}

/** In-memory cache of solved lineups, keyed on actual roster contents (see
 *  buildOptimalLineup's own note on why depth/weight are deliberately absent
 *  from the key). A simple FIFO cap rather than a real LRU — this only needs
 *  to survive one browsing session's worth of depth/valueMode/trade-candidate
 *  toggling, not be a precise cache; insertion order is close enough to
 *  recency for that. */
const lineupCache = new Map<string, OptimalLineup>();
const LINEUP_CACHE_MAX = 500;

function lineupCacheKey(
  players: ResolvedPlayer[],
  positionSlots: Record<string, number>,
  formula: LeaguePointsFormula | null | undefined,
  valueMode: LineupValueMode,
  forcedIn: ReadonlySet<string>,
  exact: boolean,
): string {
  const rosterKey = players.map((p) => p.fantraxId).sort().join(",");
  const slotsKey = Object.entries(positionSlots).sort(([a], [b]) => a.localeCompare(b)).map(([s, c]) => `${s}:${c}`).join(",");
  const forcedKey = forcedIn.size ? [...forcedIn].sort().join(",") : "";
  const formulaKey = formula ? JSON.stringify(formula) : "";
  return `${rosterKey}|${slotsKey}|${formulaKey}|${valueMode}|${forcedKey}|${exact}`;
}

export function buildOptimalLineup(
  players: ResolvedPlayer[],
  positionSlots: Record<string, number>,
  formula?: LeaguePointsFormula | null,
  options?: {
    valueMode?: LineupValueMode;
    /** Fantrax ids the user has manually forced into the lineup — the
     *  optimizer treats these as effectively mandatory (see FORCED_BONUS)
     *  and still picks their best slot relative to everyone else, rather
     *  than a separate greedy pre-pass. Category Edge's "Adjust starters"
     *  substitution feature; every other caller omits this. */
    forcedIn?: ReadonlySet<string>;
    /** Skip the exact branch-and-bound solver and go straight to greedy,
     *  regardless of size. Default true (exact) — every existing caller
     *  keeps today's behavior unless it opts out. For "my own lineup" this
     *  should always stay exact (it's the tool's actual answer); for the
     *  other 29 teams in a depth-weighted league-wide comparison, they're
     *  just a competitive benchmark, and greedy is "still meaningfully
     *  better than a fixed slot order" (see greedyAssignment's own note)
     *  without the branch-and-bound's exponential worst case. See
     *  buildDepthWeightedProfiles' exactTeamId for where this gets used —
     *  running the exact solver 30 times per depth-toggle click is what
     *  caused real "Page Unresponsive" freezes (Ash, 2026-08-11) on large
     *  leagues (30 teams × a wide bench × "Best 10" active slots). */
    exact?: boolean;
  },
): OptimalLineup {
  const valueMode = options?.valueMode ?? "league";
  const forcedIn = options?.forcedIn ?? new Set<string>();
  const exact = options?.exact ?? true;

  // `depth`/`weight` (Trade/Category Edge's roster-depth toggle) never reach
  // this function — the caller applies them afterward via extendLineup, on
  // top of this same base lineup. So every one of the 6 depth-toggle clicks
  // (Starters..+5) calls in here with byte-identical players/positionSlots/
  // formula/valueMode/forcedIn/exact, asking to re-solve the exact same
  // problem from scratch — that redundant re-solve, not any single solve
  // being slow, is what produced the "Page Unresponsive" freeze on a depth
  // click (Ash, 2026-08-19: the underlying compute was already correct, it
  // was just being thrown away and redone on every click). Cache on the
  // actual roster contents (not object identity — trade simulations build a
  // fresh players array per candidate trade) so only a genuine change in
  // who's on the roster, the slots, or the ranking mode forces a re-solve.
  const key = lineupCacheKey(players, positionSlots, formula, valueMode, forcedIn, exact);
  const cached = lineupCache.get(key);
  if (cached) return cached;

  const baseValue = (p: ResolvedPlayer) => lineupValueOf(p, formula, valueMode);
  const rankValue = (p: ResolvedPlayer) => {
    const v = baseValue(p);
    if (v === null) return null;
    return forcedIn.has(p.fantraxId) ? v + FORCED_BONUS : v;
  };

  const pool = players.filter((p) => baseValue(p) !== null);

  const slotInstances: string[] = [];
  for (const [slot, count] of Object.entries(positionSlots)) {
    if (RESERVE_SLOTS.has(slot.toLowerCase())) continue;
    for (let i = 0; i < count; i++) slotInstances.push(slot);
  }

  const useExact = exact && pool.length * slotInstances.length <= 400;
  // solveOptimalAssignment returns null if BACKTRACK_BUDGET is exhausted
  // (clustered values + heavy multi-position eligibility can defeat the
  // prune well under the 400-product size cutoff — see BACKTRACK_BUDGET's
  // own note) — greedyAssignment is the same safety-valve fallback the size
  // cutoff already uses, so a budget bailout degrades the same way a
  // too-large roster always has.
  const assignment =
    (useExact ? solveOptimalAssignment(slotInstances, pool, rankValue) : null) ??
    greedyAssignment(slotInstances, pool, rankValue);

  const starters: LineupAssignment[] = [];
  const usedIds = new Set<string>();
  assignment.forEach((player, idx) => {
    if (player) { starters.push({ slot: slotInstances[idx], player }); usedIds.add(player.fantraxId); }
  });

  const unplaceable = pool.filter((p) => forcedIn.has(p.fantraxId) && !usedIds.has(p.fantraxId));
  const bench = pool.filter((p) => !usedIds.has(p.fantraxId));

  const result: OptimalLineup = { starters, bench, unplaceable };
  lineupCache.set(key, result);
  if (lineupCache.size > LINEUP_CACHE_MAX) {
    const oldest = lineupCache.keys().next().value;
    if (oldest !== undefined) lineupCache.delete(oldest);
  }
  return result;
}

/**
 * Builds the same shape buildTeamProfile() (analyze.ts) returns, but from a
 * pre-selected slot-aware lineup rather than a flat top-N re-selection — so a
 * team's roto totals/points always agree with the lineup actually shown.
 * Aggregation logic (FG%/FT% attempt-weighted, per-game × games for totals)
 * intentionally mirrors buildTeamProfile()'s own — only the starter
 * selection differs.
 */
export function profileFromLineup(
  teamId: string,
  teamName: string,
  lineup: OptimalLineup,
  scored: readonly FheCategory[],
  formula?: LeaguePointsFormula | null,
): TeamCategoryProfile {
  const starters = lineup.starters.map((a) => a.player);

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

  let pointsTotal: number | null = null;
  if (formula) {
    pointsTotal = 0;
    for (const p of starters) {
      const g = p.gamesPlayed ?? 0;
      if (p.pointsValue != null && g > 0) pointsTotal += p.pointsValue * g;
    }
  }

  return {
    teamId,
    teamName,
    totals,
    pointsTotal,
    statTotals: {
      pts, fg3m, reb, ast, stl, blk, tov, gamesPlayed,
      fg_pct: fga > 0 ? fgm / fga : null,
      ft_pct: fta > 0 ? ftm / fta : null,
    },
    starters,
    unmatched: lineup.starters.length + lineup.bench.length - starters.length,
    rosterSize: lineup.starters.length + lineup.bench.length,
  };
}

/** Slot-aware profiles for every team in the league — the shared input both
 *  Category Edge and Power Rankings' Roto tab compute from, so the two
 *  screens can never silently disagree about who's in a given lineup.
 *
 *  `scored`/`positionSlots` default to the league's own auto-detected values
 *  but accept the Settings screen's user overrides (scoredCategoriesOverride/
 *  positionSlotsOverride) — this is what makes those toggles functionally
 *  real rather than cosmetic. */
export function buildLeagueProfiles(
  analysis: LeagueAnalysis,
  overrides?: { scored?: readonly FheCategory[]; positionSlots?: Record<string, number> },
): TeamCategoryProfile[] {
  const { league } = analysis;
  const scored = overrides?.scored ?? league.categories.scored;
  const positionSlots = overrides?.positionSlots ?? league.positionSlots;
  const formula = league.scoringMode === "points" ? league.pointsFormula : null;
  return analysis.rosters.map((r) => {
    const lineup = buildOptimalLineup(r.players, positionSlots, formula);
    return profileFromLineup(r.teamId, r.teamName, lineup, scored, formula);
  });
}

/**
 * The Settings screen's category-toggle/roster-stepper overrides, resolved
 * against a live league's auto-detected values. Deliberately typed with
 * inline fields rather than importing SavedLeagueSettings from store.ts —
 * store.ts is server-only (fs, service-role client) and this helper is
 * called from client components (Category Edge, Power Rankings), matching
 * the same client/server split league-tags.ts exists to enforce.
 */
export function resolveEffectiveScoring(
  league: { categories: { scored: readonly FheCategory[] }; positionSlots: Record<string, number> },
  settings: { scoredCategoriesOverride?: FheCategory[]; positionSlotsOverride?: Record<string, number> } | undefined,
): { scored: readonly FheCategory[]; positionSlots: Record<string, number> } {
  return {
    scored: settings?.scoredCategoriesOverride?.length ? settings.scoredCategoriesOverride : league.categories.scored,
    positionSlots: settings?.positionSlotsOverride ?? league.positionSlots,
  };
}

export type CategoryTier = "promoter" | "passive" | "detractor";

/** Fixed z-score bands, not lineup-relative percentiles — consistent with
 *  the codebase's existing anchor-based coloring (analyze.ts's vBg() in
 *  admin/fantrax/_connector.tsx uses the same fixed-anchor convention).
 *  Placeholder thresholds pending a pixel-level check against the design's
 *  ELITE/EXCELLENT/AVERAGE/FAIR tier badges. */
export function categoryTier(z: number | null | undefined): CategoryTier | null {
  if (z == null || !Number.isFinite(z)) return null;
  if (z >= 0.5) return "promoter";
  if (z <= -0.5) return "detractor";
  return "passive";
}

export const RANK_TIER_LABELS = ["Elite", "Excellent", "Good", "Average", "Fair", "Poor"] as const;

/** The design's 6 percentile buckets (ELITE top 10% ... POOR bottom 10%) off
 *  a 1-based finish among `of` teams — the single source of truth for both
 *  the rank-tier text badges and any conditional-formatting color scale that
 *  needs to bucket the same way (Power Rankings' Roto table/H2H strength
 *  bar). Index into RANK_TIER_LABELS for the text form. */
export function rankTierIndex(rank: number, of: number): number {
  const pct = rank / Math.max(1, of);
  if (pct <= 0.1) return 0;
  if (pct <= 0.3) return 1;
  if (pct <= 0.5) return 2;
  if (pct <= 0.7) return 3;
  if (pct <= 0.9) return 4;
  return 5;
}

/** Roughly matches the design's rank-tier badges (ELITE/EXCELLENT/GOOD/
 *  AVERAGE/FAIR/POOR) off a 1-based finish among `of` teams. */
export function rankTierLabel(rank: number, of: number): string {
  return RANK_TIER_LABELS[rankTierIndex(rank, of)];
}

/** A lineup's combined per-game output in one category — the sum of each
 *  starter's own per-game raw stat (not season-totals-weighted), FG%/FT%
 *  attempt-weighted across the lineup. Shared display helper for Category
 *  Edge and Power Rankings' Roto table, both of which show real per-game
 *  averages alongside the z-score-driven ranks. */
export function teamPerGameStat(players: ResolvedPlayer[], cat: FheCategory): number {
  const nz = (v: number | null | undefined) => v ?? 0;
  if (cat === "FG" || cat === "FT") {
    let makes = 0, atts = 0;
    for (const p of players) {
      const s = p.statLine;
      if (!s) continue;
      const a = cat === "FG" ? nz(s.fga) : nz(s.fta);
      const pct = cat === "FG" ? nz(s.fg_pct) : nz(s.ft_pct);
      atts += a;
      makes += a * pct;
    }
    return atts > 0 ? makes / atts : 0;
  }
  const key = cat === "PTS" ? "pts" : cat === "REB" ? "reb" : cat === "AST" ? "ast" : cat === "STL" ? "stl" : cat === "BLK" ? "blk" : cat === "FG3" ? "fg3m" : "tov";
  return players.reduce((acc, p) => acc + nz(p.statLine?.[key as keyof NonNullable<ResolvedPlayer["statLine"]>] as number | null), 0);
}
