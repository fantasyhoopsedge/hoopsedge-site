/**
 * Build season_player_stats / season_player_values for the "2026-27 Projections"
 * dataset (season=2027, season_type="projection") from the Python projections
 * model's Stage 5 artifact (output/season-projections-2026-27.json) — NOT from
 * real game logs, since 2026-27 hasn't been played yet.
 *
 * Sibling to build-seasonal-values.ts, reusing everything from it that
 * generalizes (loadConsensus, pos5, round1/round3, batchUpsert, assertFinite)
 * without touching its real-game-log aggregation path at all. computeAllLeagueSizes
 * (the engine itself) is untouched — same 9-cat math, just fed a different
 * PlayerStats source.
 *
 * NO VALIDATION GATE: build-seasonal-values.ts's gate checks per-game values
 * against a reference export of REAL 2025-26 results — there is no equivalent
 * reference for a projection season. Same reasoning the summer-league datasets
 * already use to opt out (see seasons.ts's GATE_DATASET check).
 *
 * The artifact already carries display name/team/position per player (Stage 1/5
 * built them from the roster CSV + role-context/depth-chart passes), so unlike
 * the real-season build this script needs no nba_players lookup at all.
 *
 * IDENTITY FALLBACK for 2026 draftees: the Python pipeline's athlete_id only
 * resolves against REGULAR-SEASON hoopR history (models/data-foundation), which
 * a brand-new draftee has none of — Stage 5 emits `athlete_id: null` for them.
 * But Summer League 2026 (build-summer-league-values.ts) already ran and already
 * solved this exact problem: it resolves each player to their real hoopR id when
 * one exists, else a stable synthetic `sl-<nbaComId>` (the same scheme still
 * live for 295 of 444 SL-2026 rows today). We reuse THAT resolution — join this
 * artifact's null-id players onto season_player_stats(season=2026,
 * season_type='summer') by normalized name — rather than inventing a second,
 * incompatible id scheme. A player who skipped Summer League (rare) still has no
 * id anywhere and stays excluded; that's a real, separate gap, not this one.
 *
 *   npm run projections:build              # compute + upsert to Supabase
 *   npm run projections:build -- --dry-run # compute + print, no writes
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getServiceClient, normalizeName, loadEnv } from "./nba-data/client";
import { lookupWithNameAlias } from "../src/lib/player-name-aliases";
import {
  computeAllLeagueSizes,
  type PlayerStats,
  type RankedPlayerValues,
} from "../src/lib/value/compute-values";
import {
  assertFinite, batchUpsert, loadConsensus, pos5, round1, round3,
} from "./build-seasonal-values";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_PATH = resolve(REPO_ROOT, "output", "season-projections-2026-27.json");
const SEASON = 2027;
const SEASON_TYPE = "projection";

const DRY_RUN = process.argv.includes("--dry-run");

export interface ArtifactPlayer {
  athlete_id: number | null;
  player: string;
  team: string;
  pos: string;
  projGames: number;
  projMpg: number;
  // Stage 5 durability signal, availability-based (see season-projections-model
  // memory) — reused by scripts/build-real-salary-values.ts as the discount
  // input for Real Salary Rankings. Not currently persisted to Supabase by
  // this script (season_player_stats/values have no column for it), so
  // consumers read it straight from the artifact via resolvePlayers().
  confidenceTier: "High" | "Medium" | "Low";
  perGame: {
    pts: number; reb: number; ast: number; stl: number; blk: number; tov: number;
    fg3m: number; fgm: number; fga: number; ftm: number; fta: number;
    fgPct: number; ftPct: number;
  };
  totals: {
    pts: number; reb: number; ast: number; stl: number; blk: number; tov: number;
    fg3m: number; fgm: number; fga: number; ftm: number; fta: number;
  };
}

export interface Artifact {
  season: number;
  seasonLabel: string;
  generatedAt: string;
  players: ArtifactPlayer[];
}

export function loadArtifact(): Artifact {
  const raw = readFileSync(ARTIFACT_PATH, "utf8");
  return JSON.parse(raw) as Artifact;
}

/** The Summer League year Stage 1's regular-season-only lookup can't cover —
 *  the current draft class's on-ramp to the league. */
