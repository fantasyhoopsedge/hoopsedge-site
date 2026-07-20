import { parse } from "csv-parse/sync";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient as createSb, type SupabaseClient } from "@supabase/supabase-js";
import bundledTeams from "@/data/team-category-2026-27.json";

/**
 * Storage for the team-category selector inside /admin/depth-chart. Same two-mode
 * shape as depth-chart-store.ts, but keyed by TEAM alone (not team+player) --
 * this is a per-team assignment, not a per-roster-spot one.
 *
 * UNLIKE depth-chart-store.ts's tier/injury tags, THIS one IS read live by
 * project.py (apply_depth_chart_corrections()) -- it selects which row of the
 * (category x role) typical-games table an acute-dip player's availability gets
 * pulled toward. An "unset" team falls back to the plain MPG-bucket baseline, so
 * tagging a team is what turns its roster's tier tags into something the model uses.
 */

const SEASON = "2026-27";
const DATA_DIR = join(process.cwd(), "data", "nba-rosters");
const CANONICAL = join(DATA_DIR, "team-category-2026-27.csv");
const DRAFT = join(DATA_DIR, "team-category-2026-27.draft.csv");

// Mirror in models/minutes-allocator/team_category_baseline.py's CATEGORY_OPTIONS --
// keep values/labels byte-identical.
export const CATEGORY_OPTIONS = [
  { value: "unset", label: "Unset", hint: "not yet assessed" },
  { value: "contending", label: "Contending", hint: "real playoff/seeding race" },
  { value: "playoff_bubble", label: "Playoff bubble", hint: "outside the race, not lottery-bound" },
  { value: "bottom3_risk", label: "Bottom-3 risk", hint: "could finish bottom-3 — incentivized to win under the new anti-tank rule" },
  { value: "safe_middle", label: "Safe middle", hint: "clear of bottom-3, no real playoff path — the rest-stars zone" },
] as const;
export type CategoryValue = (typeof CATEGORY_OPTIONS)[number]["value"];
export const CATEGORY_VALUES: readonly string[] = CATEGORY_OPTIONS.map((c) => c.value);
export const DEFAULT_CATEGORY: CategoryValue = "unset";

export interface TeamRow { team: string; category: string; note: string }
export type CategoryEdit = { team: string; category: string };

// ── bundled team reference (works in prod; no runtime fs) ─────────────────────
const TEAMS = bundledTeams as TeamRow[];
function baselineMap(): Record<string, string> {
  const m: Record<string, string> = {};
  for (const t of TEAMS) if (t.category && t.category !== DEFAULT_CATEGORY) m[t.team] = t.category;
  return m;
}

// ── Supabase wiring ──────────────────────────────────────────────────────────
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB_CONFIGURED = Boolean(SB_URL && SB_ANON && SB_SERVICE);
export const TC_SUPABASE_ENABLED =
  SB_CONFIGURED && (process.env.NODE_ENV === "production" || process.env.TC_USE_SUPABASE === "1");

function serviceClient(): SupabaseClient {
  return createSb(SB_URL!, SB_SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Doc = { published: Record<string, string>; draft: Record<string, string> | null };

async function readDoc(): Promise<Doc> {
  const { data } = await serviceClient()
    .from("team_category_docs").select("published, draft").eq("season", SEASON).maybeSingle();
  return { published: (data?.published as Record<string, string>) ?? {}, draft: (data?.draft as Record<string, string>) ?? null };
}

async function writeDoc(fields: { published?: Record<string, string>; draft?: Record<string, string> | null }): Promise<void> {
  await serviceClient().from("team_category_docs").upsert({
    season: SEASON, ...fields, updated_at: new Date().toISOString(),
  });
}

function mergeMap(base: Record<string, string> | null, edits: CategoryEdit[]): { map: Record<string, string>; changed: number } {
  const seeded = base && Object.keys(base).length ? base : baselineMap();
  const map: Record<string, string> = { ...seeded };
  let changed = 0;
  for (const e of edits) {
    if (!CATEGORY_VALUES.includes(e.category)) throw new Error(`unknown category "${e.category}"`);
    const prev = map[e.team] ?? DEFAULT_CATEGORY;
    if (prev === e.category) continue;
    changed += 1;
    if (e.category === DEFAULT_CATEGORY) delete map[e.team];
    else map[e.team] = e.category;
  }
  return { map, changed };
}

// ── CSV (file mode) ──────────────────────────────────────────────────────────
const COLUMNS = ["team", "category", "note"] as const;
type RawRow = Record<string, string>;
const readRaw = (path: string): RawRow[] => parse(readFileSync(path, "utf8"), { columns: true, skip_empty_lines: true, trim: true });
const csvField = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function writeCsv(path: string, raws: RawRow[]): void {
  const lines = [COLUMNS.join(",")];
  for (const r of raws) lines.push(COLUMNS.map((c) => csvField(r[c] ?? "")).join(","));
  writeFileSync(path, lines.join("\r\n") + "\r\n", "utf8");
}

function fileApply(edits: CategoryEdit[]): { raws: RawRow[]; changed: number } {
  const raws = readRaw(existsSync(DRAFT) ? DRAFT : CANONICAL);
  const index = new Map(raws.map((r) => [r.team, r]));
  let changed = 0;
  for (const e of edits) {
    if (!CATEGORY_VALUES.includes(e.category)) throw new Error(`unknown category "${e.category}"`);
    const row = index.get(e.team);
    if (!row) throw new Error(`no team-category row for ${e.team}`);
    if (row.category !== e.category) { row.category = e.category; changed += 1; }
  }
  return { raws, changed };
}

// ── public API (async; the route awaits) ─────────────────────────────────────
export async function loadForEditor(): Promise<{ teams: TeamRow[]; isDraft: boolean; supabase: boolean }> {
  if (TC_SUPABASE_ENABLED) {
    const doc = await readDoc();
    const active = doc.draft ?? doc.published;
    const seeded = Object.keys(doc.published).length > 0 || doc.draft !== null;
    const teams = TEAMS.map((t) => ({
      ...t,
      category: seeded ? (active[t.team] ?? DEFAULT_CATEGORY) : t.category,
    }));
    return { teams, isDraft: doc.draft !== null, supabase: true };
  }
  const isDraft = existsSync(DRAFT);
  const byTeam = new Map(readRaw(isDraft ? DRAFT : CANONICAL).map((r) => [r.team, r.category]));
  const teams = TEAMS.map((t) => ({
    ...t,
    category: CATEGORY_VALUES.includes(byTeam.get(t.team) ?? "") ? byTeam.get(t.team)! : DEFAULT_CATEGORY,
  }));
  return { teams, isDraft, supabase: false };
}

export async function saveDraft(edits: CategoryEdit[]): Promise<{ changed: number }> {
  if (TC_SUPABASE_ENABLED) {
    const doc = await readDoc();
    const { map, changed } = mergeMap(doc.draft ?? doc.published, edits);
    await writeDoc({ draft: map });
    return { changed };
  }
  const { raws, changed } = fileApply(edits);
  writeCsv(DRAFT, raws);
  return { changed };
}

export async function publish(edits: CategoryEdit[]): Promise<{ changed: number }> {
  if (TC_SUPABASE_ENABLED) {
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
  if (TC_SUPABASE_ENABLED) { await writeDoc({ draft: null }); return; }
  if (existsSync(DRAFT)) rmSync(DRAFT);
}
