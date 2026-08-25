import { promises as fs } from "fs";
import path from "path";
import { createClient as createSb, type SupabaseClient } from "@supabase/supabase-js";
import { FX_SUPABASE_ENABLED } from "./store";

/**
 * Storage for the cached custom-valuations ledger — one row per (owner,
 * league), latest snapshot only (overwritten on every Regenerate, no
 * version history: nothing here is collaboratively edited the way the
 * rookie board is, so there's nothing to reconcile between versions of).
 *
 * Deliberately mirrors src/lib/fantrax/store.ts's own dual-mode convention
 * (Supabase table when configured, local JSON fallback for offline dev)
 * rather than inventing a third storage pattern — see fx_leagues' own doc
 * in store.ts and the fx_custom_valuations migration
 * (20260823120000_fx_custom_valuations.sql) for why.
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

function serviceClient(): SupabaseClient {
  return createSb(SB_URL!, SB_SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } });
}

const LOCAL_PATH = path.join(process.cwd(), "src", "data", "fantrax-custom-valuations.json");

export interface LedgerRow {
  asset: string;
  type: "player" | "pick";
  /** Set for player/FA rows only — the real Fantrax roster id, so Trade
   *  Edge's live baseValueByFantraxId map can join a custom value onto the
   *  exact same player it already knows, without a name-based join (see
   *  CLAUDE.md's Fantrax connector doc on why a name join risks the
   *  duplicate-name hazard). */
  fantraxId: string | null;
  /** Set for a CURRENT-draft-year pick row with a known overall pick number
   *  only — `"${draftYear}:${overallPick}"`. This is the one pick shape the
   *  ledger prices individually (real rookie-board-mapped consensus rank per
   *  slot); a future-year row is a generic bracket estimate shared by every
   *  team's pick in that range, not tied to one real pick, so it gets no key.
   *  Lets Trade Edge's live pick cards join onto the SAME number the ledger
   *  itself shows for that exact pick (Ash, 2026-08-23: found the two
   *  disagreeing — card showed rank #177 for a pick the ledger ranked #302)
   *  instead of recomputing a different value via the generic ratio model. */
  pickKey: string | null;
  /** Fantrax eligibility, already filtered to real positions (posDisplayFor)
   *  — "Flx"/other roster-slot-only tags never appear here, only PG/SG/SF/
   *  PF/C/G/F as this league's own positionSlots actually recognizes. Null
   *  for a pick. */
  pos: string | null;
  /** Canonical NBA_TEAM_ABBRS code for a player/FA row (see nba-teams.ts) —
   *  null for a pick, or a player resolve.ts couldn't attach a team to. */
  nbaTeam: string | null;
  /** 2026 draft class flag — same headshot-source-ordering signal
   *  PlayerHeadshot's own `rookie` prop reads elsewhere. False for a pick. */
  isRookie: boolean;
  dynRank: number | null;
  tradeValue: number;
  tradeRank: number | null;
  salary: number | null;
  contract: string | null;
  owner: string;
}

export interface CustomValuationsDoc {
  leagueId: string;
  generatedAt: string;
  playerCount: number;
  pickCount: number;
  extraPickCount: number;
  rows: LedgerRow[];
  /** "full" = every rostered player/FA/pick revalued against this league's
   *  own rules (the original custom-valuations flow). "picksOnly" = draft-
   *  pick values alone, generated for a STANDARD (non-custom) dynasty/keeper
   *  league via computePickValuesLedger — a consumer must never merge a
   *  picksOnly doc's rows into player base values (it has none — every row
   *  is type "pick" — but a mode check is the explicit, future-proof guard
   *  rather than relying on that always being true). Absent on a doc
   *  generated before this field existed — treat missing as "full", the
   *  only kind that could exist then. */
  mode?: "full" | "picksOnly";
  /** The real-salary efficiency-weight actually used to produce THIS
   *  generation (see SavedLeagueSettings.realSalaryEfficiencyWeight) — the
   *  weight baked into the ledger, not necessarily whatever the Settings
   *  slider currently shows (the user can move the slider without hitting
   *  Regenerate yet, so those two can disagree). Null for a non-real-salary
   *  league, where this setting has no effect at all. */
  realSalaryEfficiencyWeight: number | null;
}

type LocalFile = Record<string, Record<string, CustomValuationsDoc>>; // owner -> leagueId -> doc

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

/** Reads the cached ledger for a league — null if it's never been
 *  generated. Never recomputes; see custom-valuations.ts's
 *  computeCustomLedger() for the write side. */
export async function getCustomValuations(owner: string, leagueId: string): Promise<CustomValuationsDoc | null> {
  if (FX_SUPABASE_ENABLED) {
    const { data, error } = await serviceClient()
      .from("fx_custom_valuations")
      .select("data, generated_at")
      .eq("owner", owner)
      .eq("league_id", leagueId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return { ...(data.data as Omit<CustomValuationsDoc, "generatedAt">), generatedAt: data.generated_at as string };
  }
  const all = await readLocal();
  return all[owner]?.[leagueId] ?? null;
}

/** Overwrites the cached ledger for a league — the "Regenerate" action's
 *  write side. */
export async function saveCustomValuations(
  owner: string,
  leagueId: string,
  doc: Omit<CustomValuationsDoc, "generatedAt">,
): Promise<CustomValuationsDoc> {
  const generatedAt = new Date().toISOString();
  const saved: CustomValuationsDoc = { ...doc, generatedAt };

  if (FX_SUPABASE_ENABLED) {
    const { error } = await serviceClient()
      .from("fx_custom_valuations")
      .upsert(
        { owner, league_id: leagueId, data: doc, generated_at: generatedAt },
        { onConflict: "owner,league_id" },
      );
    if (error) throw new Error(error.message);
    return saved;
  }

  const all = await readLocal();
  all[owner] = { ...(all[owner] ?? {}), [leagueId]: saved };
  await writeLocal(all);
  return saved;
}
