import { LEAGUE_SIZES } from "@/lib/value/compute-values";
import { toDisplayName, type FxDraftResults, type FxLeagueInfo, type FxPlayerIdMap, type FxStandingsRow, type FxTeamRosters } from "./api";

/**
 * Turns the four raw FXEA payloads into one normalized league snapshot the rest
 * of FHE can reason about. Everything Fantrax-shaped stops here: analyze.ts and
 * the UI only ever see the types below.
 */

// ── categories ──────────────────────────────────────────────────────────────

/** The nine categories the FHE value engine models, in its canonical order. */
export const FHE_CATEGORIES = ["PTS", "FG3", "REB", "AST", "STL", "BLK", "FG", "FT", "TO"] as const;
export type FheCategory = (typeof FHE_CATEGORIES)[number];

/** Per-category z-score column in season_player_values, by FHE category. */
export const CATEGORY_VALUE_COLUMN: Record<FheCategory, string> = {
  PTS: "v_pts", FG3: "v_fg3", REB: "v_reb", AST: "v_ast", STL: "v_stl",
  BLK: "v_blk", FG: "v_fg", FT: "v_ft", TO: "v_to",
};

export const CATEGORY_LABEL: Record<FheCategory, string> = {
  PTS: "PTS", FG3: "3PM", REB: "REB", AST: "AST", STL: "STL",
  BLK: "BLK", FG: "FG%", FT: "FT%", TO: "TO",
};

/**
 * Fantrax category shortName → FHE category. Fantrax exposes far more
 * categories than the engine models (FGM/FTA/DD/TD/MIN/…); anything absent from
 * this map is reported as unmodelled rather than silently dropped, so a league
 * scoring double-doubles knows its analysis is partial.
 *
 * Note TO: v_to is already sign-flipped by compute-values.ts (fewer turnovers =>
 * positive), which matches Fantrax treating turnovers as a category you want to
 * win by having the fewest. No extra negation anywhere.
 */
const FANTRAX_CATEGORY_MAP: Record<string, FheCategory> = {
  PTS: "PTS",
  "3PTM": "FG3", "3PM": "FG3", TPM: "FG3",
  REB: "REB", TREB: "REB",
  AST: "AST",
  ST: "STL", STL: "STL",
  BLK: "BLK", BLKS: "BLK",
  "FG%": "FG", FGP: "FG",
  "FT%": "FT", FTP: "FT",
  TO: "TO", TOV: "TO", TRN: "TO",
};

export interface LeagueCategories {
  /** Scored categories the engine models, in FHE_CATEGORIES order. */
  scored: FheCategory[];
  /** Fantrax categories with no FHE equivalent (e.g. "DD", "MIN"). */
  unmodelled: string[];
}

/**
 * `scoringSystem.scoringCategories` populates for BOTH categories and points
 * leagues (a points league's entries look like `{ BLK: { Default: "points3" } }`
 * — verified live 2026-08-09), so this must only ever be called for a
 * categories-mode league. `buildLeague()` enforces that; a points league gets
 * `parsePointsFormula()` instead.
 */
function parseCategories(info: FxLeagueInfo): LeagueCategories {
  const codes = new Set<string>();
  const byGroup = info.scoringSystem?.scoringCategories ?? {};
  for (const group of Object.values(byGroup)) for (const code of Object.keys(group)) codes.add(code);
  // Fallback: some league types only populate the settings array.
  if (codes.size === 0) {
    for (const setting of info.scoringSystem?.scoringCategorySettings ?? []) {
      for (const cfg of setting.configs ?? []) {
        if (cfg.scoringCategory?.shortName) codes.add(cfg.scoringCategory.shortName);
      }
    }
  }

  const scored = new Set<FheCategory>();
  const unmodelled: string[] = [];
  for (const code of codes) {
    const mapped = FANTRAX_CATEGORY_MAP[code.toUpperCase()];
    if (mapped) scored.add(mapped);
    else unmodelled.push(code);
  }
  return {
    scored: FHE_CATEGORIES.filter((c) => scored.has(c)),
    unmodelled: unmodelled.sort(),
  };
}

// ── points-league formula ───────────────────────────────────────────────────

/**
 * Raw counting stats a points league can weight directly — a superset of
 * FheCategory, since points formulas weight makes/attempts as their own
 * stats (never a shooting percentage the way the categories/z-score world
 * does) and never fold turnovers' sign the way v_to does.
 */
export const POINTS_STATS = ["PTS", "FG3M", "REB", "AST", "STL", "BLK", "TOV", "FGM", "FGA", "FTM", "FTA"] as const;
export type PointsStat = (typeof POINTS_STATS)[number];

/** Fantrax category shortName → PointsStat. Deliberately narrow: an unmapped
 *  code (DD, TD, MIN, …) falls through to `unmodelled` rather than guessing. */
const POINTS_STAT_MAP: Record<string, PointsStat> = {
  PTS: "PTS",
  "3PTM": "FG3M", "3PM": "FG3M", TPM: "FG3M",
  REB: "REB", TREB: "REB",
  AST: "AST",
  ST: "STL", STL: "STL",
  BLK: "BLK", BLKS: "BLK",
  TO: "TOV", TOV: "TOV", TRN: "TOV",
  FGM: "FGM", FGA: "FGA", FTM: "FTM", FTA: "FTA",
};

