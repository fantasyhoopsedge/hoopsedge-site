import "server-only";
import { getCachedLeagueAnalysis } from "./league-cache";
import type { FantraxDatasetKey } from "./resolve";
import type { ResolvedPlayer, StatLine } from "./analyze";
import type { FheCategory, TeamDraftPick } from "./league";
import type { LeagueType, SalaryFormat } from "./league-tags";
import { getAgeByFheId, getConsensusPoolSize, getContractByFheId, getDynastyRankByFheId, getSalaryRankByFheId, getSophomoreByFheId } from "./roster-edge";
import { computeBaseTradeValues, computeKeeperWeight } from "./trade-value";
import { CATEGORIES_PICK_TIERS, pickEquivalentValue } from "./trade-verdict";
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
  /** True for a player in their SECOND NBA season — same
   *  getSophomoreByFheId() signal Trade Edge's own asset-tier coloring
   *  reads (roster-table.tsx's playerAssetTier). False (never null) for a
   *  pick — a draft asset has no season count of its own. */
  isSophomore: boolean;
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
  /** Per-game RAW category stats (PTS/FG3/REB/AST/STL/BLK/FG%/FT%/TO) — for
   *  display, sourced from ResolvedPlayer.statLine (rostered player) or
   *  season_player_stats' own raw columns (free agent). NEVER read
   *  ResolvedPlayer.cats here — that field is z-scores, not raw stats (see
   *  catsZ below); conflating the two mislabeled every stat cell in this
   *  table's first ship. Empty for a pick — a draft asset has no box score. */
  catsRaw: Partial<Record<FheCategory, number>>;
  /** Per-game category Z-SCORES — ResolvedPlayer.cats for a rostered player,
   *  season_player_values' v_* columns (CATEGORY_VALUE_COLUMN) for a free
   *  agent. Drives conditional-format tinting only, never displayed as a raw
   *  number. Empty for a pick. */
  catsZ: Partial<Record<FheCategory, number>>;
  /** Per-game FG/FT attempts — the volume side of a volume-weighted FG%/FT%
   *  summary (Σ attempts×pct÷Σ attempts, same shape roster-table.tsx's own
   *  weightedAverage uses), which a plain average of per-player percentages
   *  can't produce correctly. Null for a pick. */
  fgAttempts: number | null;
  ftAttempts: number | null;
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
  /** Whichever basis Trade Edge is ACTUALLY pricing this league's assets
   *  with right now, per its own settings (useCustomValuations /
   *  useGeneratedPickValues / leagueType / salaryFormat / keeper blend
   *  weight) — the client highlights this tab so "which of these four
   *  numbers is the real one elsewhere in the app" is never a guess (Ash,
   *  2026-08-25). */
  activeBasis: RankingsBasis;
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
  useCustomValuations: boolean | undefined;
  useGeneratedPickValues: boolean | undefined;
}

export interface LeagueRankingsInput {
  leagueId: string;
  owner: string;
  teamId: string | null;
  dataset: FantraxDatasetKey;
  leagueType: LeagueType;
  settings: LeagueRankingsSettings;
}

/** Canonicalizes Fantrax position eligibility down to one of G, F, C, G/F,
 *  F/C, G/C, G/F/C — collapsing PG/SG into G and SF/PF into F, and dropping
 *  every non-position slot (Flx, Util, numbered flex, …) outright rather than
 *  gating them behind the league's own slot config the way roster-table.tsx's
 *  posDisplayFor does. This table shows one simplified label per asset, not a
 *  per-slot eligibility list (Ash, 2026-08-25: "remove any ref to FLX
 *  position and simplify player position eligibility"). */
function positionGroup(eligible: string[] | undefined): string | null {
  if (!eligible || eligible.length === 0) return null;
  let g = false, f = false, c = false;
  for (const raw of eligible) {
    const e = raw.toUpperCase();
    if (e === "PG" || e === "SG" || e === "G") g = true;
    else if (e === "SF" || e === "PF" || e === "F") f = true;
    else if (e === "C") c = true;
  }
  const parts = [g && "G", f && "F", c && "C"].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join("/") : null;
}

