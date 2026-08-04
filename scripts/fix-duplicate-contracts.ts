/**
 * Remove stale duplicate rows from nba_contracts.
 *
 *   npm run contracts:dedupe            # report only (default — deletes nothing)
 *   npm run contracts:dedupe -- --apply # actually delete the stale rows
 *
 * ── The bug ─────────────────────────────────────────────────────────────────
 * nba_contracts is keyed on `norm_name` and salary_ingest.ts upserts with
 * `onConflict: "norm_name"`. When HoopsHype changes how it lists a player's name
 * between refreshes ("Herbert Jones" -> "Herb Jones"), the next ingest INSERTS a
 * second row under the new key instead of updating the first, and the old row
 * survives forever holding a season-stale contract. Which one a consumer sees
 * then depends on which spelling it happens to join with — the same shape as the
 * documented salary-column offset bug.
 *
 * Found by `npm run identity:reconcile`, which resolved two rows to one identity
 * for Herbert Jones, Ronald Holland II and Hansen Yang. In each case the stale
 * row's `salary_y2` equalled the fresh row's `salary_current` — i.e. it was
 * exactly one season behind.
 *
 * ── Why rows are grouped by IDENTITY, not by player_id ──────────────────────
 * This script originally grouped on `nba_contracts.player_id` and skipped rows
 * where it was null. That catches only the easy half of the bug, and structurally
 * misses the half most likely to occur.
 *
 * `player_id` is itself filled in by a NAME join (salary_ingest.ts `matchPlayer`,
 * CSV name -> nba_players). So a rename that also breaks that join writes the new
 * row with `player_id` null — leaving the stale row as the only one carrying the
 * id, i.e. a group of one, i.e. invisible. Grouping on the very key the rename
 * breaks means the detector fails exactly when the bug is worst.
 *
 * That shipped: Nic Claxton. HoopsHype relisted him as "Nicolas Claxton" between
 * the 2026-07-16 and 2026-07-29 refreshes; the `nicolas claxton` -> `nic claxton`
 * alias didn't exist until 2026-08-03 (39f180f, the Fantrax connector), so the
 * 07-29 ingest wrote the new row with a null `player_id`. `identity:reconcile`
 * saw both rows resolve to fhe_000166; this script saw two singletons and
 * reported "Nothing to do."
 *
 * So the group key is the resolved identity — provider id first, then the
 * alias-aware name, ambiguity refused — via the one shared resolver in
 * `src/lib/player-identity`, the same rule `identity:reconcile` used to find the
 * collision in the first place. `player_id` remains a fallback key for any row
 * the registry doesn't cover, so nothing previously caught stops being caught.
 *
 * ── How the keeper is chosen ────────────────────────────────────────────────
 * Not by guessing, and not by date alone. nba_roster is an INDEPENDENT source
 * for the same season (2026-27), so the keeper is the row whose salary_current
 * matches that player's roster salary_yr1. Only if the roster can't adjudicate
 * does it fall back to the most recently updated row, and if neither is
 * conclusive it refuses to touch the group and says so.
 *
 * Deleting salary rows is not reversible from here, hence report-by-default.
 */
import { getServiceClient, loadEnv } from "./nba-data/client";
import { identityFromRow, PlayerIdentityIndex } from "../src/lib/player-identity";
import { NICKNAME_TO_LEGAL_NAME } from "../src/lib/player-name-aliases";

loadEnv();

const APPLY = process.argv.slice(2).includes("--apply");
const ROSTER_SEASON = "2026-27";

interface Contract {
  norm_name: string;
  salary_player_name: string;
  player_id: string | null;
  team: string | null;
  salary_current: number | null;
  salary_y2: number | null;
  free_agent_year: number | null;
  updated_at: string;
}

