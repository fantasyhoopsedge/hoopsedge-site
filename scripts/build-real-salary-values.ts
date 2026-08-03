/**
 * Build real_salary_values — Ash's consensus-anchored Market Value model
 * (2026-07-30, fifth revision). See docs/real-salary-dynasty-rankings-brief.md
 * §3.1 and src/lib/value/real-salary-model.ts for the full methodology; short
 * version:
 *
 *   1. EfficiencyZ = 60%·salaryZ (cheapness — rank-to-z of salary rank
 *      ASCENDING, so a LOW salary scores well) + 40%·productionZ (blend of
 *      per-game/totals Minus1V — see EFFICIENCY_BASE_SALARY_WEIGHT). Weighted toward
 *      salary because a cheap, long-controlled contract is the real asset in
 *      this format even before a young player's box score catches up.
 *   2. BlendScore = wConsensus·consensusZ + wEfficiency·EfficiencyZ (pure
 *      z-space, no dollars).
 *   3. Rank = order by BlendScore. ExpectedCapHit ("Market Salary") =
 *      QUANTILE-MAPPED onto the population's own REAL salary distribution —
 *      the player ranked #1 by BlendScore is priced at whatever the actual
 *      highest real salary in the pool is, #2 at the 2nd-highest, etc. —
 *      rather than derived from an abstract linear scale.
 *   4. SurplusValue = ExpectedCapHit - actual salary (nba_roster.salary_yr1,
 *      falling back to nba_contracts.salary_current).
 *   5. This script stores the "Balanced" preset; Contending/Rebuilding/
 *      Tanking are recomputed CLIENT-SIDE from consensus_z/production_z/
 *      salary_z, no extra rows needed.
 *
 * POOL_SIZE=480 / TEAMS=30 / ROSTER_SPOTS=16 matches Ash's real leagues
 * (2026-07-30) — POOL_SIZE is exported for display/reference only now
 * (computeMarketValue quantile-maps over whatever rows it's given).
 *
 *   npm run realsalary:build              # compute + upsert to Supabase
 *   npm run realsalary:build -- --dry-run # compute + print, no writes
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getServiceClient, loadEnv, normalizeName } from "./nba-data/client";
import { loadArtifact, resolvePlayers, loadFallbackIds } from "./build-projection-values";
import { batchUpsert, loadConsensus } from "./build-seasonal-values";
import { lookupWithNameAlias } from "../src/lib/player-name-aliases";
import { NBA_MINIMUM_SALARY } from "../src/lib/nba-cap";
import {
  WEIGHT_PRESETS, rankToZ, selectPool, computeMarketValue, rankBy, contractClassOf,
  POOL_SIZE,
  type RealSalaryFactors, type ContractClass,
} from "../src/lib/value/real-salary-model";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEASON = 2027;
const SOURCE_SEASON_TYPE = "projection";
// Last COMPLETED season, used only to admit consensus-ranked players the
// projection model can't cover (see loadCarryForward). hoopR numbering: 2026 =
// the 2025-26 season.
const CARRY_SEASON = 2026;
const CARRY_SEASON_TYPE = "regular";

/**
 * Age at or above which a CARRIED-FORWARD player's last season is discarded
 * entirely, leaving him anchored to consensus (2026-08-03).
 *
 * Why carrying forward breaks for veterans specifically: every normally-scored
 * player's production comes from a PROJECTION, which ages him down. A carried
 * player's comes from last season's ACTUALS, which don't. Dynasty consensus
 * meanwhile prices a 3-5 year window and has already discounted him hard, so the
 * gap between "what he did" and "what the board thinks of his future" is widest
 * exactly for old players — and Efficiency turned that gap into upward movement.
 * Measured 2026-08-03 across the 30 carried players: age 32+ rose a mean of
 * +15.8 spots, under 32 fell -2.6. Jonas Valanciunas +56, DeMar DeRozan +35,
 * Russell Westbrook +17 — all 34-38 years old.
 *
 * NOT a scale artifact, which was the first suspicion: paired on the same
 * players, 2026-actual minus 2027-projection is mean +0.004 (sd 0.245, higher
 * only 52% of the time). The two distributions are effectively identical. It is
 * specifically the missing aging step.
 *
 * Ash's reasoning (2026-08-03), which is why the fix is "discard" rather than
 * "discount": a veteran the projection model didn't include has no established
 * 2026-27 role. Valanciunas has left for Europe; DeRozan is expected to sign
 * somewhere with a smaller projection than last season; Westbrook will likely
 * take a minimum bench role. In every case last season describes a role the
 * player no longer has, and for an older player the next one is smaller, not
 * bigger. A younger carried player might see his role grow instead, so the carry
 * still applies below the threshold.
 *
 * 32 is where the data flips sign, not a round number chosen first. Age comes
 * from the board (see loadBoardMeta) because these players often have no
 * nba_roster row to read a dob from. An unknown age keeps its carried production
 * — the gate only fires on positive evidence that a player is old.
 */
