/**
 * Build the projection-data extract FHE ships to Angle Dynasty for Downtown
 * Fantasy Sports — see [[angle-downtown-fantasy-partnership]] in memory for
 * the deal (FHE gives projection data, gets an API back for a Deep Edge
 * connector). Format is the CSV Ash confirmed 2026-08-18, full player pool:
 *
 *   player,team,fhe_id,espn_id,nba_stats_id,bbm_id,fantrax_id,rotowire_id,
 *   gp,pts,reb,ast,stl,blk,tov,fg3m,fg_pct,ft_pct,
 *   rank_9cat,rank_8cat,rank_minus1,rank_fpts
 *
 *   npm run downtown:export                  # write output/downtown-projections-export.csv
 *   npm run downtown:export -- --out path.csv # write elsewhere
 *   npm run downtown:export -- --dry-run      # compute + print summary, no file written
 *
 * The `downtown:export` npm script runs `identity:backfill --apply --only
 * season_player_stats` FIRST, then this file — see the identity-gap incident
 * in [[angle-downtown-fantasy-partnership]]: build-projection-values.ts never
 * writes fhe_id on its own upserts (unlike seasonal:build), so any player who
 * enters the 2027/projection dataset after the last backfill pass (a
 * free-agent signing, a call-up) silently exports with blank provider ids
 * until backfill catches up. Running it as a pre-step every time closes that
 * gap automatically instead of relying on someone remembering to do it.
 * Running this file directly (not via `npm run downtown:export`) skips that
 * step — fine for a quick dry-run against already-backfilled data, but run
 * the full npm script before a real delivery to Angle Dynasty.
 *
 * SOURCES:
 *  - gp + the 9 per-game counting stats: season_player_stats (season=2027,
 *    season_type='projection' — the dataset projections:build writes from
 *    output/season-projections-2026-27.json).
 *  - rank_9cat: season_player_values.value_rank, and rank_fpts:
 *    points_league_values.fpts_rank, both stored columns.
 *  - rank_8cat / rank_minus1: NOT stored columns. Computed here the same way
 *    the /seasonal-rankings UI does it client-side (see
 *    seasonal-rankings-table.tsx): 8CatV = (value*9 - v_to)/8 (turnovers
 *    removed), then both re-sorted descending over the full pool to get a
 *    rank. Reproduce this logic rather than looking for a rank column that
 *    doesn't exist.
 *  - identity columns: joined on season_player_stats.fhe_id against the full
 *    id ledger `data/player-ids/player-identity.json` (NOT the slim bundled
 *    registry, which lacks rotowire_id). sportradar_id/statsinc_id are
 *    deliberately excluded from this export per Ash's confirmed format.
 *
 * POOL SIZE: 450 (the widest of LEAGUE_SIZES), matching the sample Ash
 * validated against the live /seasonal-rankings page (450-player pool,
 * Minus1V rank-by) — NOT the app's own default CANONICAL_SIZE of 400. If
 * Downtown's convention changes, update DOWNTOWN_LEAGUE_SIZE below.
 *
 * Rows are sorted by rank_minus1 ascending, matching the confirmed sample
 * and the live page's default rank-by mode.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getServiceClient, loadEnv } from "./nba-data/client";

loadEnv();

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IDENTITY_LEDGER_PATH = resolve(REPO_ROOT, "data", "player-ids", "player-identity.json");
const DEFAULT_OUT_PATH = resolve(REPO_ROOT, "output", "downtown-projections-export.csv");

const SEASON = 2027;
const SEASON_TYPE = "projection";
const DOWNTOWN_LEAGUE_SIZE = 450;

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const outArgIdx = argv.indexOf("--out");
const OUT_PATH = outArgIdx >= 0 ? resolve(process.cwd(), argv[outArgIdx + 1]) : DEFAULT_OUT_PATH;

interface StatRow {
  player_id: string;
  name: string;
  team: string | null;
  fhe_id: string | null;
  g: number | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  stl: number | null;
  blk: number | null;
  tov: number | null;
  fg3m: number | null;
  fg_pct: number | null;
  ft_pct: number | null;
}

interface ValueRow {
  player_id: string;
  value: number | null;
  value_rank: number | null;
  minus1v: number | null;
  v_to: number | null;
}

interface PointsRow {
  player_id: string;
  fpts_rank: number | null;
}

interface IdentityLedgerRow {
  fhe_id: string;
  espn_id: string | null;
  nba_stats_id: string | null;
  bbm_id: string | null;
  fantrax_id: string | null;
  rotowire_id: string | null;
}

async function fetchAll<T>(table: string, cols: string, eq: Record<string, string | number>): Promise<T[]> {
  const supabase = getServiceClient();
  const all: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let query = supabase.from(table).select(cols) as any;
    for (const [col, val] of Object.entries(eq)) query = query.eq(col, val);
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

async function main(): Promise<void> {
  console.log(`Building Downtown projections export — season ${SEASON}/${SEASON_TYPE}, pool ${DOWNTOWN_LEAGUE_SIZE}`);

  const stats = await fetchAll<StatRow>(
    "season_player_stats",
    "player_id,name,team,fhe_id,g,pts,reb,ast,stl,blk,tov,fg3m,fg_pct,ft_pct",
    { season: SEASON, season_type: SEASON_TYPE },
  );
  console.log(`  ${stats.length} season_player_stats row(s)`);

  const values = await fetchAll<ValueRow>(
    "season_player_values",
    "player_id,value,value_rank,minus1v,v_to",
    { season: SEASON, season_type: SEASON_TYPE, league_size: DOWNTOWN_LEAGUE_SIZE },
  );
  console.log(`  ${values.length} season_player_values row(s) (league_size=${DOWNTOWN_LEAGUE_SIZE})`);

  const points = await fetchAll<PointsRow>(
    "points_league_values",
    "player_id,fpts_rank",
    { season: SEASON, season_type: SEASON_TYPE },
  );
  console.log(`  ${points.length} points_league_values row(s)`);

  // 8CatV / Minus1V ranks aren't stored — reproduce the UI's client-side math
  // over the FULL pool, then look up each player's rank.
  const withCatv8 = values
    .map((r) => ({
      player_id: r.player_id,
      catv8: r.value != null && r.v_to != null ? (r.value * 9 - r.v_to) / 8 : null,
      minus1v: r.minus1v,
    }));

  const rank8 = new Map<string, number>();
  [...withCatv8]
    .filter((r) => r.catv8 != null)
    .sort((a, b) => b.catv8! - a.catv8!)
    .forEach((r, i) => rank8.set(r.player_id, i + 1));

  const rankM1 = new Map<string, number>();
  [...withCatv8]
    .filter((r) => r.minus1v != null)
    .sort((a, b) => b.minus1v! - a.minus1v!)
    .forEach((r, i) => rankM1.set(r.player_id, i + 1));

  const valueByPlayer = new Map(values.map((v) => [v.player_id, v]));
  const fptsRankByPlayer = new Map(points.map((p) => [p.player_id, p.fpts_rank]));

  const ledger: IdentityLedgerRow[] = JSON.parse(readFileSync(IDENTITY_LEDGER_PATH, "utf8"));
  const ledgerByFheId = new Map(ledger.map((r) => [r.fhe_id, r]));

  let missingFheId = 0;
  let missingValueRow = 0;

  const rows = stats.map((s) => {
    const v = valueByPlayer.get(s.player_id);
    if (!v) missingValueRow++;
    const idRow = s.fhe_id ? ledgerByFheId.get(s.fhe_id) : undefined;
    if (!idRow) missingFheId++;
    return {
      player: s.name,
      team: s.team ?? "",
      fhe_id: s.fhe_id ?? "",
      espn_id: idRow?.espn_id ?? s.player_id,
      nba_stats_id: idRow?.nba_stats_id ?? "",
      bbm_id: idRow?.bbm_id ?? "",
      fantrax_id: idRow?.fantrax_id ?? "",
      rotowire_id: idRow?.rotowire_id ?? "",
      gp: s.g ?? "",
      pts: s.pts ?? "",
      reb: s.reb ?? "",
      ast: s.ast ?? "",
      stl: s.stl ?? "",
      blk: s.blk ?? "",
      tov: s.tov ?? "",
      fg3m: s.fg3m ?? "",
      fg_pct: s.fg_pct ?? "",
      ft_pct: s.ft_pct ?? "",
      rank_9cat: v?.value_rank ?? "",
      rank_8cat: rank8.get(s.player_id) ?? "",
      rank_minus1: rankM1.get(s.player_id) ?? "",
      rank_fpts: fptsRankByPlayer.get(s.player_id) ?? "",
      _sortKey: rankM1.get(s.player_id) ?? Number.POSITIVE_INFINITY,
    };
  });

  rows.sort((a, b) => a._sortKey - b._sortKey);

  console.log(`  ${missingValueRow} row(s) with no season_player_values match (pool ${DOWNTOWN_LEAGUE_SIZE})`);
  console.log(`  ${missingFheId} row(s) with no fhe_id / identity-ledger match`);

  const header = [
    "player", "team", "fhe_id", "espn_id", "nba_stats_id", "bbm_id", "fantrax_id", "rotowire_id",
    "gp", "pts", "reb", "ast", "stl", "blk", "tov", "fg3m", "fg_pct", "ft_pct",
    "rank_9cat", "rank_8cat", "rank_minus1", "rank_fpts",
  ];
  const csv = [
    header.join(","),
    ...rows.map((r) => header.map((k) => {
      const v = (r as Record<string, unknown>)[k];
      if (k === "player" && typeof v === "string" && v.includes(",")) return `"${v.replace(/"/g, '""')}"`;
      return v ?? "";
    }).join(",")),
  ].join("\n");

  console.log(`\n  top 5 by rank_minus1:`);
  for (const r of rows.slice(0, 5)) {
    console.log(`    ${String(r.rank_minus1).padStart(3)}  ${r.player}`);
  }

  if (DRY_RUN) {
    console.log(`\n(dry run — ${rows.length} row(s) not written)`);
    return;
  }

  writeFileSync(OUT_PATH, `${csv}\n`, "utf8");
  console.log(`\n✓ wrote ${rows.length} row(s) to ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
