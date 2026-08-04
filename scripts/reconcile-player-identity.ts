/**
 * Reconcile every consumer table against the player identity registry.
 *
 *   npm run identity:reconcile
 *
 * **READ-ONLY.** No DDL, no writes, no schema change. This is the validation
 * gate that has to pass before anything is keyed on `fhe_id`.
 *
 * ── What it's actually asking ───────────────────────────────────────────────
 * The registry has been verified internally consistent (no duplicate provider
 * ids, idempotent rebuilds, correct spot checks). That is NOT the same claim as
 * "keying on it reproduces today's behaviour", and only the second one justifies
 * building on it. So for every row in every consumer table this asks: if I
 * resolved this row by identity instead of the way I resolve it today, would I
 * land on the same human?
 *
 * Three checks per table:
 *
 *   1. COVERAGE      — does the row resolve to an fhe_id at all?
 *   2. DISAGREEMENT  — the row's id join and its name join both resolve, but to
 *                      DIFFERENT humans. This is the one that matters. It is the
 *                      exact shape of every identity bug FHE has shipped: the
 *                      Harden age-19 rank-reuse bug, and the Fantrax waiver board
 *                      handing a rank-10 player's z-scores to a teamless
 *                      namesake. This set must be empty.
 *   3. COLLISION     — two rows in the same logical scope resolve to ONE fhe_id,
 *                      i.e. the same human appears twice. Directly tests the
 *                      orphan-row hazard in re-keying: build-summer-league-values.ts
 *                      upserts on player_id without sweeping, so changing a
 *                      player's id from `sl-<n>` to a real ESPN id would leave the
 *                      old row behind and show him twice.
 *
 * A clean run is the evidence for Phase 2. A dirty run is the bug list, found
 * for the price of a script run rather than after five tables carry a column.
 *
 * Caveat worth stating: the registry was BUILT from most of these sources, so
 * this is a consistency check, not an independent audit. It earns its keep on
 * the rows that reached the registry by more than one path — those are the only
 * places an id join and a name join can genuinely diverge.
 */
import { promises as fs } from "fs";
import path from "path";
import { getServiceClient, loadEnv } from "./nba-data/client";
import { identityFromRow, PlayerIdentityIndex, type IdentityRecord } from "../src/lib/player-identity";
import { NICKNAME_TO_LEGAL_NAME } from "../src/lib/player-name-aliases";

loadEnv();

const REPORT = path.join(process.cwd(), "output", "identity-reconciliation.md");

interface RegistryRow {
  fhe_id: string;
  display_name: string;
  norm_name: string;
  espn_id: string | null;
  nba_stats_id: string | null;
  bbm_id: string | null;
}

/**
 * Resolves a row two independent ways so they can be compared.
 *
 * The comparison is the whole point, so the two paths must be *separate* here
 * even though `PlayerIdentityIndex.resolve()` would combine them — asking the
 * combined resolver twice would compare it against itself. What the shared index
 * supplies is the id lookup and the alias-aware name lookup; the decision to run
 * them independently and diff the answers is this script's job.
 */
class Resolver {
  constructor(private readonly index: PlayerIdentityIndex) {}

  /** By provider id only — null when the key isn't an ESPN id (sl-/cons-). */
  byId(playerId: string | null): IdentityRecord | null {
    return this.index.byProviderId("espnId", playerId);
  }

  /** By name only, through the alias map. Null when absent OR ambiguous —
   *  an ambiguous name is not a resolution, it's a coin flip. */
  byName(name: string | null): IdentityRecord | null | "ambiguous" {
    const candidates = this.index.candidatesByName(name);
    if (candidates.length === 0) return null;
    return candidates.length === 1 ? candidates[0] : "ambiguous";
  }
}

interface Finding {
  scope: string;
  key: string;
  name: string;
  detail: string;
}

interface TableResult {
  table: string;
  rows: number;
  resolvedById: number;
  resolvedByName: number;
  resolvedEither: number;
  unresolved: Finding[];
  disagreements: Finding[];
  collisions: Finding[];
  ambiguous: Finding[];
}

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

interface Row { playerId: string | null; name: string | null; scope: string }

