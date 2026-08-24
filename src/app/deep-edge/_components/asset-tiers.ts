import type { ContractClass } from "@/lib/value/real-salary-model";

/**
 * Trade Edge's asset-card color coding (Ash, 2026-08-23) — a fixed priority
 * order, checked top to bottom: an incoming rookie/2026 pick always reads
 * gold even if it's also (trivially) on a rookie-scale deal; a rookie-scale
 * CONTRACT tag is for the 3rd/4th-year player still on that deal, not for
 * the rookie season itself.
 */
export type AssetTier = "rookie" | "sophomore" | "futureFirst" | "futureSecond" | "rookieScale" | "veteran";

export const ASSET_TIER_LABEL: Record<AssetTier, string> = {
  rookie: "ROOKIE",
  sophomore: "SOPHOMORE",
  futureFirst: "FUTURE 1ST",
  futureSecond: "FUTURE 2ND",
  rookieScale: "ROOKIE SCALE",
  veteran: "VETERAN",
};

/** bg = card fill, ink = text color chosen for contrast against that fill. */
export const ASSET_TIER_COLOR: Record<AssetTier, { bg: string; ink: string; inkSoft: string }> = {
  rookie: { bg: "#D9A521", ink: "#241B04", inkSoft: "rgba(36,27,4,0.68)" },
  sophomore: { bg: "#2F6FB0", ink: "#FFFFFF", inkSoft: "rgba(255,255,255,0.72)" },
  futureFirst: { bg: "#B23A12", ink: "#FFFFFF", inkSoft: "rgba(255,255,255,0.72)" },
  futureSecond: { bg: "#FB8659", ink: "#33150A", inkSoft: "rgba(51,21,10,0.68)" },
  rookieScale: { bg: "#1F9D6B", ink: "#FFFFFF", inkSoft: "rgba(255,255,255,0.72)" },
  veteran: { bg: "#9AA3AE", ink: "#1B1D21", inkSoft: "rgba(27,29,33,0.65)" },
};

/**
 * A rostered/free-agent player's card tier. `isRookieScaleContract` should
 * come from `contractClassOf(nba_roster.contract_status) === "rookie-scale"`
 * (roster-edge.ts's ContractInfo.contractClass) — KNOWN GAP: as of 2026-08-23
 * nba_roster tags Victor Wembanyama "Standard" for the 2026-27 season, when
 * his real rookie-scale deal doesn't convert until the 27-28 extension kicks
 * in — so he (and anyone else this same data gap affects) reads VETERAN
 * silver here instead of ROOKIE SCALE green until the roster CSV is
 * corrected. That's a roster-data accuracy issue, not something this
 * classifier can detect or special-case by name.
 */
export function playerAssetTier(opts: {
  isRookie: boolean;
  isSophomore: boolean;
  isRookieScaleContract: boolean;
}): AssetTier {
  if (opts.isRookie) return "rookie";
  if (opts.isSophomore) return "sophomore";
  if (opts.isRookieScaleContract) return "rookieScale";
  return "veteran";
}

/** A draft-pick card's tier — any pick in the imminent draft class (this
 *  year's `seasonYear`) reads gold regardless of round; everything further
 *  out splits by round only. */
export function pickAssetTier(pick: { year: number; round: number }, seasonYear: number): AssetTier {
  if (pick.year <= seasonYear) return "rookie";
  return pick.round === 1 ? "futureFirst" : "futureSecond";
}

export type { ContractClass };
