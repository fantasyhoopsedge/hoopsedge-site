import dynastyRankingsJson from "./dynasty-rankings.json";

export interface DynastyPlayer {
  consensusRank: number;
  player: string;
  team: string;
  position: string;
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