function reconcile(table: string, rows: Row[], resolver: Resolver): TableResult {
  const res: TableResult = {
    table, rows: rows.length, resolvedById: 0, resolvedByName: 0, resolvedEither: 0,
    unresolved: [], disagreements: [], collisions: [], ambiguous: [],
  };
  // scope -> fhe_id -> the rows that landed on it, for the collision check.
  const seen = new Map<string, Map<string, Row[]>>();

  for (const row of rows) {
    const viaId = resolver.byId(row.playerId);
    const viaName = resolver.byName(row.name);

    if (viaId) res.resolvedById += 1;
    if (viaName && viaName !== "ambiguous") res.resolvedByName += 1;
    if (viaName === "ambiguous") {
      res.ambiguous.push({
        scope: row.scope, key: row.playerId ?? "—", name: row.name ?? "—",
        detail: "name matches more than one identity — a name join here would be a coin flip",
      });
    }

    // THE check: both paths resolved, to different humans.
    if (viaId && viaName && viaName !== "ambiguous" && viaId.fheId !== viaName.fheId) {
      res.disagreements.push({
        scope: row.scope, key: row.playerId ?? "—", name: row.name ?? "—",
        detail: `id join -> ${viaId.fheId} (${viaId.displayName}); name join -> ${viaName.fheId} (${viaName.displayName})`,
      });
    }

    const resolved = viaId ?? (viaName !== "ambiguous" ? viaName : null);
    if (resolved) {
      res.resolvedEither += 1;
      const byScope = seen.get(row.scope) ?? new Map<string, Row[]>();
      const list = byScope.get(resolved.fheId) ?? [];
      list.push(row);
      byScope.set(resolved.fheId, list);
      seen.set(row.scope, byScope);
    } else {
      res.unresolved.push({
        scope: row.scope, key: row.playerId ?? "—", name: row.name ?? "—",
        detail: "no identity by id or name",
      });
    }
  }

  for (const [scope, byFhe] of seen) {
    for (const [fheId, list] of byFhe) {
      if (list.length > 1) {
        res.collisions.push({
          scope, key: fheId, name: list[0].name ?? "—",
          detail: `${list.length} rows resolve to one identity: ${list.map((r) => r.playerId ?? "—").join(", ")}`,
        });
      }
    }
  }
  return res;
}

function summarize(r: TableResult): string {
  const pct = (n: number) => (r.rows ? `${((n / r.rows) * 100).toFixed(1)}%` : "—");
  return [
    `${r.table}  (${r.rows} rows)`,
    `    resolved            ${String(r.resolvedEither).padStart(5)}  ${pct(r.resolvedEither)}`,
    `      by provider id    ${String(r.resolvedById).padStart(5)}`,
    `      by name           ${String(r.resolvedByName).padStart(5)}`,
    `    unresolved          ${String(r.unresolved.length).padStart(5)}`,
    `    DISAGREEMENTS       ${String(r.disagreements.length).padStart(5)}${r.disagreements.length ? "   <-- must be zero" : ""}`,
    `    collisions          ${String(r.collisions.length).padStart(5)}${r.collisions.length ? "   <-- same human twice in one scope" : ""}`,
    `    ambiguous names     ${String(r.ambiguous.length).padStart(5)}`,
  ].join("\n");
}

function section(title: string, findings: Finding[], limit = 25): string {
  if (!findings.length) return `### ${title}\n\nNone.\n`;
  const lines = findings.slice(0, limit).map(
    (f) => `| ${f.scope} | \`${f.key}\` | ${f.name} | ${f.detail} |`,
  );
  const more = findings.length > limit ? `\n\n_…and ${findings.length - limit} more._\n` : "\n";
  return `### ${title} (${findings.length})\n\n| scope | key | name | detail |\n|---|---|---|---|\n${lines.join("\n")}${more}`;
}

