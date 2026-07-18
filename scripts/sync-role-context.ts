/**
 * Bridge the role-context tiers between Supabase (where the /admin/role-context editor
 * writes in production) and the CSV the projection model reads.
 *
 *   npm run role-context:sync            # PULL: Supabase published tiers -> the CSV.
 *   npm run role-context:sync -- --pull  #   (same; run this before a local model run)
 *   npm run role-context:sync -- --push  # PUSH: the CSV's current tiers -> Supabase.
 *   npm run role-context:sync -- --dry-run
 *
 * PULL is the everyday direction: after editing tiers on the road, this writes them into
 * data/nba-rosters/role-context-2026-27.csv so `python models/minutes-allocator/project.py`
 * picks them up. Only the `tier` column changes; class/dyn_rank/note/source are preserved,
 * and the file is written CRLF to match prep_role_context.py so the diff stays minimal.
 *
 * PUSH seeds/resets the DB from the CSV — use it once to initialise the table, or after
 * editing tiers directly in the CSV and wanting the app to reflect them.
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
const CSV = resolve(REPO, "data/nba-rosters/role-context-2026-27.csv");
const COLUMNS = ["team", "player", "class", "dyn_rank", "tier", "note", "source"];
const TIERS = new Set(["won_job", "expanded", "no_change", "reduced", "clear_backup"]);
const keyOf = (team: string, player: string) => `${team}||${player}`;

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
    .from("role_context_docs").select("published").eq("season", SEASON).maybeSingle();
  if (error) throw error;
  const map = (data?.published as Record<string, string>) ?? {};
  const rows = readCsv();
  let changed = 0;
  const moves: string[] = [];
  for (const r of rows) {
    const next = map[keyOf(r.team, r.player)] ?? "no_change";
    if (!TIERS.has(next)) throw new Error(`published map has an unknown tier "${next}" for ${r.player}`);
    if (r.tier !== next) {
      moves.push(`${r.team} ${r.player}: ${r.tier} -> ${next}`);
      r.tier = next;
      changed += 1;
    }
  }
  console.log(`PULL: ${Object.keys(map).length} non-default tier(s) in Supabase; ${changed} CSV row(s) change`);
  for (const m of moves.slice(0, 40)) console.log(`  ${m}`);
  if (moves.length > 40) console.log(`  … and ${moves.length - 40} more`);
  if (dry) return console.log("(dry run — CSV not written)");
  writeCsv(rows);
  console.log(`wrote ${CSV}`);
}

async function push(dry: boolean): Promise<void> {
  const rows = readCsv();
  const map: Record<string, string> = {};
  for (const r of rows) {
    if (!TIERS.has(r.tier)) throw new Error(`CSV has an unknown tier "${r.tier}" for ${r.player}`);
    if (r.tier !== "no_change") map[keyOf(r.team, r.player)] = r.tier;
  }
  console.log(`PUSH: ${Object.keys(map).length} non-default tier(s) from the CSV -> Supabase.published`);
  if (dry) return console.log("(dry run — Supabase not written)");
  const { error } = await getServiceClient().from("role_context_docs").upsert({
    season: SEASON, published: map, draft: null, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  console.log("upserted role_context_docs");
}

async function main(): Promise<void> {
  loadEnv();
  const args = new Set(process.argv.slice(2));
  const dry = args.has("--dry-run");
  if (args.has("--push")) await push(dry);
  else await pull(dry); // default direction
}

main().catch((e) => { console.error(e); process.exit(1); });
