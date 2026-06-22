/**
 * Build the precomputed seasonal-rankings value sets and persist them.
 *
 *   npm run seasonal:build              # latest season, upsert to Supabase
 *   npm run seasonal:build -- --season 2026
 *   npm run seasonal:build -- --dry-run # compute + validate, NO writes
 *
 * Pipeline:
 *   1. Aggregate per-game season averages from nba_player_game_logs (the
 *      documented source of truth) for one season's regular games. We read the
 *      logs directly rather than the matview so fga/fta are always available.
 *   2. Run the BBM-style 9-cat value engine for every league size.
 *   3. Validation gate (league_size 400) — must reproduce the reference BBM
 *      export within tolerance, else STOP.
 *   4. Left-join dynasty consensus rank by aggressive-normalized name.
 *   5. Upsert season_player_stats (one row/player) + season_player_values
 *      (one row per player × league_size).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getServiceClient, normalizeName, loadEnv } from "./nba-data/client";
import {
  LEAGUE_SIZES,
  computeAllLeagueSizes,
  type PlayerStats,
  type RankedPlayerValues,
} from "../src/lib/value/compute-values";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const seasonArgIdx = argv.indexOf("--season");
const SEASON_OVERRIDE = seasonArgIdx >= 0 ? Number(argv[seasonArgIdx + 1]) : null;

// ── validation gate reference (BBM export, league_size = 400) ──────────────────
const REF_VALUES: Record<string, number> = {
  "nikola jokic": 1.637,
  "victor wembanyama": 1.537,
  "shai gilgeous-alexander": 1.414,
};
const REF_BASELINE_PTS_MU = 11.76;
const VALUE_TOLERANCE = 0.03;

type LogRow = {
  player_id: string;
  min: number | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  stl: number | null;
  blk: number | null;
  tov: number | null;
  fg3m: number | null;
  fgm: number | null;
  fga: number | null;
  ftm: number | null;
  fta: number | null;
};

type Aggregate = {
  gp: number;
  sumMin: number;
  sumPts: number;
  sumReb: number;
  sumAst: number;
  sumStl: number;
  sumBlk: number;
  sumTov: number;
  sumFg3m: number;
  sumFgm: number;
  sumFga: number;
  sumFtm: number;
  sumFta: number;
};

const n = (v: number | null) => (v == null ? 0 : v);

async function fetchAllLogs(season: number): Promise<LogRow[]> {
  const supabase = getServiceClient();
  const cols = "player_id,min,pts,reb,ast,stl,blk,tov,fg3m,fgm,fga,ftm,fta";
  const all: LogRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("nba_player_game_logs")
      .select(cols)
      .eq("season", season)
      .eq("season_type", "regular")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`game-log fetch failed: ${error.message}`);
    const rows = (data ?? []) as LogRow[];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

async function latestSeason(): Promise<number> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("nba_player_game_logs")
    .select("season")
    .eq("season_type", "regular")
    .order("season", { ascending: false })
    .limit(1);
  if (error) throw new Error(`season probe failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error("no regular-season game logs found");
  return data[0].season as number;
}

async function fetchPlayers(): Promise<Map<string, { name: string; team: string | null; position: string | null }>> {
  const supabase = getServiceClient();
  const map = new Map<string, { name: string; team: string | null; position: string | null }>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("nba_players")
      .select("id,full_name,team,position")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`players fetch failed: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) map.set(r.id as string, { name: r.full_name as string, team: r.team as string | null, position: r.position as string | null });
    if (rows.length < PAGE) break;
  }
  return map;
}

/** dynasty-rankings.json → normalized name → consensusRank. */
function loadConsensusRanks(): Map<string, number> {
  const raw = readFileSync(resolve(REPO_ROOT, "src/lib/dynasty-rankings.json"), "utf8");
  const players = JSON.parse(raw) as Array<{ player: string; consensusRank: number }>;
  const m = new Map<string, number>();
  for (const p of players) {
    const key = normalizeName(p.player);
    if (!m.has(key)) m.set(key, p.consensusRank);
  }
  return m;
}

