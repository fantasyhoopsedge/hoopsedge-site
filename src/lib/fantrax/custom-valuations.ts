import "server-only";
import { getCachedLeagueAnalysis } from "./league-cache";
import type { FantraxDatasetKey } from "./resolve";
import type { LeagueAnalysis, ResolvedPlayer } from "./analyze";
import type { TeamDraftPick } from "./league";
import type { ContractRule, LeagueType, RookieSalaryTier, SalaryFormat } from "./league-tags";
import { getAgeByFheId, getConsensusPoolSize, getContractByFheId, getDynastyRankByFheId, getSalaryRankByFheId, type ContractInfo } from "./roster-edge";
import { blendScore, rankBy, type RealSalaryFactors } from "../value/real-salary-model";
import { computeBaseTradeValues, type ValueBasis } from "./trade-value";
import { CATEGORIES_PICK_TIERS } from "./trade-verdict";
import type { TradeValueMode } from "./trade-edge";
import { playerIdentity } from "../player-identity/bundled";
import { DRAFT_BOARD } from "../rookie-board";
import { createAdminClient } from "../../utils/supabase/admin";
import type { LedgerRow } from "./custom-valuations-store";

/**
 * The custom league-asset ledger — everything this session validated by
 * hand (free agents pulled in alongside rostered players, 2026 rookie picks
 * mapped to real prospects at real dynasty consensus rank, house
 * contract-label rules, sign-aware year-decayed future picks) as one
 * reusable, on-demand-callable function. Called from
 * /api/fantrax/custom-valuations' POST handler ("Regenerate"); the result
 * is cached by custom-valuations-store.ts, never recomputed on page load.
 *
 * Deliberately does NOT read anything Fantrax can't give us plus this
 * league's own settings — no hardcoded league-specific numbers (unlike the
 * scratch scripts this was extracted from, which hardcoded Old But Gold's
 * own rookie salary table and contract rules directly).
 */

const REAL_SALARY_SEASON = 2027; // matches roster-edge.ts's own constant
const TOTAL_2026_PICKS_DEFAULT = 60; // 30 teams x 2 rookie-draft rounds, the common case
const YEAR_DECAY = 0.8; // same constant trade-verdict.ts documents (~0.74-0.84x observed)

/** A league's own rookie salary scale, sorted and searched by overall pick
 *  number. Empty settings -> every synthesized pick player gets salary
 *  null (still valued, just with no salary/contract-rule signal to feed
 *  into the blend — same "absent evidence" handling blendScore already
 *  gives any player with no salary on file). */
export function salaryForPick(tiers: RookieSalaryTier[] | undefined, overallPick: number): number | null {
  const hit = (tiers ?? []).find((t) => overallPick >= t.minPick && overallPick <= t.maxPick);
  return hit?.salary ?? null;
}

/** Same filter roster-table.tsx's own posDisplayFor() applies — duplicated
 *  for the same server/client boundary reason as formatRealContractLabel
 *  below. Drops "Flx" (and any other roster-slot-only tag) from Fantrax
 *  eligibility, keeping only real positions this league's own positionSlots
 *  actually recognizes (Ash, 2026-08-24: "use the fantrax eligibility but do
 *  not display FLX as a position"). */
const MAIN_POSITIONS = new Set(["PG", "SG", "SF", "PF", "C"]);
function posDisplayForLedger(eligible: string[], positionSlots: Record<string, number> | undefined): string {
  const showG = (positionSlots?.G ?? 0) > 0;
  const showF = (positionSlots?.F ?? 0) > 0;
  return eligible
    .filter((e) => {
      const upper = e.toUpperCase();
      if (MAIN_POSITIONS.has(upper)) return true;
      if (upper === "G") return showG;
      if (upper === "F") return showF;
      return false;
    })
    .join("/") || "";
}

/** Same "Xyr/$Y.YM" shape roster-table.tsx's own formatContract() renders —
 *  duplicated rather than imported since that module is a client component
 *  ("use client") and this one is server-only; both are tiny, framework-free
 *  string formatters that would drift apart if either changes, so keep them
 *  byte-identical in shape if you touch one. */
function formatRealContractLabel(info: ContractInfo | undefined): string | null {
  if (!info) return null;
  return `${info.yearsRemaining}yr/$${(info.totalRemaining / 1_000_000).toFixed(1)}M`;
}

/** Sign-aware decay: shrinks a positive baseline toward zero, pushes a
 *  negative baseline further from zero — either way strictly worse than
 *  the anchor, matching "a future pick can never be worth more than the
 *  equivalent slot converting into a real roster spot right now" (Ash,
 *  2026-08-23). A plain multiplicative decay gets this backwards for a
 *  negative baseline (pulls it toward zero = numerically HIGHER = this
 *  system reads it as MORE valuable). */
function decayFromAnchor(anchor: number, yearsOut: number): number {
  const factor = YEAR_DECAY ** yearsOut;
  return anchor >= 0 ? anchor * factor : anchor / factor;
}

