/**
 * Salary / contract ingest — reads the HUMAN-COMMITTED CSV
 * (data/nba-salaries/current.csv) and upserts it into nba_contracts.
 *
 * This is the ONLY way salary data enters the system. No salary website is
 * ever fetched, scraped, or requested — not here, not anywhere. The only
 * network this script touches is Supabase.
 *
 * Expected (documented) header:
 *   player,team,salary_current,salary_y2,salary_y3,salary_y4,salary_y5,contract_note
 * but the column mapping is DETECTED, not assumed by position, so a rougher
 * HoopsHype paste (ranking column, extra columns, year-labelled salary
 * headers) is tolerated. If the player/salary columns can't be found with
 * confidence, the script STOPS and prints the first 5 parsed rows.
 *
 * Usage:
 *   npx tsx scripts/nba-data/salary_ingest.ts            # write
 *   npx tsx scripts/nba-data/salary_ingest.ts --dry-run  # no writes, report only
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { CURRENT_SEASON, getServiceClient, normalizeName } from "./client";
import { normalizeTeamAbbr } from "../../src/lib/nba-teams";
import { lookupWithNameAlias, NICKNAME_TO_LEGAL_NAME } from "../../src/lib/player-name-aliases";
import { identityFromRow, PlayerIdentityIndex } from "../../src/lib/player-identity";
import type { SupabaseClient } from "@supabase/supabase-js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CSV_PATH = resolve(REPO_ROOT, "data/nba-salaries/current.csv");
const UNMATCHED_PATH = resolve(REPO_ROOT, "data/nba-salaries/_unmatched.json");
const UPSERT_CHUNK = 500;

// ── Column detection ──────────────────────────────────────────────────────────
function findCol(header: string[], re: RegExp): number {
  return header.findIndex((h) => re.test(h.trim()));
}
/** Salary columns = our documented names OR year-labelled HoopsHype headers. */
function findSalaryCols(header: string[]): number[] {
  const idxs: number[] = [];
  header.forEach((h, i) => {
    const c = h.trim();
    if (/salary|cap ?hit|^\$|^20\d\d([/-]\d\d)?$|current|^y\d$|year ?\d/i.test(c)) idxs.push(i);
  });
  return idxs;
}

