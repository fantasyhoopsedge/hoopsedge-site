import { promises as fs } from "fs";
import path from "path";
import { createClient as createSb, type SupabaseClient } from "@supabase/supabase-js";
import type { FantraxDatasetKey, FheCategory } from "./league";
import {
  DEFAULT_LEAGUE_TAGS, type ContractRule, type LeagueFormat, type LeagueType,
  type RookieSalaryTier, type SalaryFormat,
} from "./league-tags";

export { DEFAULT_LEAGUE_TAGS, type ContractRule, type LeagueFormat, type LeagueType, type RookieSalaryTier, type SalaryFormat };

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
  /** True once the user has explicitly confirmed `format` — Fantrax's API
   *  can't tell roto from head-to-head-categories (verified live 2026-08-09:
   *  both report scoringType "rotisserie"), so `format` otherwise silently
   *  carries DEFAULT_LEAGUE_TAGS.format ("roto") with no signal that it was
   *  ever actually checked. Missing/false on any league saved before this
   *  field existed — correctly, since those saves may never have had the
   *  format looked at. */
  formatConfirmed?: boolean;
  /** Which FHE dataset this league opens to by default next time it's loaded. */
  defaultDataset?: FantraxDatasetKey;
  /** Games & lineups (The Deep Edge, added 2026-08-10) — drives Power Rankings'
   *  depth weighting. All optional: leagues saved before this existed have
   *  none of them in their stored jsonb; callers fall back to
   *  DEFAULT_GAMES_CAP_SETTINGS, never assume presence. */
  lineupCadence?: "daily" | "weekly";
  capPos?: boolean;
  capPosN?: number;
  capMatch?: boolean;
  capMatchN?: number;

  /**
   * Full Settings-screen fields (The Deep Edge, added 2026-08-11). All
   * optional, same fallback convention as everything above: absent on any
   * league saved before this existed, and on every field Fantrax doesn't
   * expose, auto-population seeds a best-guess default that the user can
   * override — never silently assume presence.
   */

  /** User override for which of FHE's 9 canonical categories are scored —
   *  the Scoring-categories chip toggle. Falls back to the league's own
   *  auto-detected categories.scored when absent. Read by every screen that
   *  computes LeagueV/roto/H2H math (Category Edge, Power Rankings) — this
   *  is a functional override, not just a display list. */
  scoredCategoriesOverride?: FheCategory[];
  /** Extra Fantrax-style categories added from the "Add category" picker for
   *  informational display only (DD, TD, PF, …) — FHE's value engine has no
   *  z-score model for these, so they never enter scoredCategoriesOverride
   *  or any computation. Shown as non-interactive chips only. */
  additionalCategories?: string[];
  /** User override for roster slot counts (PG/SG/SF/PF/C/G/F/UTIL/Bench/IR/
   *  Minors). Falls back to the league's own auto-detected positionSlots
   *  when absent. Also a functional override — read by buildOptimalLineup()
   *  everywhere; Bench/IR/Minors never fill as active slots (see
   *  lineup.ts's RESERVE_SLOTS) regardless of their count here. */
  positionSlotsOverride?: Record<string, number>;

  // Salary cap — shown only when salaryFormat !== "none". Fantrax exposes
  // that a salary number exists (hasSalaries) but not the cap total or cap
  // type, so those need explicit confirmation.
  salaryCapTotal?: number;
  salaryCapConfirmed?: boolean;
  capType?: "soft" | "hard";
  /** Max contract length is a real rule only in custom-salary (auction/
   *  keeper-valuation) leagues — most real-salary and non-salary leagues
   *  don't have one, so this is an explicit on/off toggle rather than an
   *  always-shown confirm field. Capped at 5 years when enabled. */
  maxContractLengthEnabled?: boolean;
  maxContractLength?: number;

  // Keepers & contracts — shown only when leagueType is "dynasty" or
  // "keeper". None of these are Fantrax-detectable; all default and the
  // user adjusts.
  keeperPolicy?: string; // "all" | "10" .. "1"
  rookieDraftRounds?: number;
  taxiSquad?: boolean;
  /** This league's own contract-label prefix scheme (F/R/J/E or whatever
   *  house convention it uses) — see ContractRule's own doc for why this is
   *  per-league, not a global decoder. Empty/absent = today's behavior,
   *  every contract treated identically regardless of label. */
  contractRules?: ContractRule[];
  /** This league's own rookie-scale salary-by-draft-position table — see
   *  RookieSalaryTier's own doc. */
  rookieSalaryScale?: RookieSalaryTier[];
  /** Opt-in switch: when true, Trade Edge reads base value from the cached
   *  custom-valuations ledger (fx_custom_valuations, via
   *  custom-valuations-store.ts) instead of computing the default cascade
   *  fresh (trade-value.ts's computeBaseTradeValues). Off by default — the
   *  default cascade is already correct per league type, this is an
   *  opt-in upgrade, not a replacement. */
  useCustomValuations?: boolean;
  /** ISO timestamp of the last time Home's "customize your league assets?"
   *  prompt was shown (Yes or No) — null/absent means never asked. Set
   *  either way so the prompt doesn't nag on every visit. */
  customValuationsPromptedAt?: string | null;

  // Waivers & trades — not Fantrax-detectable; default and let the user adjust.
  waiverType?: "faab" | "rolling";
  faabBudget?: number;
  tradeDeadline?: string; // ISO date, yyyy-mm-dd

  /** Standings conferences (League basics). When enabled, seeded from
   *  Fantrax's own real per-team `division` field (FantraxLeague.teams[].
   *  division — genuinely Fantrax-sourced, not a guess) when the league has
   *  it; falls back to a simple alphabetical split otherwise. Team ids are
   *  Fantrax team ids (FantraxLeague.teams[].id / LeagueRoster.teamId). */
  conferencesEnabled?: boolean;
  conferences?: { name: string; teamIds: string[] }[];
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
