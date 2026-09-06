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

/**
 * When registration for the founding discount closes: the end of 4 October
 * 2026 *anywhere on earth*.
 *
 * UTC-12 is the last zone to leave a date, so midnight there is noon UTC the
 * following day. Picking that instant rather than 23:59 UTC means nobody is
 * ever told the offer has expired while their own calendar still says the 4th
 * — the classic "I clicked at 5pm on the last day and it was closed" support
 * ticket. Erring later costs a few hours; erring earlier costs a customer.
 *
 * This closes REGISTRATION only. A row already written keeps its own
 * discount_pct forever: the promise was made when they signed up, and this
 * date does not retract it.
 */
export const FOUNDING_OFFER_ENDS_AT = "2026-10-05T12:00:00.000Z";

/** How the deadline is written in copy. Kept beside the instant above so the
 *  two can't drift — the date a visitor reads must be the date enforced. */
export const FOUNDING_OFFER_END_LABEL = "4 October 2026";

/**
 * Whether the founding discount is still open for NEW registrations.
 *
 * Callers that must be right (the capture API) are dynamic and evaluate this
 * per request. A statically-rendered page that calls this bakes the answer in
 * at build time, so any such page needs its own `revalidate` — see
 * src/app/the-deep-edge/page.tsx.
 */
export function foundingOfferIsOpen(now: Date = new Date()): boolean {
  return now.getTime() < Date.parse(FOUNDING_OFFER_ENDS_AT);
}