// ── Value cleaning ──────────────────────────────────────────────────────────
function parseMoney(v: string | undefined): number | null {
  if (v == null) return null;
  const s = v.replace(/[$,\s]/g, "").trim();
  if (!s || s === "-" || s === "—") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// ── Derivations (clearly heuristic, from the committed salary data only) ─────
type Derived = {
  free_agent_year: number;
  free_agent_status: "UFA" | "RFA" | null;
  is_two_way: boolean;
};
function derive(futureSalaries: (number | null)[], note: string | null): Derived {
  const futureCount = futureSalaries.filter((s) => s != null).length;
  const free_agent_year = CURRENT_SEASON + futureCount + 1;
  const n = note ?? "";
  const is_two_way = /two[- ]?way|\bTW\b/i.test(n);
  let free_agent_status: "UFA" | "RFA" | null = null;
  if (/qualifying|\bQO\b/i.test(n)) free_agent_status = "RFA";
  else if (futureCount === 0) free_agent_status = "UFA"; // expires within one season
  return { free_agent_year, free_agent_status, is_two_way };
}

type ContractRow = {
  player_id: string | null;
  salary_player_name: string;
  norm_name: string;
  team: string | null;
  salary_current: number | null;
  salary_y2: number | null;
  salary_y3: number | null;
  salary_y4: number | null;
  salary_y5: number | null;
  contract_note: string | null;
  free_agent_year: number;
  free_agent_status: string | null;
  is_two_way: boolean;
  source: string;
  updated_at: string;
};

/** Build a norm_name -> [{id, team}] index of known players for the join. */
async function loadPlayerIndex(supabase: SupabaseClient) {
  const index = new Map<string, { id: string; team: string | null }[]>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("nba_players")
      .select("id,norm_name,team")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load nba_players: ${error.message}`);
    if (!data?.length) break;
    for (const p of data) {
      const arr = index.get(p.norm_name) ?? [];
      arr.push({ id: p.id, team: p.team });
      index.set(p.norm_name, arr);
    }
    if (data.length < PAGE) break;
  }
  return index;
}

/** Match a salary row to a player id by norm_name, tiebreaking on team. */
function matchPlayer(
  index: Map<string, { id: string; team: string | null }[]>,
  norm: string,
  team: string | null,
): string | null {
  const cands = lookupWithNameAlias(index, norm);
  if (!cands || cands.length === 0) return null;
  if (cands.length === 1) return cands[0].id;
  if (team) {
    const t = team.trim().toUpperCase();
    const byTeam = cands.find(
      (c) => c.team && (c.team.toUpperCase() === t || t.includes(c.team.toUpperCase())),
    );
    if (byTeam) return byTeam.id;
  }
  return null; // ambiguous -> treat as unmatched for human review
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * The player registry, for the sweep below. Null (with a warning) when it isn't
 * populated yet — see the sweep's note on why that degrades rather than throws.
 */
async function loadIdentityIndex(
  supabase: ReturnType<typeof getServiceClient>,
): Promise<PlayerIdentityIndex | null> {
  const rows: Parameters<typeof identityFromRow>[0][] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("player_identity")
      .select("fhe_id,display_name,norm_name,espn_id,nba_stats_id,bbm_id,dob,draft_year,current_team")
      .range(from, from + 999);
    if (error) {
      console.warn(`player_identity unreadable (${error.message}) — sweep falls back to player_id only.`);
      return null;
    }
    rows.push(...((data ?? []) as typeof rows));
    if ((data?.length ?? 0) < 1000) break;
  }
  if (rows.length === 0) {
    console.warn("player_identity is empty — sweep falls back to player_id only. Run `npm run identity:build`.");
    return null;
  }
  return new PlayerIdentityIndex(rows.map(identityFromRow), NICKNAME_TO_LEGAL_NAME);
}

/**
 * Delete rows this ingest orphaned by a NAME CHANGE.
 *
 * nba_contracts is keyed on `norm_name`, so when HoopsHype relists a player
 * under a different name ("Herbert Jones" -> "Herb Jones") the upsert above
 * inserts a SECOND row and the old one survives, holding a season-stale
 * contract. Which row a consumer then reads depends on which spelling it joins
 * with — the same failure mode as the salary-column offset bug.
 *
 * That shipped: Herbert Jones, Ronald Holland II and Hansen Yang each carried
 * two rows a full season apart, found 2026-08-03 by `npm run identity:reconcile`
 * and cleaned up by scripts/fix-duplicate-contracts.ts. This sweep stops it
 * recurring.
 *
 * Scoped deliberately tightly: only rows resolving to the same PLAYER as a row
 * this ingest just wrote, whose `norm_name` is NOT in the current CSV. A player
 * who simply dropped off the salary sheet keeps his row (that's a data gap, not
 * a rename), and a row that resolves to nobody is never touched since it can't
 * be proven a duplicate.
 *
 * ── Why "same player" is resolved, not read off player_id ───────────────────
 * This used to compare `player_id` alone, and so missed the half of the bug it
 * matters most on. `player_id` is filled by `matchPlayer` — a NAME join against
 * nba_players — so a rename that ALSO breaks that join writes the new row with a
 * null id, and the two rows then share nothing to group on. The guard was keyed
 * on the very thing the rename breaks.
 *
 * That is exactly how Nic Claxton got past it: HoopsHype relisted him as
 * "Nicolas Claxton" on 2026-07-29, the `nicolas claxton` alias didn't exist until
 * 2026-08-03, so the new row landed with player_id null, this sweep saw nothing,
 * and a stale $25.5M row survived beside the real $23.3M one until
 * `identity:reconcile` found them resolving to one fhe_id on 2026-08-04.
 *
 * So identity comes from the shared resolver (`src/lib/player-identity`) —
 * provider id first, then the alias-aware name, ambiguity refused — which is the
 * same rule `identity:reconcile` and `contracts:dedupe` use. player_id remains a
 * fallback key, so nothing previously swept stops being swept. If the registry
 * is empty the sweep degrades to the old id-only behaviour rather than failing
 * the ingest: a missed sweep is a stale row, an aborted ingest is no salaries.
 */
async function sweepRenamedDuplicates(
  supabase: ReturnType<typeof getServiceClient>,
  written: ContractRow[],
  dryRun = false,
): Promise<void> {
  const index = await loadIdentityIndex(supabase);
  const keyOf = (playerId: string | null, name: string | null, team: string | null): string | null => {
    const hit = index?.resolveOrNull({ espnId: playerId, name, team });
    if (hit) return `fhe:${hit.fheId}`;
    return playerId ? `espn:${playerId}` : null;
  };

  const writtenNames = new Set(written.map((c) => c.norm_name));
  const writtenKeys = new Set(
    written.map((c) => keyOf(c.player_id, c.salary_player_name, c.team)).filter((k): k is string => Boolean(k)),
  );
  if (writtenKeys.size === 0) return;

  const { data, error } = await supabase
    .from("nba_contracts")
    .select("norm_name,salary_player_name,player_id,team");
  if (error) throw new Error(`nba_contracts sweep read: ${error.message}`);

  const stale = (data ?? []).filter((r) => {
    if (writtenNames.has(r.norm_name as string)) return false;
    const key = keyOf(r.player_id as string | null, r.salary_player_name as string, r.team as string | null);
    return key != null && writtenKeys.has(key);
  });
  if (stale.length === 0) return;

  if (dryRun) {
    console.log(
      `Would sweep ${stale.length} row(s) orphaned by a name change: ` +
        stale.map((r) => `'${r.norm_name}'`).join(", "),
    );
    return;
  }
  for (const r of stale) {
    const { error: delErr } = await supabase
      .from("nba_contracts").delete().eq("norm_name", r.norm_name as string);
    if (delErr) throw new Error(`nba_contracts sweep delete '${r.norm_name}': ${delErr.message}`);
  }
  console.log(
    `Swept ${stale.length} row(s) orphaned by a name change: ` +
      stale.map((r) => `'${r.norm_name}'`).join(", "),
  );
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!existsSync(CSV_PATH)) {
    console.error(`No salary CSV at ${CSV_PATH}. Commit data/nba-salaries/current.csv first.`);
    process.exit(1);
  }

  // Parse permissively: keep rows as arrays, tolerate ragged column counts.
  const rows: string[][] = parse(readFileSync(CSV_PATH, "utf8"), {
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: true,
  });
  if (rows.length < 2) {
    console.error("CSV has no data rows.");
    process.exit(1);
  }

  const header = rows[0];
  const playerIdx = findCol(header, /\bplayer\b|\bname\b/i);
  const teamIdx = findCol(header, /\bteam\b/i);
  const noteIdx = findCol(header, /note|option|guarantee|status|type|comment/i);
  const salaryIdxs = findSalaryCols(header).slice(0, 5); // current, y2, y3, y4, y5

  // Confidence gate — STOP and show a sample if we can't map the key columns.
  if (playerIdx === -1 || salaryIdxs.length === 0) {
    console.error(
      "Could not confidently map the player/salary columns.\n" +
        `Detected header: ${JSON.stringify(header)}\n` +
        `playerIdx=${playerIdx} salaryIdxs=${JSON.stringify(salaryIdxs)}\n` +
        "First 5 parsed rows:",
    );
    for (const r of rows.slice(1, 6)) console.error("  " + JSON.stringify(r));
    process.exit(1);
  }

  const now = new Date().toISOString();
  const contracts: ContractRow[] = [];
  const supabase = getServiceClient();
  const index = await loadPlayerIndex(supabase);

  for (const row of rows.slice(1)) {
    const name = (row[playerIdx] ?? "").trim();
    if (!name) continue; // blank / spacer / totals row
    const norm = normalizeName(name);
    const team = teamIdx >= 0 ? normalizeTeamAbbr(row[teamIdx]) : null;
    const sal = salaryIdxs.map((i) => parseMoney(row[i]));
    const note = noteIdx >= 0 ? (row[noteIdx] ?? "").trim() || null : null;
    const d = derive(sal.slice(1), note); // future = y2..y5

    contracts.push({
      player_id: matchPlayer(index, norm, team),
      salary_player_name: name,
      norm_name: norm,
      team,
      salary_current: sal[0] ?? null,
      salary_y2: sal[1] ?? null,
      salary_y3: sal[2] ?? null,
      salary_y4: sal[3] ?? null,
      salary_y5: sal[4] ?? null,
      contract_note: note,
      free_agent_year: d.free_agent_year,
      free_agent_status: d.free_agent_status,
      is_two_way: d.is_two_way,
      source: "hoopshype_manual_csv",
      updated_at: now,
    });
  }

  // Dedupe on norm_name (PK) — last occurrence wins.
  const byNorm = new Map<string, ContractRow>();
  for (const c of contracts) byNorm.set(c.norm_name, c);
  const deduped = [...byNorm.values()];

  const unmatched = deduped.filter((c) => !c.player_id);

  if (!dryRun) {
    for (const c of chunk(deduped, UPSERT_CHUNK)) {
      const { error } = await supabase
        .from("nba_contracts")
        .upsert(c, { onConflict: "norm_name" });
      if (error) throw new Error(`nba_contracts upsert: ${error.message}`);
    }
    await sweepRenamedDuplicates(supabase, deduped);
  } else {
    // Report-only sweep. The sweep is the one part of this script whose blast
    // radius is a DELETE, and it used to be unobservable without writing —
    // which is precisely why its player_id blind spot went unnoticed. --dry-run
    // now shows what it would remove.
    await sweepRenamedDuplicates(supabase, deduped, true);
  }

  // Always write the unmatched report — the human's spot-check list.
  writeFileSync(
    UNMATCHED_PATH,
    JSON.stringify(
      unmatched.map((c) => ({
        salary_player_name: c.salary_player_name,
        norm_name: c.norm_name,
        team: c.team,
        salary_current: c.salary_current,
      })),
      null,
      2,
    ),
  );

  console.log(
    `Salary ingest${dryRun ? " (DRY RUN, no writes)" : ""}: ` +
      `${deduped.length} contracts ${dryRun ? "would be upserted" : "upserted"}, ` +
      `${unmatched.length} unmatched.`,
  );
  if (unmatched.length) {
    console.log(`\nUnmatched (see ${UNMATCHED_PATH}):`);
    for (const c of unmatched) console.log(`  - ${c.salary_player_name} (${c.team ?? "?"})`);
  }
}

main().catch((err) => {
  console.error("salary_ingest failed:", err);
  process.exit(1);
});