async function main(): Promise<void> {
  const supabase = getServiceClient();

  const registry = await fetchAll<RegistryRow>(
    (f, t) => supabase.from("player_identity")
      .select("fhe_id,display_name,norm_name,espn_id,nba_stats_id,bbm_id").range(f, t),
    "player_identity",
  );
  if (registry.length === 0) {
    throw new Error("player_identity is empty — run `npm run identity:build` first.");
  }
  console.log(`Registry: ${registry.length} identities\n`);
  const resolver = new Resolver(
    new PlayerIdentityIndex(registry.map(identityFromRow), NICKNAME_TO_LEGAL_NAME),
  );

  const results: TableResult[] = [];

  // season_player_stats — scoped per dataset, since the same human legitimately
  // appears once per (season, season_type).
  const stats = await fetchAll<{ player_id: string; name: string; season: number; season_type: string }>(
    (f, t) => supabase.from("season_player_stats").select("player_id,name,season,season_type").range(f, t),
    "season_player_stats",
  );
  results.push(reconcile("season_player_stats", stats.map((r) => ({
    playerId: r.player_id, name: r.name, scope: `${r.season}/${r.season_type}`,
  })), resolver));

  // Names for the tables that carry only an id.
  const nameById = new Map<string, string>();
  for (const s of stats) if (!nameById.has(s.player_id)) nameById.set(s.player_id, s.name);

  const trends = await fetchAll<{ player_id: string; player_name: string; season: number; season_type: string }>(
    (f, t) => supabase.from("nba_player_trends").select("player_id,player_name,season,season_type").range(f, t),
    "nba_player_trends",
  );
  results.push(reconcile("nba_player_trends", trends.map((r) => ({
    playerId: r.player_id, name: r.player_name, scope: `${r.season}/${r.season_type}`,
  })), resolver));

  const salary = await fetchAll<{ player_id: string; season: number; league_size: number }>(
    (f, t) => supabase.from("real_salary_values").select("player_id,season,league_size").range(f, t),
    "real_salary_values",
  );
  results.push(reconcile("real_salary_values", salary.map((r) => ({
    playerId: r.player_id, name: nameById.get(r.player_id) ?? null, scope: `${r.season}/${r.league_size}`,
  })), resolver));

  const roster = await fetchAll<{ player_id: string | null; full_name: string; season: string }>(
    (f, t) => supabase.from("nba_roster").select("player_id,full_name,season").range(f, t),
    "nba_roster",
  );
  results.push(reconcile("nba_roster", roster.map((r) => ({
    playerId: r.player_id, name: r.full_name, scope: r.season,
  })), resolver));

  const contracts = await fetchAll<{ player_id: string | null; salary_player_name: string }>(
    (f, t) => supabase.from("nba_contracts").select("player_id,salary_player_name").range(f, t),
    "nba_contracts",
  );
  results.push(reconcile("nba_contracts", contracts.map((r) => ({
    playerId: r.player_id, name: r.salary_player_name, scope: "current",
  })), resolver));

  // dynasty-rankings.json — name-only, and the source most joined against.
  const dynasty = JSON.parse(
    await fs.readFile(path.join(process.cwd(), "src", "lib", "dynasty-rankings.json"), "utf8"),
  ) as { player: string }[];
  results.push(reconcile("dynasty-rankings.json", dynasty.map((p) => ({
    playerId: null, name: p.player, scope: "board",
  })), resolver));

  for (const r of results) console.log(summarize(r), "\n");

  const totalDisagreements = results.reduce((a, r) => a + r.disagreements.length, 0);
  const totalCollisions = results.reduce((a, r) => a + r.collisions.length, 0);

  const md = [
    "# Player identity reconciliation",
    "",
    `Generated ${new Date().toISOString()} · registry ${registry.length} identities · **read-only, nothing was written**`,
    "",
    "Compares what an `fhe_id` join would return against how each table resolves players today.",
    "`DISAGREEMENT` = both the id join and the name join resolved, but to different humans — this is the",
    "shape of every identity bug FHE has shipped, and must be zero before anything is keyed on `fhe_id`.",
    "",
    "## Verdict",
    "",
    totalDisagreements === 0
      ? "**No disagreements.** Every row that resolves both ways resolves to the same player."
      : `**${totalDisagreements} disagreement(s).** Resolve these before Phase 2.`,
    "",
    totalCollisions === 0
      ? "**No collisions.** No table has the same human appearing twice within one scope."
      : `**${totalCollisions} collision(s)** — the same human appears more than once in one scope.`,
    "",
    "## Summary",
    "",
    "| table | rows | resolved | by id | by name | unresolved | disagreements | collisions |",
    "|---|---|---|---|---|---|---|---|",
    ...results.map((r) => `| ${r.table} | ${r.rows} | ${r.resolvedEither} | ${r.resolvedById} | ${r.resolvedByName} | ${r.unresolved.length} | ${r.disagreements.length} | ${r.collisions.length} |`),
    "",
    ...results.flatMap((r) => [
      `## ${r.table}`,
      "",
      section("Disagreements", r.disagreements),
      section("Collisions", r.collisions),
      section("Unresolved", r.unresolved),
      section("Ambiguous names", r.ambiguous),
    ]),
  ].join("\n");

  await fs.mkdir(path.dirname(REPORT), { recursive: true });
  await fs.writeFile(REPORT, `${md}\n`, "utf8");

  console.log("═".repeat(60));
  console.log(`VERDICT: ${totalDisagreements} disagreement(s), ${totalCollisions} collision(s)`);
  console.log(`Report: ${path.relative(process.cwd(), REPORT)}`);
  console.log("Nothing was written to the database.");
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
