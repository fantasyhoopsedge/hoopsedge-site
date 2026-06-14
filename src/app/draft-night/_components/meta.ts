import type { DnMiniGameKey } from "@/types/database";

export interface MiniMeta {
  title: string;
  short: string;
  blurb: string;
  icon: string;
  accent: string;
  /** human-readable score ceiling, shown on cards + results */
  ceiling: string;
}

export const MINI_META: Record<DnMiniGameKey, MiniMeta> = {
  drafted_higher: {
    title: "Drafted Higher",
    short: "5 taps",
    blurb: "Five head-to-heads. Tap whoever lands the higher pick.",
    icon: "⚔️",
    accent: "var(--edge-orange)",
    ceiling: "150 pts",
  },
  first_round: {
    title: "First-Round Locks",
    short: "4 tags",
    blurb: "Tag who cracks the first round (pick ≤ 30) — and who you're fading.",
    icon: "🎯",
    accent: "var(--blueprint)",
    ceiling: "160 pts",
  },
  guard_order: {
    title: "Guard Pecking Order",
    short: "rank 5",
    blurb: "Rank the five guards in the order they come off the board.",
    icon: "🎖️",
    accent: "var(--dynasty-gold)",
    ceiling: "150 pts",
  },
  mock_lottery: {
    title: "The Mock Lottery",
    short: "draft 14",
    blurb: "Build your own lottery — draft and order the top 14. The marquee board.",
    icon: "🏆",
    accent: "var(--dynasty-gold)",
    ceiling: "560 pts",
  },
};