// ── Roster-scarcity durability discount (2026-08-23) ────────────────────────
//
// A league with very few active/total roster spots can't absorb an aging,
// injury-prone star the way a deep dynasty league can — every spot has to be
// a near-lock to contribute, so real managers in that format routinely let a
// declining, expensive veteran sit as a free agent rather than burn a scarce
// roster spot on him (Ash, 2026-08-23, verified live against FBI Super20 Real
// Salary Roto: Stephen Curry, 38, and Joel Embiid — both genuinely UNROSTERED
// there despite the ledger ranking them top-150 of 511 by base value alone.
// 20 teams, only 8 active lineup slots / 14 total roster spots — one of the
// shallowest connected leagues seen). Base trade value (computeBaseTradeValues)
// carries no age or durability signal at all — it's derived from consensus
// rank / real-salary rank, neither of which discounts for "can THIS league
// afford to carry his risk." This multiplier scales with BOTH the player's
// own age/durability profile AND how little roster room this specific league
// has: a young, durable player is untouched even in the shallowest league,
// and an old, fragile one barely moves in a normal-depth one.
// 32 was the original starting point; checked live against FBI Super20 Real
// Salary Roto and found it left a 30.77-year-old Karl-Anthony Towns almost
// untouched (~4% off, from the games component alone) despite sitting
// unrostered there too — Ash, 2026-08-24: "he is over 30... he should be
// [devalued]." Lowered to 30 to match.
const AGE_DECLINE_START = 30; // age where durability/decline risk starts being real for most players
const AGE_DECLINE_RATE = 0.05; // fraction of value at risk per year past AGE_DECLINE_START
// Missed-games weight only phases in as age makes it plausible the games
// missed reflect real decline, not just a young star's normal load
// management or a one-off rookie-year injury with a full recovery expected
// — gated to start 4 years before AGE_DECLINE_START and reach full weight
// AT that threshold (Ash's own framing was "old high-salary guys"; without
// this gate, a healthy 22-year-old projected for 65 of 82 games — completely
// normal — took the same games-missed hit as a declining 38-year-old,
// caught live: Wembanyama dropped 9.5% off a near-full-season 65-game
// projection alone, well before any age signal should apply to him at all).
const GAMES_RELEVANCE_START = AGE_DECLINE_START - 4;
const GAMES_MISSED_FULL_SEASON = 82;
const GAMES_MISSED_WEIGHT = 0.4; // an age-relevant player projected for 0 games loses up to 40% here
const MAX_DURABILITY_PENALTY = 0.7; // never discount more than 70% off age+durability alone
const REFERENCE_TOTAL_ROSTER_SLOTS = 16; // this repo's other reference league (Old But Gold, 30x16)

/** 1 = no discount; shrinks toward 0 as age/missed-games risk and roster
 *  scarcity both increase. Applied sign-aware (see applyDurabilityDiscount)
 *  so a below-replacement asset gets WORSE, never accidentally better. */
function durabilityMultiplier(age: number | undefined, gamesPlayed: number | null | undefined, totalRosterSlots: number): number {
  const agePenalty = age != null ? Math.min(MAX_DURABILITY_PENALTY, Math.max(0, age - AGE_DECLINE_START) * AGE_DECLINE_RATE) : 0;
  const gamesRelevance = age != null ? Math.min(1, Math.max(0, (age - GAMES_RELEVANCE_START) / (AGE_DECLINE_START - GAMES_RELEVANCE_START))) : 0;
  const gamesPenalty = gamesPlayed != null
    ? Math.min(MAX_DURABILITY_PENALTY, Math.max(0, (GAMES_MISSED_FULL_SEASON - gamesPlayed) / GAMES_MISSED_FULL_SEASON) * GAMES_MISSED_WEIGHT * gamesRelevance)
    : 0;
  const basePenalty = Math.min(MAX_DURABILITY_PENALTY, agePenalty + gamesPenalty);
  if (basePenalty <= 0) return 1;
  const shallownessMultiplier = Math.min(2, Math.max(1, REFERENCE_TOTAL_ROSTER_SLOTS / Math.max(1, totalRosterSlots)));
  const scaledPenalty = Math.min(MAX_DURABILITY_PENALTY, basePenalty * shallownessMultiplier);
  return 1 - scaledPenalty;
}

/** Same sign-aware convention as this module's own decayFromAnchor — a
 *  multiplier below 1 must make a NEGATIVE value MORE negative (divide),
 *  never closer to zero (which would read as an improvement). */
function applyDurabilityDiscount(value: number, multiplier: number): number {
  return value >= 0 ? value * multiplier : value / multiplier;
}

function categoryFallbackModeFor(scoringMode: string, scoredCount: number): Exclude<TradeValueMode, "surplusV"> {
  if (scoringMode === "points") return "fpts";
  return scoredCount === 8 ? "eightCatV" : "nineCatV";
}

export interface CustomValuationsInput {
  leagueId: string;
  teamId: string | null;
  dataset: FantraxDatasetKey;
  leagueType: LeagueType;
  valueBasis: ValueBasis;
  salaryFormat: SalaryFormat;
  contractRules: ContractRule[] | undefined;
  rookieSalaryScale: RookieSalaryTier[] | undefined;
  keeperPolicy: string | undefined;
  /** Real-salary leagues only — see SavedLeagueSettings.realSalaryEfficiencyWeight's
   *  own doc. Undefined, or equal to the site-wide "Balanced" default (0.30),
   *  keeps today's behavior (the frozen, rookie-scale-aware site-wide rank —
   *  see getRealSalaryRankByFheId below). Any other value triggers a fresh,
   *  per-league re-rank at that weight. */
  realSalaryEfficiencyWeight: number | undefined;
}

const DEFAULT_EFFICIENCY_WEIGHT = 0.30; // matches WEIGHT_PRESETS.balanced.efficiency