const CARRY_FORWARD_AGE_LIMIT = 32;
// The V-score engine only precomputes a fixed menu of baseline pool sizes
// (compute-values.ts's LEAGUE_SIZES, 250..450) — 480 isn't one of them, so
// season_player_values has no rows there. Rather than expanding that shared
// menu (touches /seasonal-rankings too) just for this tool, SOURCE_LEAGUE_SIZE
// stays at the nearest existing baseline (450) for the underlying Minus1V
// statistics; POOL_SIZE (imported from real-salary-model.ts, 480 = 30 teams
// x 16 roster spots, Ash's real leagues, 2026-07-30) is this tool's OWN
// separate pool-selection size for budget calibration — same "re-select our
// own pool" pattern already used for the single-factor model this replaced.
const SOURCE_LEAGUE_SIZE = 450;
const ROSTER_SEASON = "2026-27";
const PRODUCTION_BLEND = { perGame: 0.5, totals: 0.5 };

const DRY_RUN = process.argv.includes("--dry-run");

type Tier = "High" | "Medium" | "Low";

interface ProjectionRow { minus1v: number; minus1vTot: number; }

async function loadProjectedMinus1V(): Promise<Map<string, ProjectionRow>> {
  const supabase = getServiceClient();
  const out = new Map<string, ProjectionRow>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("season_player_values")
      .select("player_id,minus1v,minus1v_tot")
      .eq("season", SEASON)
      .eq("season_type", SOURCE_SEASON_TYPE)
      .eq("league_size", SOURCE_LEAGUE_SIZE)
      .range(from, from + 999);
    if (error) throw new Error(`season_player_values fetch failed: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) {
      if (r.minus1v != null) {
        out.set(r.player_id, { minus1v: r.minus1v, minus1vTot: r.minus1v_tot ?? r.minus1v });
      }
    }
    if (data.length < 1000) break;
  }
  return out;
}

/** Normalized key -> the board's own display spelling and age. loadConsensus()
 *  keys by normalized name and keeps neither, but the forced-in players below
 *  have no stats row anywhere to take a readable name from, and the age gate in
 *  CARRY_FORWARD_AGE_LIMIT needs an age for players who may have no nba_roster
 *  row at all. The board carries both for every player it ranks, which is
 *  exactly the population both cases are drawn from. */
function loadBoardMeta(): Map<string, { name: string; age: number | null }> {
  const raw = readFileSync(resolve(REPO_ROOT, "src/lib/dynasty-rankings.json"), "utf8");
  const players = JSON.parse(raw) as Array<{ player: string; age?: number | null }>;
  const m = new Map<string, { name: string; age: number | null }>();
  for (const p of players) {
    const key = normalizeName(p.player);
    if (!m.has(key)) m.set(key, { name: p.player, age: p.age ?? null });
  }
  return m;
}

/**
 * Consensus-ranked players the 2027 projection dataset has no row for, keyed by
 * normalized name, with last COMPLETED season's ACTUAL Minus1V standing in for
 * the missing projection.
 *
 * Why they're missing in the first place: the Python model's Stage 1 universe is
 * the "roster of record" — it projects minutes ONTO a team, so anyone without a
 * 2026-27 roster spot never enters the pipeline. That silently excluded 37
 * board-ranked players from this page, Jonathan Kuminga (consensus 182) and
 * DeMar DeRozan (205) among them. Ash (2026-08-03): wire them in regardless.
 *
 * Scale note: these Minus1V figures are standardized against the 2025-26 real-
 * season 450 pool, not the 2027 projection 450 pool — different populations, so
 * strictly they are not the same yardstick. Acceptable here because production
 * is only 40% of the Efficiency adjuster, which is itself 22.5-37.5% of the
 * blend (i.e. ≤15% of a player's score), and because the alternative is showing
 * nothing at all. Do NOT reuse this as a general-purpose production source.
 */
/**
 * player_id -> display name for the CURRENT projection dataset.
 *
 * Needed because `nameById` (built from the artifact) only covers players the
 * artifact still contains, while `season_player_values` can hold projection rows
 * written by an EARLIER artifact — 8 of them as of 2026-08-03. Those fell back to
 * a bare numeric id as their "name", which then failed to match dynasty consensus,
 * which left them with a null consensus rank, which made the third admission pass
 * force in a SECOND row for the same human under a synthetic id (caught 2026-08-03
 * via Duke Miles, board rank 491, who ended up with both). Resolving the real name
 * here fixes all three symptoms at the source.
 */
async function loadProjectionNames(): Promise<Map<string, string>> {
  const supabase = getServiceClient();
  const out = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("season_player_stats")
      .select("player_id,name")
      .eq("season", SEASON)
      .eq("season_type", SOURCE_SEASON_TYPE)
      .range(from, from + 999);
    if (error) throw new Error(`projection name fetch failed: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) out.set(r.player_id, r.name);
    if (data.length < 1000) break;
  }
  return out;
}

interface CarryForward { playerId: string; name: string; minus1v: number; minus1vTot: number; }

