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

/**
 * A custom-salary league's own contract-label prefix scheme — Fantrax gives
 * commissioners a free-text contract-label field, and what a prefix means
 * (if anything) is a house rule written into that league's own constitution,
 * not a Fantrax-wide convention (confirmed against a real one, 2026-08-23:
 * Old But Gold's own "Designated Code" section defines F/R/J/E/FA/WW, with
 * "F24-25 -> contract will end on season 2024-2025" establishing that the
 * label's trailing year range is always the contract's FINAL season, and a
 * separate rule fixing E ("extended contract for the acquired FA and WW
 * players") at exactly two years with "automatic drop after that two years"
 * — no recontract path at all). Two houses can use the same letter for
 * opposite meanings, so this is opt-in and per-league, not a global decoder.
 */
export type ContractRuleKind =
  /** No special treatment — the default for any unmatched prefix (today's
   *  behavior, unchanged). */
  | "standard"
  /** A team-controlled, league-fixed-price rookie deal — deserves the same
   *  extra cheapness credit the site-wide Real Salary model gives a real
   *  rookie-scale contract (see real-salary-model.ts's ContractClass /
   *  WeightPreset.rookieScaleAdjustment), which this per-league blend
   *  otherwise can't apply since Fantrax exposes no contract-status field. */
  | "rookieScale"
  /** A contract with a known, FIXED maximum length and NO renewal path —
   *  once it expires the player is gone, full stop. A trade asset's dynasty
   *  value assumes open-ended team control; capping that control should
   *  discount the asset, most severely as the fixed expiry approaches. */
  | "expiring";

export interface ContractRule {
  /** Matched case-insensitively against the leading letters of the roster
   *  spot's own contract label (e.g. "E" matches "E26-27"). */
  prefix: string;
  kind: ContractRuleKind;
  /** Required for "expiring" only — the contract type's own maximum total
   *  length in years (Old But Gold's E-contract: 2), used to scale the
   *  discount by how much of that fixed horizon remains. */
  maxYears?: number;
}

/** A league's own rookie-scale salary-by-draft-position table (e.g. Old But
 *  Gold's constitution: pick 1 -> $14 down to picks 31-60 -> $1) — like
 *  ContractRule, a house rule with no Fantrax-wide convention, so this is
 *  opt-in and per-league. `minPick`/`maxPick` are OVERALL pick numbers
 *  (1-based, across every round), not per-round. Empty/absent = custom
 *  valuations has no real salary figure to attach to a synthesized pick
 *  player and falls back to leaving it unset. */
export interface RookieSalaryTier {
  minPick: number;
  maxPick: number;
  salary: number;
}

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

/** Extra Fantrax-style categories the Settings screen's "Add category"
 *  picker offers, and Roster Edge's own stat picker matches (Ash, 2026-08-12:
 *  "add the additional custom stats to toggle on/off to match with the
 *  league settings page") — one shared list so the two pickers can't drift.
 *  Informational only: FHE's engine has no z-score model for any of these
 *  (see SavedLeagueSettings.additionalCategories in store.ts), and several
 *  (DD/TD/TREB/PF/TF/OREB/DREB) have no real data source anywhere in FHE's
 *  stat pipeline at all — season_player_stats tracks only the 9 roto
 *  categories plus usg_pct, nothing else. Roster Edge disables exactly those
 *  options rather than silently dropping them from the list, so the two
 *  pickers still read as the same catalog. */
export const EXTRA_CATEGORIES: { code: string; label: string }[] = [
  { code: "DD", label: "Double-doubles (DD)" },
  { code: "TD", label: "Triple-doubles (TD)" },
  { code: "A/TO", label: "Assist / turnover ratio (A/TO)" },
  { code: "MPG", label: "Minutes per game (MPG)" },
  { code: "TREB", label: "Total rebounds (TREB)" },
  { code: "FGM", label: "Field goals made (FGM)" },
  { code: "FTM", label: "Free throws made (FTM)" },
  { code: "PF", label: "Personal fouls (PF)" },
  { code: "TF", label: "Technical fouls (TF)" },
  { code: "GP", label: "Games played (GP)" },
  { code: "OREB", label: "Offensive rebounds (OREB)" },
  { code: "DREB", label: "Defensive rebounds (DREB)" },
];

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
  contractRules: [] as ContractRule[],
  rookieSalaryScale: [] as RookieSalaryTier[],
  useCustomValuations: false,
  customValuationsPromptedAt: null as string | null,
  useGeneratedPickValues: false,
  // Matches the site-wide Real Salary Rankings "Balanced" preset (30%
  // efficiency / 70% consensus) — see SavedLeagueSettings.realSalaryEfficiencyWeight.
  realSalaryEfficiencyWeight: 0.30,
};
