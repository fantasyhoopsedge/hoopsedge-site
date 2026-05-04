import dynastyRankingsJson from "./dynasty-rankings.json";

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
    jason?: number;
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
