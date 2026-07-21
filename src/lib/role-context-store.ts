import { parse } from "csv-parse/sync";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient as createSb, type SupabaseClient } from "@supabase/supabase-js";
import bundledRoster from "@/data/role-context-2026-27.json";

/**
 * Storage for the Stage 1 role-context tier pass (the /admin/role-context editor).
 *
 * Two source-of-truth modes, mirroring the rookie board:
 *   • Supabase (production, or dev with RC_USE_SUPABASE=1) — tier decisions live in the
 *     role_context_docs table, so the owner can edit from anywhere. Vercel's filesystem
 *     is read-only, so this is the only mode that works in prod.
 *   • Local CSV (dev default) — reads/writes data/nba-rosters/role-context-2026-27.csv
 *     directly, so a local model run picks up an edit immediately with no round-trip.
 *
 * The ROSTER itself (team, player, class, dynasty rank, note) is reference data prepared
 * by models/projections-adjuster/prep_role_context.py. It ships as a bundled JSON import so
 * it renders in prod without runtime fs; only the TIER decisions ever hit the DB. When
 * the owner publishes in prod, scripts/sync-role-context.ts pulls those tiers back into
 * the CSV before the model runs. Only the `tier` column is ever written — class/dynRank/
 * note/source are preserved, and the CSV is written CRLF to match the Python writer so a
 * publish diffs only changed lines.
 */

const SEASON = "2026-27";
const DATA_DIR = join(process.cwd(), "data", "nba-rosters");
const CANONICAL = join(DATA_DIR, "role-context-2026-27.csv");
const DRAFT = join(DATA_DIR, "role-context-2026-27.draft.csv");

// Mirror of ROLE_TIERS in models/projections-adjuster/minutes.py — keep values/multipliers
// byte-identical. The allocator reads a tier RELATIVE to team-mates, so "no_change" is
// the correct default for the large majority.
export const TIER_OPTIONS = [
  { value: "won_job", mult: 1.15, label: "Won job", hint: "clear path to a starting spot that was vacated or contested" },
  { value: "expanded", mult: 1.08, label: "Expanded", hint: "more responsibility, short of a starting job" },
  { value: "no_change", mult: 1.0, label: "No change", hint: "the default — correct for the large majority" },
  { value: "reduced", mult: 0.9, label: "Reduced", hint: "rotation squeezed by an arrival or a returning starter" },
  { value: "clear_backup", mult: 0.7, label: "Clear backup", hint: "signed or traded into an obvious backup role" },
] as const;
export type TierValue = (typeof TIER_OPTIONS)[number]["value"];
export const TIER_VALUES: readonly string[] = TIER_OPTIONS.map((t) => t.value);
export const DEFAULT_TIER: TierValue = "no_change";

export interface RoleRow {
  team: string; player: string; cls: string; dynRank: number | null;
  tier: string; note: string; source: string;
}
export type TierEdit = { team: string; player: string; tier: string };

const keyOf = (team: string, player: string) => `${team}||${player}`;

// ── bundled roster reference (works in prod; no runtime fs) ───────────────────
interface BundleRow { team: string; player: string; class: string; dynRank: number | null; tier: string; note: string; source: string }
const ROSTER = bundledRoster as BundleRow[];
const rosterRow = (b: BundleRow): RoleRow => ({
  team: b.team, player: b.player, cls: b.class, dynRank: b.dynRank,
  tier: DEFAULT_TIER, note: b.note, source: b.source,
});
/** Baseline non-default tiers from the prep (e.g. the TGFSL "expanded" sophomores). */
function baselineMap(): Record<string, string> {
  const m: Record<string, string> = {};
  for (const b of ROSTER) if (b.tier && b.tier !== DEFAULT_TIER) m[keyOf(b.team, b.player)] = b.tier;
  return m;
}

// ── Supabase wiring ──────────────────────────────────────────────────────────
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB_CONFIGURED = Boolean(SB_URL && SB_ANON && SB_SERVICE);
export const RC_SUPABASE_ENABLED =
  SB_CONFIGURED && (process.env.NODE_ENV === "production" || process.env.RC_USE_SUPABASE === "1");

