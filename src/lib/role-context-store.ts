import { parse } from "csv-parse/sync";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Server-only store for the Stage 1 role-context tier pass (dev tool).
 *
 * The projection model's minutes stage reads data/nba-rosters/role-context-2026-27.csv
 * -- a per-player role TIER that the allocator turns into MPG while holding each team to
 * its minute budget. This store lets the /admin/role-context editor read that CSV, save a
 * work-in-progress DRAFT alongside it, and publish over the canonical file. It only makes
 * sense on localhost (it writes the repo working tree); the API route guards prod.
 *
 * The CSV is prepared by models/minutes-allocator/prep_role_context.py, which adds the
 * `class` and `dyn_rank` columns and sorts by team then dynasty rank. This store only ever
 * edits the `tier` column -- every other column (note, source, class, dyn_rank) is
 * preserved byte-for-byte on write, so a publish never clobbers the Python-side prep.
 */

const DATA_DIR = join(process.cwd(), "data", "nba-rosters");
const CANONICAL = join(DATA_DIR, "role-context-2026-27.csv");
const DRAFT = join(DATA_DIR, "role-context-2026-27.draft.csv");

// Mirror of ROLE_TIERS in models/minutes-allocator/minutes.py -- keep the values and
// multipliers byte-identical (Python can't be imported here). The allocator reads a tier
// RELATIVE to team-mates, so "no_change" is the correct default for the large majority.
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

/** CSV column order — preserved exactly on every write. */
const COLUMNS = ["team", "player", "class", "dyn_rank", "tier", "note", "source"] as const;

export interface RoleRow {
  team: string;
  player: string;
  cls: string; // rookie | sophomore | veteran
  dynRank: number | null;
  tier: string;
  note: string;
  source: string;
}

type RawRow = Record<string, string>;

function readRaw(path: string): RawRow[] {
  return parse(readFileSync(path, "utf8"), { columns: true, skip_empty_lines: true, trim: true });
}

function toRoleRow(r: RawRow): RoleRow {
  const rank = (r.dyn_rank ?? "").trim();
  return {
    team: r.team ?? "",
    player: r.player ?? "",
    cls: r.class ?? "veteran",
    dynRank: rank === "" ? null : Number(rank),
    tier: TIER_VALUES.includes(r.tier) ? r.tier : DEFAULT_TIER,
    note: r.note ?? "",
    source: r.source ?? "",
  };
}

/** Escape one CSV field: quote when it holds a comma, quote or newline; double inner quotes. */
function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function writeCsv(path: string, raws: RawRow[]): void {
  // CRLF to match what models/minutes-allocator/prep_role_context.py writes (Python's
  // csv module defaults to \r\n). Matching it means a publish rewrites only the lines
  // whose tier actually changed, instead of flipping every line-ending and churning the
  // whole file in git.
  const lines = [COLUMNS.join(",")];
  for (const r of raws) lines.push(COLUMNS.map((c) => csvField(r[c] ?? "")).join(","));
  writeFileSync(path, lines.join("\r\n") + "\r\n", "utf8");
}

export function hasDraft(): boolean {
  return existsSync(DRAFT);
}

/** The working set the editor sees: the draft if one exists, else the canonical file. */
export function loadForEditor(): { rows: RoleRow[]; isDraft: boolean } {
  const isDraft = hasDraft();
  const raws = readRaw(isDraft ? DRAFT : CANONICAL);
  return { rows: raws.map(toRoleRow), isDraft };
}

export type TierEdit = { team: string; player: string; tier: string };

/** Apply tier edits onto the current working set and return the merged raw rows.
 *  Every non-tier column is carried through untouched. Throws on an unknown tier or a
 *  (team, player) that isn't on the roster. */
function applyEdits(edits: TierEdit[]): { raws: RawRow[]; changed: number } {
  const base = hasDraft() ? DRAFT : CANONICAL;
  const raws = readRaw(base);
  const index = new Map<string, RawRow>();
  for (const r of raws) index.set(`${r.team}||${r.player}`, r);

  let changed = 0;
  for (const e of edits) {
    if (!TIER_VALUES.includes(e.tier)) throw new Error(`unknown tier "${e.tier}"`);
    const row = index.get(`${e.team}||${e.player}`);
    if (!row) throw new Error(`no roster row for ${e.player} (${e.team})`);
    if (row.tier !== e.tier) {
      row.tier = e.tier;
      changed += 1;
    }
  }
  return { raws, changed };
}

/** Save a work-in-progress draft next to the canonical file (never touches canonical). */
export function saveDraft(edits: TierEdit[]): { changed: number } {
  const { raws, changed } = applyEdits(edits);
  writeCsv(DRAFT, raws);
  return { changed };
}

/** Publish over the canonical CSV (what Stage 1 reads), then clear the draft. */
export function publish(edits: TierEdit[]): { changed: number } {
  const { raws, changed } = applyEdits(edits);
  writeCsv(CANONICAL, raws);
  if (hasDraft()) rmSync(DRAFT);
  return { changed };
}

/** Discard the WIP draft, reverting the editor to the canonical file. */
export function discardDraft(): void {
  if (hasDraft()) rmSync(DRAFT);
}
