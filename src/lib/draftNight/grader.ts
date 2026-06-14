/**
 * FHE Draft Night Challenge — the grader.
 *
 * This is the one part of the build that must be exact (handoff §2). It is a
 * pure, dependency-free module: every function takes the mini-game config, the
 * user's payload, and the official results map, and returns an integer score.
 * No I/O, no Supabase, no `prospects.ts` (fs) imports — so it can be unit-tested
 * via a dry-run with hand-computed expected scores before draft night (§6).
 *
 * Prospects are identified by `slug` everywhere (the master CSV exposes no
 * `prospect_id`; slug is the stable key — see src/lib/prospects.ts).
 *
 * `ResultsPicks` maps slug -> the prospect's ACTUAL draft pick (1..60). A slug
 * absent from the map is treated as undrafted. `pickOf` is the single source of
 * that null-vs-number decision.
 */

export type MiniGameKey =
  | "mock_lottery"
  | "guard_order"
  | "drafted_higher"
  | "first_round";

/** slug -> actual draft pick (1..60). Absent slug = undrafted. */
export type ResultsPicks = Record<string, number>;

export interface MockLotteryConfig {
  key: "mock_lottery";
  /** selectable pool of slugs (top 50 minus Suigo). */
  pool: string[];
  /** number of lottery slots to fill (14). */
  slots: number;
  /** display-only: NBA team abbreviation per slot (index 0 = pick 1). The
   * grader ignores this — it only affects how the lottery board is labelled. */
  slotTeams?: string[];
}

export interface GuardOrderConfig {
  key: "guard_order";
  /** the 5 guards, in their default display order. */
  pool: string[];
}

export interface DraftedHigherConfig {
  key: "drafted_higher";
  /** the 5 head-to-head pairs, each [A, B]. */
  pairs: [string, string][];
}

export interface FirstRoundConfig {
  key: "first_round";
  /** the 4 bubble candidates. */
  pool: string[];
  /** a pick at or below this number counts as "first round" (30). */
  r1Threshold: number;
}

export type MiniGameConfig =
  | MockLotteryConfig
  | GuardOrderConfig
  | DraftedHigherConfig
  | FirstRoundConfig;

/** Actual pick for a slug, or null when undrafted (absent from results). */
export function pickOf(picks: ResultsPicks, slug: string): number | null {
  const p = picks[slug];
  return typeof p === "number" ? p : null;
}

// ── §2.1 mock_lottery — self-draft, 14 slots (ceiling 560) ──────────────────
/**
 * `payload` is the user's ordered slugs; index 0 = slot 1. Entries beyond the
 * placed picks (or empty) score 0. Inclusion credit (+5) rewards naming a real
 * lottery prospect (actual pick <= 14) even when the slot is off by 3+.
 */
export function gradeMockLottery(
  payload: string[],
  config: MockLotteryConfig,
  picks: ResultsPicks,
): number {
  let score = 0;
  for (let s = 1; s <= config.slots; s++) {
    const slug = payload[s - 1];
    if (!slug) continue; // nothing placed in this slot
    const a = pickOf(picks, slug);
    if (a === null) continue; // undrafted -> 0
    const d = Math.abs(a - s);
    if (d === 0) score += 40;
    else if (d === 1) score += 20;
    else if (d === 2) score += 10;
    else if (a <= 14) score += 5; // right lottery name, wrong slot
    // else 0
  }
  return score;
}

// ── §2.2 guard_order — 5 fixed (ceiling 150) ────────────────────────────────
/**
 * Builds the actual order = the 5 guards sorted ascending by actual pick
 * (undrafted -> last, stable). Each position scores by how far the user's
 * placed guard is from where it actually landed; an exact match adds +50.
 */
export function gradeGuardOrder(
  payload: string[],
  config: GuardOrderConfig,
  picks: ResultsPicks,
): number {
  // Stable sort of the pool by actual pick (undrafted = +Infinity -> last).
  const actualOrder = config.pool
    .map((slug, idx) => ({ slug, idx, a: pickOf(picks, slug) ?? Infinity }))
    .sort((x, y) => (x.a === y.a ? x.idx - y.idx : x.a - y.a))
    .map((e) => e.slug);

  let score = 0;
  for (let i = 0; i < payload.length; i++) {
    const j = actualOrder.indexOf(payload[i]);
    if (j === -1) continue; // not a pool member (shouldn't happen)
    const d = Math.abs(i - j);
    if (d === 0) score += 20;
    else if (d === 1) score += 10;
  }
  // perfect-order bonus
  const exact =
    payload.length === actualOrder.length &&
    payload.every((slug, i) => slug === actualOrder[i]);
  if (exact) score += 50;
  return score;
}

// ── §2.3 drafted_higher — 5 pairs (ceiling 150) ─────────────────────────────
/**
 * `payload[i]` is the slug the user picked to be drafted higher in pair i.
 * Both undrafted = push (0, no penalty). Otherwise the lower actual pick wins;
 * a correct pick scores +30.
 */
export function gradeDraftedHigher(
  payload: string[],
  config: DraftedHigherConfig,
  picks: ResultsPicks,
): number {
  let score = 0;
  config.pairs.forEach(([a, b], i) => {
    const pa = pickOf(picks, a) ?? Infinity;
    const pb = pickOf(picks, b) ?? Infinity;
    if (pa === Infinity && pb === Infinity) return; // push
    const winner = pa < pb ? a : b;
    if (payload[i] === winner) score += 30;
  });
  return score;
}

// ── §2.4 first_round — multi-select of 4 (range -120..+160) ──────────────────
/**
 * `payload` is the set of slugs the user tagged as first-rounders. Tagging a
 * first-rounder = +40; a wrong tag = -30; a correct fade = +20; a missed
 * first-rounder is neutral (0) to avoid double jeopardy.
 */
export function gradeFirstRound(
  payload: string[],
  config: FirstRoundConfig,
  picks: ResultsPicks,
): number {
  const tagged = new Set(payload);
  let score = 0;
  for (const slug of config.pool) {
    const a = pickOf(picks, slug);
    const draftedR1 = a !== null && a <= config.r1Threshold;
    const isTagged = tagged.has(slug);
    if (isTagged && draftedR1) score += 40;
    else if (isTagged && !draftedR1) score -= 30;
    else if (!isTagged && draftedR1) score += 0; // missed: neutral
    else score += 20; // correct fade
  }
  return score;
}

/** Dispatch on mini-game key. `payload` shapes differ per key (see above). */
export function gradeMiniGame(
  config: MiniGameConfig,
  payload: string[],
  picks: ResultsPicks,
): number {
  switch (config.key) {
    case "mock_lottery":
      return gradeMockLottery(payload, config, picks);
    case "guard_order":
      return gradeGuardOrder(payload, config, picks);
    case "drafted_higher":
      return gradeDraftedHigher(payload, config, picks);
    case "first_round":
      return gradeFirstRound(payload, config, picks);
  }
}

/**
 * Combined Draft Night Score (§2.5): the sum of every mini-game score, floored
 * at 0 so no sign-up finishes underwater. Per-mini-game scores (including a
 * negative first_round) stay visible on the results screen; only this total is
 * floored.
 */
export function combinedScore(miniScores: number[]): number {
  return Math.max(
    0,
    miniScores.reduce((sum, s) => sum + s, 0),
  );
}
