import "server-only";
import { getCachedLeagueAnalysis } from "./league-cache";
import type { FantraxDatasetKey } from "./resolve";
import type { ResolvedPlayer } from "./analyze";
import type { TeamDraftPick } from "./league";
import type { ContractRule, LeagueType, RookieSalaryTier, SalaryFormat } from "./league-tags";
import { getConsensusPoolSize, getDynastyRankByFheId, getSalaryRankByFheId } from "./roster-edge";
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
}

export interface CustomLedgerResult {
  playerCount: number;
  pickCount: number;
  extraPickCount: number;
  rows: LedgerRow[];
}

export async function computeCustomLedger(input: CustomValuationsInput): Promise<CustomLedgerResult> {
  const { leagueId, teamId, dataset, leagueType, valueBasis, contractRules, rookieSalaryScale, keeperPolicy } = input;

  const analysis = await getCachedLeagueAnalysis(leagueId, teamId, dataset, leagueType === "redraft" ? "redraft" : leagueType);
  const rostered: ResolvedPlayer[] = analysis.rosters.flatMap((r) => r.players);
  const rosteredIds = new Set(rostered.map((p) => p.fantraxId));

  const [salaryRank, dynastyRankByFheId] = await Promise.all([
    getSalaryRankByFheId(),
    Promise.resolve(getDynastyRankByFheId()),
  ]);
  const realSalaryRankByFheId = new Map(Object.entries(salaryRank.rankByFheId));
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
  const admin = createAdminClient();
  const espnIds = [...new Set(espnIdByFantraxId.values())];
  const faPlayers: ResolvedPlayer[] = [];
  if (espnIds.length > 0) {
    const { data: svRows, error } = await admin
      .from("season_player_values")
      .select("player_id,value,minus1v")
      .eq("season", REAL_SALARY_SEASON).eq("season_type", "projection").eq("league_size", 450)
      .in("player_id", espnIds);
    if (error) throw new Error(error.message);
    const valueByEspnId = new Map((svRows ?? []).map((r) => [r.player_id as string, { nineCatV: r.value as number | null, minus1V: r.minus1v as number | null }]));
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
        gamesPlayed: null, minutesPerGame: null, usgPct: null, statLine: null,
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
  const baseValueByFantraxId = computeBaseTradeValues({
    players: allCandidates, leagueType, valueBasis, categoryFallbackMode,
    redraftBaseMode: "native", leaguePoolSize, consensusPoolSize,
    realSalaryRankByFheId, realSalaryPoolSize, keeperPolicy, totalRosterSlots,
    contractRules, currentSeason,
  });

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
    rows.push({
      asset: p.name, type: "player", fantraxId: p.fantraxId, pickKey: null, pos: (p.eligible || []).join("/") || null,
      dynRank, tradeValue: v, tradeRank: null,
      salary: p.salary ?? null, contract: p.contract ?? null,
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
  // sign-aware year-decay, not the disconnected external bracket table.
  const futureYears = new Set<number>();
  for (const r of analysis.league.rosters) {
    for (const pick of r.draftPicks) {
      if (pick.year > draftYear) futureYears.add(pick.year);
    }
  }
  const tiers = CATEGORIES_PICK_TIERS[2027] ?? [];
  let extraPickCount = 0;
  for (const year of [...futureYears].sort((a, b) => a - b)) {
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
  };
}