/** Real-salary base rank, honoring a per-league efficiency-weight override.
 *  Default weight reuses the frozen site-wide rank (getSalaryRankByFheId) —
 *  rookie-scale-aware, byte-identical to today. A genuinely different weight
 *  re-ranks fresh from the same raw factors real-salary-rankings itself
 *  stores (consensus_z/production_z/salary_z), same blendScore formula, just
 *  a custom consensus/efficiency split — simplified to treat every contract
 *  as "standard" (no rookie-scale bonus) since this path has no per-player
 *  contract-class signal to work from without a second round trip; a
 *  deliberate v1 scope cut, not an oversight (Ash, 2026-08-24: "the ability
 *  to shift the math in settings... I will shift the math slightly and then
 *  re-generate"). */
export async function getRealSalaryRankByFheId(
  admin: ReturnType<typeof createAdminClient>,
  efficiencyWeight: number | undefined,
): Promise<{ rankByFheId: Map<string, number>; poolSize: number }> {
  const w = efficiencyWeight ?? DEFAULT_EFFICIENCY_WEIGHT;
  if (Math.abs(w - DEFAULT_EFFICIENCY_WEIGHT) < 0.001) {
    const salaryRank = await getSalaryRankByFheId();
    return { rankByFheId: new Map(Object.entries(salaryRank.rankByFheId)), poolSize: salaryRank.poolSize };
  }
  const { data: rows, error } = await admin
    .from("real_salary_values")
    .select("player_id,fhe_id,consensus_z,production_z,salary_z,salary")
    .eq("season", REAL_SALARY_SEASON);
  if (error) throw new Error(error.message);
  const preset = { consensus: 1 - w, efficiency: w, rookieScaleAdjustment: 0 };
  // salary carried through for real (not null) — blendScore's cheapnessCredit
  // gate zeroes the ENTIRE cheapness sub-weight for a null salary, which
  // would silently drop this path to "production only" for every player.
  const factors: RealSalaryFactors[] = (rows ?? []).map((r) => ({
    playerId: r.player_id as string,
    consensusZ: r.consensus_z as number,
    productionZ: r.production_z as number | null,
    salaryZ: r.salary_z as number,
    salary: r.salary as number | null,
  }));
  const rankByPlayerId = rankBy(factors.map((f) => ({ playerId: f.playerId, f })), ({ f }) => blendScore(f, preset));
  const rankByFheId = new Map<string, number>();
  for (const r of rows ?? []) {
    if (!r.fhe_id || rankByFheId.has(r.fhe_id as string)) continue;
    const rank = rankByPlayerId.get(r.player_id as string);
    if (rank != null) rankByFheId.set(r.fhe_id as string, rank);
  }
  return { rankByFheId, poolSize: (rows ?? []).length };
}

export interface CustomLedgerResult {
  playerCount: number;
  pickCount: number;
  extraPickCount: number;
  rows: LedgerRow[];
  /** "full" = every rostered player/FA/pick revalued (computeCustomLedger);
   *  "picksOnly" = draft-pick values alone, generated for a league that
   *  otherwise reads standard base values (computePickValuesLedger below) —
   *  see CustomValuationsDoc.mode's own doc for how a consumer must gate on
   *  this. */
  mode: "full" | "picksOnly";
  realSalaryEfficiencyWeight: number | null;
}

/**
 * Resolves this league's Fantrax free agents against the identity registry +
 * season_player_values, into the same ResolvedPlayer shape a rostered player
 * already has. Shared by computeCustomLedger (the full ledger) and
 * computePickValuesLedger (the picksOnly ledger's own rank-scaffold pool —
 * see that function's own doc) so there is exactly ONE Fantrax-free-agent
 * resolution implementation, not two that can silently drift apart — the
 * league-rankings.ts free-agent loop was a THIRD copy of this same block
 * until it and this one were both found still resolving by raw name instead
 * of Fantrax id (Ash, 2026-08-26: duplicate "Jaylin Williams"/"Jalen
 * Johnson" rows), which is exactly the kind of divergence three independent
 * copies of one join invite.
 */
