import { parse } from "csv-parse/sync";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient as createSb, type SupabaseClient } from "@supabase/supabase-js";
import bundledRoster from "@/data/depth-chart-2026-27.json";

/**
 * Storage for the /admin/depth-chart editor — same two-mode shape as role-context-store
 * (which itself mirrors the rookie board):
 *   • Supabase (production, or dev with DC_USE_SUPABASE=1) — tier decisions live in the
 *     depth_chart_docs table, so the owner can edit from anywhere. Vercel's filesystem is
 *     read-only, so this is the only mode that works in prod.
 *   • Local CSV (dev default) — reads/writes data/nba-rosters/depth-chart-2026-27.csv
 *     directly.
 *
 * The ROSTER reference (team, player, pos, projected minutes, contract/salary status) is
 * prepared by models/projections-adjuster/prep_depth_chart.py and ships as a bundled JSON
 * import so it renders in prod without runtime fs. Only the `tier` column is ever
 * written by this store — everything else is read-only reference data.
 *
 * STANDALONE BY DESIGN: this tier assignment is NOT read by Stage 1 or any other part of
 * the projection pipeline. It exists so a human's depth-chart judgment (who actually
 * starts, who's in the rotation, who's fringe) can be recorded and viewed against
 * contract status — wiring it back into project.py as a projection input is a distinct,
 * separate step, deliberately not done here.
 */

const SEASON = "2026-27";
const DATA_DIR = join(process.cwd(), "data", "nba-rosters");
const CANONICAL = join(DATA_DIR, "depth-chart-2026-27.csv");
const DRAFT = join(DATA_DIR, "depth-chart-2026-27.draft.csv");

export const TIER_OPTIONS = [
  { value: "starter", label: "Starter", hint: "in the opening lineup when healthy" },
  { value: "rotation", label: "Rotation", hint: "regular minutes off the bench" },
  { value: "reserve", label: "Reserve", hint: "situational / matchup-dependent minutes" },
  { value: "fringe", label: "Fringe", hint: "two-way, deep bench, spot duty only" },
  { value: "cut", label: "Won't make roster", hint: "excluded entirely from the team's minute allocation" },
] as const;
export type TierValue = (typeof TIER_OPTIONS)[number]["value"];
export const TIER_VALUES: readonly string[] = TIER_OPTIONS.map((t) => t.value);
export const DEFAULT_TIER: TierValue = "reserve";

// Separate from tier on purpose: an injury tag needs to reduce a player's games
// projection RELATIVE TO the tier he'd otherwise occupy (a hurt starter is still a
// starter, just a starter who plays fewer games than a healthy one) -- folding
// "long-term injury" into the tier dropdown itself would throw away exactly the
// "what would he be if healthy" information that reduction needs.
export const INJURY_OPTIONS = [
  { value: "none", label: "Healthy", hint: "no notable injury concern" },
  { value: "short_term", label: "Short-term injury", hint: "expected back within weeks — modest games reduction" },
  { value: "long_term", label: "Long-term injury", hint: "expected to miss extended time — larger games reduction" },
] as const;
export type InjuryValue = (typeof INJURY_OPTIONS)[number]["value"];
export const INJURY_VALUES: readonly string[] = INJURY_OPTIONS.map((t) => t.value);
export const DEFAULT_INJURY: InjuryValue = "none";

