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

// Non-team placeholder values that legitimately appear in "team" columns —
// pass through unchanged, never flagged as unknown.
const NON_TEAM_VALUES = new Set(["FA", "UFA"]);

/**
 * Normalizes any known team-code dialect to the canonical FHE abbreviation.
 * Passes non-team placeholders (FA, UFA) through unchanged. Returns the input
 * (trimmed/uppercased) unchanged if it isn't a known alias, so unrecognized
 * values (a genuine data error, or an exhibition-game label like "EAST")
 * surface rather than getting silently dropped. Returns null for null/empty.
 */
export function normalizeTeamAbbr(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toUpperCase();
  if (!t) return null;
  if (NON_TEAM_VALUES.has(t)) return t;
  return TEAM_ALIASES[t] ?? t;
}

/** True if `raw` normalizes to one of the 30 real NBA teams (not FA/UFA/exhibition labels/junk). */
export function isNbaTeam(raw: string | null | undefined): boolean {
  const n = normalizeTeamAbbr(raw);
  return n != null && NBA_TEAM_SET.has(n);
}
