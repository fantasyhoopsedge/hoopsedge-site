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
import { getServiceClient, loadEnv, normalizeName } from "./nba-data/client";
import { loadArtifact, resolvePlayers, loadFallbackIds } from "./build-projection-values";
import { batchUpsert, loadConsensus } from "./build-seasonal-values";
import { lookupWithNameAlias } from "../src/lib/player-name-aliases";
import {
  WEIGHT_PRESETS, rankToZ, selectPool, computeMarketValue, rankBy, contractClassOf,
  POOL_SIZE,
  type RealSalaryFactors, type ContractClass,
} from "../src/lib/value/real-salary-model";

const SEASON = 2027;
const SOURCE_SEASON_TYPE = "projection";
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

  console.log(`Building Real Salary Rankings (season ${SEASON}, pool_size ${POOL_SIZE})`
    + `${DRY_RUN ? " [DRY RUN]" : ""}`);

  const [projections, salaries] = await Promise.all([loadProjectedMinus1V(), loadSalaries()]);
  console.log(`  ${projections.size} players with projected Minus1V, `
    + `${salaries.byPlayerId.size} salaried by id + ${salaries.byName.size} salaried by name`);

  // Scoreable population: needs both a projection AND a salary. This is the
  // universe every z-score/rank transform below is computed over.
  interface Scoreable {
    playerId: string; name: string; salary: number; salarySource: "nba_roster" | "nba_contracts";
    tier: Tier | null; productionRaw: number; consensusRank: number | null;
    contractClass: ContractClass;
  }
  const scoreable: Scoreable[] = [];
  let skippedNoSalary = 0;
  for (const [playerId, proj] of projections) {
    const name = nameById.get(playerId) ?? playerId;
    // player_id first (precise); normalized-name fallback catches brand-new
    // rookies whose nba_roster row has no player_id yet — see loadSalaries().
    const sal = salaries.byPlayerId.get(playerId) ?? salaries.byName.get(normalizeName(name));
    if (!sal) { skippedNoSalary++; continue; }
    const cons = lookupWithNameAlias(consensus, normalizeName(name));
    const productionRaw = PRODUCTION_BLEND.perGame * proj.minus1v + PRODUCTION_BLEND.totals * proj.minus1vTot;
    scoreable.push({
      playerId, name, salary: sal.salary, salarySource: sal.source,
      tier: tierById.get(playerId) ?? null, productionRaw,
      consensusRank: cons?.rank ?? null,
      contractClass: sal.contractClass,
    });
  }
  console.log(`  ${skippedNoSalary} player(s) with a projection but no known salary — excluded`);

  const N = scoreable.length;
  const worstConsensusRank = Math.max(...scoreable.map((r) => r.consensusRank ?? 0), 0);
  const unrankedConsensusRank = Math.max(worstConsensusRank + 1, N);

  // Cheapness rank: 1 = lowest actual salary. rankToZ then gives a HIGH
  // z-score to a LOW salary — see RealSalaryFactors.salaryZ's doc comment.
  const bySalaryAsc = [...scoreable].sort((a, b) => a.salary - b.salary);
  const salaryRankById = new Map(bySalaryAsc.map((r, i) => [r.playerId, i + 1]));

  const factors: RealSalaryFactors[] = scoreable.map((r) => ({
    playerId: r.playerId,
    consensusZ: rankToZ(r.consensusRank ?? unrankedConsensusRank, N),
    productionZ: r.productionRaw,
    salaryZ: rankToZ(salaryRankById.get(r.playerId)!, N),
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
  const surplusRankById = rankBy(computed, (c) => c.surplusValue);
  // Rank = order by ExpectedCapHit ("Market Salary") directly — it's already
  // the consensus-dominant blend, so Rank and Market Salary are one number.
  const valueRankById = rankBy(computed, (c) => c.expectedCapHit);

  console.log(`  pool=${poolIds.size} players`);

  type Row = Scoreable & { expectedCapHit: number; surplusValue: number; surplusRank: number; valueRank: number; consensusZ: number; productionZ: number; salaryZ: number };
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
      surplusRank: surplusRankById.get(r.playerId)!,
      valueRank: valueRankById.get(r.playerId)!,
    };
  }).sort((a, b) => a.valueRank - b.valueRank);

  console.log(`\n── top 15 by Market Value Rank (Balanced) ──`);
  for (const r of rows.slice(0, 15)) {
    console.log(`${String(r.valueRank).padStart(2)}. ${r.name.padEnd(24)} `
      + `consensus=${r.consensusRank ?? "—"} salary=$${(r.salary / 1e6).toFixed(1)}M `
      + `expected=$${(r.expectedCapHit / 1e6).toFixed(1)}M surplus=$${(r.surplusValue / 1e6).toFixed(1)}M`);
  }
  console.log(`\n── top 10 by Surplus $ ──`);
  for (const r of [...rows].sort((a, b) => a.surplusRank - b.surplusRank).slice(0, 10)) {
    console.log(`${String(r.surplusRank).padStart(3)}. ${r.name.padEnd(24)} `
      + `salary=$${(r.salary / 1e6).toFixed(1)}M expected=$${(r.expectedCapHit / 1e6).toFixed(1)}M `
      + `surplus=$${(r.surplusValue / 1e6).toFixed(1)}M`);
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
  const WATCHLIST = ["Victor Wembanyama", "Ajay Mitchell", "LeBron James", "Joel Embiid", "Stephen Curry", "Jayson Tatum", "Giannis Antetokounmpo", "Cameron Boozer", "AJ Dybantsa", "Javon Small", "Izaiyah Nelson"];
  console.log(`\n── watchlist ──`);
  for (const name of WATCHLIST) {
    const r = rows.find((row) => row.name === name);
    if (!r) { console.log(`  ${name}: not found`); continue; }
    console.log(`  ${name.padEnd(24)} rank=${r.valueRank} consensus=${r.consensusRank ?? "—"} `
      + `salary=$${(r.salary / 1e6).toFixed(1)}M expected=$${(r.expectedCapHit / 1e6).toFixed(1)}M `
      + `surplus=$${(r.surplusValue / 1e6).toFixed(1)}M`);
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
  for (const cls of ["rookie-scale", "standard", "non-guaranteed"] as ContractClass[]) {
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
    production_z: round3(r.productionZ),
    salary_z: round3(r.salaryZ),
    // market_value_score deliberately unwritten as of the 3rd revision: Rank
    // now sorts by expected_cap_hit directly (Rank and Market Salary are the
    // same number), so the column is unused. Left in the schema rather than
    // migrated away for now — harmless, not worth the migration churn.
    expected_cap_hit: round0(r.expectedCapHit),
    surplus_value: round0(r.surplusValue),
    surplus_rank: r.surplusRank,
    updated_at: now,
  }));
  await batchUpsert(supabase, "real_salary_values", dbRows, "player_id,season");
  console.log(`\n✓ upserted ${dbRows.length} rows`);
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

