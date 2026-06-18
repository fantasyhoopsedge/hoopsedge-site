/**
 * Shared helpers for the FHE NBA data pipeline scripts.
 *
 *   • loadEnv()         — load .env.local / .env from the repo root (these
 *                         scripts run under tsx, OUTSIDE Next, so nothing loads
 *                         them automatically).
 *   • getServiceClient()— Supabase service-role client. Mirrors
 *                         src/utils/supabase/admin.ts but is self-contained so
 *                         the scripts don't depend on Next's "@/..." path alias.
 *                         Bypasses RLS — server/CI use only, never the browser.
 *   • normalizeName()   — MUST stay identical to the dynasty-rankings
 *                         normalizer (src/lib/dynasty-rankings.ts) so the salary
 *                         CSV and the stats feed produce the SAME join key.
 *   • mapBoxRow()       — hoopR/ESPN parquet row -> our game-log + player shape.
 *
 * The only network sources these scripts may touch are sportsdataverse GitHub
 * release URLs, Supabase, and (for the staleness alarm) SendGrid. NEVER a
 * salary website.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Current NBA season in hoopR terms: 2026 = the 2025-26 season. */
export const CURRENT_SEASON = 2026;

/** sportsdataverse hoopR player-box parquet, one immutable file per season. */
export function boxScoreUrl(season: number): string {
  return `https://raw.githubusercontent.com/sportsdataverse/hoopR-nba-data/main/nba/player_box/parquet/player_box_${season}.parquet`;
}

/** ESPN season_type integer -> our text label. preseason(1)/offseason(4) -> null (dropped). */
export function seasonTypeLabel(n: unknown): "regular" | "postseason" | null {
  if (n === 2) return "regular";
  if (n === 3) return "postseason";
  return null;
}

/**
 * Minimal .env loader (no dotenv dependency). Reads .env.local then .env from
 * the repo root and sets any keys not already present in process.env.
 */
export function loadEnv(): void {
  for (const name of [".env.local", ".env"]) {
    const file = resolve(REPO_ROOT, name);
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

/** Service-role Supabase client. Throws if env is missing. */
export function getServiceClient(): SupabaseClient {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Missing env: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Aggressive name normalization — IDENTICAL to normalizePlayerName() in
 * src/lib/dynasty-rankings.ts. Keep these in lockstep: lowercase -> strip
 * diacritics -> strip . , ' ’ -> strip jr/sr/ii/iii/iv suffix -> collapse
 * whitespace. This is the salary <-> stats join key.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,'’]/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse hoopR minutes: number passthrough, "MM:SS" -> decimal, else null. */
export function parseMinutes(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    if (s.includes(":")) {
      const [m, sec] = s.split(":").map(Number);
      if (Number.isFinite(m) && Number.isFinite(sec)) return m + sec / 60;
      return null;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toStr(v: unknown): string | null {
  if (v == null) return null;
  return String(v);
}
function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function toDate(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string") return v.slice(0, 10);
  return null;
}

export type GameLog = {
  game_id: string;
  player_id: string;
  game_date: string | null;
  season: number;
  season_type: string;
  team: string | null;
  min: number | null;
  pts: number | null; reb: number | null; oreb: number | null; dreb: number | null;
  ast: number | null; stl: number | null; blk: number | null; tov: number | null;
  fgm: number | null; fga: number | null; fg3m: number | null; fg3a: number | null;
  ftm: number | null; fta: number | null;
  updated_at: string;
};

export type Player = {
  id: string;
  full_name: string;
  norm_name: string;
  team: string | null;
  position: string | null;
  is_active: boolean;
  updated_at: string;
};

/**
 * Map one hoopR/ESPN parquet box-score row to our log + player shapes.
 * Returns null for rows we deliberately skip: DNP, missing athlete/game id,
 * or preseason/off-season (season_type not 2 or 3).
 */
export function mapBoxRow(
  row: Record<string, unknown>,
  now: string,
): { log: GameLog; player: Player } | null {
  if (row.did_not_play === true) return null;

  const seasonType = seasonTypeLabel(row.season_type);
  if (!seasonType) return null;

  const playerId = toStr(row.athlete_id);
  const gameId = toStr(row.game_id);
  const fullName = toStr(row.athlete_display_name);
  const season = toNum(row.season);
  if (!playerId || !gameId || !fullName || season == null) return null;

  const team = toStr(row.team_abbreviation);

  const log: GameLog = {
    game_id: gameId,
    player_id: playerId,
    game_date: toDate(row.game_date),
    season,
    season_type: seasonType,
    team,
    min: parseMinutes(row.minutes),
    pts: toNum(row.points),
    reb: toNum(row.rebounds),
    oreb: toNum(row.offensive_rebounds),
    dreb: toNum(row.defensive_rebounds),
    ast: toNum(row.assists),
    stl: toNum(row.steals),
    blk: toNum(row.blocks),
    tov: toNum(row.turnovers),
    fgm: toNum(row.field_goals_made),
    fga: toNum(row.field_goals_attempted),
    fg3m: toNum(row.three_point_field_goals_made),
    fg3a: toNum(row.three_point_field_goals_attempted),
    ftm: toNum(row.free_throws_made),
    fta: toNum(row.free_throws_attempted),
    updated_at: now,
  };

  const player: Player = {
    id: playerId,
    full_name: fullName,
    norm_name: normalizeName(fullName),
    team,
    position: toStr(row.athlete_position_abbreviation),
    is_active: season === CURRENT_SEASON,
    updated_at: now,
  };

  return { log, player };
}