function aggregate(logs: LogRow[]): Map<string, Aggregate> {
  const agg = new Map<string, Aggregate>();
  for (const r of logs) {
    let a = agg.get(r.player_id);
    if (!a) {
      a = { gp: 0, sumMin: 0, sumPts: 0, sumReb: 0, sumAst: 0, sumStl: 0, sumBlk: 0, sumTov: 0, sumFg3m: 0, sumFgm: 0, sumFga: 0, sumFtm: 0, sumFta: 0 };
      agg.set(r.player_id, a);
    }
    a.gp += 1;
    a.sumMin += n(r.min);
    a.sumPts += n(r.pts);
    a.sumReb += n(r.reb);
    a.sumAst += n(r.ast);
    a.sumStl += n(r.stl);
    a.sumBlk += n(r.blk);
    a.sumTov += n(r.tov);
    a.sumFg3m += n(r.fg3m);
    a.sumFgm += n(r.fgm);
    a.sumFga += n(r.fga);
    a.sumFtm += n(r.ftm);
    a.sumFta += n(r.fta);
  }
  return agg;
}

function buildStats(agg: Map<string, Aggregate>): PlayerStats[] {
  const out: PlayerStats[] = [];
  for (const [playerId, a] of agg) {
    if (a.gp === 0) continue;
    out.push({
      playerId,
      pts: a.sumPts / a.gp,
      fg3m: a.sumFg3m / a.gp,
      reb: a.sumReb / a.gp,
      ast: a.sumAst / a.gp,
      stl: a.sumStl / a.gp,
      blk: a.sumBlk / a.gp,
      tov: a.sumTov / a.gp,
      fgPct: a.sumFga === 0 ? 0 : a.sumFgm / a.sumFga,
      fga: a.sumFga / a.gp,
      ftPct: a.sumFta === 0 ? 0 : a.sumFtm / a.sumFta,
      fta: a.sumFta / a.gp,
    });
  }
  return out;
}

function assertFinite(values: Map<number, RankedPlayerValues[]>): void {
  for (const [size, rows] of values) {
    for (const r of rows) {
      for (const [k, v] of Object.entries(r)) {
        if (typeof v === "number" && !Number.isFinite(v)) {
          throw new Error(`Non-finite ${k}=${v} for player ${r.playerId} at league_size ${size}`);
        }
      }
    }
  }
}

function runValidationGate(
  stats: PlayerStats[],
  agg: Map<string, Aggregate>,
  players: Map<string, { name: string }>,
  values: Map<number, RankedPlayerValues[]>,
): void {
  const ranked400 = values.get(400)!;
  const byId = new Map(ranked400.map((r) => [r.playerId, r]));
  const nameOf = (id: string) => players.get(id)?.name ?? id;

  // Top-15 log
  console.log(`\n── league_size 400: top 15 by value ──`);
  for (const r of ranked400.slice(0, 15)) {
    console.log(`${String(r.valueRank).padStart(2)}. ${nameOf(r.playerId).padEnd(26)} value=${r.value.toFixed(3)} minus1v=${r.minus1v.toFixed(3)}`);
  }

  // Baseline pts μ over the converged top-400 pool (= valueRank ≤ 400).
  const statById = new Map(stats.map((s) => [s.playerId, s]));
  const poolPts = ranked400.slice(0, Math.min(400, ranked400.length)).map((r) => statById.get(r.playerId)!.pts);
  const muPts = poolPts.reduce((a, b) => a + b, 0) / poolPts.length;
  console.log(`\nbaseline p/g μ (top-400 pool) = ${muPts.toFixed(3)} (ref ≈ ${REF_BASELINE_PTS_MU})`);

  // Per-player reference checks
  const failures: string[] = [];
  const normToId = new Map<string, string>();
  for (const id of byId.keys()) normToId.set(normalizeName(nameOf(id)), id);

  for (const [normName, ref] of Object.entries(REF_VALUES)) {
    const id = normToId.get(normName);
    if (!id) {
      failures.push(`reference player "${normName}" not found in feed`);
      continue;
    }
    const got = byId.get(id)!.value;
    const drift = Math.abs(got - ref);
    const ok = drift <= VALUE_TOLERANCE;
    console.log(`${normName.padEnd(26)} value=${got.toFixed(3)} ref=${ref} drift=${drift.toFixed(3)} ${ok ? "OK" : "FAIL"}`);
    if (!ok) failures.push(`${normName}: drift ${drift.toFixed(3)} > ${VALUE_TOLERANCE}`);
  }

  if (Math.abs(muPts - REF_BASELINE_PTS_MU) > 0.5) {
    failures.push(`baseline p/g μ ${muPts.toFixed(3)} far from ref ${REF_BASELINE_PTS_MU}`);
  }

  if (failures.length > 0) {
    throw new Error(`VALIDATION GATE FAILED:\n  - ${failures.join("\n  - ")}`);
  }
  console.log(`\n✓ validation gate passed (league_size 400 within tolerance ${VALUE_TOLERANCE})`);
}

