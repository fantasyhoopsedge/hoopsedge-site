/**
 * Canonical NBA team abbreviations for the FHE ecosystem (docs/FHE_NBA_team_standard_abr.txt).
 *
 * Before this file existed, six different places in the repo each hand-rolled
 * their own alias map to reconcile competing abbreviation dialects (dynasty
 * consensus data uses PHO/NOR; stats.nba.com/HoopsHype/older CSVs use PHX/NOP;
 * hoopR's raw parquet feed — piped straight into Supabase — uses GS/NO/NY/SA/
 * UTAH/WSH). Any new ingestion script or UI component that needs to resolve a
 * team code MUST call normalizeTeamAbbr() here instead of writing a 7th map.
 */

export const NBA_TEAM_ABBRS = [
  "ATL", "BOS", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU",
  "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOR", "NYK", "BKN",
  "OKC", "ORL", "PHI", "PHO", "POR", "SAC", "SAS", "TOR", "UTA", "WAS",
] as const;

export type NbaTeamAbbr = (typeof NBA_TEAM_ABBRS)[number];

const NBA_TEAM_SET = new Set<string>(NBA_TEAM_ABBRS);

// Every non-canonical code seen in the wild across this codebase's data
// sources, mapped to its canonical FHE code.
const TEAM_ALIASES: Record<string, NbaTeamAbbr> = {
  // stats.nba.com / HoopsHype / older roster+salary CSV exports
  NOP: "NOR",
  PHX: "PHO",
  // hoopR/ESPN parquet feed (piped straight into nba_players / nba_player_game_logs)
  NO: "NOR",
  GS: "GSW",
  NY: "NYK",
  SA: "SAS",
  UTAH: "UTA",
  WSH: "WAS",
};

// "FA" is the ONE non-team placeholder for a player with no current NBA
// roster spot — do not reintroduce "UFA" as a second free-agent bucket. The
// two used to coexist (dynasty-rankings.json had both; nobody could say what
// distinguished them) and just fragmented the same real-world status into two
// UI filter options. "UFA" is normalized to "FA" below rather than added
// here, so it can never pass through unmapped again.
const NON_TEAM_VALUES = new Set(["FA"]);

/**
 * Normalizes any known team-code dialect to the canonical FHE abbreviation.
 * Passes the "FA" non-team placeholder through unchanged (and folds the
 * legacy "UFA" placeholder into it — see NON_TEAM_VALUES above). Returns the
 * input (trimmed/uppercased) unchanged if it isn't a known alias, so
 * unrecognized values (a genuine data error, or an exhibition-game label like
 * "EAST") surface rather than getting silently dropped. Returns null for
 * null/empty.
 */
export function normalizeTeamAbbr(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let t = raw.trim().toUpperCase();
  if (!t) return null;
  if (t === "UFA") t = "FA";
  if (NON_TEAM_VALUES.has(t)) return t;
  return TEAM_ALIASES[t] ?? t;
}

/** True if `raw` normalizes to one of the 30 real NBA teams (not FA/exhibition labels/junk). */
export function isNbaTeam(raw: string | null | undefined): boolean {
  const n = normalizeTeamAbbr(raw);
  return n != null && NBA_TEAM_SET.has(n);
}