const FALLBACK_SEASON = 2026;
const FALLBACK_TYPE = "summer";

/** Normalized name -> player_id from Summer League 2026's own already-resolved
 *  identities (real hoopR id where one exists, else its stable sl-<nbaComId>).
 *  See the module docstring for why this is the right identity source, not a
 *  new one. */
export async function loadFallbackIds(): Promise<Map<string, string>> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("season_player_stats")
    .select("player_id,name")
    .eq("season", FALLBACK_SEASON)
    .eq("season_type", FALLBACK_TYPE);
  if (error) throw new Error(`fallback-id fetch failed: ${error.message}`);
  const map = new Map<string, string>();
  for (const r of data ?? []) map.set(normalizeName(r.name), String(r.player_id));
  return map;
}

export interface ResolvedPlayer extends ArtifactPlayer {
  id: string;
}

/** Resolves every artifact player to a stable string id: the Python-assigned
 *  athlete_id when present, else the Summer League 2026 fallback by normalized
 *  name, else excluded (logged, not silently dropped). */
export function resolvePlayers(
  players: ArtifactPlayer[],
  fallbackIds: Map<string, string>,
): { resolved: ResolvedPlayer[]; unresolved: ArtifactPlayer[] } {
  const resolved: ResolvedPlayer[] = [];
  const unresolved: ArtifactPlayer[] = [];
  for (const p of players) {
    const id = p.athlete_id != null ? String(p.athlete_id) : fallbackIds.get(normalizeName(p.player));
    if (id != null) resolved.push({ ...p, id });
    else unresolved.push(p);
  }
  return { resolved, unresolved };
}

function toPerGameStats(p: ResolvedPlayer): PlayerStats {
  const g = p.perGame;
  return {
    playerId: p.id,
    pts: g.pts, fg3m: g.fg3m, reb: g.reb, ast: g.ast, stl: g.stl, blk: g.blk, tov: g.tov,
    fgPct: g.fgPct, fga: g.fga, ftPct: g.ftPct, fta: g.fta,
  };
}

/** Totals-mode input: season counting totals; percentages carried from per-game
 *  unchanged — mirrors buildTotalsStats() in build-seasonal-values.ts exactly. */
function toTotalsStats(p: ResolvedPlayer): PlayerStats {
  const t = p.totals;
  return {
    playerId: p.id,
    pts: t.pts, fg3m: t.fg3m, reb: t.reb, ast: t.ast, stl: t.stl, blk: t.blk, tov: t.tov,
    fgPct: p.perGame.fgPct, fga: t.fga, ftPct: p.perGame.ftPct, fta: t.fta,
  };
}

/**
 * Standard NBA usage rate, mirroring models/projections-adjuster/prep_depth_chart.py's
 * exact formula (the depth-chart tool's own USG% column) so the two never drift:
 *   USG% = 100 * (FGA + 0.44*FTA + TOV) * (TeamMP/5) / (MP * (TeamFGA + 0.44*TeamFTA + TeamTOV))
 *
 * Team totals are summed over the FULL, UNFILTERED artifact (`allPlayers`) —
 * including any still-unresolved player. Their projected minutes and shot
 * volume are real team-conserved usage; leaving them out of the denominator
 * would inflate every real player's USG%. The per-player result is only
 * produced for `resolved` players (there's nowhere to store one for the rest),
 * keyed by their resolved id.
 */
