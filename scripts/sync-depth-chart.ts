/**
 * Bridge the depth chart between Supabase (where the /admin/depth-chart editor writes in
 * PRODUCTION) and the CSV the projection model reads.
 *
 *   npm run depth-chart:sync              # PULL: Supabase published edits -> the CSV.
 *   npm run depth-chart:sync -- --pull    #   (same; run this before a local model run)
 *   npm run depth-chart:sync -- --push    # PUSH: the CSV's current state -> Supabase.
 *   npm run depth-chart:sync -- --dry-run
 *
 * WHY THIS EXISTS. role-context and team-category both had a sync; the depth chart did
 * not, and it is the one carrying the hand-set GP/MPG overrides that Stage 1 locks before
 * allocation. In production the editor writes depth_chart_docs; nothing carried that into
 * data/nba-rosters/depth-chart-2026-27.csv, so a prod-side edit was invisible to
 * project.py. In dev (NODE_ENV !== production, DC_USE_SUPABASE unset) the same editor
 * writes the CSV directly, which is why the local file has been the fuller of the two.
 *
 * THE KEY IS `team||player`, AND PLAYERS CHANGE TEAMS -- the same trap as
 * sync-role-context.ts, and it has cost real data here twice. A stored edit is orphaned
 * under the old team, and every consumer keys the same way: Stage 1 looks up (team,
 * player), misses, and silently drops a hand-set override. So both directions fall back
 * to matching on player NAME when the composite key misses, and report every re-key.
 * Strict on both sides -- a shared name is where a wrong guess hands someone else's
 * minutes to the wrong man.
 *
 * The CSV is the fuller record and the model's interface, so PULL is deliberately
 * CONSERVATIVE: it will not invent rows and it will not blank an override that the CSV
 * has and Supabase does not. Only fields Supabase actually carries for a matched player
 * move. Anything else is reported for a human.
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
const CSV = resolve(REPO, "data/nba-rosters/depth-chart-2026-27.csv");
const COLUMNS = ["team", "player", "tier", "injury", "override_games", "override_mpg"] as const;
const TIERS = new Set(["starter", "rotation", "reserve", "fringe", "cut"]);
const keyOf = (team: string, player: string) => `${team}||${player}`;

type Row = Record<string, string>;
type Edit = { tier: string; injury: string; overrideGames: number | null; overrideMpg: number | null };

const readCsv = (): Row[] => parse(readFileSync(CSV, "utf8"), { columns: true, skip_empty_lines: true, trim: true });
const csvField = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const num = (v: string | undefined): number | null => (v == null || v.trim() === "" ? null : Number(v));
const str = (n: number | null): string => (n == null ? "" : String(n));

function writeCsv(rows: Row[]): void {
  const lines = [COLUMNS.join(",")];
  for (const r of rows) lines.push(COLUMNS.map((c) => csvField(r[c] ?? "")).join(","));
  writeFileSync(CSV, lines.join("\r\n") + "\r\n", "utf8");
}

/** Index published keys by player name, for the re-key fallback. */
function byName(keys: string[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const k of keys) {
    const player = k.slice(k.indexOf("||") + 2);
    m.set(player, [...(m.get(player) ?? []), k]);
  }
  return m;
}

async function readDoc(): Promise<Record<string, Edit>> {
  const { data, error } = await getServiceClient()
    .from("depth_chart_docs").select("published").eq("season", SEASON).maybeSingle();
  if (error) throw error;
  return (data?.published as Record<string, Edit>) ?? {};
}