async function resolveFreeAgentPlayers(
  analysis: LeagueAnalysis,
  admin: ReturnType<typeof createAdminClient>,
  dynastyRankByFheId: Record<string, number>,
): Promise<ResolvedPlayer[]> {
  const idx = playerIdentity();
  const rawFAs = analysis.league.freeAgents ?? [];
  const espnIdByFantraxId = new Map<string, string>();
  const fheIdByFantraxId = new Map<string, string>();
  for (const fa of rawFAs) {
    // Fantrax id, not name — resolve.ts's own resolveOne() uses the same
    // id-based join for exactly this reason (see its file header: "there is
    // deliberately NO name fallback"). The registry blocks a Fantrax id from
    // linking to an identity whenever another Fantrax player shares its name
    // and can't be safely told apart (blockedFantraxNames() in
    // build-player-identity.ts); a raw name resolve bypasses that guard and
    // matches the SAME identity for every same-named Fantrax entry, which is
    // how a league's ghost/duplicate free-agent entry for a rostered player
    // (e.g. two "Jaylin Williams" or two "Jalen Johnson" rows, one rostered,
    // one a teamless free agent) ended up duplicated in the generated ledger
    // with identical values under both rows.
    const r = idx.resolve({ fantraxId: fa.fantraxId });
    if (r.kind === "matched" && r.identity.espnId) {
      espnIdByFantraxId.set(fa.fantraxId, r.identity.espnId);
      fheIdByFantraxId.set(fa.fantraxId, r.identity.fheId);
    }
  }
  const espnIds = [...new Set(espnIdByFantraxId.values())];
  const faPlayers: ResolvedPlayer[] = [];
  if (espnIds.length > 0) {
    const [{ data: svRows, error }, { data: statRows, error: statError }] = await Promise.all([
      admin
        .from("season_player_values")
        .select("player_id,value,minus1v")
        .eq("season", REAL_SALARY_SEASON).eq("season_type", "projection").eq("league_size", 450)
        .in("player_id", espnIds),
      // Real projected games — the durability discount's other input (see
      // durabilityMultiplier). Rostered players already carry this on
      // ResolvedPlayer.gamesPlayed; a free agent otherwise had it hardcoded
      // null here, silently exempting exactly the players (unrostered,
      // often aging/oft-injured) that signal matters most for.
      admin
        .from("season_player_stats")
        .select("player_id,g")
        .eq("season", REAL_SALARY_SEASON).eq("season_type", "projection")
        .in("player_id", espnIds),
    ]);
    if (error) throw new Error(error.message);
    if (statError) throw new Error(statError.message);
    const valueByEspnId = new Map((svRows ?? []).map((r) => [r.player_id as string, { nineCatV: r.value as number | null, minus1V: r.minus1v as number | null }]));
    const gamesByEspnId = new Map((statRows ?? []).map((r) => [r.player_id as string, r.g as number | null]));
    for (const fa of rawFAs) {
      const espnId = espnIdByFantraxId.get(fa.fantraxId);
      const fheId = fheIdByFantraxId.get(fa.fantraxId);
      if (!espnId) continue;
      const v = valueByEspnId.get(espnId);
      if (!v || v.nineCatV == null) continue;
      faPlayers.push({
        fantraxId: fa.fantraxId, name: fa.name, slot: "FA", eligible: fa.eligible ?? [],
        nbaTeam: fa.nbaTeam ?? "", status: "FA", salary: null, contract: null,
        playerId: espnId, fheId: fheId ?? null, source: "projection", cats: {}, catsTotals: {},
        leagueV: null, pointsValue: null, nineCatV: v.nineCatV, consensusRank: fheId ? dynastyRankByFheId[fheId] ?? null : null,
        gamesPlayed: gamesByEspnId.get(espnId) ?? null, minutesPerGame: null, usgPct: null, statLine: null,
        catV: { perGame: { nineCatV: v.nineCatV, minus1V: v.minus1V, eightCatV: null }, totals: { nineCatV: null, minus1V: null, eightCatV: null } },
        catVRank: { perGame: { nineCatV: null, minus1V: null, eightCatV: null }, totals: { nineCatV: null, minus1V: null, eightCatV: null } },
        trendTags: null, ambiguousName: false, smallSample: false, isRookie: false,
      } as unknown as ResolvedPlayer);
    }
  }
  return faPlayers;
}

