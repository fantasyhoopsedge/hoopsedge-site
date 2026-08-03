/**
 * Backfill the Phase 2 dual-key `fhe_id` column on every consumer table.
 *
 *   npm run identity:backfill              # report only (default — writes nothing)
 *   npm run identity:backfill -- --apply   # write the fhe_id values
 *   npm run identity:backfill -- --apply --only nba_roster
 *
 * Additive by construction: it only ever sets a column nothing reads yet, and
 * never touches an existing key. Safe to re-run — it recomputes from the
 * registry every time.
 *
 * ── Resolution ──────────────────────────────────────────────────────────────
 * Identical to what `npm run identity:reconcile` measured, on purpose: provider
 * id first, then normalized name through the alias map, and an ambiguous name
 * is treated as NO answer rather than a coin flip. That reconcile pass found
 * zero disagreements across 9,211 rows, so the per-table coverage printed below
 * should match its numbers; compare them before passing --apply. A divergence
 * means either the registry moved, or the two are not resolving the same way —
 * which is exactly how the real_salary_values name join was caught missing here,
 * 85.8% against reconcile's 98.0%.
 *
 * ── Why it updates per player rather than per row ───────────────────────────
 * PostgREST has no bulk "update these 5,000 rows to 5,000 different values"
 * verb, and an upsert would rewrite whole rows (nulling any column not sent) —
 * unacceptable on live stat and salary tables. So it issues one PATCH per
 * distinct player key, which updates all that player's rows at once and only
 * ever writes the single fhe_id column.
 */
import { getServiceClient, loadEnv, normalizeName } from "./nba-data/client";
import { nameKeyCandidates } from "../src/lib/player-name-aliases";

loadEnv();

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const onlyIdx = argv.indexOf("--only");
const ONLY = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;

/** Concurrent PATCHes. Modest on purpose — this is a live database. */
const CONCURRENCY = 8;

interface RegistryRow {
  fhe_id: string;
  display_name: string;
  norm_name: string;
  espn_id: string | null;
}

type Client = ReturnType<typeof getServiceClient>;

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

class Resolver {
  private byEspn = new Map<string, RegistryRow>();
  private byNorm = new Map<string, RegistryRow[]>();

  constructor(rows: RegistryRow[]) {
    for (const r of rows) {
      if (r.espn_id) this.byEspn.set(r.espn_id, r);
      const list = this.byNorm.get(r.norm_name) ?? [];
      list.push(r);
      this.byNorm.set(r.norm_name, list);
    }
  }

  resolve(playerId: string | null, name: string | null): RegistryRow | null {
    if (playerId) {
      const hit = this.byEspn.get(playerId);
      if (hit) return hit;
    }
    if (!name) return null;
    for (const key of nameKeyCandidates(normalizeName(name))) {
      const hit = this.byNorm.get(key);
      if (hit?.length === 1) return hit[0];
      if (hit && hit.length > 1) return null; // ambiguous is not an answer
    }
    return null;
  }
}

/** One PATCH target: all rows sharing this key get this fhe_id. */
interface Patch { column: "player_id" | "norm_name"; key: string; fheId: string }

interface TableSpec {
  table: string;
  /** Which column identifies a player for the PATCH. */
  keyColumn: "player_id" | "norm_name";
  load: (c: Client) => Promise<{ key: string | null; playerId: string | null; name: string | null }[]>;
}

const TABLES: TableSpec[] = [
  {
    table: "season_player_stats", keyColumn: "player_id",
    load: async (c) => (await fetchAll<{ player_id: string; name: string }>(
      (f, t) => c.from("season_player_stats").select("player_id,name").range(f, t), "season_player_stats",
    )).map((r) => ({ key: r.player_id, playerId: r.player_id, name: r.name })),
  },
  {
    table: "nba_player_trends", keyColumn: "player_id",
    load: async (c) => (await fetchAll<{ player_id: string; player_name: string }>(
      (f, t) => c.from("nba_player_trends").select("player_id,player_name").range(f, t), "nba_player_trends",
    )).map((r) => ({ key: r.player_id, playerId: r.player_id, name: r.player_name })),
  },
  {
    // real_salary_values carries only a player_id — no name column. Resolving
    // on the id alone would strand every row keyed on an `sl-`/`cons-`
    // placeholder (80 of 562), so names are joined in from season_player_stats
    // first, exactly as identity:reconcile does. Without this the two disagree
    // by 69 rows and the coverage check below fails.
    table: "real_salary_values", keyColumn: "player_id",
    load: async (c) => {
      const names = new Map<string, string>();
      const stats = await fetchAll<{ player_id: string; name: string }>(
        (f, t) => c.from("season_player_stats").select("player_id,name").range(f, t), "season_player_stats",
      );
      for (const s of stats) if (!names.has(s.player_id)) names.set(s.player_id, s.name);
      const rows = await fetchAll<{ player_id: string }>(
        (f, t) => c.from("real_salary_values").select("player_id").range(f, t), "real_salary_values",
      );
      return rows.map((r) => ({ key: r.player_id, playerId: r.player_id, name: names.get(r.player_id) ?? null }));
    },
  },
  {
    table: "nba_roster", keyColumn: "norm_name",
    load: async (c) => (await fetchAll<{ norm_name: string; full_name: string; player_id: string | null }>(
      (f, t) => c.from("nba_roster").select("norm_name,full_name,player_id").range(f, t), "nba_roster",
    )).map((r) => ({ key: r.norm_name, playerId: r.player_id, name: r.full_name })),
  },
  {
    table: "nba_contracts", keyColumn: "norm_name",
    load: async (c) => (await fetchAll<{ norm_name: string; salary_player_name: string; player_id: string | null }>(
      (f, t) => c.from("nba_contracts").select("norm_name,salary_player_name,player_id").range(f, t), "nba_contracts",
    )).map((r) => ({ key: r.norm_name, playerId: r.player_id, name: r.salary_player_name })),
  },
];

