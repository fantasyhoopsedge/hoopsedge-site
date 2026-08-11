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

/** Fallback games-cap/lineup settings for leagues saved before The Deep Edge's
 *  Settings screen existed — matches the design spec's own defaults. */
export const DEFAULT_GAMES_CAP_SETTINGS = {
  lineupCadence: "daily" as "daily" | "weekly",
  capPos: true,
  capPosN: 82,
  capMatch: false,
  capMatchN: 40,
};

/** Standard roster shape shown in the Settings screen's Roster & positions
 *  grid — used only when the league's own auto-detected positionSlots is
 *  missing a slot the UI always shows (so the grid never has a gap), never
 *  to override real Fantrax data. Minors defaults to 0: it's a real roster
 *  slot type (Fantrax's own standings/roster UI calls it out separately from
 *  Bench/IR) but common only in dynasty/keeper leagues, rare in redraft. */
export const STANDARD_POSITION_SLOTS: Record<string, number> = {
  PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 3, Bench: 3, IR: 2, Minors: 0,
};

/** Reserve-type roster slots — never fill as part of the active/scoring
 *  lineup (see lineup.ts's RESERVE_SLOTS, the source of truth for this same
 *  set). Kept here too since the Settings screen needs it for the roster
 *  summary line's starters/bench split — duplicated deliberately rather than
 *  importing lineup.ts (a server/client boundary concern like league-tags.ts
 *  vs store.ts) since it's a plain string constant, not logic. */
export const RESERVE_SLOT_NAMES = ["bench", "res", "ir", "na", "minors", "min", "taxi", "be"];

/** Fallback for the Salary cap / Keepers & contracts / Waivers & trades
 *  sections — none of these are Fantrax-detectable, so every league (new or
 *  pre-existing) falls back to these until the user sets its own. */
export const DEFAULT_ADVANCED_SETTINGS = {
  capType: "hard" as "soft" | "hard",
  maxContractLength: 4,
  maxContractLengthEnabled: false,
  keeperPolicy: "all",
  rookieDraftRounds: 4,
  taxiSquad: false,
  waiverType: "faab" as "faab" | "rolling",
  faabBudget: 100,
};
