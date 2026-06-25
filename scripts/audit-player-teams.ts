/**
 * Audit: find players in season_player_stats whose team tag doesn't match
 * the team from their last regular-season game log entry.
 *
 * Run: npx tsx scripts/audit-player-teams.ts
 */
import { getServiceClient, loadEnv } from "./nba-data/client.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const DATASETS = [
  { season: 2026, type: "regular", label: "2025-26 Regular" },
  { season: 2025, type: "regular", label: "2024-25 Regular" },
  { season: 2024, type: "regular", label: "2023-24 Regular" },
];

const PAGE = 1000;

async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  select: string,
  filters: Record<string, unknown>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(select).range(from, from + PAGE - 1);
    for (const [k, v] of Object.entries(filters)) q = (q as ReturnType<typeof q.eq>).eq(k, v);
    const { data, error } = await q;
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

type LogRow = { player_id: string; game_date: string | null; team: string | null };
type StatRow = { player_id: string; name: string; team: string | null };

interface Mismatch {
  name: string;
  player_id: string;
  season: string;
  current_team: string | null;
  correct_team: string | null;
}

async function main(): Promise<void> {
  loadEnv();
  const supabase = getServiceClient();
  const allMismatches: Mismatch[] = [];

  for (const ds of DATASETS) {
    console.log(`\nAuditing ${ds.label}...`);

    const [logs, stats] = await Promise.all([
      fetchAll<LogRow>(supabase, "nba_player_game_logs", "player_id,game_date,team", {
        season: ds.season,
        season_type: ds.type,
      }),
      fetchAll<StatRow>(supabase, "season_player_stats", "player_id,name,team", {
        season: ds.season,
        season_type: ds.type,
      }),
    ]);

    // Find the last game date per player and the team they played for then
    const lastGame = new Map<string, { date: string; team: string | null }>();
    for (const row of logs) {
      if (!row.game_date) continue;
      const prev = lastGame.get(row.player_id);
      if (!prev || row.game_date > prev.date) {
        lastGame.set(row.player_id, { date: row.game_date, team: row.team });
      }
    }

    let checked = 0;
    let mismatches = 0;
    for (const s of stats) {
      const last = lastGame.get(s.player_id);
      if (!last) continue;
      checked++;
      if (last.team && last.team !== s.team) {
        mismatches++;
        allMismatches.push({
          name: s.name,
          player_id: s.player_id,
          season: ds.label,
          current_team: s.team,
          correct_team: last.team,
        });
      }
    }
    console.log(`  ${checked} players checked, ${mismatches} mismatches found`);
  }

  if (allMismatches.length === 0) {
    console.log("\nNo mismatches found — all team tags are correct.");
  } else {
    console.log(`\n=== ${allMismatches.length} TEAM TAG MISMATCHES ===\n`);
    console.log(
      "Player Name".padEnd(30) +
        "Season".padEnd(24) +
        "Current Tag".padEnd(14) +
        "Correct (last game)",
    );
    console.log("-".repeat(82));
    for (const m of allMismatches) {
      console.log(
        m.name.padEnd(30) +
          m.season.padEnd(24) +
          (m.current_team ?? "null").padEnd(14) +
          (m.correct_team ?? "null"),
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
