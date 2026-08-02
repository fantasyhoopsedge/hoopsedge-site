import { DYNASTY_RANKINGS, normalizePlayerName } from "@/lib/dynasty-rankings";

/**
 * Types + display helpers for the Dynasty Board editor (/admin/dynasty-board).
 *
 * A DynastyBoardPlayer starts life as one row of src/lib/dynasty-rankings.json,
 * ordered by the FBI-HE expert's OWN rank (`expertRanks.fbihe` — not the
 * multi-expert consensus average) — that's the "FHE/FBI Baseline" shown in the
 * tool (`consensusRank`, name kept for historical reasons). As of 2026-08-02
 * this baseline IS the FBI-HE co-branded rank (replacing hashtag, which ended
 * its FHE partnership — see the fbi-partnership memory) — this tool's own
 * published output feeds the next cycle's `fbihe` values, so the baseline is
 * self-referential by design each time it's reseeded. The current v1.1
 * multi-expert consensus average rides along separately as `consensusAvgRank`,
 * shown read-only for reference. Both are enriched at seed time with
 * contract/role/production fields from Supabase (see dynasty-board-seed.ts)
 * so the editor can show real context while the owner drags players into
 * their own order. Enrichment fields are a snapshot taken when the doc was
 * (re)seeded, not a live join — same trade-off the rookie board makes for
 * its star ratings.
 */

export const ROLE_TAGS = ["starter", "rotation", "reserve", "fringe"] as const;
export type RoleTag = (typeof ROLE_TAGS)[number];

export const ROLE_TAG_LABEL: Record<string, string> = {
  starter: "Starter",
  rotation: "Rotation",
  reserve: "Reserve",
  fringe: "Fringe",
  cut: "Off Roster",
};

export interface DynastyBoardPlayer {
  /** 1-based position in the current custom order — recomputed from array index on every save. */
  customRank: number;
  name: string;
  team: string;
  position: string;
  age: number | null;
  /** Frozen "FHE/FBI Baseline" rank at the time this doc was seeded/reset — sourced from the
   * FBI-HE expert's individual rank (falling back to the v1.1 consensus rank for
   * the small slice of players FBI-HE didn't personally rank). null for a player added later
   * from the ecosystem pool — they have no baseline at all. */
  consensusRank: number | null;
  /** The current v1.1 multi-expert consensus AVERAGE rank — dynasty-rankings.json's own
   * `avgRank` (a decimal, e.g. 5.4), the exact figure shown as "AVG RANK" on /dynasty-rankings.
   * Shown read-only alongside the FHE/FBI Baseline for reference. null for a player added later
   * from the ecosystem pool — they aren't part of that consensus. */
  consensusAvgRank: number | null;
  isRookie: boolean;
  isSophomore: boolean;
  /** Pre-formatted contract summary, e.g. "4 yrs · $54.2M · Standard". Empty string if unknown. */
  contract: string;
  contractStatus: string | null;
  /** 1-based rank by per-game Minus1V among players with a projected value, or null if unprojected. */
  minus1vRank: number | null;
  mpg: number | null;
  gp: number | null;
  usg: number | null;
  roleTag: RoleTag | "cut" | null;
  /** Free-text note the editor can attach to a player; not sourced from any feed. */
  note: string;
}

/** The enrichment fields shared by a board row and an ecosystem-pool candidate —
 * everything EXCEPT the board-specific position/baseline (customRank, consensusRank,
 * consensusAvgRank, note). */
export type EcosystemPlayer = Omit<DynastyBoardPlayer, "customRank" | "consensusRank" | "consensusAvgRank" | "note">;

export interface DynastyBoardDoc {
  updatedAt: string;
  players: DynastyBoardPlayer[];
}

export function normalizeName(name: string): string {
  return normalizePlayerName(name);
}

/** Renumbers `customRank` from array position. Call after any reorder/add/remove. */
export function renumber(players: DynastyBoardPlayer[]): DynastyBoardPlayer[] {
  return players.map((p, i) => ({ ...p, customRank: i + 1 }));
}

/** How many spots a player has moved from their FHE/FBI Baseline rank. Positive = moved up.
 * null when the player has no baseline (added later from the ecosystem pool). */
export function moveFromConsensus(p: DynastyBoardPlayer): number | null {
  if (p.consensusRank == null) return null;
  return p.consensusRank - p.customRank;
}

/** How many spots a player has moved from the v1.1 consensus AVERAGE rank (rounded to the
 * nearest whole spot, since avgRank is a decimal). Positive = moved up. Dynamically reflects
 * the current custom order — recompute this on every render, never cache it. null when the
 * player isn't part of the current consensus (added later from the ecosystem pool). */
export function moveFromConsensusAvg(p: DynastyBoardPlayer): number | null {
  if (p.consensusAvgRank == null) return null;
  return Math.round(p.consensusAvgRank) - p.customRank;
}

// Name → { FHE/FBI Baseline rank, v1.1 consensus average rank }, built once from
// the CURRENT dynasty-rankings.json. Keyed by normalizePlayerName() — never a
// persisted rank number (CLAUDE.md).
const BASELINE_BY_NAME = new Map<string, { baseline: number; avg: number }>();
for (const p of DYNASTY_RANKINGS) {
  BASELINE_BY_NAME.set(normalizePlayerName(p.player), {
    baseline: p.expertRanks.fbihe ?? p.consensusRank,
    avg: p.avgRank,
  });
}

/**
 * Refreshes `consensusRank` (FHE/FBI Baseline) and `consensusAvgRank` for every
 * player on a LOADED doc from the current dynasty-rankings.json, rather than
 * trusting whatever was frozen into the saved doc. Two reasons this matters:
 *   1. A doc saved before this pair of fields existed (or before the baseline
 *      switched from consensus-average to FBI-HE's own rank) would otherwise
 *      show stale/missing values forever — this makes them self-heal on load.
 *   2. If dynasty-rankings.json gets refreshed later, an already-added player's
 *      baseline/consensus-avg numbers stay current instead of drifting stale —
 *      the same "prefer a live join over a frozen snapshot" rule the rest of
 *      the app follows for anything sourced from the consensus.
 * Never touches customRank/order/note — only these two reference numbers.
 * A player not found (an ecosystem-pool addition, or dropped from a refresh)
 * correctly resolves to null, same as if they'd never had a baseline.
 */
export function refreshBaselineRanks(players: DynastyBoardPlayer[]): DynastyBoardPlayer[] {
  return players.map((p) => {
    const found = BASELINE_BY_NAME.get(normalizePlayerName(p.name));
    return {
      ...p,
      consensusRank: found?.baseline ?? null,
      consensusAvgRank: found?.avg ?? null,
    };
  });
}

function money(n: number): string {
  return "$" + (n / 1e6).toFixed(1) + "M";
}

/** Builds the display string stored on `contract`, e.g. "4 yrs · $54.2M · Standard". */
export function formatContract(
  status: string | null,
  years: number | null,
  total: number | null,
): string {
  const parts: string[] = [];
  if (years != null) parts.push(`${years} yr${years === 1 ? "" : "s"}`);
  if (total != null) parts.push(money(total));
  if (status) parts.push(status);
  return parts.join(" · ");
}
