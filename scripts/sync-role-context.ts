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
 * data/nba-rosters/role-context-2026-27.csv so `python models/projections-adjuster/project.py`
 * picks them up. Only the `tier` column changes; class/dyn_rank/note/source are preserved,
 * and the file is written CRLF to match prep_role_context.py so the diff stays minimal.
 *
 * PUSH seeds/resets the DB from the CSV — use it once to initialise the table, or after
 * editing tiers directly in the CSV and wanting the app to reflect them.
 *
 * THE KEY IS `team||player`, AND PLAYERS CHANGE TEAMS. When one does, his stored tier is
 * orphaned under the old team and a plain PULL silently resets him to no_change — the tier
 * is still in the table, just unreachable. That is not hypothetical: Caris LeVert (DET->MIL)
 * and Luguentz Dort (OKC->ATL) both lost a `reduced` this way before anyone noticed, and it
 * is the same drift that broke the Usage Role publish in 690d651. So PULL falls back to
 * matching on player NAME when the composite key misses, and says so loudly — a re-key is
 * something to see, not something to swallow. The fallback is deliberately strict: it
 * applies only when the name is unique on BOTH sides, because two players sharing a name is
 * exactly the case where guessing would put a tier on the wrong man.
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

  // Name -> published keys, for the re-key fallback. Both indexes are built so the
  // fallback can require uniqueness on each side before it moves a tier.
  const pubByName = new Map<string, string[]>();
  for (const k of Object.keys(map)) {
    const player = k.slice(k.indexOf("||") + 2);
    pubByName.set(player, [...(pubByName.get(player) ?? []), k]);
  }
  const csvNameCount = new Map<string, number>();
  for (const r of rows) csvNameCount.set(r.player, (csvNameCount.get(r.player) ?? 0) + 1);

  let changed = 0;
  const moves: string[] = [];
  const rekeyed: string[] = [];
  const ambiguous: string[] = [];
  const consumed = new Set<string>();
  for (const r of rows) {
    const exact = keyOf(r.team, r.player);
    let next = map[exact];
    if (next !== undefined) {
      consumed.add(exact);
    } else {
      const cands = pubByName.get(r.player) ?? [];
      if (cands.length === 1 && csvNameCount.get(r.player) === 1) {
        next = map[cands[0]];
        consumed.add(cands[0]);
        rekeyed.push(`${cands[0]} -> ${exact} (${next}) — traded since the tier was set`);
      } else if (cands.length > 1) {
        ambiguous.push(`${r.player}: ${cands.length} published keys (${cands.join(", ")}) — left at no_change, set it by hand`);
      }
    }
    next = next ?? "no_change";
    if (!TIERS.has(next)) throw new Error(`published map has an unknown tier "${next}" for ${r.player}`);
    if (r.tier !== next) {
      moves.push(`${r.team} ${r.player}: ${r.tier} -> ${next}`);
      r.tier = next;
      changed += 1;
    }
  }
  const dead = Object.keys(map).filter((k) => !consumed.has(k));
  console.log(`PULL: ${Object.keys(map).length} non-default tier(s) in Supabase; ${changed} CSV row(s) change`);
  for (const m of moves.slice(0, 40)) console.log(`  ${m}`);
  if (moves.length > 40) console.log(`  … and ${moves.length - 40} more`);
  if (rekeyed.length) {
    console.log(`  RE-KEYED ${rekeyed.length} tier(s) by name (team changed under the stored key):`);
    for (const m of rekeyed) console.log(`    ${m}`);
    console.log("    -> run --push to rewrite Supabase under the new keys and clear the orphans");
  }
  if (ambiguous.length) {
    console.log(`  !! ${ambiguous.length} ambiguous name(s), NOT re-keyed:`);
    for (const m of ambiguous) console.log(`    ${m}`);
  }
  if (dead.length) {
    console.log(`  ${dead.length} published key(s) match nobody on a roster (player cut/retired):`);
    for (const k of dead) console.log(`    ${k} = ${map[k]}`);
  }
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

  // A push REPLACES the whole map, so anything in the table and not in the CSV is about
  // to be discarded. Say what, before doing it: an orphaned key here is usually a tier
  // the CSV has already lost to a trade, and overwriting it destroys the only surviving
  // record of the call. Run a --pull first (it re-keys by name) if any of these are real.
  const { data } = await getServiceClient()
    .from("role_context_docs").select("published").eq("season", SEASON).maybeSingle();
  const before = (data?.published as Record<string, string>) ?? {};
  const dropping = Object.keys(before).filter((k) => !(k in map));
  if (dropping.length) {
    console.log(`  !! this REPLACES the stored map and drops ${dropping.length} key(s) not in the CSV:`);
    for (const k of dropping) console.log(`    ${k} = ${before[k]}`);
    console.log("    -> if any is a real call, --pull first (it re-keys by name), then push");
  }
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
