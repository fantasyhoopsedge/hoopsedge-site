/**
 * One-time stats backfill — loads the current season plus the prior 3 seasons
 * of hoopR player-box parquet, upserts players + game logs, then refreshes the
 * season-averages materialized view.
 *
 * Run ONCE to seed history. The daily job (stats_refresh.ts) keeps only the
 * current season fresh; prior-season release files are immutable.
 *
 * Usage:
 *   npx tsx scripts/nba-data/stats_backfill.ts            # write
 *   npx tsx scripts/nba-data/stats_backfill.ts --dry-run  # no writes, report only
 */
import { CURRENT_SEASON } from "./client.ts";
import { ingestSeasons } from "./stats_refresh.ts";

const SEASONS = [CURRENT_SEASON, CURRENT_SEASON - 1, CURRENT_SEASON - 2, CURRENT_SEASON - 3];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(
    `NBA stats backfill — seasons ${SEASONS.join(", ")}${dryRun ? " (DRY RUN, no writes)" : ""}`,
  );
  const result = await ingestSeasons(SEASONS, { dryRun });
  const totalLogs = result.perSeason.reduce((s, x) => s + x.logRows, 0);
  console.log(
    `\nDone. ${dryRun ? "Would touch" : "Touched"} ${totalLogs} game-log rows across ` +
      `${result.perSeason.length} seasons. nba_season_averages rows: ${result.matviewRows ?? "unknown"}`,
  );
}

main().catch((err) => {
  console.error("stats_backfill failed:", err);
  process.exit(1);
});