// Step 5: how much an injury tag discounts the games projection. NOT backtested --
// there is no historical field for "short-term vs long-term" injury severity (the
// closest proxy, dnp_injury, is blind on exactly the long-duration absences that
// matter here: Ty Jerome's real 67-game absence in 2025-26 shows as only 10 DNP rows
// in the box-score feed). These are reasoned defaults grounded in real schedule math,
// not a fitted result, and should move if the season's actual outcomes disagree.
//
// The 82-game slate runs mid-October to mid-April, ~24.9 weeks, so the league plays
// close to 3.3 games/week on average. A tag translates to a REPRESENTATIVE absence
// length, converted to a fraction of a healthy season (not a fraction of whatever
// games remain -- this tool has no "today's date" concept, it's a season-level
// projection, not an in-season live tracker).
//
// TIER-DEPENDENT, NOT FLAT -- mirror of INJURY_REDUCTION in project.py, keep values
// byte-identical. A fringe/two-way guy who gets hurt doesn't just lose a fixed
// fraction of an already-tiny role, he typically loses the roster spot/opportunity
// window entirely (someone else gets the call-up); starter/rotation keep the
// original schedule-math reduction (they get their job back), reserve loses more
// (thinner margin), fringe loses almost everything.
export const INJURY_REDUCTION: Record<string, Record<InjuryValue, number>> = {
  starter: { none: 0, short_term: 0.15, long_term: 0.45 },
  rotation: { none: 0, short_term: 0.15, long_term: 0.45 },
  reserve: { none: 0, short_term: 0.35, long_term: 0.75 },
  fringe: { none: 0, short_term: 0.60, long_term: 0.95 },
};

export const STATUS_LABEL: Record<string, string> = {
  guaranteed: "Signed",
  player_option: "Player Option",
  team_option: "Team Option",
  restricted_fa: "Restricted FA",
  non_guaranteed: "Non-Guaranteed",
  unrestricted_fa: "Unrestricted FA",
};

export interface DepthRow {
  team: string; player: string; pos: string; tier: string; injury: string;
  projMpg: number | null; projGames: number | null; usg: number | null;
  salaryNow: number | null; statusNow: string;
  salaryNext: number | null; statusNext: string;
  // Manual overrides -- null means "no override, use the model's own number".
  // Wired into project.py: an overridden player's load is LOCKED before allocate()
  // runs, and the rest of the team rescales around it -- the same cap-locking
  // mechanism allocate() already uses for MPG_CAP enforcement, just applied to a
  // hand-set value instead of a hit cap. See src/lib/allocate-team.ts for the
  // client-side preview of the same math.
  overrideGames: number | null;
  overrideMpg: number | null;
}
export type TierEdit = {
  team: string; player: string; tier: string; injury: string;
  overrideGames: number | null; overrideMpg: number | null;
};

const keyOf = (r: { team: string; player: string }) => `${r.team}||${r.player}`;

// ── bundled roster reference (works in prod; no runtime fs) ───────────────────
const ROSTER = bundledRoster as DepthRow[];
type EditValue = { tier: string; injury: string; overrideGames: number | null; overrideMpg: number | null };
function baselineMap(): Record<string, EditValue> {
  const m: Record<string, EditValue> = {};
  for (const b of ROSTER) {
    const injury = b.injury || DEFAULT_INJURY;
    const hasOverride = b.overrideGames != null || b.overrideMpg != null;
    if ((b.tier && b.tier !== DEFAULT_TIER) || injury !== DEFAULT_INJURY || hasOverride) {
      m[keyOf(b)] = {
        tier: b.tier, injury,
        overrideGames: b.overrideGames ?? null, overrideMpg: b.overrideMpg ?? null,
      };
    }
  }
  return m;
}

// ── Supabase wiring ──────────────────────────────────────────────────────────
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB_CONFIGURED = Boolean(SB_URL && SB_ANON && SB_SERVICE);
export const DC_SUPABASE_ENABLED =
  SB_CONFIGURED && (process.env.NODE_ENV === "production" || process.env.DC_USE_SUPABASE === "1");

