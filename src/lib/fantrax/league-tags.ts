import type { FantraxDatasetKey } from "./league";

/**
 * User-set league tags — split out from store.ts so client components (the
 * connector UI) can import the types and the default constant without pulling
 * in store.ts's `fs`/service-role Supabase code, which isn't safe to bundle
 * for the browser. store.ts re-exports these for server-side callers.
 */

/** Fantrax reports "rotisserie"/"headToHead"/"points" — this is the connector's
 *  own coarser tag for which projected-standings view makes sense by default. */
export type LeagueFormat = "roto" | "h2h";
export type LeagueType = "redraft" | "keeper" | "dynasty";
/** Whether roster salaries are real NBA cap numbers, a custom auction/keeper
 *  valuation, or the league doesn't play with salaries at all. Distinct from
 *  `hasSalaries` (auto-detected from Fantrax roster data): Fantrax can't tell
 *  us WHICH kind of number a salary field holds, only that one exists. */
export type SalaryFormat = "real" | "custom" | "none";

/** Fallback tags for leagues saved before format/leagueType/salaryFormat existed. */
export const DEFAULT_LEAGUE_TAGS = {
  format: "roto" as LeagueFormat,
  leagueType: "redraft" as LeagueType,
  salaryFormat: "none" as SalaryFormat,
  defaultDataset: "2027:projection" as FantraxDatasetKey,
};