export async function computeCustomLedger(input: CustomValuationsInput): Promise<CustomLedgerResult> {
  const { leagueId, teamId, dataset, leagueType, valueBasis, salaryFormat, contractRules, rookieSalaryScale, keeperPolicy } = input;

  const analysis = await getCachedLeagueAnalysis(leagueId, teamId, dataset, leagueType === "redraft" ? "redraft" : leagueType);
  const rostered: ResolvedPlayer[] = analysis.rosters.flatMap((r) => r.players);
  const rosteredIds = new Set(rostered.map((p) => p.fantraxId));
  const admin = createAdminClient();
  const idx = playerIdentity();

  const [salaryRank, dynastyRankByFheId, ageByFheId, contractByFheId] = await Promise.all([
    getRealSalaryRankByFheId(admin, input.realSalaryEfficiencyWeight),
    Promise.resolve(getDynastyRankByFheId()),
    getAgeByFheId(),
    // Only meaningful for a real-salary league — Fantrax's own raw contract
    // LABEL (ResolvedPlayer.contract, a custom-salary house convention, see
    // LeagueRosterSpot's own doc) is what a custom-salary league already
    // carries through below; a real-salary league's rows need the REAL
    // years/dollars-remaining contract instead, which lives here, not on
    // ResolvedPlayer at all (Ash, 2026-08-23: found every row reading
    // CONTRACT "—" in a real-salary league — this was never wired in).
    salaryFormat === "real" ? getContractByFheId() : Promise.resolve<Record<string, ContractInfo>>({}),
  ]);
  const realSalaryRankByFheId = salaryRank.rankByFheId;
  const realSalaryPoolSize = salaryRank.poolSize;
  const consensusPoolSize = getConsensusPoolSize();

  const scoredCount = analysis.league.categories?.scored?.length ?? 9;
  const categoryFallbackMode = categoryFallbackModeFor(analysis.league.scoringMode, scoredCount);

  const faPlayers = await resolveFreeAgentPlayers(analysis, admin, dynastyRankByFheId);

  const teamNameByPlayerFantraxId = new Map<string, string>();
  for (const r of analysis.rosters) for (const p of r.players) teamNameByPlayerFantraxId.set(p.fantraxId, r.teamName);

  const currentSeason = Number(dataset.split(":")[0]) || REAL_SALARY_SEASON;
  // rawBaseValueByFantraxId comes back from buildPickAssetRows itself — it's
  // computeBaseTradeValues' own output over the FULL candidate pool
  // (rostered + FA + synthesized picks together), the same single call the
  // pre-refactor version made once and read for both players AND picks.
  // Recomputing a second time over rostered+FA ALONE would be wrong for
  // valueBasis "custom": customSalaryValues ranks players POOL-RELATIVELY
  // (rankBy against whatever's in the array), so dropping ~60 pick
  // candidates from that array would shift every real player's rank (and
  // therefore value) versus the original combined computation — reusing
  // this map instead of a fresh, narrower call is what keeps player values
  // byte-identical to before this function was split in two.
  const { rows: pickRows, pickCount, extraPickCount, rawBaseValueByFantraxId } = buildPickAssetRows({
    analysis, corePlayers: [...rostered, ...faPlayers], dynastyRankByFheId, idx, rookieSalaryScale,
    leagueType, valueBasis, categoryFallbackMode, consensusPoolSize, realSalaryRankByFheId, realSalaryPoolSize,
    keeperPolicy, contractRules, currentSeason,
  });

  // Durability discount — real players only (rostered + free agents), never
  // a rookie-pick placeholder (no age/games history to discount, and a
  // prospect's own risk is already what the pick-value curve prices). Uses
  // this league's own TOTAL roster capacity (maxTotalPlayers), not the
  // active-lineup totalRosterSlots buildPickAssetRows computed for the
  // computeBaseTradeValues call above — the discount is about whether the
  // league can even afford to CARRY a risky asset on the bench, not whether
  // he'd start every night.
  const baseValueByFantraxId = new Map(rawBaseValueByFantraxId);
  for (const p of [...rostered, ...faPlayers]) {
    const raw = baseValueByFantraxId.get(p.fantraxId);
    if (raw == null) continue;
    const age = p.fheId ? ageByFheId[p.fheId] : undefined;
    const multiplier = durabilityMultiplier(age, p.gamesPlayed, analysis.league.maxTotalPlayers);
    if (multiplier < 1) baseValueByFantraxId.set(p.fantraxId, applyDurabilityDiscount(raw, multiplier));
  }

  const rows: LedgerRow[] = [];
  for (const p of [...rostered, ...faPlayers]) {
    const v = baseValueByFantraxId.get(p.fantraxId);
    if (v == null) continue;
    const dynRank = p.fheId ? dynastyRankByFheId[p.fheId] ?? null : null;
    // Real-salary league: the real years/dollars-remaining contract (null
    // only when the site-wide contract table itself has nothing for him — a
    // genuinely unsigned/undrafted player). Custom-salary (or no salary
    // data): Fantrax's own raw contract-label field, unchanged.
    const realContractInfo = p.fheId ? contractByFheId[p.fheId] : undefined;
    const contract = salaryFormat === "real" ? formatRealContractLabel(realContractInfo) : (p.contract ?? null);
    // Fantrax's own roster salary (p.salary) is null for anyone NOT
    // currently rostered in THIS league — true for every free agent
    // regardless of format, so it silently blanked SALARY for the whole FA
    // list even though CONTRACT (above) already had his real current-season
    // salary sitting right there (Ash, 2026-08-24: "free agents salary is
    // missing"). Falls back to that same real figure for a real-salary
    // league; a custom-salary league has no such site-wide fallback to
    // offer, so an unrostered player there still correctly shows nothing.
    const salary = p.salary ?? (salaryFormat === "real" ? realContractInfo?.currentSalary ?? null : null);
    rows.push({
      asset: p.name, type: "player", fantraxId: p.fantraxId, pickKey: null, bracketKey: null,
      pos: posDisplayForLedger(p.eligible || [], analysis.league.positionSlots) || null,
      nbaTeam: p.nbaTeam || null, isRookie: p.isRookie ?? false,
      dynRank, tradeValue: v, tradeRank: null,
      salary, contract,
      owner: rosteredIds.has(p.fantraxId) ? (teamNameByPlayerFantraxId.get(p.fantraxId) ?? "—") : "Free agent",
    });
  }
  rows.push(...pickRows);

  rows.sort((a, b) => b.tradeValue - a.tradeValue);
  rows.forEach((r, i) => { r.tradeRank = i + 1; });

  return {
    playerCount: rows.filter((r) => r.type === "player").length,
    pickCount,
    extraPickCount,
    rows,
    mode: "full",
    realSalaryEfficiencyWeight: salaryFormat === "real" ? (input.realSalaryEfficiencyWeight ?? DEFAULT_EFFICIENCY_WEIGHT) : null,
  };
}

/**
 * The pick-only half of computeCustomLedger — extracted so a STANDARD
 * (non-custom-valuation) dynasty/keeper league can generate the SAME real,
 * individually-slotted pick values (current-year picks anonymized to real
 * prospects at real dynasty-consensus rank, future years sign-aware-decayed
 * off that same curve) without pulling in the rest of the custom ledger
 * (durability discount, custom-salary contract rules, per-league efficiency
 * weight — all genuinely custom-VALUATION concerns a standard league opts
 * out of by definition). Called by both computeCustomLedger (`corePlayers`
 * = this league's real rostered + FA pool, so a synthesized pick competes
 * for base value against real players exactly as before) and
 * computePickValuesLedger below (`corePlayers` = [] — see that function's
 * own doc for why an empty pool is still correct there).
 */
