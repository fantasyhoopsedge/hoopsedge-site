/**
 * Bridge team-category tags between Supabase (where the team-category selector
 * inside /admin/depth-chart writes in production) and the CSV the projection model reads.
 *
 *   npm run team-category:sync            # PULL: Supabase published tags -> the CSV.
 *   npm run team-category:sync -- --pull  #   (same; run this before a local model run)
 *   npm run team-category:sync -- --push  # PUSH: the CSV's current tags -> Supabase.
 *   npm run team-category:sync -- --dry-run
 *
 * PULL is the everyday direction: after tagging teams on the road, this writes them into
 * data/nba-rosters/team-category-2026-27.csv so `python models/projections-adjuster/project.py`
 * picks them up (apply_depth_chart_corrections() reads TEAM_CATEGORY_CSV directly off disk).
 * Only the `category` column changes; `note` is preserved, and the file is written CRLF to
 * match team_category_baseline.py so the diff stays minimal.
 *
 * PUSH seeds/resets the DB from the CSV — use it once to initialise the table, or after
 * editing categories directly in the CSV and wanting the app to reflect them.
 *
 * Runs under tsx, outside Next; loads .env.local itself (service-role — server/CI only).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { loadEnv, getServiceClient } from "./nba-data/client";

const SEASON = "2026-27";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CSV = resolve(REPO, "data/nba-rosters/team-category-2026-27.csv");
const COLUMNS = ["team", "category", "note"];
// Mirror src/lib/team-category-store.ts's CATEGORY_VALUES and
// models/projections-adjuster/team_category_baseline.py's CATEGORY_OPTIONS.
const CATEGORIES = new Set(["unset", "contending", "playoff_bubble", "bottom3_risk", "safe_middle"]);

type Row = Record<string, string>;
const readCsv = (): Row[] => parse(readFileSync(CSV, "utf8"), { columns: true, skip_empty_lines: true, trim: true });
const csvField = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
function writeCsv(rows: Row[]): void {
  const lines = [COLUMNS.join(",")];
  for (const r of rows) lines.push(COLUMNS.map((c) => csvField(r[c] ?? "")).join(","));
  writeFileSync(CSV, lines.join("\r\n") + "\r\n", "utf8");
}

async function pull(dry: boolean): Promise<void> {
  const { data, error } = await getServiceClient()
    .from("team_category_docs").select("published").eq("season", SEASON).maybeSingle();
  if (error) throw error;
  const map = (data?.published as Record<string, string>) ?? {};
  const rows = readCsv();
  let changed = 0;
  const moves: string[] = [];
  for (const r of rows) {
    const next = map[r.team] ?? "unset";
    if (!CATEGORIES.has(next)) throw new Error(`published map has an unknown category "${next}" for ${r.team}`);
    if (r.category !== next) {
      moves.push(`${r.team}: ${r.category} -> ${next}`);
      r.category = next;
      changed += 1;
    }
  }
  console.log(`PULL: ${Object.keys(map).length} non-default category(ies) in Supabase; ${changed} CSV row(s) change`);
  for (const m of moves) console.log(`  ${m}`);
  if (dry) return console.log("(dry run — CSV not written)");
  writeCsv(rows);
  console.log(`wrote ${CSV}`);
}

async function push(dry: boolean): Promise<void> {
  const rows = readCsv();
  const map: Record<string, string> = {};
  for (const r of rows) {
    if (!CATEGORIES.has(r.category)) throw new Error(`CSV has an unknown category "${r.category}" for ${r.team}`);
    if (r.category !== "unset") map[r.team] = r.category;
  }
  console.log(`PUSH: ${Object.keys(map).length} non-default category(ies) from the CSV -> Supabase.published`);
  if (dry) return console.log("(dry run — Supabase not written)");
  const { error } = await getServiceClient().from("team_category_docs").upsert({
    season: SEASON, published: map, draft: null, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  console.log("upserted team_category_docs");
}

async function main(): Promise<void> {
  loadEnv();
  const args = new Set(process.argv.slice(2));
  const dry = args.has("--dry-run");
  if (args.has("--push")) await push(dry);
  else await pull(dry); // default direction
}

main().catch((e) => { console.error(e); process.exit(1); });
