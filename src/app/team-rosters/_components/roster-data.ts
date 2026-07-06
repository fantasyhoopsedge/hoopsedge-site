/**
 * Demo dataset for the NBA Team Rosters page, ported from the Claude Design
 * prototype (Thunder Roster.dc.html). Only the OKC Thunder roster is seeded —
 * the team switcher is cosmetic until this is wired to the live nba_players /
 * nba_contracts tables for all 30 teams (see src/app/api/nba/rosters/route.ts).
 */
import type { Tone } from "./trend-insight";

export type PerGameStats = {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tpm: number;
  fgp: number;
  ftp: number;
  to: number;
};

export type PlayerTag = "rookie" | "soph" | null;

export type Player = {
  id: string;
  name: string;
  team: string;
  jersey: number;
  /** Display position from the dynasty-consensus master source, e.g. "G", "F/C". */
  pos: string;
  group: "G" | "F" | "C";
  age: number;
  gp: number;
  mpg: number;
  tag: PlayerTag;
  salary: number;
  thru: string;
  /** Full contract length + total value (nba_roster.contract_years / contract_total). */
  contractYears: number | null;
  contractTotal: number | null;
  /** Real per-year cap hits, index 0 = 2026-27 (Year 1) → 2029-30. null = no contracted salary that year. */
  salaryYears: (number | null)[];
  /** Comma-separated seasons whose salary is an even-split estimate (e.g. "2027-28, 2028-29"). */
  estimatedYears: string | null;
  /** Dynasty consensus value (arbitrary points scale, higher is better). */
  dynasty: number;
  change: string;
  dir: "up" | "down" | "flat";
  /** Dynasty consensus rank, 1 = best. */
  consensus: number;
  /** Dynasty consensus tier (1 = best), from dynasty-rankings.json. null when unranked. */
  tier: number | null;
  draft: { year: number; pick: number; tier: number } | null;
  pg: PerGameStats;
  /**
   * Real 9-cat values from season_player_values (baseline-pool z-scores), in
   * CATS order: [pts, reb, ast, stl, blk, 3pm, fg%, ft%, to]. Empty when the
   * player has no 2025-26 season (rookies) → the UI falls back to a raw z-score.
   */
  catVals: number[];
  /** Real 2024-25 per-game line from season_player_stats. null = no prior-season row (rookies, etc). */
  priorPg: PerGameStats | null;
  /** Real 2024-25 9-cat values (same CATS order as catVals). Empty when priorPg is null. */
  priorCatVals: number[];
  /** 2024-25 games played, 0 = no prior season on record. */
  priorGp: number;
  nineCat: number; // precomputed 9-cat value (season_player_values.value)
  minus1: number; // precomputed Minus1V (season_player_values.minus1v)
  eightCat: number; // 8-cat, turnovers removed: (value*9 - v_to)/8
  /** Pool-wide rank (1 = best) across ALL players at the league size, per metric. null = unranked (rookie/no season). */
  rankNineCat: number | null;
  rankMinus1: number | null;
  rankEightCat: number | null;
  /**
   * Blended consensus-vs-real-value trend tone per metric (see trend-insight.ts),
   * precomputed server-side from output/player-trends/{season}-{type}.json.
   * null when there's no trend history yet (rookies) or no consensus rank.
   */
  toneNineCat: Tone | null;
  toneMinus1: Tone | null;
  toneEightCat: Tone | null;
  /** True when catVals/pg are the rookie-board projection, not real 2025-26 stats. */
  projected: boolean;
};

export type Team = { abbr: string; name: string };

export const TEAMS: Team[] = [
  { abbr: "ATL", name: "Atlanta Hawks" },
  { abbr: "BOS", name: "Boston Celtics" },
  { abbr: "BKN", name: "Brooklyn Nets" },
  { abbr: "CHA", name: "Charlotte Hornets" },
  { abbr: "CHI", name: "Chicago Bulls" },
  { abbr: "CLE", name: "Cleveland Cavaliers" },
  { abbr: "DAL", name: "Dallas Mavericks" },
  { abbr: "DEN", name: "Denver Nuggets" },
  { abbr: "DET", name: "Detroit Pistons" },
  { abbr: "GSW", name: "Golden State Warriors" },
  { abbr: "HOU", name: "Houston Rockets" },
  { abbr: "IND", name: "Indiana Pacers" },
  { abbr: "LAC", name: "LA Clippers" },
  { abbr: "LAL", name: "Los Angeles Lakers" },
  { abbr: "MEM", name: "Memphis Grizzlies" },
  { abbr: "MIA", name: "Miami Heat" },
  { abbr: "MIL", name: "Milwaukee Bucks" },
  { abbr: "MIN", name: "Minnesota Timberwolves" },
  { abbr: "NOP", name: "New Orleans Pelicans" },
  { abbr: "NYK", name: "New York Knicks" },
  { abbr: "OKC", name: "Oklahoma City Thunder" },
  { abbr: "ORL", name: "Orlando Magic" },
  { abbr: "PHI", name: "Philadelphia 76ers" },
  { abbr: "PHX", name: "Phoenix Suns" },
  { abbr: "POR", name: "Portland Trail Blazers" },
  { abbr: "SAC", name: "Sacramento Kings" },
  { abbr: "SAS", name: "San Antonio Spurs" },
  { abbr: "TOR", name: "Toronto Raptors" },
  { abbr: "UTA", name: "Utah Jazz" },
  { abbr: "WAS", name: "Washington Wizards" },
];