interface PickAssetRowsInput {
  analysis: LeagueAnalysis;
  corePlayers: ResolvedPlayer[];
  dynastyRankByFheId: Record<string, number>;
  idx: ReturnType<typeof playerIdentity>;
  rookieSalaryScale: RookieSalaryTier[] | undefined;
  leagueType: LeagueType;
  valueBasis: ValueBasis;
  categoryFallbackMode: Exclude<TradeValueMode, "surplusV">;
  consensusPoolSize: number;
  realSalaryRankByFheId: Map<string, number>;
  realSalaryPoolSize: number;
  keeperPolicy: string | undefined;
  contractRules: ContractRule[] | undefined;
  currentSeason: number;
}
interface PickAssetRowsResult {
  rows: LedgerRow[];
  pickCount: number;
  extraPickCount: number;
  /** computeBaseTradeValues' own output over the full corePlayers+pick pool
   *  — handed back so a caller with its own corePlayers (computeCustomLedger)
   *  can price ITS OWN player rows off the exact same computation, rather
   *  than running a second, narrower one that would (for valueBasis
   *  "custom" specifically) rank players against a different pool and so
   *  disagree with this function's own pick values. See computeCustomLedger's
   *  own call site for why that matters. */
  rawBaseValueByFantraxId: Map<string, number>;
}
function buildPickAssetRows(input: PickAssetRowsInput): PickAssetRowsResult {
  const {
    analysis, corePlayers, dynastyRankByFheId, idx, rookieSalaryScale, leagueType, valueBasis,
    categoryFallbackMode, consensusPoolSize, realSalaryRankByFheId, realSalaryPoolSize, keeperPolicy,
    contractRules, currentSeason,
  } = input;

  // current-year picks: rookie board's own candidate pool, sorted by REAL
  // dynasty consensus rank (not the board's own internal 1-N ordering — see
  // trade-value.ts's module doc for why those two disagree player-for-player).
  // draftYear = the SOONEST year any team holds a pick for — real draft-pick
  // data is always forward-looking, so the minimum year across every team's
  // picks is the imminent draft class, read directly rather than assumed
  // from the connected dataset's own season number.
  const allPickYears = analysis.league.rosters.flatMap((r) => r.draftPicks.map((p) => p.year));
  const draftYear = allPickYears.length > 0 ? Math.min(...allPickYears) : new Date().getFullYear();
  const currentYearPicks = analysis.league.rosters.flatMap((r) => r.draftPicks).filter((p) => p.year === draftYear);
  const totalPicks = currentYearPicks.reduce((max, p) => Math.max(max, p.overallPick ?? 0), TOTAL_2026_PICKS_DEFAULT);
  const candidates: { name: string; pos: string; nbaTeam: string; fheId: string; consensusRank: number }[] = [];
  for (const boardPlayer of DRAFT_BOARD) {
    const r = idx.resolve({ name: boardPlayer.name });
    if (r.kind !== "matched") continue;
    const consensusRank = dynastyRankByFheId[r.identity.fheId];
    if (consensusRank == null) continue;
    candidates.push({ name: boardPlayer.name, pos: boardPlayer.pos ?? "", nbaTeam: boardPlayer.nbaTeam ?? "", fheId: r.identity.fheId, consensusRank });
  }
  candidates.sort((a, b) => a.consensusRank - b.consensusRank);
  const topN = candidates.slice(0, Math.max(totalPicks, TOTAL_2026_PICKS_DEFAULT));

  const pickPlayers: ResolvedPlayer[] = [];
  const pickPlayerFantraxIdByOverallPick = new Map<number, string>();
  topN.forEach((c, i) => {
    const overallPick = i + 1;
    const fantraxId = `rookie-pick-${draftYear}-${overallPick}`;
    pickPlayerFantraxIdByOverallPick.set(overallPick, fantraxId);
    pickPlayers.push({
      fantraxId, name: `${c.name} (${draftYear} #${overallPick})`, slot: "Bench",
      eligible: [c.pos], nbaTeam: c.nbaTeam, status: "prospect",
      salary: salaryForPick(rookieSalaryScale, overallPick), contract: null,
      playerId: null, fheId: c.fheId, source: "projection", cats: {}, catsTotals: {},
      leagueV: null, pointsValue: null, nineCatV: null, consensusRank: c.consensusRank,
      gamesPlayed: null, minutesPerGame: null, usgPct: null, statLine: null,
      catV: { perGame: { nineCatV: null, minus1V: null, eightCatV: null }, totals: { nineCatV: null, minus1V: null, eightCatV: null } },
      catVRank: { perGame: { nineCatV: null, minus1V: null, eightCatV: null }, totals: { nineCatV: null, minus1V: null, eightCatV: null } },
      trendTags: null, ambiguousName: false, smallSample: false, isRookie: true,
    } as unknown as ResolvedPlayer);
  });

  const teamNameByTeamId = new Map(analysis.league.rosters.map((r) => [r.teamId, r.teamName]));
  const totalRosterSlots = Object.values(analysis.league.positionSlots ?? {}).reduce((a, b) => a + b, 0);
  const leaguePoolSize = analysis.league.poolSize;
  const rawBaseValueByFantraxId = computeBaseTradeValues({
    players: [...corePlayers, ...pickPlayers], leagueType, valueBasis, categoryFallbackMode,
    redraftBaseMode: "native", leaguePoolSize, consensusPoolSize,
    realSalaryRankByFheId, realSalaryPoolSize, keeperPolicy, totalRosterSlots,
    contractRules, currentSeason,
  });

  // Running clamp: guarantees pick order == value order using only real,
  // pool-comparable signal — no external reference-table floor (see
  // trade-value.ts's module doc for why that floor was wrong: it made late
  // picks read above real, known, cheap productive players).
  //
  // Loop bound is `totalPicks` (every real, individually-slotted pick any
  // team in the league actually holds), NOT `topN.length` (how many rookie-
  // board prospects happened to resolve an identity AND carry a published
  // dynasty consensus rank — the rookie board only names ~66 prospects
  // total, nowhere near enough to cover a 3-round, 30-team draft's 90 real
  // slots). Capping the loop at topN.length used to leave every pick beyond
  // the last named prospect with NO value at all — pickValueFor() returned
  // null, so the row-building loop below silently dropped that pick from
  // the ledger entirely (Ash, 2026-08-26: HBB's real, team-owned 2026 3rd
  // (#63) and (#88) picks in Woolridge DMD30 had no ledger row, so Trade
  // Edge's cards fell back to ranking them against the whole real-player
  // pool instead — reading as the league's 369th-best asset apiece, a wild,
  // scale-broken number next to the ledger-covered picks around them).
  // Every slot past topN.length still hits the `raw == null` branch below
  // and flat-continues the last real, resolvable pick's value — the same
  // fallback this loop already used for any individual gap, just no longer
  // gated behind a bound that silently excluded genuine late-round picks.
  const pickValues: (number | null)[] = [];
  let runningCap = Infinity;
  for (let overallPick = 1; overallPick <= Math.max(topN.length, totalPicks); overallPick++) {
    const fid = pickPlayerFantraxIdByOverallPick.get(overallPick);
    const raw = fid ? rawBaseValueByFantraxId.get(fid) ?? null : null;
    if (raw == null) {
      pickValues.push(pickValues.length > 0 ? pickValues[pickValues.length - 1] : null);
      continue;
    }
    const clamped = Math.min(raw, runningCap);
    runningCap = clamped;
    pickValues.push(clamped);
  }
  const pickValueFor = (overallPick: number): number | null => pickValues[overallPick - 1] ?? null;

  function pickLabel(pick: TeamDraftPick): string {
    const ordinal = pick.round === 1 ? "1st" : pick.round === 2 ? "2nd" : `${pick.round}th`;
    const slot = pick.overallPick != null ? ` (#${pick.overallPick})` : "";
    const origin = pick.originalOwnerLabel ? ` — from ${pick.originalOwnerLabel}` : "";
    return `${pick.year} ${ordinal}${slot}${origin}`;
  }

  const rows: LedgerRow[] = [];
  let pickCount = 0;
  const seenPick = new Set<string>();
  for (const r of analysis.league.rosters) {
    for (const pick of r.draftPicks) {
      if (pick.year !== draftYear) continue;
      const key = `${r.teamId}:${pick.round}:${pick.overallPick}`;
      if (seenPick.has(key)) continue;
      seenPick.add(key);
      const v = pick.overallPick != null ? pickValueFor(pick.overallPick) : null;
      if (v == null) continue;
      pickCount++;
      rows.push({
        asset: pickLabel(pick), type: "pick", fantraxId: null,
        pickKey: pick.overallPick != null ? `${draftYear}:${pick.overallPick}` : null, bracketKey: null,
        pos: null, nbaTeam: null, isRookie: false, dynRank: null, tradeValue: v, tradeRank: null,
        salary: pick.overallPick != null ? salaryForPick(rookieSalaryScale, pick.overallPick) : null,
        contract: null, owner: teamNameByTeamId.get(r.teamId) ?? "—",
      });
    }
  }

  // Future years: derived from the corrected current-year curve via
  // sign-aware year-decay, not the disconnected external bracket table. Also
  // folds draftYear itself in at yearsOut=0 when the league had NO real,
  // individually-slotted pick for it (pickCount === 0 above) — a league whose
  // own current-season draft already concluded reports no "current year"
  // pick data at all (Fantrax's getDraftPicks never returns the currently-
  // drafting season, and a league past its own draft has none left to report
  // either), so draftYear (the earliest year ANY pick data exists for) is
  // itself just another un-slotted future class, not a real orderable draft
  // — without this it silently vanished from the ledger entirely (Ash,
  // 2026-08-24, verified live against FBI Super20 Real Salary Roto: "2027
  // picks are missing" — that league's 2026 draft concluded July 23, so 2027
  // was the earliest year present, yet had zero picks with a real overallPick).
  const bracketYears = new Set<number>();
  for (const r of analysis.league.rosters) {
    for (const pick of r.draftPicks) {
      if (pick.year > draftYear || (pick.year === draftYear && pickCount === 0)) bracketYears.add(pick.year);
    }
  }
  const tiers = CATEGORIES_PICK_TIERS[2027] ?? [];
  let extraPickCount = 0;
  for (const year of [...bracketYears].sort((a, b) => a - b)) {
    const yearsOut = year - draftYear;
    for (const tier of tiers) {
      const anchor = pickValueFor(tier.minPick);
      if (anchor == null) continue;
      const v = decayFromAnchor(anchor, yearsOut);
      extraPickCount++;
      rows.push({
        asset: `${year} #${tier.minPick}-${tier.maxPick}`, type: "pick", fantraxId: null, pickKey: null,
        bracketKey: `${year}:${tier.minPick}-${tier.maxPick}`,
        pos: null, nbaTeam: null, isRookie: false, dynRank: null,
        tradeValue: v, tradeRank: null, salary: null, contract: null, owner: "—",
      });
    }
  }

  return { rows, pickCount, extraPickCount, rawBaseValueByFantraxId };
}

