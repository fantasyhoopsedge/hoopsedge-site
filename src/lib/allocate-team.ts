/**
 * Client-side port of models/projections-adjuster/minutes.py's allocate() -- the same
 * tilted-proportional-with-cap-enforcement rescaling that keeps every team's
 * minutes summing to the 241.75 budget, ported here so the /admin/depth-chart tool
 * can show LIVE redistribution as Ash manually overrides one player's GP/MPG,
 * without a round-trip to Python for every keystroke.
 *
 * THE INVARIANT IS THE SAME ONE THIS WHOLE SESSION HAS PROTECTED: locking one
 * player's load (his manual override) and re-running this exact algorithm over
 * everyone else is mathematically identical to how allocate() already handles
 * MPG_CAP enforcement (a capped player gets "fixed", the remainder rescales among
 * the rest) -- a manual override is just another kind of "fixed" input, not a new
 * mechanism.
 *
 * Mirror of minutes.py's TEAM_MINUTE_BUDGET/MPG_CAP/ALPHA -- keep byte-identical.
 */

export const TEAM_MINUTE_BUDGET = 241.75;
export const MPG_CAP = 38.0;
export const ALPHA = 1.0;

export interface AllocateInput {
  key: string;              // unique row identity, e.g. player name
  rawLoad: number;          // "natural" claim on the budget: mpg x availability, pre-rescale
  availability: number;     // games / 82, drives both the MPG_CAP-per-team-game and proj_games
  locked?: number;          // if set (a manual override), this player's LOAD is fixed at this value
}

export interface AllocateResult {
  key: string;
  projLoad: number;
  projMpg: number;
  projGames: number;
}

/** Re-implements minutes.py's allocate() for one team's roster. */
export function allocateTeam(players: AllocateInput[]): AllocateResult[] {
  const n = players.length;
  const load = players.map((p) => Math.max(0, p.locked ?? p.rawLoad));
  const avail = players.map((p) => p.availability);
  const cap = avail.map((a) => MPG_CAP * a);
  const isLocked = players.map((p) => p.locked != null);

  let free = players.map((_, i) => !isLocked[i]);
  const fixed = players.map((p, i) => (isLocked[i] ? p.locked! : 0));

  for (let iter = 0; iter < 20; iter++) {
    const fixedSum = fixed.reduce((a, b) => a + b, 0);
    const remaining = TEAM_MINUTE_BUDGET - fixedSum;
    const tilt = players.map((_, i) => (free[i] ? Math.pow(load[i], ALPHA) : 0));
    const tiltSum = tilt.reduce((a, b) => a + b, 0);
    if (tiltSum <= 0 || remaining <= 0) break;

    const scaled = tilt.map((t) => (remaining * t) / tiltSum);
    const over = players.map((_, i) => free[i] && scaled[i] > cap[i]);
    if (!over.some((x) => x)) {
      for (let i = 0; i < n; i++) if (free[i]) fixed[i] = scaled[i];
      break;
    }
    for (let i = 0; i < n; i++) if (over[i]) fixed[i] = cap[i];
    free = free.map((f, i) => f && !over[i]);
  }

  return players.map((p, i) => ({
    key: p.key,
    projLoad: fixed[i],
    projMpg: avail[i] > 0 ? fixed[i] / avail[i] : 0,
    projGames: avail[i] * 82,
  }));
}

/**
 * Recovers each player's "natural" rawLoad from the model's own already-computed
 * proj_mpg/proj_games (what the bundled JSON already carries) -- the starting point
 * for a live re-allocation, so the tool doesn't need to re-derive base_mpg/role_mult
 * from scratch to know what a player's un-overridden claim on the budget was.
 */
export function impliedRawLoad(projMpg: number, projGames: number): number {
  return projMpg * (projGames / 82);
}
