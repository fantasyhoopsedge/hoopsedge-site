import "server-only";
import rankings from "@/lib/dynasty-rankings.json";
import { playerIdentity } from "@/lib/player-identity/bundled";
import { getRealSalaryValues, getRosterExtras } from "@/lib/value/real-salary-data";
import { contractClassOf, rankBy, type ContractClass } from "@/lib/value/real-salary-model";

type BoardPlayer = { player: string; consensusRank: number };

/**
 * Salary-rank/contract enrichment for the Roster Edge tool — deliberately
 * NOT folded into resolve.ts/ResolvedPlayer. Category Edge, Power Rankings
 * and Settings all share the same /api/fantrax/league route and don't need
 * this data; joining it there would slow down three working tools to feed a
 * fourth. Roster Edge's own route (api/fantrax/roster-edge) calls these
 * separately and looks results up by ResolvedPlayer.fheId client-side.
 */

// 2026-27 roster season — matches /real-salary-rankings' own SEASON constant.
const REAL_SALARY_SEASON = 2027;

/**
 * fhe_id -> site-wide Real Salary Rankings rank (1 = best), same ordering
 * /real-salary-rankings shows on load.
 *
 * FIXED (2026-08-12): this originally sorted by `market_value_score`, which
 * real-salary-table.tsx doesn't actually read for its rank — that column has
 * been unwritten (always null) since build-real-salary-values.ts's 3rd
 * revision, per its own comment: "Rank now sorts by expected_cap_hit
 * directly (Rank and Market Salary are the same number)". Sorting a column
 * that's null for every row produced a meaningless order, which is exactly
 * why the numbers didn't match production. `expected_cap_hit` is what the
 * live page's own valueRank is actually keyed on (real-salary-table.tsx:
 * `rankBy(computed, c => c.expectedCapHit)`), and the DB row stores that
 * exact value for the "Balanced" preset — the page's own default view, so
 * this now matches it on load. It will drift from what's on screen only if
 * a user has switched the live page to a different weight-preset archetype
 * (Aggressive/Conservative/etc.), which re-ranks client-side and isn't
 * reproduced here.
 */
/** `poolSize` is the population the ranks were computed within — the total
 *  row count of the site-wide Real Salary Rankings pool for this season, NOT
 *  any one Fantrax league's own roster size. A caller converting one of
 *  these ranks to a z-score (`rankToZ`) must use THIS number as the
 *  denominator, never a connected league's own `poolSize` (see Trade Edge's
 *  base-value cascade — src/lib/fantrax/trade-value.ts). */
export async function getSalaryRankByFheId(): Promise<{ rankByFheId: Record<string, number>; poolSize: number }> {
  const values = await getRealSalaryValues(REAL_SALARY_SEASON);
  const ranked = rankBy(
    values.map((v) => ({ playerId: v.player_id, score: v.expected_cap_hit })),
    (r) => r.score,
  );
  const rankByFheId: Record<string, number> = {};
  for (const v of values) {
    if (!v.fhe_id || rankByFheId[v.fhe_id] != null) continue;
    const rank = ranked.get(v.player_id);
    if (rank != null) rankByFheId[v.fhe_id] = rank;
  }
  return { rankByFheId, poolSize: values.length };
}

/**
 * fhe_id -> dynasty consensus rank, resolved through the player identity
 * registry rather than resolve.ts's own name-based lookupWithNameAlias() —
 * same pattern real-salary-rankings/page.tsx already uses for its
 * CONSENSUS_RANK_BY_FHE_ID map (the dynasty board is a hand-published name
 * list with no id column of its own, so it's resolved through
 * player_identity once here rather than name-matched per player against
 * resolve.ts's alias table again). Scoped to Roster Edge on purpose —
 * resolve.ts's consensusRank stays name-based for every other consumer
 * (Category Edge, Power Rankings, Settings), unchanged.
 */
export function getDynastyRankByFheId(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of rankings as BoardPlayer[]) {
    const res = playerIdentity().resolve({ name: p.player });
    if (res.kind === "matched" && out[res.identity.fheId] == null) {
      out[res.identity.fheId] = p.consensusRank;
    }
  }
  return out;
}

/** Population size `getDynastyRankByFheId`'s ranks were drawn from — the
 *  dynasty board's own player count, read live rather than hardcoded so it
 *  tracks board growth automatically. Same "ranks need their SOURCE
 *  population's size, not a connected league's own pool size" rule as
 *  `getSalaryRankByFheId`'s `poolSize` — see Trade Edge's base-value
 *  cascade (src/lib/fantrax/trade-value.ts). */
export function getConsensusPoolSize(): number {
  return (rankings as BoardPlayer[]).length;
}

