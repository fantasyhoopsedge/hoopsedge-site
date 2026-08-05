import { promises as fs } from "fs";
import path from "path";
import { createClient as createSb, type SupabaseClient } from "@supabase/supabase-js";
import type { FantraxDatasetKey } from "./league";
import { DEFAULT_LEAGUE_TAGS, type LeagueFormat, type LeagueType, type SalaryFormat } from "./league-tags";

export { DEFAULT_LEAGUE_TAGS, type LeagueFormat, type LeagueType, type SalaryFormat };

/**
 * Storage for a user's linked Fantrax leagues.
 *
 * Same two-mode shape as rookie-board-store.ts / dynasty-board-store.ts:
 *   • Supabase (production, or dev with FX_USE_SUPABASE=1) — table fx_leagues.
 *   • Local JSON (dev default) — src/data/fantrax-leagues.json, so the connector
 *     is testable before the migration is applied.
 *
 * What is stored is deliberately narrow: the league id, which team is the
 * user's, and a snapshot of the imported settings for display. It never holds a
 * Secret ID. That isn't an oversight — /privacy §4 states the Secret ID is
 * never transmitted to or stored on a FantasyHoopsEdge server, and a league id
 * is all the server needs, since every league-scoped Fantrax endpoint is
 * key-less. Do not add a secret column here.
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB_CONFIGURED = Boolean(SB_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && SB_SERVICE);

export const FX_SUPABASE_ENABLED =
  SB_CONFIGURED && (process.env.NODE_ENV === "production" || process.env.FX_USE_SUPABASE === "1");

// Untyped client — like rb_* and dynasty_board_docs, fx_leagues is a
// service-role-only table and isn't carried in src/types/database.ts.
function serviceClient(): SupabaseClient {
  return createSb(SB_URL!, SB_SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } });
}

const LOCAL_PATH = path.join(process.cwd(), "src", "data", "fantrax-leagues.json");

/** Owner key used in dev, where there's no signed-in user to attribute rows to. */
export const LOCAL_OWNER = "local-dev";

/** The subset of imported settings worth showing without re-fetching Fantrax. */
export interface SavedLeagueSettings {
  seasonYear: number;
  scoringType: string;
  categories: string[];
  unmodelledCategories: string[];
  teamCount: number;
  maxTotalPlayers: number;
  maxActivePlayers: number;
  hasSalaries: boolean;
  poolSize: number;
  /** User-set tags below — Fantrax's API doesn't expose any of these, so they
   *  default from the closest auto-detected signal and the user can override.
   *  Optional: leagues saved before these existed have none of them in their
   *  stored jsonb — callers should fall back with DEFAULT_LEAGUE_TAGS, never
   *  assume presence. */
  format?: LeagueFormat;
  leagueType?: LeagueType;
  salaryFormat?: SalaryFormat;
  /** Which FHE dataset this league opens to by default next time it's loaded. */
  defaultDataset?: FantraxDatasetKey;
}

export interface SavedLeague {
  leagueId: string;
  leagueName: string;
  teamId: string | null;
  teamName: string | null;
  settings: SavedLeagueSettings;
  savedAt: string;
}

type LocalFile = Record<string, SavedLeague[]>;

async function readLocal(): Promise<LocalFile> {
  try {
    return JSON.parse(await fs.readFile(LOCAL_PATH, "utf8")) as LocalFile;
  } catch {
    return {};
  }
}

async function writeLocal(data: LocalFile): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_PATH), { recursive: true });
  await fs.writeFile(LOCAL_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function listLeagues(owner: string): Promise<SavedLeague[]> {
  if (FX_SUPABASE_ENABLED) {
    const { data, error } = await serviceClient()
      .from("fx_leagues")
      .select("league_id, league_name, team_id, team_name, settings, updated_at")
      .eq("owner", owner)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      leagueId: r.league_id as string,
      leagueName: r.league_name as string,
      teamId: (r.team_id as string) ?? null,
      teamName: (r.team_name as string) ?? null,
      settings: r.settings as SavedLeagueSettings,
      savedAt: r.updated_at as string,
    }));
  }
  const all = await readLocal();
  return all[owner] ?? [];
}

export async function saveLeague(owner: string, league: Omit<SavedLeague, "savedAt">): Promise<SavedLeague> {
  const saved: SavedLeague = { ...league, savedAt: new Date().toISOString() };

  if (FX_SUPABASE_ENABLED) {
    const { error } = await serviceClient()
      .from("fx_leagues")
      .upsert(
        {
          owner,
          league_id: saved.leagueId,
          league_name: saved.leagueName,
          team_id: saved.teamId,
          team_name: saved.teamName,
          settings: saved.settings,
          updated_at: saved.savedAt,
        },
        { onConflict: "owner,league_id" },
      );
    if (error) throw new Error(error.message);
    return saved;
  }

  const all = await readLocal();
  const mine = (all[owner] ?? []).filter((l) => l.leagueId !== saved.leagueId);
  all[owner] = [saved, ...mine];
  await writeLocal(all);
  return saved;
}

export async function deleteLeague(owner: string, leagueId: string): Promise<void> {
  if (FX_SUPABASE_ENABLED) {
    const { error } = await serviceClient()
      .from("fx_leagues")
      .delete()
      .eq("owner", owner)
      .eq("league_id", leagueId);
    if (error) throw new Error(error.message);
    return;
  }
  const all = await readLocal();
  all[owner] = (all[owner] ?? []).filter((l) => l.leagueId !== leagueId);
  await writeLocal(all);
}
