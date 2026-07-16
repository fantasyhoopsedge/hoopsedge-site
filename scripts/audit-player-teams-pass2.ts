/**
 * Pass 2: find players where the dynasty consensus team differs from
 * season_player_stats.team, for the current-season datasets only.
 * This catches players who were traded but never played for the new team
 * (e.g. Anthony Davis: traded to WAS, injured, last game log = DAL).
 *
 * Run: npx tsx scripts/audit-player-teams-pass2.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getServiceClient, loadEnv, normalizeName } from "./nba-data/client";
import { isNbaTeam, normalizeTeamAbbr } from "../src/lib/nba-teams";
import type { SupabaseClient } from "@supabase/supabase-js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Only the current-season datasets are relevant — historical seasons can't
// be cross-checked this way because the consensus reflects today's roster.
const DATASETS = [
  { season: 2026, type: "regular", label: "2025-26 Regular" },
  { season: 2026, type: "postseason", label: "2026 Playoffs" },
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

type StatRow = { player_id: string; name: string; team: string | null };
type LogRow = { player_id: string; game_date: string | null; team: string | null };

interface ConsensusEntry {
  player: string;
  team: string;
  position?: string;
  consensusRank?: number;
}

async function main(): Promise<void> {
  loadEnv();
  const supabase = getServiceClient();

  // Load consensus rankings, key by normalized name
  const raw = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "src/lib/dynasty-rankings.json"), "utf8"),
  ) as Record<string, ConsensusEntry>;
  const consensus = new Map<string, ConsensusEntry>();
  for (const entry of Object.values(raw)) {
    if (entry.player) consensus.set(normalizeName(entry.player), entry);
  }
  console.log(`Loaded ${consensus.size} consensus entries.\n`);

  for (const ds of DATASETS) {
    console.log(`Auditing ${ds.label}...`);

    const [stats, logs] = await Promise.all([
      fetchAll<StatRow>(supabase, "season_player_stats", "player_id,name,team", {
        season: ds.season,
        season_type: ds.type,
      }),
      fetchAll<LogRow>(supabase, "nba_player_game_logs", "player_id,game_date,team", {
        season: ds.season,
        season_type: ds.type,
      }),
    ]);

    // Last-game team per player (from pass 1 logic)
    const lastGame = new Map<string, { date: string; team: string | null }>();
    for (const row of logs) {
      if (!row.game_date) continue;
      const prev = lastGame.get(row.player_id);
      if (!prev || row.game_date > prev.date) {
        lastGame.set(row.player_id, { date: row.game_date, team: row.team });
      }
    }

    let matched = 0;
    const mismatches: {
      name: string;
      statsTeam: string | null;
      consensusTeam: string;
      lastGameTeam: string | null;
      note: string;
    }[] = [];

    for (const s of stats) {
      const key = normalizeName(s.name);
      const entry = consensus.get(key);
      if (!entry) continue;
      matched++;

      const cTeam = normalizeTeamAbbr(entry.team);
      if (!cTeam || !isNbaTeam(cTeam)) continue; // skip FA, rookies, etc.

      if (cTeam !== s.team) {
        const lastGameTeam = lastGame.get(s.player_id)?.team ?? null;
        const alreadyCaught = lastGameTeam && lastGameTeam !== s.team;
        mismatches.push({
          name: s.name,
          statsTeam: s.team,
          consensusTeam: cTeam,
          lastGameTeam,
          note: alreadyCaught ? "(also caught in pass 1)" : "*** NEW — traded, no games played for new team",
        });
      }
    }

    console.log(`  ${stats.length} players in stats, ${matched} matched to consensus`);
    console.log(`  ${mismatches.length} consensus-vs-stats mismatches\n`);

    if (mismatches.length > 0) {
      console.log(
        "Player Name".padEnd(30) +
          "Stats Tag".padEnd(12) +
          "Consensus".padEnd(12) +
          "Last Game".padEnd(12) +
          "Note",
      );
      console.log("-".repeat(100));
      for (const m of mismatches) {
        console.log(
          m.name.padEnd(30) +
            (m.statsTeam ?? "null").padEnd(12) +
            m.consensusTeam.padEnd(12) +
            (m.lastGameTeam ?? "null").padEnd(12) +
            m.note,
        );
      }
      console.log();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
