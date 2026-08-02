/**
 * How a real NBA team's minutes are SHAPED across its rotation, and where the
 * depth chart currently sits against that.
 *
 * The Team Load chip answers "do these minutes sum to 241.75?". A depth chart can
 * hit that total and still be shaped like no team that has ever played: the same
 * 241.75 buys a three-star team or a nine-man committee. Measured 2026-08-02, the
 * projections were doing the second — moving roughly 9 min/team-game off the top 3
 * and the deep bench into ranks 4-12, which compounds into a top usage rate at the
 * 35th percentile and a usage spread at the 29th. With 86% of MPG values hand-set,
 * that shape is an author's, and the author had no feedback on it while typing.
 *
 * THE BANDS. 99 team-seasons from 2022-2026 whose top-8 availability falls inside
 * the range the projections themselves assume (0.76-0.88; matched mean 0.824 vs the
 * projections' 0.819). Matching matters: an average real season carries injuries a
 * healthy-expectation projection does not, and comparing against all team-seasons
 * flatters the projection by ~8 minutes in the 4-8 block. Unit is minutes per TEAM
 * game (season minutes / team games), so a player who misses time contributes less
 * — the same unit the allocator's `load` and Stage 3 both use.
 *
 * RANKS 13+ IS NOT A FAIR TARGET and is labelled accordingly. Real teams spend
 * ~20 min/game there on call-ups, two-ways and injury fill-ins who are not on a
 * roster of record in August, so a depth chart structurally cannot reach the band.
 * It is shown because the gap has to land somewhere, and seeing it land on ranks
 * 4-12 is the point.
 */

export interface Band {
  key: "top3" | "r4_8" | "r9_12" | "r13";
  label: string;
  hint: string;
  mean: number;
  lo: number;
  hi: number;
  /** Ranks 13+ can't be met from a roster of record — inform, never flag. */
  advisory?: boolean;
}

export const ROTATION_BANDS: Band[] = [
  { key: "top3", label: "Top 3", hint: "the closers", mean: 85.3, lo: 74.4, hi: 95.2 },
  { key: "r4_8", label: "Ranks 4-8", hint: "the rest of the rotation", mean: 97.4, lo: 86.0, hi: 109.3 },
  { key: "r9_12", label: "Ranks 9-12", hint: "end of the bench", mean: 38.5, lo: 28.8, hi: 48.7 },
  {
    key: "r13", label: "Ranks 13+", hint: "call-ups & fill-ins — history only",
    mean: 20.3, lo: 9.5, hi: 34.1, advisory: true,
  },
];

/** Top usage rate on the team, and the spread of usage across the rotation. */
export const USG_BANDS = {
  top: { label: "Top usage", mean: 30.16, lo: 25.01, hi: 36.34 },
  spread: { label: "Usage spread", mean: 6.02, lo: 3.34, hi: 8.89 },
};

export type BlockTotals = Record<Band["key"], number>;

/** Sum minutes-per-team-game into rotation blocks. `loads` need not be sorted. */
export function rotationBlocks(loads: number[]): BlockTotals {
  const s = [...loads].sort((a, b) => b - a);
  const sum = (from: number, to: number) =>
    s.slice(from, to).reduce((a, b) => a + b, 0);
  return { top3: sum(0, 3), r4_8: sum(3, 8), r9_12: sum(8, 12), r13: sum(12, s.length) };
}

export type Verdict = "low" | "ok" | "high";

export function verdictOf(band: Band, value: number): Verdict {
  if (value < band.lo) return "low";
  if (value > band.hi) return "high";
  return "ok";
}

/** Position of `value` inside [lo, hi] as 0..1, clamped — for the band marker. */
export function bandPosition(band: Band, value: number): number {
  return Math.max(0, Math.min(1, (value - band.lo) / (band.hi - band.lo || 1)));
}

/** Population standard deviation of usage across the rotation. */
export function usageSpread(usg: number[]): number {
  if (usg.length < 3) return NaN;
  const mean = usg.reduce((a, b) => a + b, 0) / usg.length;
  return Math.sqrt(usg.reduce((a, v) => a + (v - mean) ** 2, 0) / usg.length);
}

/** A player counts as "rotation" for usage-shape purposes at 15+ min/team-game. */
export const ROTATION_MIN_LOAD = 15;