interface RegistryRow {
  fhe_id: string;
  display_name: string;
  norm_name: string;
  espn_id: string | null;
  nba_stats_id: string | null;
  bbm_id: string | null;
  dob: string | null;
  draft_year: number | null;
  current_team: string | null;
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

const money = (v: number | null) => (v == null ? "—" : `$${v.toLocaleString("en-US")}`);

/**
 * The key two rows must share to be candidate duplicates.
 *
 * Resolved identity when the registry knows the player, else the raw player_id —
 * so this is a strict superset of the old player_id-only grouping. Null means
 * "cannot be proven a duplicate of anything", and such rows are left alone;
 * deleting a salary row on a guess is worse than leaving a stale one.
 */
function groupKey(
  index: PlayerIdentityIndex,
  playerId: string | null,
  name: string | null,
  team: string | null,
): string | null {
  const hit = index.resolveOrNull({ espnId: playerId, name, team });
  if (hit) return `fhe:${hit.fheId}`;
  return playerId ? `espn:${playerId}` : null;
}

async function main(): Promise<void> {
  const supabase = getServiceClient();

  const registry = await fetchAll<RegistryRow>(
    (f, t) => supabase.from("player_identity")
      .select("fhe_id,display_name,norm_name,espn_id,nba_stats_id,bbm_id,dob,draft_year,current_team")
      .range(f, t),
    "player_identity",
  );
  if (registry.length === 0) {
    throw new Error("player_identity is empty — run `npm run identity:build` first.");
  }
  const index = new PlayerIdentityIndex(registry.map(identityFromRow), NICKNAME_TO_LEGAL_NAME);

  const contracts = await fetchAll<Contract>(
    (f, t) => supabase.from("nba_contracts")
      .select("norm_name,salary_player_name,player_id,team,salary_current,salary_y2,free_agent_year,updated_at")
      .range(f, t),
    "nba_contracts",
  );
  const roster = await fetchAll<{ player_id: string | null; salary_yr1: number | null; norm_name: string; full_name: string; team: string | null }>(
    (f, t) => supabase.from("nba_roster")
      .select("player_id,salary_yr1,norm_name,full_name,team").eq("season", ROSTER_SEASON).range(f, t),
    "nba_roster",
  );
  // Keyed the SAME way as the contract rows, so the adjudication below lines up
  // for a player whose two sources spell him differently — the whole point here.
  const rosterSalary = new Map<string, number>();
  for (const r of roster) {
    if (r.salary_yr1 == null) continue;
    const key = groupKey(index, r.player_id, r.full_name, r.team);
    if (key) rosterSalary.set(key, r.salary_yr1);
  }

  console.log(
    `registry: ${registry.length} identities · nba_contracts: ${contracts.length} rows · ` +
      `nba_roster ${ROSTER_SEASON}: ${roster.length} rows\n`,
  );

  const groups = new Map<string, Contract[]>();
  let unkeyed = 0;
  for (const c of contracts) {
    const key = groupKey(index, c.player_id, c.salary_player_name, c.team);
    if (!key) { unkeyed += 1; continue; }
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }
  if (unkeyed) {
    console.log(`${unkeyed} row(s) resolve to no identity and carry no player_id — not checked.\n`);
  }

  const toDelete: { row: Contract; reason: string }[] = [];
  const skipped: string[] = [];
  let dupeGroups = 0;

  for (const [key, rows] of groups) {
    if (rows.length < 2) continue;
    dupeGroups += 1;

    const rosterVal = rosterSalary.get(key);
    const matches = rosterVal != null ? rows.filter((r) => r.salary_current === rosterVal) : [];

    let keeper: Contract | null = null;
    let why = "";
    if (matches.length === 1) {
      keeper = matches[0];
      why = `salary_current matches nba_roster ${ROSTER_SEASON} salary_yr1 (${money(rosterVal!)})`;
    } else {
      const sorted = [...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      if (sorted[0].updated_at !== sorted[1].updated_at) {
        keeper = sorted[0];
        why = `no roster match; kept most recently updated (${sorted[0].updated_at.slice(0, 10)})`;
      }
    }

    console.log(`${rows[0].salary_player_name}  (${key}) — ${rows.length} rows`);
    for (const r of rows) {
      const mark = keeper && r.norm_name === keeper.norm_name ? "KEEP  " : "DELETE";
      console.log(`   ${mark} '${r.norm_name}' cur=${money(r.salary_current)} y2=${money(r.salary_y2)} fa=${r.free_agent_year} upd=${r.updated_at.slice(0, 10)} pid=${r.player_id ?? "—"}`);
    }

    if (!keeper) {
      console.log("   !! cannot tell which row is current — SKIPPED, resolve by hand\n");
      skipped.push(`${rows[0].salary_player_name} (${key})`);
      continue;
    }
    console.log(`   -> ${why}\n`);
    for (const r of rows) {
      if (r.norm_name !== keeper.norm_name) toDelete.push({ row: r, reason: why });
    }
  }

  console.log("─".repeat(60));
  console.log(`duplicate groups: ${dupeGroups} · rows to delete: ${toDelete.length} · skipped: ${skipped.length}`);
  if (skipped.length) console.log(`  skipped: ${skipped.join(", ")}`);

  if (toDelete.length === 0) {
    console.log("\nNothing to do.");
    return;
  }
  if (!APPLY) {
    console.log("\nReport only — nothing deleted. Re-run with --apply to delete the rows marked DELETE.");
    return;
  }

  for (const { row } of toDelete) {
    const { error } = await supabase.from("nba_contracts").delete().eq("norm_name", row.norm_name);
    if (error) throw new Error(`delete '${row.norm_name}': ${error.message}`);
    console.log(`  deleted '${row.norm_name}'`);
  }
  console.log(`\nDeleted ${toDelete.length} stale row(s).`);
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
