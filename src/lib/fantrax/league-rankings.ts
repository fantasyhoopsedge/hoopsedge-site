import "server-only";
import { getCachedLeagueAnalysis } from "./league-cache";
import type { FantraxDatasetKey } from "./resolve";
import type { ResolvedPlayer } from "./analyze";
import type { TeamDraftPick } from "./league";
import type { LeagueType, SalaryFormat } from "./league-tags";
import { getAgeByFheId, getConsensusPoolSize, getContractByFheId, getDynastyRankByFheId, getSalaryRankByFheId } from "./roster-edge";
import { computeBaseTradeValues } from "./trade-value";
import { pickEquivalentValue } from "./trade-verdict";
import { playerIdentity } from "../player-identity/bundled";
import { createAdminClient } from "../../utils/supabase/admin";
import { getCustomValuations } from "./custom-valuations-store";
import { getRealSalaryRankByFheId, salaryForPick } from "./custom-valuations";
import type { SavedLeagueSettings } from "./store";
import type { TrendTag } from "@/app/team-rosters/_components/trend-insight";

/**
 * League Rankings (Ash, 2026-08-25) — "a place to analyse/review the full
 * suite of valued assets within the league," every player/FA/pick ranked
 * FOUR different ways at once (custom generated, standard consensus dynasty,
 * real-salary, redraft/FHE-projection), with the display columns (salary,
 * contract, age, trend, GP/MIN/USG, 9CatV/8CatV/Minus1V/FPTS) computed ONCE
 * and shared across all four — only the RANK/VALUE a row sorts by changes
 * when the basis tab changes, matching "the sort remains static on the
 * ranking" (item 5 of the ask: no per-column sort, just whichever basis is
 * selected).
 *
 * Reuses the same candidate-assembly shape as custom-valuations.ts
 * (rostered + free agents + every real team-owned draft pick, current AND
 * future years) but does NOT synthesize anonymized rookie-board "players"
 * for picks the way that module does — draft-pick pricing here goes through
 * the mature, already-shipped ratio-transplant model (pickEquivalentValue,
 * trade-verdict.ts), which prices ANY real pick a team holds, not just the
 * current draft class. The "custom" basis overlays a generated ledger
 * (full OR picksOnly, custom-valuations-store.ts) on top of that same
 * standard number wherever the ledger has one — same overlay convention
 * Trade Edge's own baseValueByFantraxId merge already uses.
 *
 * "Redraft (FHE's projections)" prices players only — a draft pick has no
 * production value to project, so it's simply absent from that basis
 * (assets.length unaffected; the client shows an empty/"—" state for a pick
 * row under that tab rather than a synthesized number).
 */

const REAL_SALARY_SEASON = 2027; // matches roster-edge.ts's own constant

export type RankingsBasis = "custom" | "standard" | "real" | "redraft";

export interface AssetRow {
  key: string;
  kind: "player" | "pick";
  name: string;
  fantraxId: string | null;
  pos: string | null;
  nbaTeam: string | null;
  isRookie: boolean;
  owner: string;
  salary: number | null;
  contract: string | null;
  dynRank: number | null;
  salaryRank: number | null;
  age: number | null;
  trendTag: TrendTag | null;
  gamesPlayed: number | null;
  minutesPerGame: number | null;
  usgPct: number | null;
  nineCatV: number | null;
  eightCatV: number | null;
  minus1V: number | null;
  fpts: number | null;
  pickYear: number | null;
}

export interface RankedValue {
  value: number;
  rank: number;
}

export interface LeagueRankingsResult {
  assets: AssetRow[];
  values: Record<RankingsBasis, Record<string, RankedValue>>;
  ledgerMode: "full" | "picksOnly" | null;
  ledgerGeneratedAt: string | null;
  salaryFormat: SalaryFormat;
  positionSlots: Record<string, number>;
  family: "categories" | "points";
}

/** Only the settings fields this module actually reads — narrower than the
 *  full SavedLeagueSettings (whose many other fields, like teamCount or
 *  poolSize, are re-derived fresh from the live Fantrax analysis here
 *  anyway, not trusted off the saved doc) so a caller building this from
 *  URL query params doesn't have to fabricate values for fields that would
 *  never be used. */
