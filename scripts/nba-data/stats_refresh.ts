/**
 * Daily stats refresh — downloads ONLY the current-season hoopR player-box
 * parquet, upserts players + game logs, and refreshes the season-averages
 * materialized view. Prior seasons are immutable, so they are never re-pulled
 * (use stats_backfill.ts once for those).
 *
 * Usage:
 *   npx tsx scripts/nba-data/stats_refresh.ts            # write
 *   npx tsx scripts/nba-data/stats_refresh.ts --dry-run  # no writes, report only
 *
 * Idempotent: game-log upserts key on (game_id, player_id); player upserts on id.
 */
import { asyncBufferFromUrl, parquetReadObjects } from "hyparquet";
import {
  CURRENT_SEASON,
  boxScoreUrl,
  getServiceClient,
  mapBoxRow,
  type GameLog,
  type Player,
} from "./client";
import type { SupabaseClient } from "@supabase/supabase-js";

const UPSERT_CHUNK = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry a transient operation with exponential backoff (1s, 2s, 4s). */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const wait = 1000 * 2 ** i;
        console.warn(`  ${label} failed (attempt ${i + 1}/${attempts}), retrying in ${wait}ms…`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

/** Fetch + parse one season's parquet into deduped logs and players. */
async function loadSeason(season: number, now: string) {
  const rows = await withRetry(`download season ${season}`, async () => {
    const file = await asyncBufferFromUrl({ url: boxScoreUrl(season) });
    return (await parquetReadObjects({ file })) as Record<string, unknown>[];
  });

  const logs: GameLog[] = [];
  const playersById = new Map<string, Player>();
  for (const row of rows) {
    const mapped = mapBoxRow(row, now);
    if (!mapped) continue;
    logs.push(mapped.log);
    // last write wins -> a player's team/position reflect their latest game.
    playersById.set(mapped.player.id, mapped.player);
  }
  return { rawRows: rows.length, logs, players: [...playersById.values()] };
}

/** Upsert players (FK target) THEN logs, in chunks. */
async function writeSeason(
  supabase: SupabaseClient,
  players: Player[],
  logs: GameLog[],
): Promise<void> {
  for (const c of chunk(players, UPSERT_CHUNK)) {
    const { error } = await supabase
      .from("nba_players")
      .upsert(c, { onConflict: "id" });
    if (error) throw new Error(`nba_players upsert: ${error.message}`);
  }
  for (const c of chunk(logs, UPSERT_CHUNK)) {
    const { error } = await supabase
      .from("nba_player_game_logs")
      .upsert(c, { onConflict: "game_id,player_id" });
    if (error) throw new Error(`nba_player_game_logs upsert: ${error.message}`);
  }
}

async function seasonAveragesCount(supabase: SupabaseClient): Promise<number | null> {
  const { count, error } = await supabase
    .from("nba_season_averages")
    .select("*", { count: "exact", head: true });
  if (error) return null;
  return count ?? null;
}

export type IngestResult = {
  dryRun: boolean;
  perSeason: { season: number; rawRows: number; logRows: number; players: number }[];
  matviewRows: number | null;
};

/**
 * Ingest the given seasons. Shared by both the daily refresh (current season
 * only) and the one-time backfill (current + prior 3). When dryRun is true,
 * nothing is written and the matview is not refreshed.
 */
export async function ingestSeasons(
  seasons: number[],
  opts: { dryRun?: boolean } = {},
): Promise<IngestResult> {
  const dryRun = opts.dryRun ?? false;
  const now = new Date().toISOString();
  const supabase = getServiceClient();
  const ordered = [...seasons].sort((a, b) => a - b); // ascending: current season writes last

  const perSeason: IngestResult["perSeason"] = [];
  for (const season of ordered) {
    process.stdout.write(`  season ${season}: downloading… `);
    const { rawRows, logs, players } = await loadSeason(season, now);
    process.stdout.write(`${rawRows} rows -> ${logs.length} logs / ${players.length} players`);
    if (!dryRun) {
      await writeSeason(supabase, players, logs);
      process.stdout.write(" (upserted)");
    }
    process.stdout.write("\n");
    perSeason.push({ season, rawRows, logRows: logs.length, players: players.length });
  }

  if (!dryRun) {
    process.stdout.write("  refreshing nba_season_averages… ");
    const { error } = await supabase.rpc("refresh_nba_season_averages");
    if (error) throw new Error(`refresh matview: ${error.message}`);
    process.stdout.write("done\n");
  }

  return { dryRun, perSeason, matviewRows: await seasonAveragesCount(supabase) };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(
    `NBA stats refresh — season ${CURRENT_SEASON}${dryRun ? " (DRY RUN, no writes)" : ""}`,
  );
  const result = await ingestSeasons([CURRENT_SEASON], { dryRun });
  const totalLogs = result.perSeason.reduce((s, x) => s + x.logRows, 0);
  console.log(
    `\nDone. ${dryRun ? "Would touch" : "Touched"} ${totalLogs} game-log rows. ` +
      `nba_season_averages rows: ${result.matviewRows ?? "unknown"}`,
  );
}

// Run only when invoked directly (so stats_backfill can import ingestSeasons).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("stats_refresh.ts")) {
  main().catch((err) => {
    console.error("stats_refresh failed:", err);
    process.exit(1);
  });
}