export interface PickValuesInput {
  leagueId: string;
  teamId: string | null;
  dataset: FantraxDatasetKey;
  leagueType: LeagueType;
  /** Only "standard" (consensus) and "real" (real salary) — the two base
   *  values computed as a pure per-player rank lookup against a site-wide
   *  table, independent of the rest of the candidate pool. "custom" salary
   *  needs the real rostered+FA pool to rank against (customSalaryValues in
   *  trade-value.ts) and stays on the full custom-ledger path (computeCustomLedger),
   *  which "standard base asset values" leagues by definition aren't using. */
  valueBasis: Extract<ValueBasis, "standard" | "real">;
  rookieSalaryScale: RookieSalaryTier[] | undefined;
}

/**
 * "Generate draft pick values" — the standard-league counterpart to
 * computeCustomLedger's pick section, for a dynasty/keeper league that
 * hasn't opted into full custom asset valuations (Ash, 2026-08-25: "a new
 * button on the home screen... to generate the value of draft pick assets
 * for dynasty and keeper leagues... used for leagues that apply the
 * standard base asset values"). Reuses buildPickAssetRows with an EMPTY
 * corePlayers pool — correct because "standard"/"real" valueBasis price
 * every player (real or synthesized-rookie) via a pure per-player rank
 * lookup against a site-wide table (dynasty consensus rank or real-salary
 * rank), never pool-relative — so a synthesized pick's own value doesn't
 * depend on which other players happen to be in the candidate array. Saved
 * into the SAME store/table as the full ledger (custom-valuations-store.ts),
 * tagged `mode: "picksOnly"` so a consumer never mistakes it for real player
 * base values (see that field's own doc) — one row per league either way,
 * whichever kind was generated most recently.
 */