async function runPatches(supabase: Client, table: string, patches: Patch[]): Promise<void> {
  let done = 0;
  for (let i = 0; i < patches.length; i += CONCURRENCY) {
    const batch = patches.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (p) => {
      const { error } = await supabase
        .from(table)
        // Only ever writes this one column — never a whole-row upsert.
        .update({ fhe_id: p.fheId } as never)
        .eq(p.column, p.key);
      if (error) throw new Error(`${table} patch ${p.key}: ${error.message}`);
    }));
    done += batch.length;
    if (done % 200 < CONCURRENCY) process.stdout.write(`\r    ${done}/${patches.length}`);
  }
  process.stdout.write(`\r    ${patches.length}/${patches.length}\n`);
}

async function main(): Promise<void> {
  const supabase = getServiceClient();

  const registry = await fetchAll<RegistryRow>(
    (f, t) => supabase.from("player_identity").select("fhe_id,display_name,norm_name,espn_id").range(f, t),
    "player_identity",
  );
  if (!registry.length) throw new Error("player_identity is empty — run `npm run identity:build` first.");
  const resolver = new Resolver(registry);
  console.log(`Registry: ${registry.length} identities`);
  console.log(APPLY ? "Mode: APPLY (writing fhe_id)\n" : "Mode: report only (nothing written)\n");

  for (const spec of TABLES) {
    if (ONLY && spec.table !== ONLY) continue;

    const rows = await spec.load(supabase);
    // Collapse to one PATCH per distinct player key.
    const byKey = new Map<string, { playerId: string | null; name: string | null; rows: number }>();
    for (const r of rows) {
      if (!r.key) continue;
      const e = byKey.get(r.key) ?? { playerId: r.playerId, name: r.name, rows: 0 };
      e.rows += 1;
      if (!e.playerId && r.playerId) e.playerId = r.playerId;
      if (!e.name && r.name) e.name = r.name;
      byKey.set(r.key, e);
    }

    const patches: Patch[] = [];
    const unresolved: string[] = [];
    for (const [key, e] of byKey) {
      const hit = resolver.resolve(e.playerId, e.name);
      if (hit) patches.push({ column: spec.keyColumn, key, fheId: hit.fhe_id });
      else unresolved.push(e.name ?? key);
    }

    const coveredRows = rows.filter((r) => {
      if (!r.key) return false;
      const e = byKey.get(r.key)!;
      return resolver.resolve(e.playerId, e.name) !== null;
    }).length;

    console.log(`${spec.table}`);
    console.log(`    rows ${rows.length} · distinct keys ${byKey.size}`);
    console.log(`    resolvable ${patches.length} keys covering ${coveredRows} rows (${((coveredRows / (rows.length || 1)) * 100).toFixed(1)}%)`);
    console.log(`    unresolved ${unresolved.length}${unresolved.length ? `  e.g. ${unresolved.slice(0, 5).join(", ")}` : ""}`);

    if (APPLY && patches.length) await runPatches(supabase, spec.table, patches);
    console.log("");
  }

  if (!APPLY) {
    console.log("Report only. Re-run with --apply to write fhe_id.");
    return;
  }

  // Verify what actually landed, from the database rather than from intent.
  console.log("── verifying written values ──");
  for (const spec of TABLES) {
    if (ONLY && spec.table !== ONLY) continue;
    const total = await fetchAll<{ fhe_id: string | null }>(
      (f, t) => supabase.from(spec.table).select("fhe_id").range(f, t), spec.table,
    );
    const filled = total.filter((r) => r.fhe_id).length;
    console.log(`  ${spec.table.padEnd(22)} ${filled}/${total.length} rows carry an fhe_id (${((filled / (total.length || 1)) * 100).toFixed(1)}%)`);
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
