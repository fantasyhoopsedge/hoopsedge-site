/**
 * Build the precomputed points-league value set and persist it.
 *
 *   npm run points-league:build                     # ALL datasets, upsert to Supabase
 *   npm run points-league:build -- --only 2026:regular
 *   npm run points-league:build -- --dry-run        # compute + print, NO writes
 *
 * UNLIKE seasonal:build, this needs no game logs, no baseline pool, no
 * per-league-size fan-out, and no compute-values.ts involvement at all: a
 * points-league score is a flat weighted sum of six per-game counting stats
 * that season_player_stats ALREADY carries (built by seasonal:build /
 * projections:build). This script only reads that table and does the dot
 * product -- see src/lib/fantrax/analyze.ts's pointsValueOf() for the same
 * shape of computation done live, per-league, for a Fantrax-connected league's
 * own custom weights; this is the standalone, standard-weights, precomputed
 * equivalent.
 *
 * WEIGHTS -- the "Universal Standard Matrix" (Ash, 2026-08-16): the scoring
 * every points-league player means by default when they say "standard points
 * league" (matches Yahoo's standard points format):
 *   PTS +1.0   REB +1.2   AST +1.5   STL +3.0   BLK +3.0   TOV -1.0
 * FG%/FT%/3PM are deliberately NOT weighted -- the standard format doesn't
 * score them, and season_player_stats has no separate FGM/FTM columns anyway
 * (see pointsInputsOf() in analyze.ts for how a *custom* formula that DOES
 * weight makes derives them: fga*fg_pct / fta*ft_pct).
 *
 * DATASETS: every SEASON_DATASETS entry EXCEPT season_type==='summer' -- all
 * historic regular seasons + playoffs, plus the 2026-27 projection. Summer
 * League is exhibition ball on a tiny sample; excluded per instruction, same
 * way it already gets its own separate, non-comparable baseline pool in the
 * 9-cat system.
 *
 * Ranks are computed within each (season, season_type) -- there is no
 * league-size dependency to rank within, unlike season_player_values.
 */
import { getServiceClient, loadEnv } from "./nba-data/client";
import { round1 } from "./build-seasonal-values";
import { SEASON_DATASETS, type SeasonDataset as Dataset } from "../src/lib/value/seasons";

loadEnv();

const DATASETS: readonly Dataset[] = SEASON_DATASETS.filter((d) => d.type !== "summer");

// The Universal Standard Matrix. Keep in sync with the migration's doc comment
// if this ever changes -- there is deliberately no per-league override here,
// that is what the Fantrax connector's live pointsValueOf() is for.
const WEIGHTS = { pts: 1.0, reb: 1.2, ast: 1.5, stl: 3.0, blk: 3.0, tov: -1.0 } as const;

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const onlyArgIdx = argv.indexOf("--only");
const ONLY = onlyArgIdx >= 0 ? argv[onlyArgIdx + 1] : null;

type StatRow = {
  player_id: string;
  season: number;
  season_type: string;
  g: number | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  stl: number | null;
  blk: number | null;
  tov: number | null;
};

async function fetchStats(season: number, seasonType: string): Promise<StatRow[]> {
  const supabase = getServiceClient();
  const cols = "player_id,season,season_type,g,pts,reb,ast,stl,blk,tov";
  const all: StatRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("season_player_stats")
      .select(cols)
      .eq("season", season)
      .eq("season_type", seasonType)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`season_player_stats fetch failed: ${error.message}`);
    const rows = (data ?? []) as StatRow[];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

function fpts(r: StatRow): number | null {
  // Any missing counting stat makes the score meaningless, not just incomplete
  // -- null out rather than silently treating a missing category as zero.
  const vals = [r.pts, r.reb, r.ast, r.stl, r.blk, r.tov];
  if (vals.some((v) => v == null)) return null;
  return (
    WEIGHTS.pts * r.pts! +
    WEIGHTS.reb * r.reb! +
    WEIGHTS.ast * r.ast! +
    WEIGHTS.stl * r.stl! +
    WEIGHTS.blk * r.blk! +
    WEIGHTS.tov * r.tov!
  );
}

async function buildDataset(ds: Dataset): Promise<void> {
  console.log(`\n══ ${ds.label}  (season ${ds.season} / ${ds.type}) ══`);
  const stats = await fetchStats(ds.season, ds.type);
  console.log(`  ${stats.length} season_player_stats row(s)`);
  if (!stats.length) {
    console.log("  (nothing to build -- has seasonal:build/projections:build run for this dataset?)");
    return;
  }

  const scored = stats
    .map((r) => ({ r, pts: fpts(r) }))
    .filter((x): x is { r: StatRow; pts: number } => x.pts != null);
  const skipped = stats.length - scored.length;
  if (skipped) console.log(`  ${skipped} row(s) skipped -- missing a counting stat`);

  scored.sort((a, b) => b.pts - a.pts);

  const rows = scored.map(({ r, pts }, i) => ({
    player_id: r.player_id,
    season: r.season,
    season_type: r.season_type,
    fpts: round1(pts),
    fpts_total: r.g != null ? round1(pts * r.g) : null,
    fpts_rank: i + 1,
    updated_at: new Date().toISOString(),
  }));

  console.log(
    `  top 3: ${rows.slice(0, 3).map((r) => `${r.player_id}=${r.fpts}`).join(", ")}`,
  );

  if (DRY_RUN) {
    console.log(`  (dry run -- ${rows.length} row(s) not written)`);
    return;
  }
  const supabase = getServiceClient();
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from("points_league_values")
      .upsert(chunk, { onConflict: "player_id,season,season_type" });
    if (error) throw new Error(`upsert points_league_values failed: ${error.message}`);
  }
  console.log(`  wrote ${rows.length} row(s)`);
}

async function main(): Promise<void> {
  const targets = ONLY ? DATASETS.filter((d) => `${d.season}:${d.type}` === ONLY) : DATASETS;
  if (!targets.length) throw new Error(`no dataset matches --only ${ONLY}`);
  console.log(`building ${targets.length} dataset(s): ${targets.map((d) => d.label).join(", ")}`);
  for (const ds of targets) await buildDataset(ds);
  console.log("\ndone.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