function serviceClient(): SupabaseClient {
  return createSb(SB_URL!, SB_SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Doc = { published: Record<string, EditValue>; draft: Record<string, EditValue> | null };

async function readDoc(): Promise<Doc> {
  const { data } = await serviceClient()
    .from("depth_chart_docs").select("published, draft").eq("season", SEASON).maybeSingle();
  return { published: (data?.published as Record<string, EditValue>) ?? {}, draft: (data?.draft as Record<string, EditValue>) ?? null };
}

async function writeDoc(fields: { published?: Record<string, EditValue>; draft?: Record<string, EditValue> | null }): Promise<void> {
  await serviceClient().from("depth_chart_docs").upsert({
    season: SEASON, ...fields, updated_at: new Date().toISOString(),
  });
}

function sameOverride(a: number | null, b: number | null): boolean {
  return (a ?? null) === (b ?? null);
}

function mergeMap(base: Record<string, EditValue> | null, edits: TierEdit[]): { map: Record<string, EditValue>; changed: number } {
  const seeded = base && Object.keys(base).length ? base : baselineMap();
  const map: Record<string, EditValue> = { ...seeded };
  let changed = 0;
  for (const e of edits) {
    if (!TIER_VALUES.includes(e.tier)) throw new Error(`unknown tier "${e.tier}"`);
    if (!INJURY_VALUES.includes(e.injury)) throw new Error(`unknown injury "${e.injury}"`);
    const k = keyOf(e);
    const prev = map[k] ?? { tier: DEFAULT_TIER, injury: DEFAULT_INJURY, overrideGames: null, overrideMpg: null };
    const noOverride = e.overrideGames == null && e.overrideMpg == null;
    if (prev.tier === e.tier && prev.injury === e.injury
      && sameOverride(prev.overrideGames, e.overrideGames) && sameOverride(prev.overrideMpg, e.overrideMpg)) continue;
    changed += 1;
    if (e.tier === DEFAULT_TIER && e.injury === DEFAULT_INJURY && noOverride) delete map[k];
    else map[k] = { tier: e.tier, injury: e.injury, overrideGames: e.overrideGames, overrideMpg: e.overrideMpg };
  }
  return { map, changed };
}

// ── CSV (file mode) ──────────────────────────────────────────────────────────
const COLUMNS = ["team", "player", "tier", "injury", "override_games", "override_mpg"] as const;
type RawRow = Record<string, string>;
const readRaw = (path: string): RawRow[] => parse(readFileSync(path, "utf8"), { columns: true, skip_empty_lines: true, trim: true });
const csvField = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const parseNum = (v: string | undefined): number | null => (v && v.trim() !== "" ? Number(v) : null);

export function writeCsv(path: string, raws: RawRow[]): void {
  const lines = [COLUMNS.join(",")];
  for (const r of raws) lines.push(COLUMNS.map((c) => csvField(r[c] ?? "")).join(","));
  writeFileSync(path, lines.join("\r\n") + "\r\n", "utf8");
}

function fileApply(edits: TierEdit[]): { raws: RawRow[]; changed: number } {
  const raws = readRaw(existsSync(DRAFT) ? DRAFT : CANONICAL);
  const index = new Map(raws.map((r) => [keyOf({ team: r.team, player: r.player }), r]));
  let changed = 0;
  for (const e of edits) {
    if (!TIER_VALUES.includes(e.tier)) throw new Error(`unknown tier "${e.tier}"`);
    if (!INJURY_VALUES.includes(e.injury)) throw new Error(`unknown injury "${e.injury}"`);
    const row = index.get(keyOf(e));
    if (!row) throw new Error(`no roster row for ${e.player} (${e.team})`);
    const prevInjury = row.injury || DEFAULT_INJURY;
    const prevGames = parseNum(row.override_games);
    const prevMpg = parseNum(row.override_mpg);
    if (row.tier !== e.tier || prevInjury !== e.injury
      || !sameOverride(prevGames, e.overrideGames) || !sameOverride(prevMpg, e.overrideMpg)) {
      row.tier = e.tier; row.injury = e.injury;
      row.override_games = e.overrideGames == null ? "" : String(e.overrideGames);
      row.override_mpg = e.overrideMpg == null ? "" : String(e.overrideMpg);
      changed += 1;
    }
  }
  return { raws, changed };
}

// Read-only accessor for public pages (e.g. team-rosters' depth-chart pop-up) —
// PUBLISHED only, never the WIP draft, and no admin auth required. Mirrors
// loadForEditor's overlay logic but always resolves against doc.published /
// CANONICAL, matching what a visitor sees on the actual site right now.
export async function loadPublishedRows(): Promise<DepthRow[]> {
  if (DC_SUPABASE_ENABLED) {
    const doc = await readDoc();
    const seeded = Object.keys(doc.published).length > 0;
    return ROSTER.map((b) => {
      const ov = seeded ? doc.published[keyOf(b)] : undefined;
      return {
        ...b, tier: ov?.tier ?? b.tier, injury: ov?.injury ?? b.injury ?? DEFAULT_INJURY,
        overrideGames: ov?.overrideGames ?? b.overrideGames ?? null,
        overrideMpg: ov?.overrideMpg ?? b.overrideMpg ?? null,
      };
    });
  }
  const byKey = new Map(readRaw(CANONICAL).map((r) => [keyOf({ team: r.team, player: r.player }), r]));
  return ROSTER.map((b) => {
    const raw = byKey.get(keyOf(b));
    const tier = raw && TIER_VALUES.includes(raw.tier) ? raw.tier : b.tier;
    const injury = raw && INJURY_VALUES.includes(raw.injury) ? raw.injury : (b.injury || DEFAULT_INJURY);
    const overrideGames = raw ? parseNum(raw.override_games) : (b.overrideGames ?? null);
    const overrideMpg = raw ? parseNum(raw.override_mpg) : (b.overrideMpg ?? null);
    return { ...b, tier, injury, overrideGames, overrideMpg };
  });
}

// ── public API (async; the route awaits) ─────────────────────────────────────
export async function loadForEditor(): Promise<{ rows: DepthRow[]; isDraft: boolean; supabase: boolean }> {
  if (DC_SUPABASE_ENABLED) {
    const doc = await readDoc();
    const active = doc.draft ?? doc.published;
    const seeded = Object.keys(doc.published).length > 0 || doc.draft !== null;
    const rows = ROSTER.map((b) => {
      const ov = seeded ? active[keyOf(b)] : undefined;
      return {
        ...b, tier: ov?.tier ?? b.tier, injury: ov?.injury ?? b.injury ?? DEFAULT_INJURY,
        overrideGames: ov?.overrideGames ?? b.overrideGames ?? null,
        overrideMpg: ov?.overrideMpg ?? b.overrideMpg ?? null,
      };
    });
    return { rows, isDraft: doc.draft !== null, supabase: true };
  }
  const isDraft = existsSync(DRAFT);
  const byKey = new Map(readRaw(isDraft ? DRAFT : CANONICAL).map((r) => [keyOf({ team: r.team, player: r.player }), r]));
  const rows = ROSTER.map((b) => {
    const raw = byKey.get(keyOf(b));
    const tier = raw && TIER_VALUES.includes(raw.tier) ? raw.tier : DEFAULT_TIER;
    const injury = raw && INJURY_VALUES.includes(raw.injury) ? raw.injury : DEFAULT_INJURY;
    const overrideGames = raw ? parseNum(raw.override_games) : null;
    const overrideMpg = raw ? parseNum(raw.override_mpg) : null;
    return { ...b, tier, injury, overrideGames, overrideMpg };
  });
  return { rows, isDraft, supabase: false };
}

export async function saveDraft(edits: TierEdit[]): Promise<{ changed: number }> {
  if (DC_SUPABASE_ENABLED) {
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
  if (DC_SUPABASE_ENABLED) {
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
  if (DC_SUPABASE_ENABLED) { await writeDoc({ draft: null }); return; }
  if (existsSync(DRAFT)) rmSync(DRAFT);
}