export interface LeagueRankingsSettings {
  salaryFormat: SalaryFormat;
  keeperPolicy: string | undefined;
  realSalaryEfficiencyWeight: number | undefined;
  contractRules: SavedLeagueSettings["contractRules"];
  rookieSalaryScale: SavedLeagueSettings["rookieSalaryScale"];
}

export interface LeagueRankingsInput {
  leagueId: string;
  owner: string;
  teamId: string | null;
  dataset: FantraxDatasetKey;
  leagueType: LeagueType;
  settings: LeagueRankingsSettings;
}

function pickLabel(pick: TeamDraftPick): string {
  const ordinal = pick.round === 1 ? "1st" : pick.round === 2 ? "2nd" : `${pick.round}th`;
  const slot = pick.overallPick != null ? ` (#${pick.overallPick})` : "";
  const origin = pick.originalOwnerLabel ? ` — from ${pick.originalOwnerLabel}` : "";
  return `${pick.year} ${ordinal}${slot}${origin}`;
}

/** Sorts a value map descending and assigns 1-based ranks — the single
 *  ranking rule every basis tab uses, so "standard," "real," and "redraft"
 *  can never silently disagree on HOW a rank number is derived, only on
 *  which values went in. */
function toRanked(map: ReadonlyMap<string, number>): Record<string, RankedValue> {
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
  const out: Record<string, RankedValue> = {};
  sorted.forEach(([key, value], i) => { out[key] = { value, rank: i + 1 }; });
  return out;
}

