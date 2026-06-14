/**
 * FHE Draft Night Challenge — static pool definitions (handoff §2).
 *
 * Prospects are referenced by `slug` (the stable key from src/lib/prospects.ts;
 * the master CSV has no prospect_id). The named pools below were reconciled
 * against data/fhe_2026_prospects_master.csv — every slug resolves to a real
 * prospect. Note: the handoff's "Philon Jr." is Labaron Philon (no "Jr.");
 * "#36 Suigo" is Luigi Suigo, excluded from the lottery pool.
 *
 * The `mock_lottery` pool is the full top-50 minus Suigo and is built at seed
 * time from the CSV (see buildMockLotteryPool); it is not hard-coded here.
 */

import type {
  DraftedHigherConfig,
  FirstRoundConfig,
  GuardOrderConfig,
  MockLotteryConfig,
} from "./grader";

export const GAME_SLUG = "draft-night-2026";

/** Excluded from the lottery pool — returning to college. */
export const EXCLUDED_SLUGS = ["luigi-suigo"] as const;

export const MOCK_LOTTERY_SLOTS = 14;
export const FIRST_ROUND_THRESHOLD = 30;

/** 2026 NBA lottery order (picks 1–14), short team codes, for labelling the
 * mock_lottery slots. Display-only — the grader never reads this. */
export const DRAFT_ORDER_2026 = [
  "WAS", "UTA", "MEM", "CHI", "LAC", "BKN", "SAC",
  "ATL", "DAL", "MIL", "GSW", "OKC", "MIA", "CHA",
] as const;

// ── guard_order (§2.2) ──────────────────────────────────────────────────────
export const GUARD_ORDER_POOL = [
  "darryn-peterson",
  "kingston-flemings",
  "keaton-wagler",
  "darius-acuff-jr",
  "mikel-brown-jr",
] as const;

// ── drafted_higher (§2.3) ───────────────────────────────────────────────────
export const DRAFTED_HIGHER_PAIRS: [string, string][] = [
  ["dailyn-swain", "allen-graves"],
  ["kingston-flemings", "darius-acuff-jr"],
  ["ebuka-okorie", "brayden-burries"],
  ["morez-johnson-jr", "hannes-steinbach"],
  ["yaxel-lendeborg", "labaron-philon"],
];

// ── first_round (§2.4) ──────────────────────────────────────────────────────
export const FIRST_ROUND_POOL = [
  "richie-saunders",
  "ryan-conwell",
  "bruce-thornton",
  "joshua-jefferson",
] as const;

/**
 * Builds the lottery pool from the full prospect slug list (top 50), dropping
 * any excluded slug. Pass the ordered slugs from getAllProspects() at seed time
 * so this module stays free of the fs-based prospects loader.
 */
export function buildMockLotteryPool(allSlugs: string[]): string[] {
  const excluded = new Set<string>(EXCLUDED_SLUGS);
  return allSlugs.filter((slug) => !excluded.has(slug));
}

/** Static config objects for the three fixed-pool mini-games. */
export const guardOrderConfig: GuardOrderConfig = {
  key: "guard_order",
  pool: [...GUARD_ORDER_POOL],
};

export const draftedHigherConfig: DraftedHigherConfig = {
  key: "drafted_higher",
  pairs: DRAFTED_HIGHER_PAIRS,
};

export const firstRoundConfig: FirstRoundConfig = {
  key: "first_round",
  pool: [...FIRST_ROUND_POOL],
  r1Threshold: FIRST_ROUND_THRESHOLD,
};

/** mock_lottery config for a given pool (built from the CSV at seed time). */
export function mockLotteryConfig(pool: string[]): MockLotteryConfig {
  return {
    key: "mock_lottery",
    pool,
    slots: MOCK_LOTTERY_SLOTS,
    slotTeams: [...DRAFT_ORDER_2026],
  };
}