// Team wordmark/logo files, seeded from public/images/nba team images/ (filenames
// keep their original "imgi_<n>_<abbr>" export names, not the standard 3-letter codes).
export const TEAM_LOGO: Record<string, string> = {
  ATL: "imgi_478_atl.png",
  BOS: "imgi_458_bos.png",
  BKN: "imgi_459_bkn.png",
  CHA: "imgi_479_cha.png",
  CHI: "imgi_463_chi.png",
  CLE: "imgi_464_cle.png",
  DAL: "imgi_483_dal.png",
  DEN: "imgi_468_den.png",
  DET: "imgi_465_det.png",
  GSW: "imgi_473_gs.png",
  HOU: "imgi_484_hou.png",
  IND: "imgi_466_ind.png",
  LAC: "imgi_474_lac.png",
  LAL: "imgi_475_lal.png",
  MEM: "imgi_485_mem.png",
  MIA: "imgi_480_mia.png",
  MIL: "imgi_467_mil.png",
  MIN: "imgi_469_min.png",
  NOP: "imgi_486_no.png",
  NYK: "imgi_460_ny.png",
  OKC: "imgi_470_okc.png",
  ORL: "imgi_481_orl.png",
  PHI: "imgi_461_phi.png",
  PHX: "imgi_476_phx.png",
  POR: "imgi_471_por.png",
  SAC: "imgi_477_sac.png",
  SAS: "imgi_487_sa.png",
  TOR: "imgi_462_tor.png",
  UTA: "imgi_472_utah.png",
  WAS: "imgi_482_wsh.png",
};

// Roster/player data is fetched live per team from nba_roster + season_player_stats
// + dynasty-rankings.json — see roster-live-data.ts. (The Claude Design prototype's
// hardcoded demo array lived here; removed once the page went live.)

export type Cat = {
  key: keyof PerGameStats;
  label: string;
  lo: number;
  hi: number;
  mean: number;
  std: number;
  invert?: boolean;
};

// 9-cat config (lo/hi bound the stat-set chip diverging scale; mean/std z-score the field).
export const CATS: Cat[] = [
  { key: "pts", label: "PTS", lo: 3, hi: 32, mean: 14.5, std: 7.2 },
  { key: "reb", label: "REB", lo: 2, hi: 13, mean: 5.4, std: 2.6 },
  { key: "ast", label: "AST", lo: 1, hi: 8, mean: 3.4, std: 2.1 },
  { key: "stl", label: "STL", lo: 0.3, hi: 1.9, mean: 0.85, std: 0.4 },
  { key: "blk", label: "BLK", lo: 0.2, hi: 2.5, mean: 0.6, std: 0.55 },
  { key: "tpm", label: "3PM", lo: 0.3, hi: 3, mean: 1.5, std: 0.8 },
  { key: "fgp", label: "FG%", lo: 0.42, hi: 0.60, mean: 0.47, std: 0.045 },
  { key: "ftp", label: "FT%", lo: 0.68, hi: 0.92, mean: 0.78, std: 0.075 },
  { key: "to", label: "TO", lo: 0.6, hi: 2.6, mean: 1.5, std: 0.7, invert: true },
];

// Stat-set chips on the roster grid/list rows: fixed display order, independent of CATS order.
export const STATSET_DEFS: { key: keyof PerGameStats; label: string }[] = [
  { key: "fgp", label: "FG%" },
  { key: "pts", label: "PTS" },
  { key: "tpm", label: "3PT" },
  { key: "reb", label: "REB" },
  { key: "ast", label: "AST" },
  { key: "stl", label: "STL" },
  { key: "blk", label: "BLK" },
  { key: "ftp", label: "FT%" },
  { key: "to", label: "TO" },
];

// Diverging 5-tier scale for stat-set chips: elite green -> neutral -> poor red.
export const STATSET_COLORS: Record<number, string> = {
  5: "#12a150",
  4: "#62a046",
  3: "var(--rt-muted)",
  2: "#dd7a2b",
  1: "#cf2230",
};

// Class badges: gold rookies, periwinkle sophomores; theme-aware.
export const TAG_THEME: Record<
  "rookie" | "soph",
  { label: string; lightText: string; darkText: string; lightBorder: string; darkBorder: string; darkBg: string }
> = {
  rookie: {
    label: "Rookie",
    lightText: "#a8730a",
    darkText: "#f0bb4a",
    lightBorder: "rgba(168,115,10,0.34)",
    darkBorder: "rgba(240,165,0,0.55)",
    darkBg: "rgba(240,165,0,0.08)",
  },
  soph: {
    label: "Sophomore",
    lightText: "#4c56c0",
    darkText: "#9aa6ef",
    lightBorder: "rgba(76,86,192,0.32)",
    darkBorder: "rgba(154,166,239,0.52)",
    darkBg: "rgba(154,166,239,0.09)",
  },
};

// Dynasty consensus tier name + color, mirroring /dynasty-rankings (tier-view.tsx
// TIER_META + rankings-table.tsx TIER_COLORS). Kept in sync by hand — same 8 tiers.
export const DYNASTY_TIER_META: Record<number, { name: string; color: string }> = {
  1: { name: "Fantasy-Altering Juggernauts", color: "#F0C040" },
  2: { name: "Dynasty Cornerstones", color: "#22c55e" },
  3: { name: "Proven Contributors", color: "#3b82f6" },
  4: { name: "Depth Tilters", color: "#9b5de5" },
  5: { name: "Developmental Assets", color: "#FF6B2B" },
  6: { name: "Speculative Holds", color: "#f72585" },
  7: { name: "Deep League Filler", color: "#00c8e0" },
  8: { name: "Lottery Tickets", color: "#64748b" },
};

export type SortKey = "dynasty" | "minus1" | "ninecat" | "eightcat" | "salary" | "proj";
export type FvMetric = "minus1" | "ninecat" | "eightcat";
export type SeasonMode = "cur" | "prior" | "proj";