export interface ContractInfo {
  currentSalary: number;
  /** The real, audited full contract length — read straight off
   *  nba_roster.contract_years (Pocaro's cap-sheet team-by-team rebuild, see
   *  the salary-roster-pipeline skill), not derived by counting non-null
   *  salary_yr columns. That derivation used to be the only source here, and
   *  it silently counted a Qualifying Offer / RFA cap-hold estimate
   *  (flagged by nba_roster.salary_qo_years) as if it were a normal
   *  continuing contract year — inflating both this figure and
   *  totalRemaining for any player with one (Ash, 2026-08-27: Kyshawn
   *  George's rookie-scale deal read "3yr/$17.0M" here — 2 real years plus
   *  his 2028-29 QO estimate folded in as a third — against the audited
   *  "4yr/$14.3M" nba_roster.contract_years/contract_total already carried).
   *  Falls back to the old salary_yr-sum count only for a player/team
   *  nba_roster hasn't been through that audit for yet (contract_years
   *  null) — a real, if less precise, number rather than a blank cell. */
  yearsRemaining: number;
  /** nba_roster.contract_total when audited; otherwise the same salary_yr-sum
   *  fallback as yearsRemaining, for the same reason. */
  totalRemaining: number;
  /** contractClassOf(nba_roster.contract_status) — drives Trade Edge's
   *  asset-card "Rookie Scale" tier (see _components/asset-tiers.ts). Has the
   *  same known Wembanyama-style data gap that model carries: a real
   *  rookie-scale deal nba_roster hasn't tagged "Rookie Scale" reads as
   *  "standard" here too. */
  contractClass: ContractClass;
}

// ageFromDob mirrors real-salary-rankings/page.tsx's own helper: computed
// fresh from dob on every request, not a persisted/stale snapshot — kept as
// a fractional year like that page's own "AGE" column.
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / MS_PER_YEAR;
}

/** fhe_id -> current age, computed live from nba_roster.dob — same
 *  convention as Real Salary Rankings' own AGE column. Omits anyone
 *  nba_roster has no dob for. */
export async function getAgeByFheId(): Promise<Record<string, number>> {
  const extras = await getRosterExtras();
  const out: Record<string, number> = {};
  for (const e of extras) {
    if (!e.fhe_id) continue;
    const age = ageFromDob(e.dob);
    if (age != null) out[e.fhe_id] = age;
  }
  return out;
}

/** fhe_id -> current-season salary + the real, audited full contract
 *  (nba_roster.contract_years/contract_total when present; see ContractInfo's
 *  own doc). Omits unsigned free agents (real_salary_values.salary null — no
 *  contract to show) and anyone nba_roster has no extras row for. */
export async function getContractByFheId(): Promise<Record<string, ContractInfo>> {
  const [values, extras] = await Promise.all([
    getRealSalaryValues(REAL_SALARY_SEASON),
    getRosterExtras(),
  ]);
  const extrasByFheId = new Map(extras.filter((e) => e.fhe_id).map((e) => [e.fhe_id!, e]));
  const out: Record<string, ContractInfo> = {};
  for (const v of values) {
    if (!v.fhe_id || v.salary == null || out[v.fhe_id] != null) continue;
    const extra = extrasByFheId.get(v.fhe_id);
    // Fallback only — a player/team nba_roster hasn't audited yet
    // (contract_years null) still needs SOME "years/total" answer, so this
    // reproduces the old behavior for exactly that case. Never used when
    // contract_years/contract_total are present; see ContractInfo's own doc
    // for why those two win whenever they exist.
    const fallbackYears = [v.salary, extra?.salary_yr2, extra?.salary_yr3, extra?.salary_yr4]
      .filter((s): s is number => s != null);
    out[v.fhe_id] = {
      currentSalary: v.salary,
      yearsRemaining: extra?.contract_years ?? fallbackYears.length,
      totalRemaining: extra?.contract_total ?? fallbackYears.reduce((a, b) => a + b, 0),
      contractClass: contractClassOf(extra?.contract_status ?? null),
    };
  }
  return out;
}

/** fhe_id -> true for a player nba_roster tags as a 2nd-year NBA player
 *  (`is_sophomore`) — drives Trade Edge's asset-card "Sophomore" tier (see
 *  _components/asset-tiers.ts). Omits anyone nba_roster has no extras row
 *  for (never a false positive from a missing row). */
export async function getSophomoreByFheId(): Promise<Record<string, boolean>> {
  const extras = await getRosterExtras();
  const out: Record<string, boolean> = {};
  for (const e of extras) {
    if (e.fhe_id && e.is_sophomore) out[e.fhe_id] = true;
  }
  return out;
}