export interface LeaguePointsFormula {
  /** Points awarded per unit of each raw stat, e.g. { AST: 1.5, TOV: -1 }. */
  weights: Partial<Record<PointsStat, number>>;
  /** Fantrax categories this league weights that FHE has no stat for. */
  unmodelled: string[];
}

/**
 * Only ever called for a points-mode league (see buildLeague()). Reads the
 * numeric `configs[].points` field — NOT the `scoringCategories` string
 * encoding (`"points1.5"`), which carries the same data less conveniently.
 */
function parsePointsFormula(info: FxLeagueInfo): LeaguePointsFormula {
  const weights: Partial<Record<PointsStat, number>> = {};
  const unmodelled: string[] = [];
  for (const setting of info.scoringSystem?.scoringCategorySettings ?? []) {
    for (const cfg of setting.configs ?? []) {
      const code = cfg.scoringCategory?.shortName;
      const pts = cfg.points;
      if (!code || typeof pts !== "number") continue;
      const mapped = POINTS_STAT_MAP[code.toUpperCase()];
      if (mapped) weights[mapped] = pts;
      else unmodelled.push(code);
    }
  }
  return { weights, unmodelled: unmodelled.sort() };
}

// ── normalized league ───────────────────────────────────────────────────────

export interface LeagueTeam {
  id: string;
  name: string;
  division: string | null;
  rank: number | null;
  record: string | null;
}

export interface LeagueRosterSpot {
  /** Fantrax player id. */
  fantraxId: string;
  /** "First Last", already reordered out of Fantrax's "Last, First". */
  name: string;
  /** Roster slot the player currently occupies (PG/SG/…/Flx/Res). */
  slot: string;
  /** League-eligible positions, e.g. ["PG","Flx"]. */
  eligible: string[];
  /** NBA team per Fantrax. May be "(N/A)" for unsigned players. */
  nbaTeam: string;
  status: string;
  /** In-league contract, salary-cap leagues only. */
  salary: number | null;
  /** Fantrax's own contract-year label ("28-29", "R-2nd", "E-1st", …) — only
   *  present in leagues that track contract years. Distinct from the FHE
   *  real-world ContractInfo (resolve.ts's getContractByFheId): this is the
   *  league's own value, real or custom, used verbatim for salaryFormat
   *  "custom" leagues (see roster-table.tsx). */
  contract: string | null;
}

export interface LeagueRoster {
  teamId: string;
  teamName: string;
  players: LeagueRosterSpot[];
}

export interface FantraxLeague {
  leagueId: string;
  name: string;
  seasonYear: number;
  /** Fantrax's own scoring label, e.g. "rotisserie". Note this does NOT
   *  distinguish rotisserie from head-to-head-categories — both report
   *  "rotisserie" (verified live against real leagues of each, 2026-08-09).
   *  It only reliably distinguishes categories scoring from points scoring. */
  scoringType: string;
  /** "points" only when Fantrax reports scoringType "points"; everything else
   *  (rotisserie AND head-to-head-categories) is "categories". */
  scoringMode: "categories" | "points";
  categories: LeagueCategories;
  /** Populated only when scoringMode === "points". */
  pointsFormula: LeaguePointsFormula | null;
  teamCount: number;
  maxTotalPlayers: number;
  maxActivePlayers: number;
  /** Starting-lineup slots, e.g. { PG: 1, SG: 1, …, Flx: 1 }. */
  positionSlots: Record<string, number>;
  /** True when any roster carries a salary — the league plays with a cap. */
  hasSalaries: boolean;
  teams: LeagueTeam[];
  rosters: LeagueRoster[];
  /** Every player in the league pool that nobody owns, richest data first. */
  freeAgents: LeagueRosterSpot[];
  draft: { date: string | null; picksMade: number; totalPicks: number } | null;
  /**
   * Baseline pool size to value this league against: rostered capacity
   * (teams × roster spots) snapped into LEAGUE_SIZES. A 30-team, 20-man league
   * wants a 600-player baseline but the engine's largest precomputed pool is
   * 450, so it clamps — documented rather than hidden because it means very
   * deep leagues are valued against a slightly shallower replacement level.
   */
  poolSize: number;
  /** True when the ideal pool was larger than any precomputed size. */
  poolClamped: boolean;
  fetchedAt: string;
}

/** Snap rostered capacity into the precomputed LEAGUE_SIZES ladder. */
export function resolvePoolSize(teamCount: number, maxTotalPlayers: number): { poolSize: number; clamped: boolean } {
  const ideal = teamCount * maxTotalPlayers;
  const sizes = [...LEAGUE_SIZES].sort((a, b) => a - b);
  const smallest = sizes[0];
  const largest = sizes[sizes.length - 1];
  if (ideal >= largest) return { poolSize: largest, clamped: ideal > largest };
  if (ideal <= smallest) return { poolSize: smallest, clamped: false };
  // Nearest size, ties going deeper (a slightly deeper pool is the safer
  // default: it never invents a scarcity the league doesn't have).
  let best = sizes[0];
  for (const size of sizes) {
    if (Math.abs(size - ideal) <= Math.abs(best - ideal)) best = size;
  }
  return { poolSize: best, clamped: false };
}

