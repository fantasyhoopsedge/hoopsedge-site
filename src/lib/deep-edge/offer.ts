/**
 * The Deep Edge season-pass offer, as shown to a visitor.
 *
 * Deliberately its own module with NO "server-only" guard and no imports:
 * `waitlist.ts` is server-only (it holds the service-role client), but these
 * numbers are needed by a Client Component (the capture screen), a Server
 * Component (the landing page) and a `tsx` script (the backfill) alike.
 * Splitting them out is what stops the same price being retyped in three
 * places and drifting.
 *
 * Note the stored `deep_edge_waitlist.discount_pct` is a SNAPSHOT of
 * FOUNDING_DISCOUNT_PCT at the moment someone registered, never a live read of
 * it — see that table's migration for why a past promise has to survive a
 * price change here.
 */

export const SEASON_PASS_USD = 35;
export const FOUNDING_DISCOUNT_PCT = 20;

/** Rounded to whole dollars — 35 × 0.8 is exactly 28, but keep this derived
 *  rather than hardcoded so changing either constant above stays consistent. */
export const FOUNDING_PRICE_USD = Math.round(SEASON_PASS_USD * (1 - FOUNDING_DISCOUNT_PCT / 100));