export async function computeLeagueRankings(input: LeagueRankingsInput): Promise<LeagueRankingsResult> {
  const { leagueId, owner, teamId, dataset, leagueType, settings } = input;
  const salaryFormat = settings.salaryFormat ?? "none";

  const analysis = await getCachedLeagueAnalysis(leagueId, teamId, dataset, leagueType === "redraft" ? "redraft" : leagueType);
  const rostered: ResolvedPlayer[] = analysis.rosters.flatMap((r) => r.players);
  const admin = createAdminClient();

  const [salaryRank, contractByFheId, ageByFheId, customDoc] = await Promise.all([
    getSalaryRankByFheId(),
    getContractByFheId(),
    getAgeByFheId(),
    getCustomValuations(owner, leagueId),
  ]);
  const salaryRankByFheId = salaryRank.rankByFheId;
  const dynastyRankByFheId = getDynastyRankByFheId();
  const consensusPoolSize = getConsensusPoolSize();

  const scoredCount = analysis.league.categories?.scored?.length ?? 9;
  const categoryFallbackMode = scoredCount === 8 ? "eightCatV" : "nineCatV";
  const family: "categories" | "points" = analysis.league.scoringMode === "points" ? "points" : "categories";

  // ── free agents — same identity-registry + season_player_values resolve
  // custom-valuations.ts uses, so a free agent's 9CatV/Minus1V here matches
  // whatever the custom ledger would show for the same player. EightCatV/
  // FPTS stay null for a free agent (same known limitation as the custom
  // ledger: neither is a stored per-season column, and computing either
  // needs the full resolved-roster pipeline this path doesn't run). ──
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
      admin
        .from("season_player_stats")
        .select("player_id,g,mpg")
        .eq("season", REAL_SALARY_SEASON).eq("season_type", "projection")
        .in("player_id", espnIds),
    ]);
    if (error) throw new Error(error.message);
    if (statError) throw new Error(statError.message);
    const valueByEspnId = new Map((svRows ?? []).map((r) => [r.player_id as string, { nineCatV: r.value as number | null, minus1V: r.minus1v as number | null }]));
    const statByEspnId = new Map((statRows ?? []).map((r) => [r.player_id as string, { g: r.g as number | null, mpg: r.mpg as number | null }]));
    for (const fa of rawFAs) {
      const espnId = espnIdByFantraxId.get(fa.fantraxId);
      const fheId = fheIdByFantraxId.get(fa.fantraxId);
      if (!espnId) continue;
      const v = valueByEspnId.get(espnId);
      if (!v || v.nineCatV == null) continue;
      const stat = statByEspnId.get(espnId);
      faPlayers.push({
        fantraxId: fa.fantraxId, name: fa.name, slot: "FA", eligible: fa.eligible ?? [],
        nbaTeam: fa.nbaTeam ?? "", status: "FA", salary: null, contract: null,
        playerId: espnId, fheId: fheId ?? null, source: "projection", cats: {}, catsTotals: {},
        leagueV: null, pointsValue: null, nineCatV: v.nineCatV, consensusRank: fheId ? dynastyRankByFheId[fheId] ?? null : null,
        gamesPlayed: stat?.g ?? null, minutesPerGame: stat?.mpg ?? null, usgPct: null, statLine: null,
        catV: { perGame: { nineCatV: v.nineCatV, minus1V: v.minus1V, eightCatV: null }, totals: { nineCatV: null, minus1V: null, eightCatV: null } },
        catVRank: { perGame: { nineCatV: null, minus1V: null, eightCatV: null }, totals: { nineCatV: null, minus1V: null, eightCatV: null } },
        trendTags: null, ambiguousName: false, smallSample: false, isRookie: false,
      } as unknown as ResolvedPlayer);
    }
  }

  const corePlayers = [...rostered, ...faPlayers];
  const teamNameByPlayerFantraxId = new Map<string, string>();
  for (const r of analysis.rosters) for (const p of r.players) teamNameByPlayerFantraxId.set(p.fantraxId, r.teamName);
  const rosteredIds = new Set(rostered.map((p) => p.fantraxId));

  const totalRosterSlots = Object.values(analysis.league.positionSlots ?? {}).reduce((a, b) => a + b, 0);
  const leaguePoolSize = analysis.league.poolSize;
  const consensusPoolSizeSafe = consensusPoolSize;
  const currentSeason = Number(dataset.split(":")[0]) || REAL_SALARY_SEASON;

  const realSalaryRank = await getRealSalaryRankByFheId(admin, settings.realSalaryEfficiencyWeight);

  const standardMap = computeBaseTradeValues({
    players: corePlayers, leagueType: "dynasty", valueBasis: "standard", categoryFallbackMode,
    redraftBaseMode: "native", leaguePoolSize, consensusPoolSize: consensusPoolSizeSafe,
    realSalaryRankByFheId: realSalaryRank.rankByFheId, realSalaryPoolSize: realSalaryRank.poolSize,
    keeperPolicy: settings.keeperPolicy, totalRosterSlots, contractRules: settings.contractRules, currentSeason,
  });
  const realMap = computeBaseTradeValues({
    players: corePlayers, leagueType: "dynasty", valueBasis: "real", categoryFallbackMode,
    redraftBaseMode: "native", leaguePoolSize, consensusPoolSize: consensusPoolSizeSafe,
    realSalaryRankByFheId: realSalaryRank.rankByFheId, realSalaryPoolSize: realSalaryRank.poolSize,
    keeperPolicy: settings.keeperPolicy, totalRosterSlots, contractRules: settings.contractRules, currentSeason,
  });
  const redraftMap = computeBaseTradeValues({
    players: corePlayers, leagueType: "redraft", valueBasis: "standard", categoryFallbackMode,
    redraftBaseMode: "native", leaguePoolSize, consensusPoolSize: consensusPoolSizeSafe,
    realSalaryRankByFheId: realSalaryRank.rankByFheId, realSalaryPoolSize: realSalaryRank.poolSize,
    keeperPolicy: settings.keeperPolicy, totalRosterSlots, contractRules: settings.contractRules, currentSeason,
  });

  // "Custom" overlays the generated ledger (whichever mode) on top of the
  // standard number — same convention trade-edge/page.tsx's own
  // baseValueByFantraxId merge already uses, so a player/pick the ledger
  // never priced (a picksOnly doc's players, or any future pick beyond the
  // ledger's own current-year slots) still reads a real, non-null number
  // instead of falling out of the ranking entirely.
  const customMap = new Map(standardMap);
  const ledgerByPickKey = new Map<string, number>();
  if (customDoc) {
    for (const row of customDoc.rows) {
      if (row.fantraxId) customMap.set(row.fantraxId, row.tradeValue);
      if (row.pickKey) ledgerByPickKey.set(row.pickKey, row.tradeValue);
    }
  }

  const assets: AssetRow[] = [];
  for (const p of corePlayers) {
    const trendTag: TrendTag | null = p.trendTags?.nineCatV ?? null;
    assets.push({
      key: p.fantraxId, kind: "player", name: p.name, fantraxId: p.fantraxId,
      pos: p.eligible?.join("/") || null, nbaTeam: p.nbaTeam || null, isRookie: p.isRookie ?? false,
      owner: rosteredIds.has(p.fantraxId) ? (teamNameByPlayerFantraxId.get(p.fantraxId) ?? "—") : "Free agent",
      salary: p.salary ?? (salaryFormat === "real" && p.fheId ? contractByFheId[p.fheId]?.currentSalary ?? null : null),
      contract: salaryFormat === "real" && p.fheId
        ? (contractByFheId[p.fheId] ? `${contractByFheId[p.fheId].yearsRemaining}yr/$${(contractByFheId[p.fheId].totalRemaining / 1_000_000).toFixed(1)}M` : null)
        : (p.contract ?? null),
      dynRank: p.fheId ? dynastyRankByFheId[p.fheId] ?? null : null,
      salaryRank: p.fheId ? salaryRankByFheId[p.fheId] ?? null : null,
      age: p.fheId ? ageByFheId[p.fheId] ?? null : null,
      trendTag,
      gamesPlayed: p.gamesPlayed ?? null, minutesPerGame: p.minutesPerGame ?? null, usgPct: p.usgPct ?? null,
      nineCatV: p.catV?.perGame.nineCatV ?? null, eightCatV: p.catV?.perGame.eightCatV ?? null,
      minus1V: p.catV?.perGame.minus1V ?? null, fpts: p.pointsValue ?? null,
      pickYear: null,
    });
  }

  const seenPick = new Set<string>();
  for (const r of analysis.league.rosters) {
    for (const pick of r.draftPicks) {
      const key = `${r.teamId}:${pick.year}:${pick.round}:${pick.overallPick ?? "R"}`;
      if (seenPick.has(key)) continue;
      seenPick.add(key);
      const standardVal = pickEquivalentValue(pick, corePlayers, standardMap, family);
      const realVal = pickEquivalentValue(pick, corePlayers, realMap, family);
      if (standardVal == null && realVal == null) continue; // no priceable pool at all
      const pickKey = pick.overallPick != null ? `${pick.year}:${pick.overallPick}` : null;
      const ledgerVal = pickKey != null ? ledgerByPickKey.get(pickKey) : undefined;
      const customVal = ledgerVal ?? standardVal;
      assets.push({
        key, kind: "pick", name: pickLabel(pick), fantraxId: null,
        pos: null, nbaTeam: null, isRookie: false, owner: r.teamName,
        salary: pick.overallPick != null ? salaryForPick(settings.rookieSalaryScale, pick.overallPick) : null,
        contract: null, dynRank: null, salaryRank: null, age: null, trendTag: null,
        gamesPlayed: null, minutesPerGame: null, usgPct: null,
        nineCatV: null, eightCatV: null, minus1V: null, fpts: null,
        pickYear: pick.year,
      });
      if (standardVal != null) standardMap.set(key, standardVal);
      if (realVal != null) realMap.set(key, realVal);
      if (customVal != null) customMap.set(key, customVal);
    }
  }

  return {
    assets,
    values: {
      standard: toRanked(standardMap),
      real: toRanked(realMap),
      redraft: toRanked(redraftMap),
      custom: toRanked(customMap),
    },
    ledgerMode: customDoc?.mode ?? null,
    ledgerGeneratedAt: customDoc?.generatedAt ?? null,
    salaryFormat,
    positionSlots: analysis.league.positionSlots ?? {},
    family,
  };
}
