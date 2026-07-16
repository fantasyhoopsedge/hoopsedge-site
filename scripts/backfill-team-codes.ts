/**
 * One-time backfill: rewrite pre-standardization team codes in nba_players and
 * nba_player_game_logs to the FHE standard (docs/FHE_NBA_team_standard_abr.txt,
 * src/lib/nba-teams.ts). These two tables are fed straight from hoopR's raw
 * parquet feed (see scripts/nba-data/client.ts:mapBoxRow), which used its own
 * short codes (GS, NO, NY, SA, UTAH, WSH) for 6 teams — now normalized at
 * ingestion time going forward, but existing rows predate that fix.
 * (Phoenix's hoopR code, "PHX", happens to collide with the other legacy
 * dialect's code for the same team — still needs remapping to "PHO".)
 *
 * Only 7 old codes ever need remapping, so this is a handful of bulk
 * `UPDATE ... WHERE team = X` calls rather than a row-by-row rewrite.
 *
 * Run: npx tsx scripts/backfill-team-codes.ts            # write
 *      npx tsx scripts/backfill-team-codes.ts --dry-run  # count only, no writes
 */
import { getServiceClient, loadEnv } from "./nba-data/client";

const OLD_TO_NEW: Record<string, string> = {
  GS: "GSW",
  NO: "NOR",
  NY: "NYK",
  PHX: "PHO",
  SA: "SAS",
  UTAH: "UTA",
  WSH: "WAS",
};

const TABLES = ["nba_players", "nba_player_game_logs"] as const;

async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  const supabase = getServiceClient();

  for (const table of TABLES) {
    console.log(`\n${table}:`);
    for (const [oldCode, newCode] of Object.entries(OLD_TO_NEW)) {
      const { count, error: countError } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("team", oldCode);
      if (countError) throw new Error(`${table} count(${oldCode}): ${countError.message}`);
      if (!count) continue;

      if (dryRun) {
        console.log(`  [DRY RUN] ${oldCode} -> ${newCode}: ${count} row(s) would be updated`);
        continue;
      }
      const { error: updateError } = await supabase
        .from(table)
        .update({ team: newCode })
        .eq("team", oldCode);
      if (updateError) throw new Error(`${table} update(${oldCode}->${newCode}): ${updateError.message}`);
      console.log(`  ${oldCode} -> ${newCode}: ${count} row(s) updated`);
    }
  }
  console.log(`\n${dryRun ? "Dry run complete." : "Backfill complete."}`);
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
