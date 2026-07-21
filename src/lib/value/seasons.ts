/**
 * The seasonal-rankings datasets — one source of truth shared by the build
 * script (scripts/build-seasonal-values.ts) and the page (/seasonal-rankings).
 *
 * Season N = the (N-1)/N NBA season in hoopR terms (2026 = 2025-26). Real
 * (non-projection) datasets require game logs, so 2026-27 (season 2027) has
 * only the "projection" entry below until it is actually played. Order here
 * is the order the UI selector shows.
 */

export type SeasonType = "regular" | "postseason" | "summer" | "projection";

export type SeasonDataset = {
  season: number;
  type: SeasonType;
  label: string;
  /** Baseline pool size to default to on first load. Falls back to CANONICAL_SIZE when absent. */
  defaultSize?: number;
};

export const SEASON_DATASETS: readonly SeasonDataset[] = [
  { season: 2026, type: "regular", label: "2025-26" },
  { season: 2025, type: "regular", label: "2024-25" },
  { season: 2024, type: "regular", label: "2023-24" },
  { season: 2026, type: "postseason", label: "Playoffs 26" },
  { season: 2025, type: "postseason", label: "Playoffs 25" },
  { season: 2024, type: "postseason", label: "Playoffs 24" },
  // Vegas Summer League — standalone dataset, own (small) baseline pool. Values
  // are NOT comparable to regular-season CatV (exhibition ball, tiny samples).
  { season: 2026, type: "summer", label: "Summer League 2026", defaultSize: 250 },
  { season: 2025, type: "summer", label: "Summer League 2025", defaultSize: 250 },
  { season: 2024, type: "summer", label: "Summer League 2024", defaultSize: 250 },
  { season: 2023, type: "summer", label: "Summer League 2023", defaultSize: 250 },
  { season: 2022, type: "summer", label: "Summer League 2022", defaultSize: 250 },
  // The projections model (models/, output/season-projections-2026-27.json) —
  // built from projected per-game rates, not real game logs, so it has no
  // validation-gate reference and is intentionally last in the selector rather
  // than the default. Built by scripts/build-projection-values.ts, not the
  // real-season build.
  { season: 2027, type: "projection", label: "2026-27 Projections" },
] as const;

/** Default dataset shown on first load. */
export const DEFAULT_DATASET: SeasonDataset = SEASON_DATASETS[0]; // 2025-26 regular

/** Dataset the build's validation gate is calibrated against. */
export const GATE_DATASET = { season: 2026, type: "regular" as SeasonType };

/** Stable key for a (season, season_type) pair, used in URLs + lookups. */
export const datasetKey = (season: number, type: string): string => `${season}:${type}`;

/** Resolve a key (e.g. from a URL param) back to a dataset, or the default. */
export function datasetFromKey(key: string | null | undefined): SeasonDataset {
  if (!key) return DEFAULT_DATASET;
  return SEASON_DATASETS.find((d) => datasetKey(d.season, d.type) === key) ?? DEFAULT_DATASET;
}