export async function computePickValuesLedger(input: PickValuesInput): Promise<CustomLedgerResult> {
  const { leagueId, teamId, dataset, leagueType, valueBasis, rookieSalaryScale } = input;

  const analysis = await getCachedLeagueAnalysis(leagueId, teamId, dataset, leagueType === "redraft" ? "redraft" : leagueType);
  const admin = createAdminClient();
  const [salaryRank, dynastyRankByFheId] = await Promise.all([
    valueBasis === "real" ? getRealSalaryRankByFheId(admin, undefined) : Promise.resolve({ rankByFheId: new Map<string, number>(), poolSize: 0 }),
    Promise.resolve(getDynastyRankByFheId()),
  ]);
  const consensusPoolSize = getConsensusPoolSize();
  const idx = playerIdentity();
  const currentSeason = Number(dataset.split(":")[0]) || REAL_SALARY_SEASON;

  // The real rostered + free-agent pool — needed even though this ledger
  // never stores a player ROW (mode "picksOnly" carries picks alone), purely
  // as the rank-scaffold every pick's tradeRank gets placed within. Without
  // it (this used to pass corePlayers: []), buildPickAssetRows had no real
  // players to rank picks against at all, so the tradeRank it assigned below
  // was each pick's place among OTHER PICKS ONLY — a much smaller,
  // differently-scaled pool than the ~550-asset one every other rank number
  // in the app means (computeCustomLedger's own full-ledger rows, and
  // League Rankings' own toRanked(standardMap)/(realMap), all rank picks
  // together WITH real players in one combined sort). A picks-only-pool rank
  // of "10" silently meant something totally different from a full-pool
  // rank of "10" once it reached Trade Edge's cards, which read this number
  // as if it were the latter (Ash, 2026-08-26: Woolridge DMD30's HBB 2026
  // 1st #6 showed ledger rank #10 — correct only "among this league's other
  // picks," not among the league's real ~550 assets it was displayed
  // alongside).
  const scoredCount = analysis.league.categories?.scored?.length ?? 9;
  const categoryFallbackMode = categoryFallbackModeFor(analysis.league.scoringMode, scoredCount);
  const rostered: ResolvedPlayer[] = analysis.rosters.flatMap((r) => r.players);
  const faPlayers = await resolveFreeAgentPlayers(analysis, admin, dynastyRankByFheId);
  const corePlayers = [...rostered, ...faPlayers];

  const { rows, pickCount, extraPickCount, rawBaseValueByFantraxId } = buildPickAssetRows({
    analysis, corePlayers, dynastyRankByFheId, idx, rookieSalaryScale,
    leagueType, valueBasis, categoryFallbackMode, consensusPoolSize,
    realSalaryRankByFheId: salaryRank.rankByFheId, realSalaryPoolSize: salaryRank.poolSize,
    keeperPolicy: undefined, contractRules: undefined, currentSeason,
  });

  // Rank every pick row within the COMBINED real-player + pick pool (exactly
  // the shape computeCustomLedger's own end-of-function sort uses, and
  // exactly what league-rankings.ts's toRanked() means for every other rank
  // number in the app) — only the pick rows get stored back into the
  // ledger, but their tradeRank is computed as if the real players were
  // sitting right there in the same sorted list, because on every OTHER
  // surface that reads this number, they are.
  const combined: { value: number; row?: LedgerRow }[] = [
    ...corePlayers
      .map((p) => rawBaseValueByFantraxId.get(p.fantraxId))
      .filter((v): v is number => v != null)
      .map((value) => ({ value })),
    ...rows.map((row) => ({ value: row.tradeValue, row })),
  ];
  combined.sort((a, b) => b.value - a.value);
  combined.forEach((entry, i) => { if (entry.row) entry.row.tradeRank = i + 1; });

  return { playerCount: 0, pickCount, extraPickCount, rows, mode: "picksOnly", realSalaryEfficiencyWeight: null };
}