/** Raw per-game category line off a rostered player's own statLine — the
 *  RAW counterpart to ResolvedPlayer.cats (z-scores). Never read `.cats` for
 *  display; see AssetRow.catsRaw's own doc for why. */
function rawCatsFromStatLine(s: StatLine | null): Partial<Record<FheCategory, number>> {
  if (!s) return {};
  const out: Partial<Record<FheCategory, number>> = {};
  if (s.pts != null) out.PTS = s.pts;
  if (s.fg3m != null) out.FG3 = s.fg3m;
  if (s.reb != null) out.REB = s.reb;
  if (s.ast != null) out.AST = s.ast;
  if (s.stl != null) out.STL = s.stl;
  if (s.blk != null) out.BLK = s.blk;
  if (s.tov != null) out.TO = s.tov;
  if (s.fg_pct != null) out.FG = s.fg_pct;
  if (s.ft_pct != null) out.FT = s.ft_pct;
  return out;
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

  const [salaryRank, contractByFheId, ageByFheId, sophomoreByFheId, customDoc] = await Promise.all([
    getSalaryRankByFheId(),
    getContractByFheId(),
    getAgeByFheId(),
    getSophomoreByFheId(),
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
  //
  // EXCLUDES an undrafted current-rookie-class free agent (Ash, 2026-08-31):
  // before a league runs its own Fantrax rookie draft, every 2026 draftee
  // sits as a Fantrax free agent — League Rankings is "the full suite of
  // trade assets in the league," and while undrafted, that value is already
  // represented by the team's OWN 2026 draft-pick asset (priced via
  // pickEquivalentValue below), not by the named prospect. Once a league
  // actually drafts him, Fantrax moves him onto a roster and he flows
  // through the ROSTERED path instead (untouched) — so this only ever
  // suppresses the still-undrafted case, exactly where the pick already
  // covers his value. Waiver Edge deliberately does NOT apply this
  // exclusion (waiver-edge.ts's whole point is showing free agents,
  // undrafted rookies very much included).
  const idx = playerIdentity();
  const rawFAs = analysis.league.freeAgents ?? [];
  const fheIdByFantraxId = new Map<string, string>();
  for (const fa of rawFAs) {
    // Fantrax id, not name — resolve.ts's own resolveOne() uses the same
    // id-based join for exactly this reason (see its file header: "there is
    // deliberately NO name fallback"). The registry blocks a Fantrax id from
    // linking to an identity whenever another Fantrax player shares its name
    // and can't be safely told apart (blockedFantraxNames() in
    // build-player-identity.ts); a raw name resolve bypasses that guard and
    // matches the SAME identity for every same-named Fantrax entry, which is
    // exactly how a league's ghost/duplicate free-agent entry for a rostered
    // player (e.g. two "Jaylin Williams" rows, one rostered, one a teamless
    // free agent) ended up duplicated on the League Rankings page with
    // identical stats under both rows.
    const r = idx.resolve({ fantraxId: fa.fantraxId });
    if (r.kind === "matched" && r.identity.fheId && r.identity.draftYear !== REAL_SALARY_SEASON - 1) {
      fheIdByFantraxId.set(fa.fantraxId, r.identity.fheId);
    }
  }
  const fheIds = [...new Set(fheIdByFantraxId.values())];
  const faPlayers: ResolvedPlayer[] = [];
  const faZByFantraxId = new Map<string, Partial<Record<FheCategory, number>>>();
  if (fheIds.length > 0) {
    // Resolve fhe_id -> season_player_stats FIRST, then join season_player_values
    // on THAT row's own player_id — never assume player_id === espnId. A 2026
    // draft-class free agent has no pre-existing hoopR history, so
    // build-projection-values.ts keys their row by the Summer League 2026
    // fallback id (sl-<nbaComId>) instead — an espnId-keyed query silently drops
    // every such player (see waiver-edge.ts's header, fixed there 2026-08-29 for
    // the same reason; resolve.ts's rostered-player path never had this bug
    // because it already resolves fhe_id -> stats row -> stats.player_id ->
    // values row).
    const { data: statRows, error: statError } = await admin
      .from("season_player_stats")
      .select("player_id,fhe_id,g,mpg,pts,fg3m,reb,ast,stl,blk,tov,fga,fg_pct,fta,ft_pct")
      .eq("season", REAL_SALARY_SEASON).eq("season_type", "projection")
      .in("fhe_id", fheIds);
    if (statError) throw new Error(statError.message);

    const playerIds = [...new Set((statRows ?? []).map((r) => r.player_id as string))];
    const { data: svRows, error } = playerIds.length > 0
      ? await admin
        .from("season_player_values")
        // v_pts,v_fg3,v_reb,v_ast,v_stl,v_blk,v_fg,v_ft,v_to — spelled out
        // (not built from CATEGORY_VALUE_COLUMN) so Supabase's typed client
        // can parse this as a literal select string.
        .select("player_id,value,minus1v,v_pts,v_fg3,v_reb,v_ast,v_stl,v_blk,v_fg,v_ft,v_to")
        .eq("season", REAL_SALARY_SEASON).eq("season_type", "projection").eq("league_size", 450)
        .in("player_id", playerIds)
      : { data: [], error: null };
    if (error) throw new Error(error.message);
    const valueByPlayerId = new Map((svRows ?? []).map((row) => {
      const catsZ: Partial<Record<FheCategory, number>> = {};
      if (row.v_pts != null) catsZ.PTS = row.v_pts;
      if (row.v_fg3 != null) catsZ.FG3 = row.v_fg3;
      if (row.v_reb != null) catsZ.REB = row.v_reb;
      if (row.v_ast != null) catsZ.AST = row.v_ast;
      if (row.v_stl != null) catsZ.STL = row.v_stl;
      if (row.v_blk != null) catsZ.BLK = row.v_blk;
      if (row.v_fg != null) catsZ.FG = row.v_fg;
      if (row.v_ft != null) catsZ.FT = row.v_ft;
      if (row.v_to != null) catsZ.TO = row.v_to;
      return [row.player_id, { nineCatV: row.value, minus1V: row.minus1v, catsZ }] as const;
    }));
    const statByFheId = new Map((statRows ?? []).map((r) => [r.fhe_id as string, r]));
    for (const fa of rawFAs) {
      const fheId = fheIdByFantraxId.get(fa.fantraxId);
      if (!fheId) continue;
      const stat = statByFheId.get(fheId);
      if (!stat) continue;
      const v = valueByPlayerId.get(stat.player_id as string);
      if (!v || v.nineCatV == null) continue;
      const cats: Partial<Record<FheCategory, number>> = {
        PTS: stat.pts ?? undefined, FG3: stat.fg3m ?? undefined, REB: stat.reb ?? undefined,
        AST: stat.ast ?? undefined, STL: stat.stl ?? undefined, BLK: stat.blk ?? undefined,
        FG: stat.fg_pct ?? undefined, FT: stat.ft_pct ?? undefined, TO: stat.tov ?? undefined,
      };
      // Full raw line (incl. attempts) so AssetRow.catsRaw/fgAttempts/
      // ftAttempts can read a free agent the same way as a rostered player
      // — off .statLine — rather than a second, FA-only code path.
      const faStatLine: StatLine = {
        pts: stat.pts, fg3m: stat.fg3m, reb: stat.reb, ast: stat.ast, stl: stat.stl, blk: stat.blk,
        tov: stat.tov, fga: stat.fga, fg_pct: stat.fg_pct, fta: stat.fta, ft_pct: stat.ft_pct,
      };
      faPlayers.push({
        fantraxId: fa.fantraxId, name: fa.name, slot: "FA", eligible: fa.eligible ?? [],
        nbaTeam: fa.nbaTeam ?? "", status: "FA", salary: null, contract: null,
        playerId: stat.player_id as string, fheId, source: "projection", cats, catsTotals: {},
        leagueV: null, pointsValue: null, nineCatV: v.nineCatV, consensusRank: dynastyRankByFheId[fheId] ?? null,
        gamesPlayed: stat.g as number | null, minutesPerGame: stat.mpg as number | null, usgPct: null, statLine: faStatLine,
        catV: { perGame: { nineCatV: v.nineCatV, minus1V: v.minus1V, eightCatV: null }, totals: { nineCatV: null, minus1V: null, eightCatV: null } },
        catVRank: { perGame: { nineCatV: null, minus1V: null, eightCatV: null }, totals: { nineCatV: null, minus1V: null, eightCatV: null } },
        trendTags: null, ambiguousName: false, smallSample: false, isRookie: false,
        // AssetRow's z-score column (catsZ, below) reads this off the FA
        // ResolvedPlayer directly via faZByFantraxId rather than a real
        // ResolvedPlayer field — ResolvedPlayer has no z-score slot for a
        // freestanding FA the way `cats` covers a resolved league player.
      } as unknown as ResolvedPlayer);
      faZByFantraxId.set(fa.fantraxId, v.catsZ);
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
  // Every current-year pick's real, ledger-computed VALUE — a league's own
  // generated ledger (Ash, 2026-08-25: "the entire point of generating the
  // league rankings... is to use for the trade edge tool") is the more
  // precise number wherever it covers an asset, in place of this page's own
  // independently-computed one. RANK is never read off the ledger's own
  // row.tradeRank here — see the toRanked() calls below for why trusting a
  // number computed within a DIFFERENT pool (the ledger's own combined sort)
  // for only SOME of a map's rows breaks that map's own self-consistency.
  // Same idea for a FUTURE-year bracket row (`"${year}:${minPick}-${maxPick}"`,
  // matching the label both this file's own bracket loop below and
  // buildPickAssetRows independently derive from CATEGORIES_PICK_TIERS) —
  // see LedgerRow.bracketKey's own doc for why this exists: the ledger's
  // year-decay bracket curve and this file's own pickEquivalentValue ratio-
  // transplant estimate priced the identical synthetic pick wildly
  // differently (Ash, 2026-08-27: Woolridge DMD30's 2027 #4-8 bracket read
  // 469 in the ledger but 200 via this file's own formula — a gap wide
  // enough that 3 extra bracket rows straddled Kyrie Irving's value on one
  // side of that divide and not the other, so his rank read #85 here but
  // #88 on Trade Edge for the exact same underlying pool).
  const ledgerByPickKey = new Map<string, number>();
  const ledgerByBracketKey = new Map<string, number>();
  if (customDoc) {
    for (const row of customDoc.rows) {
      if (row.fantraxId) customMap.set(row.fantraxId, row.tradeValue);
      if (row.pickKey) ledgerByPickKey.set(row.pickKey, row.tradeValue);
      if (row.bracketKey) ledgerByBracketKey.set(row.bracketKey, row.tradeValue);
    }
  }
  // A picksOnly ledger (the "generate draft pick values" flow for a
  // STANDARD, non-custom league — see CustomValuationsDoc.mode's own doc)
  // never touches "custom" at all: that basis stays a plain copy of
  // standardMap for such a league. Its picks' real VALUE belongs on
  // whichever of "standard"/"real" is genuinely driving trade value for the
  // league (activeBasis below) — until this was added, that tab kept
  // showing its own independently-computed pick number instead of the
  // ledger's. Same computation the picksOnly POST route itself uses to
  // decide which basis to generate against (custom-valuations/route.ts) —
  // must match exactly, or this overlay would apply to the wrong map (Ash,
  // 2026-08-26: Woolridge DMD30's HBB picks read Asset Value 287/91/53/… on
  // the "Consensus dynasty" tab — the one carrying the ● "driving real
  // trade value" indicator — while Trade Edge's cards for the SAME picks
  // read a completely different number).
  const picksOnlyBasis: "standard" | "real" | null = customDoc?.mode === "picksOnly"
    ? (leagueType === "dynasty" && settings.salaryFormat === "real" ? "real" : "standard")
    : null;

  const assets: AssetRow[] = [];
  for (const p of corePlayers) {
    const trendTag: TrendTag | null = p.trendTags?.nineCatV ?? null;
    const isFA = !rosteredIds.has(p.fantraxId);
    assets.push({
      key: p.fantraxId, kind: "player", name: p.name, fantraxId: p.fantraxId,
      pos: positionGroup(p.eligible), nbaTeam: p.nbaTeam || null, isRookie: p.isRookie ?? false,
      isSophomore: p.fheId ? sophomoreByFheId[p.fheId] ?? false : false,
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
      catsRaw: rawCatsFromStatLine(p.statLine),
      catsZ: isFA ? (faZByFantraxId.get(p.fantraxId) ?? {}) : (p.cats ?? {}),
      fgAttempts: p.statLine?.fga ?? null,
      ftAttempts: p.statLine?.fta ?? null,
    });
  }

  // draftYear = the soonest year any team holds a pick for — the imminent,
  // already-slotted draft class (same convention custom-valuations.ts uses).
  // Only picks in THIS year get an individual, team-owned row below; every
  // later year collapses into shared tier buckets (see the bracket loop
  // further down) — Ash, 2026-08-25: "for future draft assets... grouping
  // those assets into buckets and not assigning them to league teams."
  const allPickYears = analysis.league.rosters.flatMap((r) => r.draftPicks.map((p) => p.year));
  const draftYear = allPickYears.length > 0 ? Math.min(...allPickYears) : new Date().getFullYear();

  const seenPick = new Set<string>();
  for (const r of analysis.league.rosters) {
    for (const pick of r.draftPicks) {
      if (pick.year !== draftYear) continue;
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
        pos: null, nbaTeam: null, isRookie: false, isSophomore: false, owner: r.teamName,
        salary: pick.overallPick != null ? salaryForPick(settings.rookieSalaryScale, pick.overallPick) : null,
        contract: null, dynRank: null, salaryRank: null, age: null, trendTag: null,
        gamesPlayed: null, minutesPerGame: null, usgPct: null,
        nineCatV: null, eightCatV: null, minus1V: null, fpts: null,
        pickYear: pick.year, catsRaw: {}, catsZ: {}, fgAttempts: null, ftAttempts: null,
      });
      if (standardVal != null) standardMap.set(key, standardVal);
      if (realVal != null) realMap.set(key, realVal);
      if (customVal != null) customMap.set(key, customVal);
      // A picksOnly ledger's own pick number IS the real, driving one for
      // whichever basis it was generated against — overwrite that map's
      // just-set standardVal/realVal the same way customVal already does
      // for "custom" above, so the tab carrying the ● "active basis"
      // indicator shows the identical number Trade Edge's cards read.
      if (ledgerVal != null && picksOnlyBasis === "standard") standardMap.set(key, ledgerVal);
      if (ledgerVal != null && picksOnlyBasis === "real") realMap.set(key, ledgerVal);
    }
  }

  // Future years: one row per (year, tier) BUCKET, not per real team pick —
  // e.g. "2027 #1-3" once, covering every team's pick in that range, instead
  // of 30 nearly-identical individually-owned rows nobody can actually slot
  // yet (a future draft order isn't set). Reuses pickEquivalentValue against
  // a synthetic representative pick at the tier's own minPick — same
  // ratio-transplant + year-decay math a real pick in that slot would get,
  // just not attached to any one team — as the FALLBACK only: the generated
  // ledger's own bracket row (ledgerByBracketKey), when one exists, is the
  // more precise number and takes priority, same "ledgerVal ?? standardVal"
  // precedence current-year picks already use above. See LedgerRow.bracketKey's
  // own doc for why this overlay exists at all — the two formulas priced the
  // identical synthetic pick wildly differently.
  const bracketYears = [...new Set(
    analysis.league.rosters.flatMap((r) => r.draftPicks.map((p) => p.year)).filter((y) => y > draftYear),
  )].sort((a, b) => a - b);
  const tiers = CATEGORIES_PICK_TIERS[2027] ?? [];
  for (const year of bracketYears) {
    for (const tier of tiers) {
      const synthetic: TeamDraftPick = { year, round: 1, overallPick: tier.minPick, originalOwnerLabel: null };
      const standardVal = pickEquivalentValue(synthetic, corePlayers, standardMap, family);
      const realVal = pickEquivalentValue(synthetic, corePlayers, realMap, family);
      if (standardVal == null && realVal == null) continue;
      const key = `bracket:${year}:${tier.minPick}-${tier.maxPick}`;
      const bracketKey = `${year}:${tier.minPick}-${tier.maxPick}`;
      const ledgerBracketVal = ledgerByBracketKey.get(bracketKey);
      assets.push({
        key, kind: "pick", name: `${year} #${tier.minPick}-${tier.maxPick}`, fantraxId: null,
        pos: null, nbaTeam: null, isRookie: false, isSophomore: false, owner: "—",
        salary: null, contract: null, dynRank: null, salaryRank: null, age: null, trendTag: null,
        gamesPlayed: null, minutesPerGame: null, usgPct: null,
        nineCatV: null, eightCatV: null, minus1V: null, fpts: null,
        pickYear: year, catsRaw: {}, catsZ: {}, fgAttempts: null, ftAttempts: null,
      });
      if (standardVal != null) standardMap.set(key, standardVal);
      if (realVal != null) realMap.set(key, realVal);
      customMap.set(key, ledgerBracketVal ?? standardVal ?? realVal!);
      if (ledgerBracketVal != null && picksOnlyBasis === "standard") standardMap.set(key, ledgerBracketVal);
      if (ledgerBracketVal != null && picksOnlyBasis === "real") realMap.set(key, ledgerBracketVal);
    }
  }

  // Whichever basis Trade Edge is actually pricing this league with right
  // now — see LeagueRankingsResult.activeBasis's own doc. `useGeneratedPickValues`
  // (the picksOnly ledger — standard dynasty/keeper/real-salary leagues'
  // "generate draft pick values" flow) is NOT "custom": players there stay on
  // standard/real values exactly like a league with no ledger at all, only
  // picks get individually priced. Only `useCustomValuations` (the FULL
  // ledger, custom-salary leagues) is really a distinct basis — this used to
  // fold both flags into "custom" together, so a league running standard
  // dynasty consensus + generated pick values showed the wrong tab lit green
  // on the League Rankings page (Ash, 2026-08-25, live example: Woolridge
  // DMD30 generated on standard dynasty consensus, but "Custom generated"
  // carried the ● indicator instead of "Consensus dynasty"). Matches
  // deep-edge/home/page.tsx's own drivingBasisLabel(), which already got
  // this right for the same picksOnly case.
  const activeBasis: RankingsBasis = (() => {
    if (settings.useCustomValuations) return "custom";
    if (leagueType === "redraft") return "redraft";
    if (leagueType === "dynasty") return settings.salaryFormat === "real" ? "real" : "standard";
    const weight = computeKeeperWeight(settings.keeperPolicy, totalRosterSlots);
    if (weight >= 0.5) return settings.salaryFormat === "real" ? "real" : "standard";
    return "redraft";
  })();

  // RANK comes purely from toRanked() — ONE global sort per basis map, which
  // is what guarantees every row's rank strictly increases as its value
  // strictly decreases, with no exceptions. This used to instead overwrite
  // a covered asset's rank with the generated ledger's own precomputed
  // tradeRank verbatim (row.tradeRank) — a number computed within the
  // LEDGER's own internal pool (custom-valuations.ts's combined sort, or,
  // for a picksOnly doc, its own picks-vs-real-players scaffold), which is
  // NOT the same pool this map's OTHER rows (bracket rows especially — see
  // custom-valuations.ts's own bracket loop, priced by a completely
  // different formula than league-rankings.ts's pickEquivalentValue) get
  // ranked within. Patching a subset of one map's ranks with numbers from a
  // differently-shaped pool is exactly what produced a real, visible bug: a
  // later, lower-value row displaying a smaller (better) rank than the row
  // directly above it (Ash, 2026-08-27 — a 2026 1st (#16) row ranked 170
  // sat directly above a 2029 #4-8 bracket row ranked 167, impossible
  // within one consistently numbered pool). The VALUE overlay above
  // (customVal/ledgerVal already written into these maps) still puts every
  // ledger-covered pick on the ledger's own number — only the RANK is now
  // always freshly, consistently derived from THIS map's own sort, so it
  // can never disagree with its own neighbors again.
  const customRanked = toRanked(customMap);
  const standardRanked = toRanked(standardMap);
  const realRanked = toRanked(realMap);

  return {
    assets,
    values: {
      standard: standardRanked,
      real: realRanked,
      redraft: toRanked(redraftMap),
      custom: customRanked,
    },
    ledgerMode: customDoc?.mode ?? null,
    ledgerGeneratedAt: customDoc?.generatedAt ?? null,
    salaryFormat,
    positionSlots: analysis.league.positionSlots ?? {},
    family,
    activeBasis,
  };
}
