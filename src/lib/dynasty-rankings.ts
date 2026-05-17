import dynastyRankingsJson from "./dynasty-rankings.json";
import nbaPlayerIds from "./nba-player-ids.json";

type NbaPlayerEntry = { id: string; name: string; team: string | null; position: string | null };
const NBA_PLAYER_IDS = nbaPlayerIds as Record<string, NbaPlayerEntry>;

function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,'’]/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Returns the NBA Stats player id for a given display name, or null. */
export function nbaIdFor(playerName: string): string | null {
  const key = normalizePlayerName(playerName);
  return NBA_PLAYER_IDS[key]?.id ?? null;
}

/** Returns the cdn.nba.com headshot URL for a display name, or null if no id mapping. */
export function nbaHeadshotUrl(
  playerName: string,
  size: "260x190" | "1040x760" = "260x190",
): string | null {
  const id = nbaIdFor(playerName);
  return id ? `https://cdn.nba.com/headshots/nba/latest/${size}/${id}.png` : null;
}

/** Slugifies a name to match prospect image filenames in /public/images/prospects/. */
function prospectSlug(playerName: string): string {
  return playerName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,'’]/g, "")
    .replace(/\s+/g, "-");
}

/** Returns the local prospect headshot URL (jpg in /public/images/prospects/). */
export function prospectHeadshotUrl(playerName: string): string {
  return `/images/prospects/${prospectSlug(playerName)}.jpg`;
}

/**
 * Returns the best headshot URL for a player:
 *  - 2026 Rookies → local /images/prospects/{slug}.jpg
 *  - Otherwise → cdn.nba.com headshot if id is mapped, else null
 */
export function playerHeadshotUrl(player: { player: string; team: string }): string | null {
  if (player.team === "2026 Rookie") return prospectHeadshotUrl(player.player);
  return nbaHeadshotUrl(player.player);
}

export type DynastyPosition = "G" | "F" | "C" | "G/F" | "F/C";

export interface DynastyPlayer {
  consensusRank: number;
  player: string;
  team: string;
  position: DynastyPosition;
  age: number | null;
  expertRanks: {
    matt?: number;
    dizzle?: number;
    angle?: number;
    mball?: number;
    hashtag?: number;
    noah?: number;
  };
  avgRank: number;
  rankedByCount: number;
  tier: number;
  trend: string;
}

export const DYNASTY_RANKINGS = dynastyRankingsJson as DynastyPlayer[];

/** Rank used for filters / rank column: consensus, or expert rank, or null if unranked by that expert. */
export function activeRankForView(player: DynastyPlayer, expertKey: string): number | null {
  if (!expertKey) return player.consensusRank;
  const v = player.expertRanks[expertKey as keyof DynastyPlayer["expertRanks"]];
  if (v === undefined || v === null) return null;
  return v;
}
