/**
 * Single source of truth for the real-salary hard cap used by the Real Salary
 * Rankings tool and the team-rosters payroll card. Both should import this
 * rather than hardcoding the number a second time (see
 * docs/real-salary-dynasty-rankings-brief.md §5, item 2).
 *
 * Ash's stated league hard cap (tax line) for 2026-27 is $200,428,000; the
 * pre-existing team-rosters payroll card used a rounded $200,400,000 — close
 * enough that Ash confirmed treating them as the same number (2026-07-29).
 * This constant is the precise figure; round for display where the old card
 * did.
 */
export const REAL_SALARY_CAP = 200_428_000;

/** The season REAL_SALARY_CAP above is anchored to. */
export const REAL_SALARY_CAP_SEASON = 2027; // 2026-27

/**
 * The NBA cap typically rises 5-7%/year, announced by the league each
 * June/July — 6% is a documented midpoint default, not an announced figure.
 * Not wired into Phase 1 pricing (single-season, anchored to
 * REAL_SALARY_CAP_SEASON) — this is prep for Phase 2's multi-year model,
 * which needs a projected future cap to price out-of-contract years against.
 * See docs/real-salary-dynasty-rankings-brief.md §3.3.1.
 */
export const REAL_SALARY_CAP_GROWTH_RATE = 0.06;

/** Projects the cap forward (or back) from REAL_SALARY_CAP_SEASON at
 *  REAL_SALARY_CAP_GROWTH_RATE, compounding annually. A projection, not an
 *  announced figure, for any season other than REAL_SALARY_CAP_SEASON. */
export function capForSeason(season: number): number {
  const yearsOut = season - REAL_SALARY_CAP_SEASON;
  return REAL_SALARY_CAP * Math.pow(1 + REAL_SALARY_CAP_GROWTH_RATE, yearsOut);
}
