import { rankTierIndex } from "@/lib/fantrax/lineup";

/**
 * Conditional-format color scale, indexed by rankTierIndex() — the same 6
 * percentile buckets (Elite/Excellent/Good/Average/Fair/Poor) the rank-tier
 * text badges use everywhere in Deep Edge. TIER_BG is a translucent
 * background (table cells, badge pills); TIER_FILL is the solid equivalent
 * (strength bar fill, badge/label text). Shared by Power Rankings and
 * Category Edge so the two screens' tiering reads as one system.
 */
const TIER_BG = [
  "rgba(22,160,106,0.55)", "rgba(22,160,106,0.32)", "rgba(22,160,106,0.14)",
  "rgba(219,43,57,0.14)", "rgba(219,43,57,0.32)", "rgba(219,43,57,0.55)",
];
const TIER_FILL = ["#16a06a", "#3fb989", "#7cc9a8", "#e28089", "#e2495a", "#db2b39"];

export function tierBg(rank: number, of: number): string {
  return TIER_BG[rankTierIndex(rank, of)];
}
export function tierFill(rank: number, of: number): string {
  return TIER_FILL[rankTierIndex(rank, of)];
}