function pos5(position: string | null): string | null {
  if (!position) return null;
  const p = position.toUpperCase();
  if (["PG", "SG", "G"].includes(p)) return "G";
  if (["SF", "PF", "F"].includes(p)) return "F";
  if (p === "C") return "C";
  if (p === "G/F" || p === "F/C" || p === "C/F" || p === "F/G") return p === "F/G" ? "G/F" : p === "C/F" ? "F/C" : p;
  return p;
}

async function upsert(
  stats: PlayerStats[],
  agg: Map<string, Aggregate>,
  players: Map<string, { name: string; team: string | null; position: string | null }>,
  consensus: Map<string, number>,
  values: Map<number, RankedPlayerValues[]>,
): Promise<void> {
  const supabase = getServiceClient();
  const now = new Date().toISOString();

  const statRows = stats.map((s) => {
    const a = agg.get(s.playerId)!;
    const meta = players.get(s.playerId);
    const name = meta?.name ?? s.playerId;
    return {
      player_id: s.playerId,
      name,
      team: meta?.team ?? null,
      position: pos5(meta?.position ?? null),
      headshot_id: s.playerId, // ESPN athlete id (page builds the ESPN headshot URL from this)
      g: a.gp,
      mpg: round1(a.sumMin / a.gp),
      pts: round1(s.pts),
      fg3m: round1(s.fg3m),
      reb: round1(s.reb),
      ast: round1(s.ast),
      stl: round1(s.stl),
      blk: round1(s.blk),
      tov: round1(s.tov),
      fga: round1(s.fga),
      fta: round1(s.fta),
      fg_pct: round3(s.fgPct),
      ft_pct: round3(s.ftPct),
      consensus_rank: consensus.get(normalizeName(name)) ?? null,
      updated_at: now,
    };
  });

  const valueRows: Record<string, unknown>[] = [];
  for (const [size, rows] of values) {
    for (const r of rows) {
      valueRows.push({
        player_id: r.playerId,
        league_size: size,
        v_pts: round3(r.vPts),
        v_fg3: round3(r.vFg3),
        v_reb: round3(r.vReb),
        v_ast: round3(r.vAst),
        v_stl: round3(r.vStl),
        v_blk: round3(r.vBlk),
        v_fg: round3(r.vFg),
        v_ft: round3(r.vFt),
        v_to: round3(r.vTo),
        value: round3(r.value),
        minus1v: round3(r.minus1v),
        value_rank: r.valueRank,
        updated_at: now,
      });
    }
  }

  await batchUpsert(supabase, "season_player_stats", statRows, "player_id");
  await batchUpsert(supabase, "season_player_values", valueRows, "player_id,league_size");
  console.log(`\n✓ upserted ${statRows.length} stat rows + ${valueRows.length} value rows`);
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

async function batchUpsert(
  supabase: ReturnType<typeof getServiceClient>,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<void> {
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`upsert ${table} failed: ${error.message}`);
  }
}

async function main(): Promise<void> {
  loadEnv();
  const season = SEASON_OVERRIDE ?? (await latestSeason());
  console.log(`Building seasonal values for season ${season} (regular)${DRY_RUN ? " [DRY RUN]" : ""}`);

  const logs = await fetchAllLogs(season);
  console.log(`fetched ${logs.length} game-log rows`);
  const agg = aggregate(logs);
  const stats = buildStats(agg);
  console.log(`aggregated ${stats.length} players (the feed)`);

  const players = await fetchPlayers();
  const values = computeAllLeagueSizes(stats);
  for (const size of LEAGUE_SIZES) {
    console.log(`  league_size ${size}: ${values.get(size)!.length} players scored`);
  }

  assertFinite(values);
  runValidationGate(stats, agg, players, values);

  const consensus = loadConsensusRanks();
  const matched = stats.filter((s) => consensus.has(normalizeName(players.get(s.playerId)?.name ?? ""))).length;
  console.log(`consensus rank matched for ${matched}/${stats.length} players`);

  if (DRY_RUN) {
    console.log("\n[DRY RUN] skipping upsert.");
    return;
  }
  await upsert(stats, agg, players, consensus, values);
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