function computeUsgById(allPlayers: ArtifactPlayer[], resolved: ResolvedPlayer[]): Map<string, number> {
  type TeamTotals = { mp: number; fga: number; fta: number; tov: number };
  const teamTotals = new Map<string, TeamTotals>();
  for (const p of allPlayers) {
    const cur = teamTotals.get(p.team) ?? { mp: 0, fga: 0, fta: 0, tov: 0 };
    cur.mp += p.projMpg * p.projGames;
    cur.fga += p.perGame.fga * p.projGames;
    cur.fta += p.perGame.fta * p.projGames;
    cur.tov += p.perGame.tov * p.projGames;
    teamTotals.set(p.team, cur);
  }

  const out = new Map<string, number>();
  for (const p of resolved) {
    const t = teamTotals.get(p.team);
    const mp = p.projMpg * p.projGames;
    if (!t || mp <= 0) continue;
    const denom = t.fga + 0.44 * t.fta + t.tov;
    if (denom <= 0) continue;
    const num = p.perGame.fga * p.projGames + 0.44 * p.perGame.fta * p.projGames
      + p.perGame.tov * p.projGames;
    const usg = (100 * num * (t.mp / 5)) / (mp * denom);
    out.set(p.id, round1(usg));
  }
  return out;
}

async function upsertProjections(
  players: ResolvedPlayer[],
  consensus: ReturnType<typeof loadConsensus>,
  values: Map<number, RankedPlayerValues[]>,
  totals: Map<number, RankedPlayerValues[]>,
  usgById: Map<string, number>,
): Promise<void> {
  const supabase = getServiceClient();
  const now = new Date().toISOString();

  const statRows = players.map((p) => {
    const cons = lookupWithNameAlias(consensus, normalizeName(p.player)) ?? null;
    return {
      player_id: p.id,
      season: SEASON,
      season_type: SEASON_TYPE,
      name: p.player,
      // The roster's projected 2026-27 team — already canonical (Stage 1 reads
      // it straight off data/nba-rosters/2026-27.csv), no last-game-team logic
      // needed since there are no games to look back on.
      team: p.team,
      position: cons?.position ?? pos5(p.pos),
      // For a sl-<nbaComId> fallback id this has no ESPN headshot (same as any
      // other sl- row already on the page) — the Headshot component already
      // falls back to initials gracefully, nothing special needed here.
      headshot_id: p.id,
      // g is `integer` in the schema (real-season builds send a literal game
      // count); projGames is a continuous model output, so round to the
      // nearest whole game rather than round1's one-decimal (which Postgres
      // rejects, e.g. "71.5").
      g: Math.round(p.projGames),
      mpg: round1(p.projMpg),
      pts: round1(p.perGame.pts),
      fg3m: round1(p.perGame.fg3m),
      reb: round1(p.perGame.reb),
      ast: round1(p.perGame.ast),
      stl: round1(p.perGame.stl),
      blk: round1(p.perGame.blk),
      tov: round1(p.perGame.tov),
      fga: round1(p.perGame.fga),
      fta: round1(p.perGame.fta),
      fg_pct: round3(p.perGame.fgPct),
      ft_pct: round3(p.perGame.ftPct),
      consensus_rank: cons?.rank ?? null,
      usg_pct: usgById.get(p.id) ?? null,
      updated_at: now,
    };
  });

  // index totals values by size+player for a parallel lookup, same pattern as
  // build-seasonal-values.ts's upsert()
  const totIndex = new Map<string, RankedPlayerValues>();
  for (const [size, rows] of totals) for (const r of rows) totIndex.set(`${size}:${r.playerId}`, r);

  const valueRows: Record<string, unknown>[] = [];
  for (const [size, rows] of values) {
    for (const r of rows) {
      const t = totIndex.get(`${size}:${r.playerId}`) ?? null;
      valueRows.push({
        player_id: r.playerId,
        season: SEASON,
        season_type: SEASON_TYPE,
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
        v_pts_tot: t ? round3(t.vPts) : null,
        v_fg3_tot: t ? round3(t.vFg3) : null,
        v_reb_tot: t ? round3(t.vReb) : null,
        v_ast_tot: t ? round3(t.vAst) : null,
        v_stl_tot: t ? round3(t.vStl) : null,
        v_blk_tot: t ? round3(t.vBlk) : null,
        v_fg_tot: t ? round3(t.vFg) : null,
        v_ft_tot: t ? round3(t.vFt) : null,
        v_to_tot: t ? round3(t.vTo) : null,
        value_tot: t ? round3(t.value) : null,
        minus1v_tot: t ? round3(t.minus1v) : null,
        updated_at: now,
      });
    }
  }

  await batchUpsert(supabase, "season_player_stats", statRows, "player_id,season,season_type");
  await batchUpsert(supabase, "season_player_values", valueRows, "player_id,season,season_type,league_size");
  console.log(`  ✓ upserted ${statRows.length} stat rows + ${valueRows.length} value rows`);
}