function serviceClient(): SupabaseClient {
  return createSb(SB_URL!, SB_SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Doc = { published: Record<string, string>; draft: Record<string, string> | null };

async function readDoc(): Promise<Doc> {
  const { data } = await serviceClient()
    .from("role_context_docs").select("published, draft").eq("season", SEASON).maybeSingle();
  return { published: (data?.published as Record<string, string>) ?? {}, draft: (data?.draft as Record<string, string>) ?? null };
}

async function writeDoc(fields: { published?: Record<string, string>; draft?: Record<string, string> | null }): Promise<void> {
  await serviceClient().from("role_context_docs").upsert({
    season: SEASON, ...fields, updated_at: new Date().toISOString(),
  });
}

/** Apply edits onto a base map, returning a complete map of only non-default tiers and
 *  the number of entries that actually changed. Seeds from the prep baseline when the
 *  base is empty, so the "expanded" sophomores survive the first edit. */
function mergeMap(base: Record<string, string> | null, edits: TierEdit[]): { map: Record<string, string>; changed: number } {
  const seeded = base && Object.keys(base).length ? base : baselineMap();
  const map: Record<string, string> = { ...seeded };
  let changed = 0;
  for (const e of edits) {
    if (!TIER_VALUES.includes(e.tier)) throw new Error(`unknown tier "${e.tier}"`);
    const k = keyOf(e.team, e.player);
    const prev = map[k] ?? DEFAULT_TIER;
    if (prev === e.tier) continue;
    changed += 1;
    if (e.tier === DEFAULT_TIER) delete map[k];
    else map[k] = e.tier;
  }
  return { map, changed };
}

// ── CSV (file mode) ──────────────────────────────────────────────────────────
const COLUMNS = ["team", "player", "class", "dyn_rank", "tier", "note", "source"] as const;
type RawRow = Record<string, string>;
const readRaw = (path: string): RawRow[] => parse(readFileSync(path, "utf8"), { columns: true, skip_empty_lines: true, trim: true });
const csvField = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Exported so the sync script writes the CSV identically. CRLF to match the Python writer. */
export function writeCsv(path: string, raws: RawRow[]): void {
  const lines = [COLUMNS.join(",")];
  for (const r of raws) lines.push(COLUMNS.map((c) => csvField(r[c] ?? "")).join(","));
  writeFileSync(path, lines.join("\r\n") + "\r\n", "utf8");
}

function fileApply(edits: TierEdit[]): { raws: RawRow[]; changed: number } {
  const raws = readRaw(existsSync(DRAFT) ? DRAFT : CANONICAL);
  const index = new Map(raws.map((r) => [keyOf(r.team, r.player), r]));
  let changed = 0;
  for (const e of edits) {
    if (!TIER_VALUES.includes(e.tier)) throw new Error(`unknown tier "${e.tier}"`);
    const row = index.get(keyOf(e.team, e.player));
    if (!row) throw new Error(`no roster row for ${e.player} (${e.team})`);
    if (row.tier !== e.tier) { row.tier = e.tier; changed += 1; }
  }
  return { raws, changed };
}

// Read-only accessor for public pages (e.g. team-rosters' depth-chart pop-up) —
// PUBLISHED only, never the WIP draft, no admin auth required. Mirrors
// loadForEditor's overlay logic but always resolves against doc.published /
// CANONICAL, matching what a visitor sees on the actual site right now.
export async function loadPublishedRows(): Promise<RoleRow[]> {
  if (RC_SUPABASE_ENABLED) {
    const doc = await readDoc();
    const seeded = Object.keys(doc.published).length > 0;
    return ROSTER.map((b) => {
      const r = rosterRow(b);
      r.tier = seeded ? (doc.published[keyOf(b.team, b.player)] ?? DEFAULT_TIER) : b.tier;
      return r;
    });
  }
  const byKey = new Map(readRaw(CANONICAL).map((r) => [keyOf(r.team, r.player), r.tier]));
  return ROSTER.map((b) => {
    const r = rosterRow(b);
    const raw = byKey.get(keyOf(b.team, b.player));
    r.tier = raw && TIER_VALUES.includes(raw) ? raw : b.tier;
    return r;
  });
}

// ── public API (async; the route awaits) ─────────────────────────────────────
export async function loadForEditor(): Promise<{ rows: RoleRow[]; isDraft: boolean; supabase: boolean }> {
  if (RC_SUPABASE_ENABLED) {
    const doc = await readDoc();
    const active = doc.draft ?? doc.published;
    const seeded = Object.keys(doc.published).length > 0 || doc.draft !== null;
    const rows = ROSTER.map((b) => {
      const r = rosterRow(b);
      r.tier = seeded ? (active[keyOf(b.team, b.player)] ?? DEFAULT_TIER) : b.tier;
      return r;
    });
    return { rows, isDraft: doc.draft !== null, supabase: true };
  }
  // file mode: roster + tiers from the CSV (draft if present).
  const isDraft = existsSync(DRAFT);
  const byKey = new Map(readRaw(isDraft ? DRAFT : CANONICAL).map((r) => [keyOf(r.team, r.player), r.tier]));
  const rows = ROSTER.map((b) => {
    const r = rosterRow(b);
    r.tier = TIER_VALUES.includes(byKey.get(keyOf(b.team, b.player)) ?? "") ? byKey.get(keyOf(b.team, b.player))! : DEFAULT_TIER;
    return r;
  });
  return { rows, isDraft, supabase: false };
}

export async function saveDraft(edits: TierEdit[]): Promise<{ changed: number }> {
  if (RC_SUPABASE_ENABLED) {
    const doc = await readDoc();
    const { map, changed } = mergeMap(doc.draft ?? doc.published, edits);
    await writeDoc({ draft: map });
    return { changed };
  }
  const { raws, changed } = fileApply(edits);
  writeCsv(DRAFT, raws);
  return { changed };
}

export async function publish(edits: TierEdit[]): Promise<{ changed: number }> {
  if (RC_SUPABASE_ENABLED) {
    const doc = await readDoc();
    const { map, changed } = mergeMap(doc.draft ?? doc.published, edits);
    await writeDoc({ published: map, draft: null });
    return { changed };
  }
  const { raws, changed } = fileApply(edits);
  writeCsv(CANONICAL, raws);
  if (existsSync(DRAFT)) rmSync(DRAFT);
  return { changed };
}

export async function discardDraft(): Promise<void> {
  if (RC_SUPABASE_ENABLED) { await writeDoc({ draft: null }); return; }
  if (existsSync(DRAFT)) rmSync(DRAFT);
}