async function loadCarryForward(): Promise<Map<string, CarryForward>> {
  const supabase = getServiceClient();
  const idByName = new Map<string, { playerId: string; name: string }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("season_player_stats")
      .select("player_id,name")
      .eq("season", CARRY_SEASON)
      .eq("season_type", CARRY_SEASON_TYPE)
      .range(from, from + 999);
    if (error) throw new Error(`carry-forward stats fetch failed: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) idByName.set(normalizeName(r.name), { playerId: r.player_id, name: r.name });
    if (data.length < 1000) break;
  }

  const valueById = new Map<string, { minus1v: number; minus1vTot: number }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("season_player_values")
      .select("player_id,minus1v,minus1v_tot")
      .eq("season", CARRY_SEASON)
      .eq("season_type", CARRY_SEASON_TYPE)
      .eq("league_size", SOURCE_LEAGUE_SIZE)
      .range(from, from + 999);
    if (error) throw new Error(`carry-forward values fetch failed: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) {
      if (r.minus1v != null) valueById.set(r.player_id, { minus1v: r.minus1v, minus1vTot: r.minus1v_tot ?? r.minus1v });
    }
    if (data.length < 1000) break;
  }

  const out = new Map<string, CarryForward>();
  for (const [key, ident] of idByName) {
    const v = valueById.get(ident.playerId);
    if (v) out.set(key, { ...ident, ...v });
  }
  return out;
}

interface SalaryInfo {
  salary: number;
  source: "nba_roster" | "nba_contracts";
  /** nba_roster.contract_status -> team-commitment class. nba_contracts has no
   *  contract-type column at all, so a contracts-sourced row falls back to
   *  "standard" (the neutral case) — see real-salary-model.ts's
   *  contractClassOf(). */
  contractClass: ContractClass;
}
interface SalaryLookup { byPlayerId: Map<string, SalaryInfo>; byName: Map<string, SalaryInfo>; }

/**
 * nba_roster.salary_yr1 (2026-27) preferred; nba_contracts.salary_current fills
 * in anyone missing from the roster CSV — matches the salary-roster-pipeline
 * skill's precedence.
 *
 * Keyed by BOTH player_id and normalized name — never player_id alone.
 * nba_roster.player_id is null for brand-new incoming rookies (not yet linked
 * to a resolved nba_players.id), while resolvePlayers() resolves those exact
 * players via the Summer League fallback scheme (sl-<nbaComId>), a completely
 * different id. A player_id-only join silently drops every such rookie —
 * caught 2026-07-30 when the entire incoming draft class (Cameron Boozer, AJ
 * Dybantsa, ...) turned out to have zero rows in real_salary_values despite
 * having both a real salary and a real projection. Name is the fallback,
 * exactly the ecosystem-wide join-key rule (see CLAUDE.md/salary-roster-
 * pipeline skill) — not a one-off patch.
 */
