import "server-only";
import { getCachedLeagueAnalysis } from "./league-cache";
import type { FantraxDatasetKey } from "./resolve";
import type { ResolvedPlayer } from "./analyze";
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
function salaryForPick(tiers: RookieSalaryTier[] | undefined, overallPick: number): number | null {
  const hit = (tiers ?? []).find((t) => overallPick >= t.minPick && overallPick <= t.maxPick);
  return hit?.salary ?? null;
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
async function getRealSalaryRankByFheId(
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
  realSalaryEfficiencyWeight: number | null;
}

export async function computeCustomLedger(input: CustomValuationsInput): Promise<CustomLedgerResult> {
  const { leagueId, teamId, dataset, leagueType, valueBasis, salaryFormat, contractRules, rookieSalaryScale, keeperPolicy } = input;

  const analysis = await getCachedLeagueAnalysis(leagueId, teamId, dataset, leagueType === "redraft" ? "redraft" : leagueType);
  const rostered: ResolvedPlayer[] = analysis.rosters.flatMap((r) => r.players);
  const rosteredIds = new Set(rostered.map((p) => p.fantraxId));
  const admin = createAdminClient();

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

  // ── free agents: resolve against the identity registry + season_player_values ──
  const idx = playerIdentity();
  const rawFAs = analysis.league.freeAgents ?? [];
  const espnIdByFantraxId = new Map<string, string>();
  const fheIdByFantraxId = new Map<string, string>();
  for (const fa of rawFAs) {
    const r = idx.resolve({ name: fa.name });
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

  // ── current-year picks: rookie board's own candidate pool, sorted by REAL ──
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

  const teamNameByPlayerFantraxId = new Map<string, string>();
  for (const r of analysis.rosters) for (const p of r.players) teamNameByPlayerFantraxId.set(p.fantraxId, r.teamName);
  const teamNameByTeamId = new Map(analysis.league.rosters.map((r) => [r.teamId, r.teamName]));

  const allCandidates = [...rostered, ...faPlayers, ...pickPlayers];
  const totalRosterSlots = Object.values(analysis.league.positionSlots ?? {}).reduce((a, b) => a + b, 0);
  const leaguePoolSize = analysis.league.poolSize;

  const currentSeason = Number(dataset.split(":")[0]) || REAL_SALARY_SEASON;
  const rawBaseValueByFantraxId = computeBaseTradeValues({
    players: allCandidates, leagueType, valueBasis, categoryFallbackMode,
    redraftBaseMode: "native", leaguePoolSize, consensusPoolSize,
    realSalaryRankByFheId, realSalaryPoolSize, keeperPolicy, totalRosterSlots,
    contractRules, currentSeason,
  });

  // Durability discount — real players only (rostered + free agents), never
  // a rookie-pick placeholder (no age/games history to discount, and a
  // prospect's own risk is already what the pick-value curve prices). Uses
  // this league's own TOTAL roster capacity (maxTotalPlayers), not the
  // active-lineup totalRosterSlots above — the discount is about whether the
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

  // Running clamp: guarantees pick order == value order using only real,
  // pool-comparable signal — no external reference-table floor (see
  // trade-value.ts's module doc for why that floor was wrong: it made late
  // picks read above real, known, cheap productive players).
  const pickValues: (number | null)[] = [];
  let runningCap = Infinity;
  for (let overallPick = 1; overallPick <= topN.length; overallPick++) {
    const fid = pickPlayerFantraxIdByOverallPick.get(overallPick);
    const raw = fid ? baseValueByFantraxId.get(fid) ?? null : null;
    if (raw == null) {
      pickValues.push(pickValues.length > 0 ? pickValues[pickValues.length - 1] : null);
      continue;
    }
    const clamped = Math.min(raw, runningCap);
    runningCap = clamped;
    pickValues.push(clamped);
  }
  const pickValueFor = (overallPick: number): number | null => pickValues[overallPick - 1] ?? null;

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
      asset: p.name, type: "player", fantraxId: p.fantraxId, pickKey: null, pos: (p.eligible || []).join("/") || null,
      dynRank, tradeValue: v, tradeRank: null,
      salary, contract,
      owner: rosteredIds.has(p.fantraxId) ? (teamNameByPlayerFantraxId.get(p.fantraxId) ?? "—") : "Free agent",
    });
  }

  function pickLabel(pick: TeamDraftPick): string {
    const ordinal = pick.round === 1 ? "1st" : pick.round === 2 ? "2nd" : `${pick.round}th`;
    const slot = pick.overallPick != null ? ` (#${pick.overallPick})` : "";
    const origin = pick.originalOwnerLabel ? ` — from ${pick.originalOwnerLabel}` : "";
    return `${pick.year} ${ordinal}${slot}${origin}`;
  }

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
        pickKey: pick.overallPick != null ? `${draftYear}:${pick.overallPick}` : null,
        pos: null, dynRank: null, tradeValue: v, tradeRank: null,
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
        asset: `${year} #${tier.minPick}-${tier.maxPick}`, type: "pick", fantraxId: null, pickKey: null, pos: null, dynRank: null,
        tradeValue: v, tradeRank: null, salary: null, contract: null, owner: "—",
      });
    }
  }

  rows.sort((a, b) => b.tradeValue - a.tradeValue);
  rows.forEach((r, i) => { r.tradeRank = i + 1; });

  return {
    playerCount: rows.filter((r) => r.type === "player").length,
    pickCount,
    extraPickCount,
    rows,
    realSalaryEfficiencyWeight: salaryFormat === "real" ? (input.realSalaryEfficiencyWeight ?? DEFAULT_EFFICIENCY_WEIGHT) : null,
  };
}