/** playerInfo.status vocabulary: "T" = taken (on a roster), "FA" = free agent,
 *  "WW" = on waivers. Both of the latter are claimable, so both count as
 *  available for the waiver-wire board. */
const AVAILABLE_STATUSES = new Set(["FA", "WW"]);

export function buildLeague(
  leagueId: string,
  info: FxLeagueInfo,
  rosters: FxTeamRosters,
  standings: FxStandingsRow[],
  draft: FxDraftResults | null,
  playerIds: FxPlayerIdMap,
): FantraxLeague {
  const playerInfo = info.playerInfo ?? {};
  const standingsById = new Map(standings.map((s) => [s.teamId, s]));

  const describe = (
    fantraxId: string, slot: string, status: string, salary: number | null, contract: string | null,
  ): LeagueRosterSpot => {
    const meta = playerIds[fantraxId];
    const league = playerInfo[fantraxId];
    return {
      fantraxId,
      name: meta ? toDisplayName(meta.name) : `Unknown player (${fantraxId})`,
      slot,
      eligible: (league?.eligiblePos ?? meta?.position ?? "").split(",").map((p) => p.trim()).filter(Boolean),
      nbaTeam: meta?.team ?? "(N/A)",
      status,
      salary,
      contract,
    };
  };

  const leagueRosters: LeagueRoster[] = Object.entries(rosters.rosters ?? {}).map(([teamId, team]) => ({
    teamId,
    teamName: team.teamName,
    players: (team.rosterItems ?? []).map((item) =>
      describe(item.id, item.position, item.status, typeof item.salary === "number" ? item.salary : null, item.contract?.name ?? null),
    ),
  }));

  const teams: LeagueTeam[] = Object.values(info.teamInfo ?? {}).map((t) => {
    const s = standingsById.get(t.id);
    return {
      id: t.id,
      name: t.name,
      division: t.division ?? null,
      rank: s?.rank ?? null,
      record: s?.points ?? null,
    };
  });
  teams.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.name.localeCompare(b.name));

  const freeAgents = Object.entries(playerInfo)
    .filter(([, v]) => AVAILABLE_STATUSES.has(v.status ?? ""))
    .map(([id, v]) => describe(id, "FA", v.status ?? "FA", null, null));

  const positionSlots: Record<string, number> = {};
  for (const [pos, cfg] of Object.entries(info.rosterInfo?.positionConstraints ?? {})) {
    if (cfg.maxActive) positionSlots[pos] = cfg.maxActive;
  }

  const maxTotalPlayers = info.rosterInfo?.maxTotalPlayers ?? 13;
  const teamCount = teams.length || leagueRosters.length;
  const { poolSize, clamped } = resolvePoolSize(teamCount, maxTotalPlayers);

  const picks = draft?.draftPicks ?? [];
  const scoringType = info.scoringSystem?.type ?? "unknown";
  const scoringMode: "categories" | "points" = scoringType === "points" ? "points" : "categories";

  return {
    leagueId,
    name: info.leagueName ?? "Fantrax league",
    seasonYear: info.seasonYear ?? new Date().getFullYear(),
    scoringType,
    scoringMode,
    categories: scoringMode === "categories" ? parseCategories(info) : { scored: [], unmodelled: [] },
    pointsFormula: scoringMode === "points" ? parsePointsFormula(info) : null,
    teamCount,
    maxTotalPlayers,
    maxActivePlayers: info.rosterInfo?.maxTotalActivePlayers ?? 0,
    positionSlots,
    hasSalaries: leagueRosters.some((r) => r.players.some((p) => p.salary !== null)),
    teams,
    rosters: leagueRosters,
    freeAgents,
    draft: picks.length
      ? {
          date: draft?.draftDate ?? null,
          picksMade: picks.filter((p) => p.playerId).length,
          totalPicks: picks.length,
        }
      : null,
    poolSize,
    poolClamped: clamped,
    fetchedAt: new Date().toISOString(),
  };
}

// ── value datasets ──────────────────────────────────────────────────────────

/**
 * The FHE datasets a league can be valued against. Lives here rather than in
 * resolve.ts because the connector UI renders this menu, and resolve.ts is
 * server-only.
 */
export type FantraxDatasetKey = "2027:projection" | "2026:regular";

export const FANTRAX_DATASETS: { key: FantraxDatasetKey; season: number; type: string; label: string }[] = [
  { key: "2027:projection", season: 2027, type: "projection", label: "2026-27 Projections" },
  { key: "2026:regular", season: 2026, type: "regular", label: "2025-26 Actual" },
];

/** Human label for the Fantrax scoring type. */
export function scoringTypeLabel(type: string): string {
  switch (type) {
    case "rotisserie": return "Rotisserie";
    case "headToHead": return "Head-to-head";
    case "points": return "Points";
    default: return type;
  }
}