async function main(): Promise<void> {
  loadEnv();
  const artifact = loadArtifact();
  const fallbackIds = await loadFallbackIds();
  const { resolved: players, unresolved } = resolvePlayers(artifact.players, fallbackIds);

  console.log(`Building 2026-27 Projections (${players.length} players, `
    + `generated ${artifact.generatedAt})${DRY_RUN ? " [DRY RUN]" : ""}`);
  const viaFallback = players.filter((p) => p.athlete_id == null).length;
  if (viaFallback > 0) {
    console.log(`  ${viaFallback} player(s) resolved via the Summer League `
      + `${FALLBACK_SEASON} fallback id (no regular-season hoopR history yet)`);
  }
  if (unresolved.length > 0) {
    console.log(`  ${unresolved.length} player(s) skipped — no athlete_id AND no `
      + `Summer League ${FALLBACK_SEASON} row to fall back to (didn't play SL, or a name-match miss), `
      + `no stable id to key on: ${unresolved.slice(0, 8).map((p) => p.player).join(", ")}`
      + `${unresolved.length > 8 ? ", ..." : ""}`);
  }

  const consensus = loadConsensus();
  // Full, UNFILTERED list — team totals for USG% must include every player's
  // real minutes/shots (resolved or not), or every real player's USG% reads
  // inflated by a missing teammate's volume.
  const usgById = computeUsgById(artifact.players, players);

  const perGameStats = players.map(toPerGameStats);
  const totalsStatsArr = players.map(toTotalsStats);

  const values = computeAllLeagueSizes(perGameStats);
  assertFinite(values);
  const totalsValues = computeAllLeagueSizes(totalsStatsArr);
  assertFinite(totalsValues);

  const byId = new Map(players.map((p) => [p.id, p]));
  const ranked400 = values.get(400)!;
  console.log(`\n── league_size 400: top 15 by value ──`);
  for (const r of ranked400.slice(0, 15)) {
    const name = byId.get(r.playerId)?.player ?? r.playerId;
    console.log(`${String(r.valueRank).padStart(2)}. ${name.padEnd(26)} value=${r.value.toFixed(3)} minus1v=${r.minus1v.toFixed(3)}`);
  }

  const matched = players.filter(
    (p) => lookupWithNameAlias(consensus, normalizeName(p.player)) != null,
  ).length;
  console.log(`\nconsensus matched for ${matched}/${players.length} players`);

  if (DRY_RUN) {
    console.log("\n[DRY RUN] skipping upsert.");
    return;
  }

  await upsertProjections(players, consensus, values, totalsValues, usgById);
  console.log(`\n✓ done`);
}

// Guard against running main() as a side effect of importing loadArtifact/
// resolvePlayers/loadFallbackIds into another script (build-real-salary-
// values.ts) — only run the build when this file is the actual entrypoint.
// Mirrors build-seasonal-values.ts's identical guard.
const isEntrypoint = process.argv[1] != null && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) {
  main().catch((e) => {
    console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