async function loadSalaries(): Promise<SalaryLookup> {
  const supabase = getServiceClient();
  const byPlayerId = new Map<string, SalaryInfo>();
  const byName = new Map<string, SalaryInfo>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("nba_roster")
      .select("player_id,full_name,salary_yr1,contract_status")
      .eq("season", ROSTER_SEASON)
      .range(from, from + 999);
    if (error) throw new Error(`nba_roster fetch failed: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) {
      if (r.salary_yr1 == null) continue;
      const info: SalaryInfo = {
        salary: r.salary_yr1,
        source: "nba_roster",
        contractClass: contractClassOf(r.contract_status),
      };
      if (r.player_id) byPlayerId.set(r.player_id, info);
      byName.set(normalizeName(r.full_name), info);
    }
    if (data.length < 1000) break;
  }
  const { data: contracts, error } = await supabase
    .from("nba_contracts")
    .select("player_id,salary_player_name,salary_current");
  if (error) throw new Error(`nba_contracts fetch failed: ${error.message}`);
  for (const r of contracts ?? []) {
    if (r.salary_current == null) continue;
    const info: SalaryInfo = { salary: r.salary_current, source: "nba_contracts", contractClass: "standard" };
    if (r.player_id && !byPlayerId.has(r.player_id)) byPlayerId.set(r.player_id, info);
    const nameKey = normalizeName(r.salary_player_name);
    if (!byName.has(nameKey)) byName.set(nameKey, info);
  }
  return { byPlayerId, byName };
}

function round0(n: number): number {
  return Math.round(n);
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

async function main(): Promise<void> {
  loadEnv();
  const artifact = loadArtifact();
  const fallbackIds = await loadFallbackIds();
  const { resolved: players } = resolvePlayers(artifact.players, fallbackIds);
  const tierById = new Map(players.map((p) => [p.id, p.confidenceTier]));
  const nameById = new Map(players.map((p) => [p.id, p.player]));
  const consensus = loadConsensus();
  const boardMeta = loadBoardMeta();

  console.log(`Building Real Salary Rankings (season ${SEASON}, pool_size ${POOL_SIZE})`
    + `${DRY_RUN ? " [DRY RUN]" : ""}`);

  const [projections, salaries, carryForward, projectionNames] = await Promise.all([
    loadProjectedMinus1V(), loadSalaries(), loadCarryForward(), loadProjectionNames(),
  ]);
  console.log(`  ${projections.size} players with projected Minus1V, `
    + `${salaries.byPlayerId.size} salaried by id + ${salaries.byName.size} salaried by name`);

  // Scoreable population: a projection + a salary, OR (since 2026-08-03) a
  // consensus rank + last season's actual production — see loadCarryForward().
  // This is the universe every z-score/rank transform below is computed over.
  interface Scoreable {
    playerId: string; name: string;
    /** null = unsigned free agent, no cap hit. See ContractClass's "unsigned". */
    salary: number | null;
    salarySource: "nba_roster" | "nba_contracts" | "unsigned";
    tier: Tier | null;
    /** null = no production data anywhere; zeroes the whole Efficiency adjuster
     *  so the player sits at his consensus slot. See blendScore. */
    productionRaw: number | null;
    consensusRank: number | null;
    contractClass: ContractClass;
    /** true when production came from last season's actuals, not a projection. */
    carried: boolean;
  }
  const scoreable: Scoreable[] = [];
  // Consensus ranks are unique per board, so tracking the RANK a projected
  // player consumed is alias-proof: lookupWithNameAlias can match a board entry
  // under a different normalized key than the artifact's own name, and a
  // name-only "already seen" check would admit that player a second time.
  const seenConsensusRanks = new Set<number>();
  let skippedNoSalary = 0;
  // nameById covers only the CURRENT artifact; the projection STATS table covers
  // every row season_player_values holds, including ones an earlier artifact
  // wrote. Falling through to a bare player id here is what broke consensus
  // matching for those rows — see loadProjectionNames().
  const carryNameById = new Map([...carryForward.values()].map((c) => [c.playerId, c.name]));
  for (const [playerId, proj] of projections) {
    const name = nameById.get(playerId) ?? projectionNames.get(playerId)
      ?? carryNameById.get(playerId) ?? playerId;
    // player_id first (precise); normalized-name fallback catches brand-new
    // rookies whose nba_roster row has no player_id yet — see loadSalaries().
    const sal = salaries.byPlayerId.get(playerId) ?? salaries.byName.get(normalizeName(name));
    const cons = lookupWithNameAlias(consensus, normalizeName(name));
    // No salary anywhere is the same "unsigned" case as an off-roster free
    // agent — admit him if the board ranks him (he has a projection, so there's
    // real production to show), and drop him only when he has no consensus rank
    // either, i.e. nothing at all to display.
    if (!sal && !cons) { skippedNoSalary++; continue; }
    const productionRaw = PRODUCTION_BLEND.perGame * proj.minus1v + PRODUCTION_BLEND.totals * proj.minus1vTot;
    if (cons) seenConsensusRanks.add(cons.rank);
    scoreable.push({
      playerId, name,
      salary: sal?.salary ?? null,
      salarySource: sal?.source ?? "unsigned",
      tier: tierById.get(playerId) ?? null, productionRaw,
      consensusRank: cons?.rank ?? null,
      contractClass: sal?.contractClass ?? "unsigned",
      carried: false,
    });
  }
  console.log(`  ${skippedNoSalary} player(s) with a projection but no salary AND no consensus rank — excluded`);

  // Second admission pass: consensus-ranked players the projection dataset has
  // no row for. Deliberately limited to CONSENSUS-RANKED players — the goal is
  // "no board player is invisible on this page," not "admit every player with a
  // 2025-26 stat line." A roster row makes them a normal salaried player; no
  // roster row means unsigned, and an unsigned player gets no cap hit at all
  // rather than the stale nba_contracts figure (a cap hold or a last-known
  // contract, not this season's money). See ContractClass's "unsigned" note.
  let admitted = 0;
  let admittedUnsigned = 0;
  const ageAnchored: Array<{ name: string; age: number; rank: number }> = [];
  const unresolvedBoard: Array<{ name: string; display: string; rank: number }> = [];
  const scoreableById = new Map(scoreable.map((r) => [r.playerId, r]));
  for (const [nameKey, info] of consensus) {
    if (seenConsensusRanks.has(info.rank)) continue;
    const carry = lookupWithNameAlias(carryForward, nameKey);
    if (!carry) {
      unresolvedBoard.push({ name: nameKey, display: boardMeta.get(nameKey)?.name ?? nameKey, rank: info.rank });
      continue;
    }
    const already = scoreableById.get(carry.playerId);
    if (already) {
      // Same human, already scored under this id — his artifact name just didn't
      // match the board, so pass 1 left him with a null consensus rank. Backfill
      // it rather than skipping: skipping silently dropped one board player per
      // name mismatch (caught 2026-08-03 by the all-present assertion below —
      // Taelon Peter, rank 465). Never overwrite a rank pass 1 did match.
      if (already.consensusRank == null) {
        already.consensusRank = info.rank;
        seenConsensusRanks.add(info.rank);
      }
      continue;
    }
    // Roster row only — a contracts-only hit means he is not on a 2026-27
    // roster, which is exactly the unsigned case.
    const rosterSal = salaries.byPlayerId.get(carry.playerId) ?? salaries.byName.get(nameKey);
    const signed = rosterSal?.source === "nba_roster";
    // Veterans: discard last season outright rather than carrying it — see
    // CARRY_FORWARD_AGE_LIMIT. A null productionRaw zeroes the whole Efficiency
    // adjuster, leaving consensus to place him.
    const age = boardMeta.get(nameKey)?.age ?? null;
    const tooOld = age != null && age >= CARRY_FORWARD_AGE_LIMIT;
    if (tooOld) ageAnchored.push({ name: carry.name, age, rank: info.rank });
    const row: Scoreable = {
      playerId: carry.playerId,
      name: carry.name,
      salary: signed ? rosterSal.salary : null,
      salarySource: signed ? "nba_roster" : "unsigned",
      tier: null,
      productionRaw: tooOld
        ? null
        : PRODUCTION_BLEND.perGame * carry.minus1v + PRODUCTION_BLEND.totals * carry.minus1vTot,
      consensusRank: info.rank,
      contractClass: signed ? rosterSal.contractClass : "unsigned",
      carried: true,
    };
    scoreable.push(row);
    scoreableById.set(carry.playerId, row);
    admitted++;
    if (!signed) admittedUnsigned++;
  }
  console.log(`  ${admitted} consensus-ranked player(s) admitted on last-season production `
    + `(${admittedUnsigned} unsigned — no cap hit, no cheapness credit, no surplus)`);
  if (ageAnchored.length > 0) {
    ageAnchored.sort((a, b) => b.age - a.age);
    console.log(`  ${ageAnchored.length} of those are ${CARRY_FORWARD_AGE_LIMIT}+ — last season DISCARDED, `
      + `anchored to consensus: `
      + ageAnchored.map((p) => `${p.name} ${p.age.toFixed(1)} (${p.rank})`).join(", "));
  }
  // Third admission pass — the guarantee (Ash, 2026-08-03): "if a player exists
  // in consensus, he must get forced into salary rank too." No exceptions, no
  // production required.
  //
  // These are mostly 2026 draftees and internationals with no NBA minutes
  // anywhere: no projection row, no completed season to carry forward, and — the
  // reason they were unreachable at all — no player_id in nba_players, no Summer
  // League row, no game logs. So they get a SYNTHETIC id, `cons-<normalized
  // name>`, deliberately mirroring build-projection-values.ts's existing
  // `sl-<nbaComId>` scheme rather than inventing a differently-shaped one. It's
  // stable across refreshes because the normalized name is the ecosystem's join
  // key, and the `cons-` prefix makes these rows trivially identifiable — which
  // the stale-row sweep after the upsert relies on, since a player who later
  // earns a real id would otherwise leave this row behind as a duplicate.
  //
  // With productionRaw null the whole Efficiency adjuster zeroes out, so nothing
  // but consensus places them — the honest position for a player we have no
  // measurement of. NOTE (Ash, 2026-08-03): Sorber and the other
  // draftees SHOULD eventually get a real projection built the way a 2026 rookie
  // is projected, off the GP/MPG already assigned in the depth chart. Once that
  // lands they'll resolve through the normal path and this pass will shrink.
  // Belt-and-braces against the Duke Miles failure (see loadProjectionNames):
  // never mint a synthetic row for a human already in the population under a
  // real id, whatever route left his consensus rank unmatched. Backfill the rank
  // onto the existing row instead — that's the repair, a second row is not.
  const scoreableByName = new Map(scoreable.map((r) => [normalizeName(r.name), r]));
  let forced = 0;
  for (const p of unresolvedBoard) {
    const existing = scoreableByName.get(p.name);
    if (existing) {
      if (existing.consensusRank == null) existing.consensusRank = p.rank;
      continue;
    }
    const carrySal = salaries.byName.get(p.name);
    const signed = carrySal?.source === "nba_roster";
    scoreable.push({
      playerId: `cons-${p.name.replace(/\s+/g, "-")}`,
      name: p.display,
      salary: signed ? carrySal.salary : null,
      salarySource: signed ? "nba_roster" : "unsigned",
      tier: null,
      productionRaw: null,
      consensusRank: p.rank,
      contractClass: signed ? carrySal.contractClass : "unsigned",
      carried: true,
    });
    forced++;
  }
  if (forced > 0) {
    unresolvedBoard.sort((a, b) => a.rank - b.rank);
    console.log(`  ${forced} consensus-ranked player(s) forced in with NO production data `
      + `(synthetic cons-* id, Efficiency zeroed → placed by consensus alone): `
      + unresolvedBoard.map((p) => `${p.display} (${p.rank})`).join(", "));
  }

  const N = scoreable.length;
  const worstConsensusRank = Math.max(...scoreable.map((r) => r.consensusRank ?? 0), 0);
  const unrankedConsensusRank = Math.max(worstConsensusRank + 1, N);

  // Cheapness rank: 1 = lowest actual salary. rankToZ then gives a HIGH
  // z-score to a LOW salary — see RealSalaryFactors.salaryZ's doc comment.
  // Unsigned players are ranked over the SALARIED population only and carry
  // salaryZ=0; CHEAPNESS_CREDIT zeroes their sub-weight anyway, so the value is
  // inert — it just must not shift anyone else's cheapness rank.
  const salaried = scoreable.filter((r) => r.salary != null);
  const bySalaryAsc = [...salaried].sort((a, b) => a.salary! - b.salary!);
  const salaryRankById = new Map(bySalaryAsc.map((r, i) => [r.playerId, i + 1]));

  const factors: RealSalaryFactors[] = scoreable.map((r) => ({
    playerId: r.playerId,
    consensusZ: rankToZ(r.consensusRank ?? unrankedConsensusRank, N),
    productionZ: r.productionRaw,
    salaryZ: r.salary == null ? 0 : rankToZ(salaryRankById.get(r.playerId)!, salaried.length),
    salary: r.salary,
    contractClass: r.contractClass,
  }));

  const poolIds = selectPool(factors, POOL_SIZE);
  if (poolIds.size < POOL_SIZE) {
    console.log(`  ⚠ only ${poolIds.size} salary-eligible players available, fewer than POOL_SIZE=${POOL_SIZE}`);
  }
  const computed = computeMarketValue(factors, WEIGHT_PRESETS.balanced);
  const computedById = new Map(computed.map((c) => [c.playerId, c]));
  const factorsById = new Map(factors.map((f) => [f.playerId, f]));
  // Unsigned players have no surplus to rank; sort them to the bottom and store
  // a null surplus_rank rather than a misleading last-place integer.
  const surplusRankById = rankBy(computed, (c) => c.surplusValue ?? -Infinity);
  // Rank = order by ExpectedCapHit ("Market Salary") directly — it's already
  // the consensus-dominant blend, so Rank and Market Salary are one number.
  const valueRankById = rankBy(computed, (c) => c.expectedCapHit);

  console.log(`  pool=${poolIds.size} players`);

  // The guarantee (Ash, 2026-08-03): consensus membership alone earns a row.
  // Loud on failure rather than silently short — a missing board player here is
  // the exact bug the three admission passes exist to prevent.
  const rankedIn = new Set(scoreable.map((r) => r.consensusRank).filter((n): n is number => n != null));
  const missingBoard = [...consensus.values()].filter((c) => !rankedIn.has(c.rank));
  if (missingBoard.length > 0) {
    throw new Error(`${missingBoard.length} consensus-ranked player(s) have no row `
      + `(ranks ${missingBoard.map((c) => c.rank).sort((a, b) => a - b).join(", ")}) — `
      + `every board player must be scoreable; see the admission passes above`);
  }
  console.log(`  ✓ all ${consensus.size} consensus-ranked players present`);

  type Row = Scoreable & { expectedCapHit: number; surplusValue: number | null; surplusRank: number | null; valueRank: number; consensusZ: number; productionZ: number | null; salaryZ: number };
  const rows: Row[] = scoreable.map((r) => {
    const c = computedById.get(r.playerId)!;
    const f = factorsById.get(r.playerId)!;
    return {
      ...r,
      consensusZ: f.consensusZ,
      productionZ: f.productionZ,
      salaryZ: f.salaryZ,
      expectedCapHit: c.expectedCapHit,
      surplusValue: c.surplusValue,
      surplusRank: r.salary == null ? null : surplusRankById.get(r.playerId)!,
      valueRank: valueRankById.get(r.playerId)!,
    };
  }).sort((a, b) => a.valueRank - b.valueRank);

  const money = (n: number | null) => (n == null ? "—" : `$${(n / 1e6).toFixed(1)}M`);

  console.log(`\n── top 15 by Market Value Rank (Balanced) ──`);
  for (const r of rows.slice(0, 15)) {
    console.log(`${String(r.valueRank).padStart(2)}. ${r.name.padEnd(24)} `
      + `consensus=${r.consensusRank ?? "—"} salary=${money(r.salary)} `
      + `expected=${money(r.expectedCapHit)} surplus=${money(r.surplusValue)}`);
  }
  console.log(`\n── top 10 by Surplus $ ──`);
  for (const r of rows.filter((x) => x.surplusRank != null)
    .sort((a, b) => a.surplusRank! - b.surplusRank!).slice(0, 10)) {
    console.log(`${String(r.surplusRank).padStart(3)}. ${r.name.padEnd(24)} `
      + `salary=${money(r.salary)} expected=${money(r.expectedCapHit)} `
      + `surplus=${money(r.surplusValue)}`);
  }

  // Carry-forward admissions: the whole point of the second pass, so show the
  // highest-consensus ones landed somewhere sane rather than trusting the count.
  // Age-anchored veterans first: they're the group most likely to look wrong on
  // the page, so keep every one of them visible rather than the top 15 by
  // consensus. See CARRY_FORWARD_AGE_LIMIT.
  const anchoredNames = new Set(ageAnchored.map((a) => normalizeName(a.name)));
  const anchoredRows = rows.filter((r) => anchoredNames.has(normalizeName(r.name)))
    .sort((a, b) => (a.consensusRank ?? 0) - (b.consensusRank ?? 0));
  if (anchoredRows.length > 0) {
    console.log(`\n── ${CARRY_FORWARD_AGE_LIMIT}+ carried vets, last season discarded ──`);
    for (const r of anchoredRows) {
      const d = (r.consensusRank ?? 0) - r.valueRank;
      console.log(`  ${r.name.padEnd(22)} consensus=${r.consensusRank} rank=${r.valueRank} `
        + `Δ=${d >= 0 ? "+" : ""}${d} salary=${money(r.salary)}`);
    }
  }

  const carried = rows.filter((r) => r.carried).sort((a, b) => (a.consensusRank ?? 0) - (b.consensusRank ?? 0));
  if (carried.length > 0) {
    console.log(`\n── carried-forward admissions (top 15 by consensus) ──`);
    for (const r of carried.slice(0, 15)) {
      console.log(`  ${r.name.padEnd(24)} consensus=${r.consensusRank} rank=${r.valueRank} `
        + `salary=${money(r.salary)} expected=${money(r.expectedCapHit)} `
        + `${r.salarySource === "unsigned" ? "[unsigned]" : ""}`);
    }
  }

  // Reference watchlist: quick sanity check on the framing examples from the
  // brief (LeBron/Ajay Mitchell bargains, Embiid/max-star overpays,
  // Wembanyama as the #1 sanity check), PLUS a couple of incoming rookies —
  // players whose nba_roster.player_id is null (not yet resolved to
  // nba_players.id) previously vanished entirely from this pipeline; a
  // present row here means the byName salary fallback is still working. Javon
  // Small and Izaiyah Nelson are two-way regression guards: both sat ~50-105
  // spots ABOVE their consensus rank before CHEAPNESS_CREDIT existed
  // (2026-08-02), purely on the $0.68M two-way minimum.
  // Kuminga and DeRozan are the carry-forward guards: both are consensus-ranked
  // (182/205) but absent from the projection artifact entirely, so a "not found"
  // on either means the second admission pass has regressed (2026-08-03).
  const WATCHLIST = ["Victor Wembanyama", "Ajay Mitchell", "LeBron James", "Joel Embiid", "Stephen Curry", "Jayson Tatum", "Giannis Antetokounmpo", "Cameron Boozer", "AJ Dybantsa", "Javon Small", "Izaiyah Nelson", "Jonathan Kuminga", "DeMar DeRozan"];
  console.log(`\n── watchlist ──`);
  for (const name of WATCHLIST) {
    const r = rows.find((row) => row.name === name);
    if (!r) { console.log(`  ${name}: not found`); continue; }
    console.log(`  ${name.padEnd(24)} rank=${r.valueRank} consensus=${r.consensusRank ?? "—"} `
      + `salary=${money(r.salary)} expected=${money(r.expectedCapHit)} `
      + `surplus=${money(r.surplusValue)}`);
  }

  // Contract-class movement audit (2026-08-02). Positive Δ = the model moved
  // him UP off his dynasty slot, same sign convention as the page's "Vs
  // Consensus" column. Non-guaranteed (two-way / Exhibit 10) deals must NOT
  // show a large positive mean/max here — that was the exact bug
  // CHEAPNESS_CREDIT fixes; see real-salary-model.ts.
  console.log(`\n── movement vs consensus by contract class (Balanced) ──`);
  // Two different Δs, and only the second one is the model's doing:
  //   rawΔ    = published consensusRank - valueRank. What the page's "Vs
  //             Consensus" column showed BEFORE 2026-08-02. Systematically
  //             inflated at the bottom of the board because
  //             dynasty-rankings.json ranks 493 players while this population
  //             is whoever has BOTH a projection and a salary — every
  //             consensus-ranked player missing here shifts everyone below him
  //             up a slot for free. Kept in this readout purely to keep the
  //             size of that artifact visible.
  //   modelΔ  = rank by consensusZ WITHIN this same population - valueRank.
  //             Pure Efficiency movement, artifact removed. This is the number
  //             CHEAPNESS_CREDIT is tuned against, and (since 2026-08-02) the
  //             number the page's Vs Consensus column actually displays — see
  //             real-salary-table.tsx's consensusRankInPool.
  const consensusOnlyRank = rankBy(
    rows.map((r) => ({ playerId: r.playerId, z: r.consensusZ })), (r) => r.z);
  const ranked = rows.filter((r) => r.consensusRank != null);
  const stat = (ds: number[]) => {
    const s = [...ds].sort((a, b) => a - b);
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    const sign = (n: number) => `${n >= 0 ? "+" : ""}${n}`;
    return `mean=${mean >= 0 ? "+" : ""}${mean.toFixed(1)} min=${sign(s[0])} `
      + `median=${sign(s[Math.floor(s.length / 2)])} max=${sign(s[s.length - 1])}`;
  };
  for (const cls of ["rookie-scale", "standard", "non-guaranteed", "unsigned"] as ContractClass[]) {
    const grp = ranked.filter((r) => r.contractClass === cls);
    if (!grp.length) { console.log(`  ${cls.padEnd(16)} none`); continue; }
    console.log(`  ${cls.padEnd(16)} n=${String(grp.length).padStart(3)}`);
    console.log(`    rawΔ   ${stat(grp.map((r) => r.consensusRank! - r.valueRank))}`);
    console.log(`    modelΔ ${stat(grp.map((r) => consensusOnlyRank.get(r.playerId)! - r.valueRank))}`);
  }
  const twoWayUp = ranked
    .filter((r) => r.contractClass === "non-guaranteed")
    .sort((a, b) => (consensusOnlyRank.get(b.playerId)! - b.valueRank) - (consensusOnlyRank.get(a.playerId)! - a.valueRank))
    .slice(0, 8);
  console.log(`  biggest non-guaranteed climbers (by modelΔ):`);
  for (const r of twoWayUp) {
    const md = consensusOnlyRank.get(r.playerId)! - r.valueRank;
    console.log(`    ${r.name.padEnd(22)} consensus=${r.consensusRank} rank=${r.valueRank} `
      + `rawΔ=${r.consensusRank! - r.valueRank >= 0 ? "+" : ""}${r.consensusRank! - r.valueRank} `
      + `modelΔ=${md >= 0 ? "+" : ""}${md}`);
  }
  // The rawΔ/modelΔ gap above is pure population attrition, and it grows with
  // board depth — printed here so a future "should the Vs Consensus column be
  // rebased?" question resolves in one run instead of a re-derivation. Since
  // 2026-08-02 the page displays modelΔ, so a big rawΔ here is expected and
  // harmless; it is NOT what users see.
  console.log(`  rawΔ vs modelΔ by consensus band (ALL contract classes):`);
  for (const [lo, hi] of [[1, 100], [101, 200], [201, 300], [301, 400], [401, 999]]) {
    const grp = ranked.filter((r) => r.consensusRank! >= lo && r.consensusRank! <= hi);
    if (!grp.length) continue;
    const avg = (f: (r: typeof grp[number]) => number) =>
      (grp.reduce((s, r) => s + f(r), 0) / grp.length).toFixed(1);
    console.log(`    cons ${String(lo).padStart(3)}-${hi === 999 ? "end" : String(hi).padStart(3)} `
      + `n=${String(grp.length).padStart(3)} `
      + `mean rawΔ=${avg((r) => r.consensusRank! - r.valueRank)} `
      + `mean modelΔ=${avg((r) => consensusOnlyRank.get(r.playerId)! - r.valueRank)}`);
  }

  // Sub-minimum dollar gate (2026-08-03). These carry a real contract_status but
  // a figure no full-season deal can pay — prorated/partial/dead money — and
  // were earning a BIGGER cheapness credit than the two-ways the class gate
  // neutralizes, because they're the smallest numbers in the population. Printed
  // every run so a future salary refresh that reintroduces junk figures is
  // visible rather than silently repricing players. See cheapnessCredit().
  const subMinimum = rows
    .filter((r) => r.salary != null && r.salary < NBA_MINIMUM_SALARY && r.contractClass !== "non-guaranteed")
    .sort((a, b) => a.salary! - b.salary!);
  console.log(`  sub-minimum salaries denied a cheapness credit: ${subMinimum.length}`);
  for (const r of subMinimum) {
    console.log(`    ${r.name.padEnd(22)} ${money(r.salary)} ${r.contractClass} (${r.salarySource})`);
  }

  // Ash's hard check: no two-way/Exhibit-10 player should sit above a
  // rookie-scale player whom dynasty consensus already ranked ahead of him.
  const rookieScale = ranked.filter((r) => r.contractClass === "rookie-scale");
  const inversions = ranked
    .filter((r) => r.contractClass === "non-guaranteed")
    .flatMap((tw) => rookieScale
      .filter((rs) => rs.consensusRank! < tw.consensusRank! && rs.valueRank > tw.valueRank)
      .map((rs) => `${tw.name} (cons ${tw.consensusRank} → #${tw.valueRank}) over ${rs.name} (cons ${rs.consensusRank} → #${rs.valueRank})`));
  console.log(`  two-way-over-rookie-scale inversions: ${inversions.length}`);
  for (const s of inversions.slice(0, 10)) console.log(`    ${s}`);

  if (DRY_RUN) {
    console.log("\n[DRY RUN] skipping upsert.");
    return;
  }

  const supabase = getServiceClient();
  const now = new Date().toISOString();
  const dbRows = rows.map((r) => ({
    player_id: r.playerId,
    season: SEASON,
    league_size: POOL_SIZE,
    salary: r.salary,
    salary_source: r.salarySource,
    confidence_tier: r.tier,
    consensus_z: round3(r.consensusZ),
    production_z: r.productionZ == null ? null : round3(r.productionZ),
    salary_z: round3(r.salaryZ),
    // production_z stays null for a forced-in player with no measurement — it
    // is the flag blendScore reads to zero the Efficiency adjuster, so writing
    // 0 here would silently turn "unknown" into "league average".
    // market_value_score deliberately unwritten as of the 3rd revision: Rank
    // now sorts by expected_cap_hit directly (Rank and Market Salary are the
    // same number), so the column is unused. Left in the schema rather than
    // migrated away for now — harmless, not worth the migration churn.
    expected_cap_hit: round0(r.expectedCapHit),
    // null for unsigned free agents — no cap hit to subtract, so no surplus and
    // no place in the surplus ranking. See ContractClass's "unsigned" note.
    surplus_value: r.surplusValue == null ? null : round0(r.surplusValue),
    surplus_rank: r.surplusRank,
    updated_at: now,
  }));
  await batchUpsert(supabase, "real_salary_values", dbRows, "player_id,season");
  console.log(`\n✓ upserted ${dbRows.length} rows`);

  // Sweep stale synthetic rows. A `cons-<name>` id exists only because the
  // player had no real id at build time; the moment he earns one (a Summer
  // League row, a first game log, an nba_players entry) this run writes him
  // under the REAL id and the old row would linger as a duplicate of the same
  // human. Scoped to the `cons-` prefix on purpose — real ids are never deleted
  // here, so a player dropping out of the board keeps his row exactly as before.
  const liveIds = new Set(dbRows.map((r) => r.player_id));
  const { data: existing, error: sweepErr } = await supabase
    .from("real_salary_values")
    .select("player_id")
    .eq("season", SEASON)
    .like("player_id", "cons-%");
  if (sweepErr) throw new Error(`stale cons- sweep failed: ${sweepErr.message}`);
  const stale = (existing ?? []).map((r) => r.player_id).filter((id) => !liveIds.has(id));
  if (stale.length > 0) {
    const { error } = await supabase
      .from("real_salary_values")
      .delete()
      .eq("season", SEASON)
      .in("player_id", stale);
    if (error) throw new Error(`stale cons- delete failed: ${error.message}`);
    console.log(`✓ swept ${stale.length} stale synthetic row(s): ${stale.join(", ")}`);
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

