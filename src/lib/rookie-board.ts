import boardData from "@/data/rookie-board.json";
import poolData from "@/data/prospect-pool.json";

/**
 * Single source of truth for the 2026 Rookie Board.
 *
 * The data lives in src/data/rookie-board.json and is edited through the local
 * authoring tool at /admin/rookie-board (writes are dev-only). The public board
 * (src/app/draft-board) and the admin editor both read these types/helpers so
 * the two never drift.
 */

export const CATS = ["pts", "reb", "ast", "stl", "blk", "fg", "ft", "tpm", "to"] as const;
export type Cat = (typeof CATS)[number];

export const CAT_LABELS: Record<Cat, string> = {
  pts: "PTS", reb: "REB", ast: "AST", stl: "STL", blk: "BLK",
  fg: "FG%", ft: "FT%", tpm: "3PM", to: "TO",
};

export interface BoardTier {
  id: number;
  label: string;
  color: string;
}

export interface BoardPlayer {
  rank: number;
  pick: string;
  name: string;
  school: string;
  pos: string;
  tier: number;
  age: number | null;
  /** ISO date (YYYY-MM-DD). When present, age is computed live from this so it
   * never goes stale. Carried in for players added from the prospect pool. */
  birthdate?: string;
  ht: string;
  pts: string;
  reb: string;
  ast: string;
  stl: string;
  blk: string;
  fg: string;
  ft: string;
  tpm: string;
  to: string;
  verdict: string;
}

export interface RookieBoard {
  version: string;
  label: string;
  updatedAt: string;
  tiers: BoardTier[];
  players: BoardPlayer[];
}

export const ROOKIE_BOARD = boardData as RookieBoard;
export const DRAFT_BOARD = ROOKIE_BOARD.players;
export const BOARD_TIERS = ROOKIE_BOARD.tiers;

/** Max prospects the board can grow to. */
export const MAX_BOARD_SIZE = 80;

/** Tier color + label lookup, sourced from the board's tier table (falls back
 * to a neutral grey for any tier id that hasn't been defined yet). */
export function tierInfo(tier: number, tiers: BoardTier[] = BOARD_TIERS): { color: string; label: string } {
  const found = tiers.find((t) => t.id === tier);
  if (found) return { color: found.color, label: found.label };
  return { color: "#64748b", label: "UNCLASSIFIED_TIER" };
}

/** Pick label from a 1-based rank, e.g. rank 4 -> "1.04", rank 13 -> "1.13". */
export function pickFromRank(rank: number): string {
  return `1.${String(rank).padStart(2, "0")}`;
}

// ── Prospect pool (Matt's top-100 Big Board) ──────────────────────────────
// Source for the "Add player" picker. The editor offers any pool prospect not
// already on the board; removing a player from the board makes them available
// again. Captured from Matt's June 16 2026 board (Luigi Suigo excluded — out of draft).

export interface ProspectStats {
  pts: number | null; reb: number | null; ast: number | null; stl: number | null;
  blk: number | null; to: number | null; fg: number | null; ft: number | null;
  tpt: number | null; ato: number | null; gp: number | null; mpg: number | null;
}
export interface PoolProspect {
  rank: number;
  name: string;
  team: string;
  pos: string;
  birthdate: string | null;
  age: number | null;
  ht: string;
  wt: number | null;
  stats: ProspectStats;
  statline: string;
}

export const PROSPECT_POOL = (poolData as { players: PoolProspect[] }).players;

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
/** Live decimal age from an ISO birthdate, or null. */
export function ageFromBirthdate(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const t = new Date(dob).getTime();
  return Number.isNaN(t) ? null : (Date.now() - t) / MS_PER_YEAR;
}