async function pull(dry: boolean): Promise<void> {
  const pub = await readDoc();
  const rows = readCsv();
  const pubByName = byName(Object.keys(pub));
  const csvNameCount = new Map<string, number>();
  for (const r of rows) csvNameCount.set(r.player, (csvNameCount.get(r.player) ?? 0) + 1);

  const moves: string[] = [], rekeyed: string[] = [], ambiguous: string[] = [];
  const consumed = new Set<string>();
  let changed = 0;
  for (const r of rows) {
    const exact = keyOf(r.team, r.player);
    let e = pub[exact];
    if (e !== undefined) {
      consumed.add(exact);
    } else {
      const cands = pubByName.get(r.player) ?? [];
      if (cands.length === 1 && csvNameCount.get(r.player) === 1) {
        e = pub[cands[0]];
        consumed.add(cands[0]);
        rekeyed.push(`${cands[0]} -> ${exact} — traded since the edit was stored`);
      } else if (cands.length > 1) {
        ambiguous.push(`${r.player}: ${cands.length} published keys (${cands.join(", ")}) — skipped`);
      }
    }
    if (e === undefined) continue;
    if (e.tier && !TIERS.has(e.tier)) throw new Error(`published edit has unknown tier "${e.tier}" for ${r.player}`);
    // Compare NUMERICALLY, and leave the cell alone when it is already equal. The CSV
    // writes 77.0 where the JSON holds 77; a string comparison calls that a change and
    // would rewrite (and re-report) essentially every row on every pull, burying the
    // handful that actually moved in 460 lines of noise.
    const before = `${r.tier}/${r.injury}/${r.override_games || "-"}/${r.override_mpg || "-"}`;
    let moved = false;
    if (e.tier && e.tier !== r.tier) { r.tier = e.tier; moved = true; }
    if (e.injury && e.injury !== (r.injury || "none")) { r.injury = e.injury; moved = true; }
    // CONSERVATIVE: a null in Supabase does not blank a value the CSV has. The CSV is
    // the fuller record; only a real, DIFFERENT number moves.
    if (e.overrideGames != null && e.overrideGames !== num(r.override_games)) {
      r.override_games = str(e.overrideGames); moved = true;
    }
    if (e.overrideMpg != null && e.overrideMpg !== num(r.override_mpg)) {
      r.override_mpg = str(e.overrideMpg); moved = true;
    }
    if (moved) {
      moves.push(`${r.team} ${r.player}: ${before} -> `
        + `${r.tier}/${r.injury}/${r.override_games || "-"}/${r.override_mpg || "-"}`);
      changed += 1;
    }
  }
  const dead = Object.keys(pub).filter((k) => !consumed.has(k));

  console.log(`PULL: ${Object.keys(pub).length} published edit(s) in Supabase; ${changed} CSV row(s) change`);
  for (const m of moves.slice(0, 40)) console.log(`  ${m}`);
  if (moves.length > 40) console.log(`  … and ${moves.length - 40} more`);
  if (rekeyed.length) {
    console.log(`  RE-KEYED ${rekeyed.length} edit(s) by name:`);
    for (const m of rekeyed) console.log(`    ${m}`);
    console.log("    -> run --push to rewrite Supabase under the new keys and clear the orphans");
  }
  if (ambiguous.length) {
    console.log(`  !! ${ambiguous.length} ambiguous name(s), NOT re-keyed:`);
    for (const m of ambiguous) console.log(`    ${m}`);
  }
  if (dead.length) {
    console.log(`  ${dead.length} published key(s) match no CSV row (player cut, or traded twice):`);
    for (const k of dead.slice(0, 20)) console.log(`    ${k} = tier ${pub[k]?.tier ?? "-"}`);
    if (dead.length > 20) console.log(`    … and ${dead.length - 20} more`);
  }
  if (dry) return console.log("(dry run — CSV not written)");
  writeCsv(rows);
  console.log(`wrote ${CSV}`);
}

async function push(dry: boolean): Promise<void> {
  const rows = readCsv();
  const map: Record<string, Edit> = {};
  for (const r of rows) {
    if (!TIERS.has(r.tier)) throw new Error(`CSV has an unknown tier "${r.tier}" for ${r.player}`);
    map[keyOf(r.team, r.player)] = {
      tier: r.tier, injury: r.injury || "none",
      overrideGames: num(r.override_games), overrideMpg: num(r.override_mpg),
    };
  }
  console.log(`PUSH: ${Object.keys(map).length} row(s) from the CSV -> depth_chart_docs.published`);

  // A push REPLACES the stored map, so say what is about to go. An orphan here is
  // usually an edit the CSV has already lost to a trade; overwriting it destroys the
  // only surviving copy. --pull first (it re-keys by name) if any of these are real.
  const before = await readDoc();
  const dropping = Object.keys(before).filter((k) => !(k in map));
  if (dropping.length) {
    console.log(`  !! replaces the stored map and drops ${dropping.length} key(s) not in the CSV:`);
    for (const k of dropping.slice(0, 25)) {
      const e = before[k];
      console.log(`    ${k} = tier ${e?.tier ?? "-"} G ${e?.overrideGames ?? "-"} MPG ${e?.overrideMpg ?? "-"}`);
    }
    if (dropping.length > 25) console.log(`    … and ${dropping.length - 25} more`);
    console.log("    -> if any is a real call, --pull first, then push");
  }
  if (dry) return console.log("(dry run — Supabase not written)");
  const { error } = await getServiceClient().from("depth_chart_docs").upsert({
    season: SEASON, published: map, draft: null, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  console.log("upserted depth_chart_docs");
}

async function main(): Promise<void> {
  loadEnv();
  const args = new Set(process.argv.slice(2));
  const dry = args.has("--dry-run");
  if (args.has("--push")) await push(dry);
  else await pull(dry); // default direction
}

main().catch((e) => { console.error(e); process.exit(1); });
