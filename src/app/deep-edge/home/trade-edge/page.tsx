"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { CategoryEdge, LeagueAnalysis, ResolvedPlayer, TeamCategoryProfile, TradePartnerSuggestion } from "@/lib/fantrax/analyze";
import { categoryEdges, projectRotoStandings, suggestTradePartners, teamStrengthsWeaknesses } from "@/lib/fantrax/analyze";
import { CATEGORY_LABEL, currentSeasonDraftStatus, type FheCategory, type TeamDraftPick } from "@/lib/fantrax/league";
import { DEFAULT_GAMES_CAP_SETTINGS, DEFAULT_LEAGUE_TAGS, type LeagueType, type SalaryFormat } from "@/lib/fantrax/league-tags";
import { FormatConfirmPrompt } from "@/lib/fantrax/format-confirm";
import { categoryTier, resolveEffectiveScoring, type CategoryTier } from "@/lib/fantrax/lineup";
import {
  buildDepthWeightedProfiles, deriveRankingsFormat, depthCaption, depthWeight,
  rotoStandingsByRawStat, simulateH2HCategoryStandings, simulateH2HPointsStandings, type RankingsFormat,
} from "@/lib/fantrax/power-rankings";
import {
  tradeProfiles, TRADE_VALUE_MODE_LABEL, valueOf,
  type TradeValueMode,
} from "@/lib/fantrax/trade-edge";
import { computeBaseTradeValues, type RedraftBaseMode } from "@/lib/fantrax/trade-value";
import type { CustomValuationsDoc } from "@/lib/fantrax/custom-valuations-store";
import { computeTradeVerdict, type TradeVerdict } from "@/lib/fantrax/trade-verdict";
import {
  DraftPickCardsGrid, formatContract, formatCustomContract, formatCustomSalary, formatSalary,
  pickValueStatus, posDisplayFor, rankAmong, statValue, weightedAverage, type EnrichData, type RosterTableFormat,
} from "../../_components/roster-table";
import { ASSET_TIER_COLOR, pickAssetTier, playerAssetTier, type ContractClass } from "../../_components/asset-tiers";
import { PlayerHeadshot } from "@/app/team-rosters/_components/roster-headshot";
import { HubShell } from "../../_components/hub-shell";
import { IconChevronLeft } from "../../_components/icons";
import { SegmentedControl } from "../../_components/segmented-control";
import { StrengthBar } from "../../_components/strength-bar";
import { tierBg, tierFill } from "../../_components/tier-colors";
import { YouVsTeamCells } from "../../_components/you-vs-team-cells";
import { DEEP_EDGE_TABLE_CSS } from "../../_components/sortable-table";
import { useActiveLeague } from "../../_lib/use-saved-leagues";

const COMPARE_TABLE_CSS = `
  .de-table tr.partner td { background: rgba(93,95,239,0.09); font-weight: 600; }
  .te-preview-table { table-layout: fixed; }
  .te-preview-table td.l { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

const TIER_COLOR: Record<string, string> = {
  promoter: "var(--rt-up)", passive: "#c98a1f", detractor: "var(--rt-down)",
};

const VALUE_MODE_OPTIONS = (Object.keys(TRADE_VALUE_MODE_LABEL) as TradeValueMode[]).map((v) => ({
  value: v, label: TRADE_VALUE_MODE_LABEL[v],
}));

function ordinal(rank: number): string {
  if (rank % 100 >= 11 && rank % 100 <= 13) return `${rank}th`;
  const suffix = rank % 10 === 1 ? "st" : rank % 10 === 2 ? "nd" : rank % 10 === 3 ? "rd" : "th";
  return `${rank}${suffix}`;
}

function formatCatValue(cat: FheCategory, raw: number | null, mode: "perGame" | "totals"): string {
  if (raw == null || !Number.isFinite(raw)) return "—";
  if (cat === "FG" || cat === "FT") return raw.toFixed(3).replace(/^0(?=\.)/, "");
  return mode === "totals" ? Math.round(raw).toLocaleString("en-US") : raw.toFixed(1);
}
/** One player's own stat, per-game or scaled to a season total (per-game ×
 *  games played) — FG%/FT% never scale, a rate has no "total" form. */
function playerStatDisplay(p: ResolvedPlayer, cat: FheCategory, mode: "perGame" | "totals"): string {
  const perGame = statValue(p, cat);
  if (perGame == null) return "—";
  if (cat === "FG" || cat === "FT") return formatCatValue(cat, perGame, mode);
  const raw = mode === "totals" ? perGame * (p.gamesPlayed ?? 0) : perGame;
  return formatCatValue(cat, raw, mode);
}
/** The ticked-players summary row: attempt-weighted rate for FG/FT (same
 *  regardless of the toggle — a percentage isn't a "total"), combined season
 *  totals summed across players for totals mode, weighted per-game average
 *  otherwise. */
function summaryStatDisplay(players: ResolvedPlayer[], cat: FheCategory, mode: "perGame" | "totals"): string {
  if (cat === "FG" || cat === "FT") return formatCatValue(cat, weightedAverage(players, cat), "perGame");
  if (mode === "perGame") return formatCatValue(cat, weightedAverage(players, cat), "perGame");
  let total = 0;
  for (const p of players) {
    const raw = statValue(p, cat);
    if (raw != null) total += raw * (p.gamesPlayed ?? 0);
  }
  return formatCatValue(cat, total, "totals");
}

/** Mean z-score across a subset of categories for one player — the combined
 *  "how good is he at exactly these cats" read the category selector below
 *  sorts/tints the picker cards by. Ignores categories the player has no
 *  data for rather than treating them as 0, same convention as
 *  suggestTradeTargets' own meanZ in analyze.ts. */
function meanZ(cats: Partial<Record<FheCategory, number>>, subset: FheCategory[]): number | null {
  let sum = 0, n = 0;
  for (const cat of subset) {
    const v = cats[cat];
    if (typeof v === "number" && Number.isFinite(v)) { sum += v; n += 1; }
  }
  return n > 0 ? sum / n : null;
}

/** Picker-card sort: by combined z across the target categories when any are
 *  selected (best fit for what you're targeting first), otherwise by the
 *  chosen TradeValueMode — same default as before the category selector
 *  existed. */
function sortForCards(
  players: ResolvedPlayer[], valueMode: TradeValueMode, targetCats: FheCategory[],
  surplusByFantraxId?: ReadonlyMap<string, number>,
): ResolvedPlayer[] {
  return [...players].sort((a, b) => {
    if (targetCats.length > 0) return (meanZ(b.cats, targetCats) ?? -Infinity) - (meanZ(a.cats, targetCats) ?? -Infinity);
    return (valueOf(b, valueMode, surplusByFantraxId) ?? -Infinity) - (valueOf(a, valueMode, surplusByFantraxId) ?? -Infinity);
  });
}

/** Whether an increase in this raw stat is a good thing — every counting
 *  stat and shooting percentage except turnovers, where fewer is better.
 *  Drives the net-impact summary's conditional formatting (see
 *  NetImpactRow) — a raw stat delta, unlike v_to, is never pre-flipped. */
const HIGHER_IS_BETTER: Record<FheCategory, boolean> = {
  PTS: true, FG3: true, REB: true, AST: true, STL: true, BLK: true, FG: true, FT: true, TO: false,
};

function totalFor(players: ResolvedPlayer[], cat: FheCategory): number {
  let total = 0;
  for (const p of players) {
    const raw = statValue(p, cat);
    if (raw != null) total += raw * (p.gamesPlayed ?? 0);
  }
  return total;
}

/** Net per-category swing this trade produces — received minus given, in
 *  whichever unit (per-game or season totals) the preview toggle is set to.
 *  FG%/FT% always compare attempt-weighted rates regardless of the toggle —
 *  a percentage has no "total" form. Null when neither side has any data
 *  for the category. */
function netFor(sendPlayers: ResolvedPlayer[], receivePlayers: ResolvedPlayer[], cat: FheCategory, mode: "perGame" | "totals"): number | null {
  if (cat === "FG" || cat === "FT" || mode === "perGame") {
    const g = weightedAverage(sendPlayers, cat);
    const r = weightedAverage(receivePlayers, cat);
    if (g == null && r == null) return null;
    return (r ?? 0) - (g ?? 0);
  }
  return totalFor(receivePlayers, cat) - totalFor(sendPlayers, cat);
}

function formatNetDelta(cat: FheCategory, net: number, mode: "perGame" | "totals"): string {
  const magnitude = cat === "FG" || cat === "FT"
    ? Math.abs(net).toFixed(3).replace(/^0(?=\.)/, "")
    : mode === "totals" ? Math.round(Math.abs(net)).toLocaleString("en-US") : Math.abs(net).toFixed(1);
  if (net > 0.0005) return `+${magnitude}`;
  if (net < -0.0005) return `-${magnitude}`;
  return `±${magnitude}`;
}

/** How a player's value shows under the chosen TradeValueMode — always a
 *  rank ("#12") within the pool. `surplusV` ("Trade Value") used to be a
 *  signed dollar figure (a real dynasty-league cost-vs-production surplus);
 *  since 2026-08-23 it reads off Trade Edge's base-value cascade
 *  (baseValueByFantraxId, trade-value.ts), which is a comparable z-score for
 *  every league type (consensus rank / real-or-custom-salary blend / season
 *  projection), never a raw dollar amount — so it ranks the same as every
 *  other mode now. Reused by both PlayerMiniCard and TradePreviewTable's VAL
 *  RK column so the two stay consistent. */
function valueDisplayFor(
  p: ResolvedPlayer, mode: TradeValueMode, leaguePlayers: ResolvedPlayer[],
  baseValueByFantraxId: ReadonlyMap<string, number> | undefined,
  ledgerRankByFantraxId?: ReadonlyMap<string, number>,
): string {
  if (mode === "surplusV") {
    const ledgerRank = ledgerRankByFantraxId?.get(p.fantraxId);
    if (ledgerRank != null) return `#${ledgerRank}`;
  }
  const rank = rankAmong(leaguePlayers, (pl) => valueOf(pl, mode, baseValueByFantraxId), valueOf(p, mode, baseValueByFantraxId));
  return rank != null ? `#${rank}` : "—";
}

/** A player's trade-value RANK against the league pool — the ONLY number
 *  PlayerMiniCard shows (Ash, 2026-08-23: "the only value to display on the
 *  card is the trade value rank"), always read off baseValueByFantraxId
 *  (the base-value cascade — custom ledger merged over the default cascade,
 *  or the default cascade alone) regardless of whichever TradeValueMode the
 *  page's own "Rank players by" selector happens to be set to. That selector
 *  still drives sort order/other displays; it no longer drives this card.
 *
 *  When a custom ledger is active, `ledgerRankByFantraxId` (the ledger's own
 *  precomputed `tradeRank`, keyed by fantraxId) is checked FIRST and used
 *  verbatim — never recomputed via rankAmong(leaguePlayers, …), which only
 *  ranks within the two trading rosters, a much smaller and differently-
 *  composed pool than the ledger's own ~552-asset ranking (Ash, 2026-08-23:
 *  found Buffalo Braves' cards showing #30/#87/#129… while the asset-values
 *  page ranked the SAME players #36/#104/#159 — the exact same class of
 *  card/ledger divergence already fixed for picks via ledgerRankByPickKey,
 *  now fixed the same way for players). Falls back to the recomputed rank
 *  only for a player the ledger never resolved a fantraxId for. */
function tradeValueRankFor(
  p: ResolvedPlayer,
  leaguePlayers: readonly ResolvedPlayer[],
  baseValueByFantraxId: ReadonlyMap<string, number> | undefined,
  ledgerRankByFantraxId?: ReadonlyMap<string, number>,
): string {
  const ledgerRank = ledgerRankByFantraxId?.get(p.fantraxId);
  if (ledgerRank != null) return `#${ledgerRank}`;
  const rank = rankAmong(leaguePlayers as ResolvedPlayer[], (pl) => baseValueByFantraxId?.get(pl.fantraxId) ?? null, baseValueByFantraxId?.get(p.fantraxId) ?? null);
  return rank != null ? `#${rank}` : "—";
}

/** A player asset card for the trade pickers — square, solid color fill by
 *  asset tier (rookie/sophomore/rookie-scale/veteran — see asset-tiers.ts,
 *  Ash's own color-coding spec 2026-08-23). Name/position/team sit top-left;
 *  the trade-value rank sits bottom-left. The headshot bleeds off the card's
 *  own bottom-right corner, faded on its left edge so it blends into the
 *  tier color rather than reading as a boxed-in photo — the original ask —
 *  but now sized and positioned to fill exactly the quadrant Ash marked up
 *  on a real screenshot (2026-08-23: "place it fully in the area marked out
 *  by the orange square"), not the earlier version that bled across nearly
 *  the whole card. Every text element is plain white with a soft drop shadow
 *  so it reads the same on every tier color, light or dark (Ash: "player
 *  names etc should all be in white"). No source (custom/default) or
 *  tier-name text on the card itself — the color alone carries the tier, and
 *  the page's own settings panel already states whether custom valuations
 *  are active; there's no room for a repeated label on a card this small.
 *  No longer dims for roster-depth "assessed" state — Ash, 2026-08-23:
 *  "remove the semi greyed application to some of the cards that was a
 *  legacy UI request." */
function PlayerMiniCard({
  player, checked, onToggle, tier, positionSlots, isSophomore, contractClass, leaguePlayers, baseValueByFantraxId, ledgerRankByFantraxId,
}: {
  player: ResolvedPlayer; checked: boolean; onToggle: () => void;
  tier: CategoryTier | null; positionSlots: Record<string, number>; isSophomore: boolean;
  contractClass: ContractClass | undefined; leaguePlayers: readonly ResolvedPlayer[];
  baseValueByFantraxId: ReadonlyMap<string, number> | undefined;
  ledgerRankByFantraxId?: ReadonlyMap<string, number>;
}) {
  const initials = player.name.split(" ").map((w) => w[0]).slice(0, 2).join("");
  const posDisplay = posDisplayFor(player.eligible, positionSlots).join("/");
  const assetTier = playerAssetTier({
    isRookie: player.isRookie, isSophomore, isRookieScaleContract: contractClass === "rookie-scale",
  });
  const { bg } = ASSET_TIER_COLOR[assetTier];
  const rankLabel = tradeValueRankFor(player, leaguePlayers, baseValueByFantraxId, ledgerRankByFantraxId);
  const textShadow = "0 1px 3px rgba(0,0,0,0.45)";
  return (
    <button
      type="button"
      onClick={onToggle}
      title={player.name}
      style={{
        position: "relative", aspectRatio: "1 / 1", borderRadius: 16,
        border: checked ? "2px solid var(--rt-ink)" : "2px solid transparent",
        background: bg, cursor: "pointer", textAlign: "left", color: "#fff",
        overflow: "hidden", font: "inherit", width: "100%", padding: 0,
      }}
    >
      {/* Headshot fills the card's own bottom-right quadrant, flush to the
          real corner (unpadded, so it can bleed to the card's true edge —
          the card's own overflow:hidden + border-radius clips its outer
          corner to match). fadeEdge blends its left edge into the card's
          tier color instead of a hard rectangular cut. */}
      <div style={{ position: "absolute", right: 0, bottom: 0, width: "48%", height: "50%" }}>
        <PlayerHeadshot
          name={player.name} size={44} width="100%" height="100%" radius={0} fadeEdge
          initials={initials} background="transparent" color="#fff" fontSize={13} rookie={player.isRookie}
        />
      </div>
      {tier && (
        <span style={{ position: "absolute", top: 10, right: checked ? 32 : 10, width: 9, height: 9, borderRadius: 999, background: TIER_COLOR[tier], boxShadow: "0 0 0 2px rgba(255,255,255,0.6)" }} />
      )}
      {checked && (
        <span style={{ position: "absolute", top: 8, right: 8, width: 20, height: 20, borderRadius: 999, background: "var(--rt-ink)", color: "var(--rt-canvas)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>
          ✓
        </span>
      )}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100%", padding: 10 }}>
        <div style={{ maxWidth: "78%" }}>
          <div
            style={{
              fontSize: 11.5, fontWeight: 800, lineHeight: 1.15, textShadow,
              overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
            }}
          >
            {player.name}
          </div>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.85)", textShadow, marginTop: 2 }}>
            {posDisplay || "—"} · {player.nbaTeam || "—"}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ maxWidth: "48%" }}>
          <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1, fontFamily: "var(--rt-font-mono)", color: "#fff", textShadow }}>
            {rankLabel}
          </span>
        </div>
      </div>
    </button>
  );
}

/** Category-by-category net swing (received minus given), rendered as one
 *  more aligned row directly under the trade preview tables above — same
 *  colgroup/column widths as TradePreviewTable so it reads as a continuation
 *  of that table rather than a separate summary block (Ash, 2026-08-14: "add
 *  another row to the table directly below the trade preview"). Light
 *  conditional formatting only: a flat green/red wash, not a magnitude-scaled
 *  gradient (raw stat deltas span wildly different scales per category, so a
 *  shared anchor would either wash out PTS or saturate FG% at the slightest
 *  move); text stays neutral ink even on the tint — the wash and the
 *  +/-/± prefix in formatNetDelta's output both already carry direction. */
/** Sum of `p.salary` across a side of the trade — null (no salary on file,
 *  e.g. an unsigned free agent) is excluded from the sum rather than treated
 *  as 0, so a missing value can't silently understate what's actually moving;
 *  `missing` surfaces the count so the caller can flag it instead of
 *  presenting a partial total as if it were complete. */
function sumSalary(players: ResolvedPlayer[]): { total: number; missing: number } {
  let total = 0, missing = 0;
  for (const p of players) {
    if (p.salary != null) total += p.salary; else missing++;
  }
  return { total, missing };
}

function NetImpactRow({ scored, sendPlayers, receivePlayers, statMode, showSalary, showContract, salaryFormat }: {
  scored: readonly FheCategory[]; sendPlayers: ResolvedPlayer[]; receivePlayers: ResolvedPlayer[]; statMode: "perGame" | "totals";
  showSalary: boolean; showContract: boolean; salaryFormat: SalaryFormat;
}) {
  if (scored.length === 0) return null;
  const isCustomSalary = salaryFormat === "custom";
  const fmtSalary = (n: number) => (isCustomSalary ? formatCustomSalary(n) : formatSalary(n));
  const sent = sumSalary(sendPlayers);
  const received = sumSalary(receivePlayers);
  const netSalary = received.total - sent.total;
  const salarySign = netSalary > 0.0005 ? "+" : netSalary < -0.0005 ? "-" : "±";
  const salaryColor = netSalary > 0.0005 ? "var(--rt-down)" : netSalary < -0.0005 ? "var(--rt-up)" : "var(--rt-ink)";
  const missing = sent.missing + received.missing;
  const salaryTitle = `${fmtSalary(sent.total)} sent · ${fmtSalary(received.total)} received`
    + (missing > 0 ? ` — ${missing} player${missing === 1 ? "" : "s"} with no salary on file` : "");
  return (
    <div style={{ marginBottom: 20 }}>
      <div className="de-table-wrap">
        <table className="de-table te-preview-table" style={{ minWidth: 640 }}>
          <colgroup>
            <col style={{ width: 170 }} />
            <col style={{ width: 60 }} />
            <col style={{ width: 50 }} />
            {showSalary && <col style={{ width: 70 }} />}
            {showContract && <col style={{ width: 80 }} />}
            <col style={{ width: 60 }} />
            <col style={{ width: 60 }} />
            {scored.map((cat) => <col key={cat} style={{ width: 56 }} />)}
          </colgroup>
          <tbody>
            <tr className="mine">
              <td className="l">Net category impact ({statMode === "perGame" ? "per game" : "totals"})</td>
              <td>—</td><td>—</td>
              {showSalary && (
                <td title={salaryTitle} style={{ fontWeight: 700, color: salaryColor }}>
                  {salarySign}{fmtSalary(Math.abs(netSalary))}
                </td>
              )}
              {showContract && <td>—</td>}
              <td>—</td><td>—</td>
              {scored.map((cat) => {
                const net = netFor(sendPlayers, receivePlayers, cat, statMode);
                const gain = net != null && Math.abs(net) > 0.0005 && (HIGHER_IS_BETTER[cat] ? net > 0 : net < 0);
                const loss = net != null && Math.abs(net) > 0.0005 && !gain;
                return (
                  <td key={cat} style={{ background: gain ? "rgba(34,197,94,0.14)" : loss ? "rgba(239,68,68,0.14)" : undefined, color: "var(--rt-ink)" }}>
                    {net != null ? formatNetDelta(cat, net, statMode) : "—"}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function pickLabel(pick: TeamDraftPick): string {
  return `${pick.year} ${ordinal(pick.round)}${pick.overallPick != null ? ` (#${pick.overallPick})` : ""}`;
}

/** A future pick's estimated overall slot, from whichever team's standing
 *  actually determines it — reverse-standings draft order (worst record
 *  picks first), same convention every real dynasty league and the NBA
 *  itself use: `overallPick = (round-1)*teamCount + (teamCount-rank+1)`
 *  (Ash, 2026-08-23: "if team is ranked 15/30, his 2nd round pick will sit
 *  around #46... and #16 for his 1st round pick" — 30-15+1=16, 30+16=46,
 *  confirmed against both examples given). The team whose standing counts is
 *  whoever the slot is ORIGINALLY tied to (`pick.originalOwnerLabel`, when
 *  the pick has changed hands at least once) — a traded pick keeps the
 *  original team's draft position, it doesn't inherit the new holder's —
 *  falling back to the holder itself for a team's own natural pick. Returns
 *  the pick unchanged when nothing here applies: the current/imminent draft
 *  year (already has a REAL slot, nothing to project), a pick that already
 *  carries one, or when the rank needed isn't available (rank map empty —
 *  see postTradeRankByTeamId's own doc for why that's gated behind opening
 *  the Power Rankings/Category Edge compare panel, not unconditional). */
function withProjectedSlot(
  pick: TeamDraftPick, holderTeamId: string, seasonYear: number, teamCount: number,
  teamIdByName: ReadonlyMap<string, string>, postTradeRankByTeamId: ReadonlyMap<string, number>,
): TeamDraftPick {
  if (pick.year <= seasonYear || pick.overallPick != null) return pick;
  const slotTeamId = (pick.originalOwnerLabel && teamIdByName.get(pick.originalOwnerLabel)) || holderTeamId;
  const rank = postTradeRankByTeamId.get(slotTeamId);
  if (rank == null) return pick;
  const overallPick = (pick.round - 1) * teamCount + (teamCount - rank + 1);
  return { ...pick, overallPick };
}

/** A single adjusted-value number for the Trade Verdict panel — same ±
 *  convention as formatNetDelta. computeTradeVerdict always runs on
 *  baseValueByFantraxId (trade-value.ts) now, which lands every league type
 *  on a comparable z-score scale, never a raw dollar amount — so this is
 *  always the same decimal format regardless of the "Rank players by"
 *  display mode (that control no longer feeds trade math at all, see
 *  valueModeDefaultKey's doc comment above). */
function formatVerdictValue(n: number): string {
  const sign = n > 0.0005 ? "+" : n < -0.0005 ? "-" : "±";
  return `${sign}${Math.abs(n).toFixed(2)}`;
}

/** A team's power-ranking position within `profiles` — the same standings
 *  function PowerRankingsCompareTable (and the standalone Power Rankings
 *  tool) itself uses per format, just reduced to the one team's rank number.
 *  Null when the team isn't found (shouldn't happen for a connected league's
 *  own team, but a profile list can be empty before data loads).
 *
 *  Roto MUST go through rotoStandingsByRawStat with the caller's own statMode
 *  — not projectRotoStandings' z-score-based ranking, which this used to call
 *  regardless of the Per Game/Totals toggle. That silently disagreed with
 *  every other roto standings table on this same page (Ash, 2026-08-24: "the
 *  power rank before and after is not linked to the displayed power rank
 *  before and after" — caught live on FBI Super20, badge read 9th while the
 *  before/after compare table right below it, and the real Power Rankings
 *  tool, both read 5th for the same team/lineup). */
function teamRankOf(profiles: TeamCategoryProfile[], format: RosterTableFormat, scored: readonly FheCategory[], teamId: string, statMode: "perGame" | "totals"): number | null {
  if (format === "roto") {
    return rotoStandingsByRawStat(profiles, scored, statMode).find((r) => r.teamId === teamId)?.projectedRank ?? null;
  }
  const rows = format === "h2hcat" ? simulateH2HCategoryStandings(profiles, scored) : simulateH2HPointsStandings(profiles);
  return rows.find((r) => r.teamId === teamId)?.rank ?? null;
}

/** A team's combined fantasy points per game — same `pointsTotal / gamesPlayed`
 *  PowerRankingsCompareTable's own FPTS/GM column already shows for a points
 *  league, just for one team instead of every row. */
function teamFptsPerGame(profiles: TeamCategoryProfile[], teamId: string): number | null {
  const p = profiles.find((pr) => pr.teamId === teamId);
  if (!p || p.statTotals.gamesPlayed <= 0) return null;
  return (p.pointsTotal ?? 0) / p.statTotals.gamesPlayed;
}

/** A small circular "rank of pool" gauge — the sweep fills clockwise from 12
 *  o'clock in proportion to how close to #1 the rank is
 *  ((of - rank + 1) / of), so a top rank reads as an almost-full ring and a
 *  bottom rank as barely a sliver — same visual language as StrengthBar's
 *  own ratio fill, just radial. `stroke` lets the caller recolor the AFTER
 *  ring by whether the trade improved or hurt this team's standing. */
function RankRing({ rank, of, size = 54, stroke = "var(--rt-primary)" }: { rank: number | null; of: number; size?: number; stroke?: string }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const pct = rank != null && of > 0 ? Math.max(0, Math.min(1, (of - rank + 1) / of)) : 0;
  const dash = c * pct;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--rt-hairline)" strokeWidth={5} />
      {rank != null && (
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={stroke} strokeWidth={5} strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
      <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.3} fontWeight={800} fill="var(--rt-ink)" fontFamily="var(--rt-font-mono)">
        {rank ?? "—"}
      </text>
      <text x="50%" y="72%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.155} fill="var(--rt-muted)">
        of {of}
      </text>
    </svg>
  );
}

/**
 * The fairness call Trade Edge never had at all before this (see
 * docs/trade-agent-gap-analysis.md's original "measures of success" review,
 * requirement 1) — who wins, by how much, and how much the losing side would
 * need to add to even it out. `verdict.sideA` is what MY team ends up
 * receiving; `verdict.sideB` is what the partner ends up receiving (i.e.
 * what I'm sending them) — so `winner === "A"` reads as "I win this trade,"
 * matching how a manager actually reads their own trade screen. Built on
 * computeTradeVerdict's star-concentration-aware adjustment (see
 * trade-verdict.ts) — validated this isn't cosmetic: it correctly flips a
 * real 3-for-1 trade a naive linear sum got backwards, matching a real
 * league's 100% community vote.
 */
/** One traded asset's full row — the clean table layout Ash asked for on
 *  the Trade Verdict specifically (2026-08-23, after an earlier pass wrongly
 *  landed it on the trade-preview table instead): trade value rank (always,
 *  from baseValueByFantraxId), a second rank under whichever raw model
 *  matches this league's format (Minus1V/8CatV/FPTS), salary (blank outside
 *  a salary league), then the raw and star-concentration-adjusted values
 *  that actually drove the verdict below — the whole point of showing this
 *  breakdown is to make WHY the verdict landed where it did legible, not
 *  just assert a total. Ring around the headshot (a player) or the filled,
 *  round-numbered circle (a pick, standing in for a photo it doesn't have)
 *  both carry the SAME asset-tier color the picker cards use (Ash,
 *  2026-08-23: "apply the same colour coding as the asset cards... for the
 *  draft picks add a similar circle and fill with the same colour coding,
 *  put a 1 if its a 1st round pick and a 2 if it's a 2nd rounder"). Name/
 *  label text uses `.de-player-name` — the same sans-serif convention every
 *  other Deep Edge table already uses for a player's own name cell — the
 *  closest existing match to the reference's own type ("try and find a
 *  match for the font type"). */
function TradeVerdictAssetRow({
  player, pick, rawValue, adjustedValue, leaguePlayers, baseValueByFantraxId, secondRankMode, showSalary, salaryFormat,
  family, ledgerRankByPickKey, ledgerRankByFantraxId, positionSlots, isSophomore, contractClass, seasonYear, currentYearPickValueByOverallPick, ledgerValues,
  onRequestValue,
}: {
  player: ResolvedPlayer | null; pick: TeamDraftPick | null; rawValue: number; adjustedValue: number;
  leaguePlayers: ResolvedPlayer[]; baseValueByFantraxId: ReadonlyMap<string, number> | undefined;
  secondRankMode: Exclude<TradeValueMode, "surplusV">; showSalary: boolean; salaryFormat: SalaryFormat;
  family: "categories" | "points"; ledgerRankByPickKey: ReadonlyMap<string, number>;
  ledgerRankByFantraxId: ReadonlyMap<string, number>; positionSlots: Record<string, number>;
  isSophomore: boolean; contractClass: ContractClass | undefined; seasonYear: number;
  currentYearPickValueByOverallPick: ReadonlyMap<number, number>; ledgerValues: readonly number[];
  /** Launches the Power Rankings compare so an unresolved future pick's
   *  real value gets computed — every row here is already part of the
   *  proposed trade, so (unlike the picker cards) the trigger always shows
   *  once needed, with no separate "checked" gate. */
  onRequestValue: () => void;
}) {
  const isCustomSalary = salaryFormat === "custom";
  const label = player ? player.name : pickLabel(pick!);
  const pickStatus = player ? null : pickValueStatus(pick!, { leaguePlayers, baseValueByFantraxId, family, ledgerRankByPickKey, currentYearPickValueByOverallPick, seasonYear, ledgerValues });
  const valRk = player ? tradeValueRankFor(player, leaguePlayers, baseValueByFantraxId, ledgerRankByFantraxId) : pickStatus!.label;
  const secondRk = player ? valueDisplayFor(player, secondRankMode, leaguePlayers, undefined) : "—";
  const salaryDisplay = player
    ? (isCustomSalary ? formatCustomSalary(player.salary) : formatSalary(player.salary))
    : "—";
  const posDisplay = player ? posDisplayFor(player.eligible, positionSlots).join("/") : null;
  const assetTier = player
    ? playerAssetTier({ isRookie: player.isRookie, isSophomore, isRookieScaleContract: contractClass === "rookie-scale" })
    : pickAssetTier(pick!, seasonYear);
  const tierColor = ASSET_TIER_COLOR[assetTier].bg;
  return (
    <tr>
      <td className="l">
        {player ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", padding: 2, border: `2px solid ${tierColor}`, flexShrink: 0 }}>
              <PlayerHeadshot name={player.name} size={20} initials={player.name.split(" ").map((w) => w[0]).slice(0, 2).join("")} background="var(--rt-surface-strong)" color="var(--rt-ink)" fontSize={8} rookie={player.isRookie} />
            </div>
            <span style={{ overflow: "hidden" }}>
              <div className="de-player-name" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
              <div style={{ fontSize: 9.5, color: "var(--rt-muted)" }}>{posDisplay || "—"} · {player.nbaTeam || "—"}</div>
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: tierColor, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, fontFamily: "var(--rt-font-mono)", flexShrink: 0, textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
              {pick!.round}
            </div>
            <span className="de-player-name" style={{ fontSize: 12.5 }}>{label}</span>
          </div>
        )}
      </td>
      <td>
        {pickStatus?.needsCalc ? (
          <button
            type="button"
            onClick={onRequestValue}
            style={{
              fontSize: 11, fontWeight: 800, fontFamily: "var(--rt-font-mono)", color: "var(--rt-ink)",
              background: "var(--rt-surface-strong)", border: "1px solid var(--rt-hairline)", borderRadius: 999,
              padding: "4px 10px", cursor: "pointer",
            }}
          >
            Value?
          </button>
        ) : valRk}
      </td>
      <td>{secondRk}</td>
      {showSalary && <td>{salaryDisplay}</td>}
      <td style={{ color: "var(--rt-muted)" }}>{formatVerdictValue(rawValue)}</td>
      <td style={{ fontWeight: 700 }}>{formatVerdictValue(adjustedValue)}</td>
    </tr>
  );
}

function TradeVerdictSideColumn({
  teamName, teamNameColor, side, players, picks, leaguePlayers, baseValueByFantraxId, secondRankMode, secondRankLabel,
  showSalary, salaryFormat, family, ledgerRankByPickKey, ledgerRankByFantraxId, positionSlots, enrich, seasonYear, currentYearPickValueByOverallPick,
  ledgerValues, onRequestValue,
}: {
  teamName: string; teamNameColor: string; side: TradeVerdict["sideA"]; players: ResolvedPlayer[]; picks: readonly TeamDraftPick[];
  leaguePlayers: ResolvedPlayer[]; baseValueByFantraxId: ReadonlyMap<string, number> | undefined;
  secondRankMode: Exclude<TradeValueMode, "surplusV">; secondRankLabel: string;
  showSalary: boolean; salaryFormat: SalaryFormat; family: "categories" | "points";
  ledgerRankByPickKey: ReadonlyMap<string, number>; ledgerRankByFantraxId: ReadonlyMap<string, number>;
  positionSlots: Record<string, number>;
  enrich: EnrichData | null; seasonYear: number; currentYearPickValueByOverallPick: ReadonlyMap<number, number>;
  ledgerValues: readonly number[]; onRequestValue: () => void;
}) {
  const assetValueByLabel = useMemo(() => new Map(side.assets.map((a) => [a.label, a])), [side.assets]);
  const rows = [
    ...players.map((p) => ({ player: p, pick: null, label: p.name })),
    ...picks.map((pk) => ({ player: null, pick: pk, label: pickLabel(pk) })),
  ].sort((a, b) => (assetValueByLabel.get(b.label)?.adjustedValue ?? 0) - (assetValueByLabel.get(a.label)?.adjustedValue ?? 0));
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: teamNameColor, fontWeight: 700 }}>{teamName.toUpperCase()} RECEIVES</div>
        <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "var(--rt-font-mono)" }}>{formatVerdictValue(side.adjustedTotal)}</div>
      </div>
      <div className="de-table-wrap">
        <table className="de-table" style={{ minWidth: 360 }}>
          <thead>
            <tr>
              <th className="l">ASSET</th>
              <th>TRADE VAL RK</th>
              <th>{secondRankLabel}</th>
              {showSalary && <th>SAL$</th>}
              <th>RAW VAL</th>
              <th>ADJ VAL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const a = assetValueByLabel.get(r.label);
              if (!a) return null;
              const isSophomore = Boolean(r.player?.fheId && enrich?.sophomoreByFheId?.[r.player.fheId]);
              const contractClass = r.player?.fheId ? enrich?.contractByFheId[r.player.fheId]?.contractClass : undefined;
              return (
                <TradeVerdictAssetRow
                  key={r.label}
                  player={r.player} pick={r.pick} rawValue={a.rawValue} adjustedValue={a.adjustedValue}
                  leaguePlayers={leaguePlayers} baseValueByFantraxId={baseValueByFantraxId} secondRankMode={secondRankMode}
                  showSalary={showSalary} salaryFormat={salaryFormat} family={family} ledgerRankByPickKey={ledgerRankByPickKey}
                  ledgerRankByFantraxId={ledgerRankByFantraxId}
                  positionSlots={positionSlots} isSophomore={isSophomore} contractClass={contractClass} seasonYear={seasonYear}
                  currentYearPickValueByOverallPick={currentYearPickValueByOverallPick} ledgerValues={ledgerValues}
                  onRequestValue={onRequestValue}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TradeVerdictPanel({
  verdict, myTeamName, theirTeamName, myTeamId, myPlayers, myPicks, theirPlayers, theirPicks, leaguePlayers, baseValueByFantraxId,
  secondRankMode, secondRankLabel, showSalary, salaryFormat, family, ledgerRankByPickKey, ledgerRankByFantraxId, positionSlots, enrich, seasonYear,
  currentYearPickValueByOverallPick, ledgerValues, onRequestValue, trade, rowFormat, scored, teamCount, salaryBefore, salaryAfter, statMode,
}: {
  verdict: TradeVerdict; myTeamName: string; theirTeamName: string; myTeamId: string;
  /** sideA (myTeamName) is what I RECEIVE — receivePlayers/receivePicks;
   *  sideB (theirTeamName) is what THEY receive — sendPlayers/sendPicks. See
   *  this module's own doc above on why sideA reads as "my team." */
  myPlayers: ResolvedPlayer[]; myPicks: readonly TeamDraftPick[]; theirPlayers: ResolvedPlayer[]; theirPicks: readonly TeamDraftPick[];
  leaguePlayers: ResolvedPlayer[]; baseValueByFantraxId: ReadonlyMap<string, number> | undefined;
  secondRankMode: Exclude<TradeValueMode, "surplusV">; secondRankLabel: string;
  showSalary: boolean; salaryFormat: SalaryFormat; family: "categories" | "points";
  ledgerRankByPickKey: ReadonlyMap<string, number>; ledgerRankByFantraxId: ReadonlyMap<string, number>;
  positionSlots: Record<string, number>;
  enrich: EnrichData | null; seasonYear: number; currentYearPickValueByOverallPick: ReadonlyMap<number, number>;
  ledgerValues: readonly number[]; onRequestValue: () => void;
  /** Before/after league-wide profiles — null until the Power Rankings
   *  compare panel has been opened at least once (see `trade`'s own doc in
   *  TradeEdgeContent: 30-team lineup solves + up to 4 branch-and-bound exact
   *  solves, deliberately never paid on every checkbox click). The Power
   *  Rank and Avg FPTS tiles below show a "View →" trigger in place of real
   *  numbers until this resolves — same lazy-reveal pattern already built for
   *  a future pick's "Value?" trigger, for the same reason. */
  trade: { before: TeamCategoryProfile[]; after: TeamCategoryProfile[] } | null;
  rowFormat: RosterTableFormat; scored: readonly FheCategory[]; teamCount: number;
  /** My team's own combined roster salary, before/after this trade — a plain
   *  sum over already-loaded rosters, so unlike Power Rank/FPTS this is
   *  always available immediately, no launch required. Null when the league
   *  doesn't play with salaries. */
  salaryBefore: number | null; salaryAfter: number | null;
  /** Same Per Game/Totals basis toggle the before/after compare table below
   *  uses (PowerRankingsCompareTable) — the Power Rank tile must be computed
   *  on the same basis or it silently disagrees with the table right under
   *  it. */
  statMode: "perGame" | "totals";
}) {
  const verdictLabel = verdict.winner === "Fair" ? "Fair trade" : verdict.winner === "A" ? `${myTeamName} wins` : `${theirTeamName} wins`;
  const verdictColor = verdict.winner === "Fair" ? "var(--rt-muted)" : verdict.winner === "A" ? "var(--rt-up)" : "var(--rt-down)";
  // Each side's own header gets the same win/lose color language as the
  // headline above, instead of a flat grey label (Ash, 2026-08-23: "colour
  // the team names") — the winning side's "RECEIVES" reads green, the
  // losing side's reads red, both neutral on a fair trade.
  const myNameColor = verdict.winner === "Fair" ? "var(--rt-muted)" : verdict.winner === "A" ? "var(--rt-up)" : "var(--rt-down)";
  const theirNameColor = verdict.winner === "Fair" ? "var(--rt-muted)" : verdict.winner === "B" ? "var(--rt-up)" : "var(--rt-down)";
  const sideProps = { leaguePlayers, baseValueByFantraxId, secondRankMode, secondRankLabel, showSalary, salaryFormat, family, ledgerRankByPickKey, ledgerRankByFantraxId, positionSlots, enrich, seasonYear, currentYearPickValueByOverallPick, ledgerValues, onRequestValue };

  const rankBefore = trade ? teamRankOf(trade.before, rowFormat, scored, myTeamId, statMode) : null;
  const rankAfter = trade ? teamRankOf(trade.after, rowFormat, scored, myTeamId, statMode) : null;
  const fptsBefore = trade && family === "points" ? teamFptsPerGame(trade.before, myTeamId) : null;
  const fptsAfter = trade && family === "points" ? teamFptsPerGame(trade.after, myTeamId) : null;
  const salaryDelta = salaryBefore != null && salaryAfter != null ? salaryAfter - salaryBefore : null;
  // A team TOTAL (summed across a whole roster) always lands in real-money
  // scale regardless of salary format — real-salary totals are stored in
  // literal dollars (divide by 1e6), custom-salary totals are already
  // whatever unit the commissioner's cap uses but a summed roster total in
  // this range reads the same way a real cap does, so both render as
  // "$XXX.XM" here (Ash, 2026-08-23) — distinct from formatCustomSalary's
  // own per-PLAYER convention (roster-table.tsx), which deliberately stays
  // a bare unitless integer since a single player's custom value is NOT
  // guaranteed to be million-scale the way a whole roster's total is.
  const formatTeamSalary = (n: number) => `$${(salaryFormat === "custom" ? n : n / 1_000_000).toFixed(1)}M`;

  const viewTrigger = (
    <button
      type="button"
      onClick={onRequestValue}
      style={{
        fontSize: 15, fontWeight: 700, color: "var(--rt-primary)", background: "none", border: "none",
        padding: 0, cursor: "pointer",
      }}
    >
      View →
    </button>
  );

  const tiles: { label: string; content: ReactNode }[] = [
    {
      label: "Variance",
      content: (
        <>
          <span style={{ fontSize: 26, fontWeight: 800, fontFamily: "var(--rt-font-mono)" }}>{(verdict.variancePct * 100).toFixed(0)}%</span>
          {verdict.winner !== "Fair" && (
            <div style={{ fontSize: 13, color: "var(--rt-muted)", marginTop: 4 }}>
              {verdict.winner === "A" ? theirTeamName : myTeamName} needs {formatVerdictValue(Math.abs(verdict.valueAdjustedNeeded))} more
            </div>
          )}
        </>
      ),
    },
  ];

  if (salaryFormat !== "none" && salaryBefore != null && salaryAfter != null) {
    tiles.push({
      label: "Team Salary",
      content: (
        <>
          <span style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--rt-font-mono)" }}>
            {formatTeamSalary(salaryBefore)} → {formatTeamSalary(salaryAfter)}
          </span>
          {salaryDelta != null && (
            <div style={{ fontSize: 13, marginTop: 4, color: salaryDelta === 0 ? "var(--rt-muted)" : salaryDelta > 0 ? "var(--rt-down)" : "var(--rt-up)" }}>
              {salaryDelta > 0 ? "+" : salaryDelta < 0 ? "-" : "±"}{formatTeamSalary(Math.abs(salaryDelta))}
            </div>
          )}
        </>
      ),
    });
  }

  if (family === "points") {
    tiles.push({
      label: "Avg FPTS",
      content: trade ? (
        <span style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--rt-font-mono)" }}>
          {fptsBefore != null ? fptsBefore.toFixed(1) : "—"} → {fptsAfter != null ? fptsAfter.toFixed(1) : "—"}
        </span>
      ) : viewTrigger,
    });
  }

  // Both rings color by the SAME rank-quality scale (tierFill — the exact
  // green→red gradient PowerRankingsCompareTable's own cells and StrengthBar
  // already use), never by a before/after directional comparison — a 7th of
  // 30 is a genuinely good rank and should always read green, whether it's
  // the before or the after number (Ash, 2026-08-23: caught the old
  // directional coloring making a good BEFORE rank read as red/bad just
  // because it was rendered in the page's flat accent color by default).
  tiles.push({
    label: "Power Rank",
    content: trade ? (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <RankRing rank={rankBefore} of={teamCount} size={58} stroke={rankBefore != null ? tierFill(rankBefore, teamCount) : undefined} />
        <span style={{ color: "var(--rt-muted)", fontSize: 15 }}>→</span>
        <RankRing rank={rankAfter} of={teamCount} size={58} stroke={rankAfter != null ? tierFill(rankAfter, teamCount) : undefined} />
      </div>
    ) : viewTrigger,
  });

  return (
    <div style={{ padding: 20, borderRadius: 16, border: "1px solid var(--rt-hairline)", marginBottom: 20, overflow: "hidden" }}>
      <span
        style={{
          display: "inline-flex", alignItems: "center", padding: "5px 14px", borderRadius: 999,
          background: "var(--rt-primary)", color: "var(--rt-on-primary)", fontSize: 13, fontWeight: 800,
          letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 12,
        }}
      >
        Trade Verdict
      </span>
      <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.1, color: verdictColor, letterSpacing: "-0.01em" }}>
        {verdictLabel.toUpperCase()}
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 6 }}>
        {myTeamName} vs {theirTeamName}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", borderTop: "1px solid var(--rt-hairline)", marginTop: 16 }}>
        {tiles.map((tile, i) => (
          <div
            key={tile.label}
            style={{
              padding: "14px 0", paddingRight: i < tiles.length - 1 ? 22 : 0, marginRight: i < tiles.length - 1 ? 22 : 0,
              borderRight: i < tiles.length - 1 ? "1px solid var(--rt-hairline)" : "none",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 7 }}>
              {tile.label}
            </div>
            {tile.content}
          </div>
        ))}
      </div>

      <div style={{ fontSize: 12.5, color: "var(--rt-muted)", margin: "14px 0" }}>
        Each asset shows its raw value, then the value actually driving the verdict — adjusted for how concentrated it is (a true top piece is worth more than the same value spread across several lesser ones).
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20 }}>
        <TradeVerdictSideColumn teamName={myTeamName} teamNameColor={myNameColor} side={verdict.sideA} players={myPlayers} picks={myPicks} {...sideProps} />
        <TradeVerdictSideColumn teamName={theirTeamName} teamNameColor={theirNameColor} side={verdict.sideB} players={theirPlayers} picks={theirPicks} {...sideProps} />
      </div>
    </div>
  );
}

/** The aligned trade-preview table — PLAYER/POS/AGE/DYN RK/VAL RK plus every
 *  scored category, fixed column widths (`te-preview-table` + `<colgroup>`)
 *  shared with its counterpart on the other side of the trade, so the two
 *  line up exactly whether read stacked or side by side. */
function TradePreviewTable({
  title, players, scored, enrich, leaguePlayers, valueMode, statMode, positionSlots, showSalary, showContract, salaryFormat,
  surplusByFantraxId, ledgerRankByFantraxId,
}: {
  title: string; players: ResolvedPlayer[]; scored: readonly FheCategory[]; enrich: EnrichData | null;
  leaguePlayers: ResolvedPlayer[]; valueMode: TradeValueMode; statMode: "perGame" | "totals";
  positionSlots: Record<string, number>;
  /** Mirrors Roster Edge's own Salary/Contract column toggles — off by
   *  default in leagues with no salary data (salaryFormat "none"). */
  showSalary: boolean; showContract: boolean; salaryFormat: SalaryFormat;
  surplusByFantraxId?: ReadonlyMap<string, number>;
  ledgerRankByFantraxId?: ReadonlyMap<string, number>;
}) {
  if (players.length === 0) return null;
  const isCustomSalary = salaryFormat === "custom";
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6, color: "var(--rt-muted)" }}>{title.toUpperCase()}</div>
      <div className="de-table-wrap">
        <table className="de-table te-preview-table" style={{ minWidth: 640 }}>
          <colgroup>
            <col style={{ width: 170 }} />
            <col style={{ width: 60 }} />
            <col style={{ width: 50 }} />
            {showSalary && <col style={{ width: 70 }} />}
            {showContract && <col style={{ width: 80 }} />}
            <col style={{ width: 60 }} />
            <col style={{ width: 60 }} />
            {scored.map((cat) => <col key={cat} style={{ width: 56 }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="l">PLAYER</th>
              <th>POS</th>
              <th>AGE</th>
              {showSalary && <th>SAL$</th>}
              {showContract && <th>CONTRACT$</th>}
              <th>DYN RK</th>
              <th>VAL RK</th>
              {scored.map((cat) => <th key={cat}>{CATEGORY_LABEL[cat]}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="mine">
              <td className="l">Σ {players.length} — weighted {statMode === "perGame" ? "per-game" : "totals"}</td>
              <td>—</td><td>—</td>
              {showSalary && (() => {
                const salaryTotal = sumSalary(players);
                return (
                  <td title={salaryTotal.missing > 0 ? `${salaryTotal.missing} player${salaryTotal.missing === 1 ? "" : "s"} with no salary on file` : undefined} style={{ fontWeight: 700 }}>
                    {isCustomSalary ? formatCustomSalary(salaryTotal.total) : formatSalary(salaryTotal.total)}
                  </td>
                );
              })()}
              {showContract && <td>—</td>}
              <td>—</td><td>—</td>
              {scored.map((cat) => <td key={cat}>{summaryStatDisplay(players, cat, statMode)}</td>)}
            </tr>
            {players.map((p) => {
              const dynastyRank = p.fheId ? enrich?.dynastyRankByFheId[p.fheId] : null;
              const age = p.fheId ? enrich?.ageByFheId?.[p.fheId] : null;
              const contract = p.fheId ? enrich?.contractByFheId[p.fheId] : undefined;
              const valueDisplay = valueDisplayFor(p, valueMode, leaguePlayers, surplusByFantraxId, ledgerRankByFantraxId);
              const posDisplay = posDisplayFor(p.eligible, positionSlots).join("/");
              return (
                <tr key={p.fantraxId}>
                  <td className="l">
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <PlayerHeadshot name={p.name} size={22} initials={p.name.split(" ").map((w) => w[0]).slice(0, 2).join("")} background="var(--rt-surface-strong)" color="var(--rt-ink)" fontSize={9} rookie={p.isRookie} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    </div>
                  </td>
                  <td>{posDisplay || "—"}</td>
                  <td>{age != null ? age.toFixed(1) : "—"}</td>
                  {showSalary && <td>{isCustomSalary ? formatCustomSalary(p.salary) : formatSalary(p.salary)}</td>}
                  {showContract && <td>{isCustomSalary ? formatCustomContract(p.contract) : formatContract(contract)}</td>}
                  <td>{dynastyRank ?? "—"}</td>
                  <td>{valueDisplay}</td>
                  {scored.map((cat) => <td key={cat}>{playerStatDisplay(p, cat, statMode)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Power Rankings' own table, twice — once per side of a before/after
 *  comparison. Both trading teams are highlighted (not just "mine"), since
 *  this is the one Deep Edge table where a second team's row matters as
 *  much as your own. */
function PowerRankingsCompareTable({
  profiles, format, scored, myTeamId, teamBId, statMode,
}: {
  profiles: TeamCategoryProfile[]; format: RosterTableFormat; scored: readonly FheCategory[]; myTeamId: string; teamBId: string;
  /** Same "which raw-stat basis" toggle the trade preview tables above
   *  already show — reused here rather than a second toggle, so the
   *  before/after roto view always matches what the rest of the page is
   *  showing. Drives the BASIS the roto points below are computed from
   *  (Ash, 2026-08-13); the cells themselves always show points, not raw
   *  stats — roto points are the default (and here, only) display for this
   *  table, matching Power Rankings' own default (Ash, 2026-08-14). */
  statMode: "perGame" | "totals";
}) {
  const teamCount = profiles.length;
  const rowClass = (teamId: string) => (teamId === myTeamId ? "mine" : teamId === teamBId ? "partner" : "");
  const rowLabel = (teamId: string, name: string) => `${name}${teamId === myTeamId ? " · YOU" : teamId === teamBId ? " · PARTNER" : ""}`;

  if (format === "roto") {
    const rows = rotoStandingsByRawStat(profiles, scored, statMode);
    return (
      <div className="de-table-wrap">
        <table className="de-table de-table-compact">
          <colgroup>
            <col style={{ width: 36 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 52 }} />
            {scored.map((cat) => <col key={cat} style={{ width: 42 }} />)}
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th className="l">TEAM</th>
              <th>ROTO</th>
              {scored.map((cat) => <th key={cat}>{CATEGORY_LABEL[cat]}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.teamId} className={rowClass(row.teamId)}>
                <td>{row.projectedRank}</td>
                <td className="l">{rowLabel(row.teamId, row.teamName)}</td>
                <td style={{ fontWeight: 700 }}>{Math.round(row.totalPoints)}</td>
                {scored.map((cat) => (
                  <td key={cat} style={{ background: tierBg(row.ranks[cat] ?? teamCount, teamCount) }}>
                    {Math.round(row.points[cat] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const rows = format === "h2hcat" ? simulateH2HCategoryStandings(profiles, scored) : simulateH2HPointsStandings(profiles);
  const myRecord = rows.find((r) => r.teamId === myTeamId);
  return (
    <div className="de-table-wrap">
      <table className="de-table" style={{ minWidth: format === "h2hcat" ? 720 : 620 }}>
        <thead>
          <tr>
            <th>#</th>
            <th className="l">TEAM</th>
            <th>WIN %</th>
            {format === "h2hcat" ? <th>CATEGORY W-D-L</th> : <th>RECORD</th>}
            {format === "h2hcat" ? <th className="l">YOU VS TEAM</th> : <th>FPTS/GM</th>}
            <th style={{ minWidth: 100 }}>STRENGTH</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const profile = profiles.find((p) => p.teamId === row.teamId);
            const fptsPerGame = profile && profile.statTotals.gamesPlayed > 0 ? (profile.pointsTotal ?? 0) / profile.statTotals.gamesPlayed : 0;
            return (
              <tr key={row.teamId} className={rowClass(row.teamId)}>
                <td>{row.rank}</td>
                <td className="l">{rowLabel(row.teamId, row.teamName)}</td>
                <td>{(row.winPct * 100).toFixed(1)}%</td>
                {format === "h2hcat" ? (
                  <>
                    <td>{row.categoryWins}-{row.categoryDraws}-{row.categoryLosses}</td>
                    <td className="l"><YouVsTeamCells myRecord={myRecord} opponentTeamId={row.teamId} scored={scored} /></td>
                  </>
                ) : (
                  <>
                    <td>{row.totalWins}-{row.totalDraws}-{row.totalLosses}</td>
                    <td>{fptsPerGame.toFixed(1)}</td>
                  </>
                )}
                <td><StrengthBar ratio={row.winPct} color={tierFill(row.rank, rows.length)} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A light strong/weak category chip — green/red tint background, neutral
 *  ink text (same "tint carries the signal, text stays neutral" rule as the
 *  fixed NetImpactRow). */
function StrengthChip({ cat, kind }: { cat: FheCategory; kind: "strong" | "weak" }) {
  return (
    <span
      style={{
        padding: "5px 12px", borderRadius: 100, fontSize: 12.5, fontWeight: 700,
        background: kind === "strong" ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.14)",
        color: "var(--rt-ink)",
      }}
    >
      {CATEGORY_LABEL[cat]}
    </span>
  );
}

/** Ash, 2026-08-13: upfront category strengths/weaknesses (≤3 each) plus up
 *  to 3 suggested trade partners whose profile complements this team's own
 *  — rendered before any partner is picked, so it's the FIRST thing read on
 *  the page rather than something surfaced only after building a trade.
 *  Points-mode leagues have no category dimension to read strengths/
 *  weaknesses/partner-fit from, so `showCategoryInsights` skips just that
 *  sub-block for them — the panel itself still always renders, since it's
 *  also the Trade partner picker's home now (Ash, 2026-08-23: "move the
 *  trade partner drop down selector to sit next to the 3 suggested trade
 *  partners"), and every league needs that regardless of scoring mode.
 *  "Rank players by" moved down here too, next to strong/weak (Ash,
 *  2026-08-23), since it's a per-roster READ, not a league-wide setting like
 *  the three above it in TRADE VALUATION SETTINGS. */
function TeamInsightPanel({
  strengthsWeaknesses, partners, onPickPartner, showCategoryInsights,
  rosterOptions, teamBId, onTeamBChange, valueMode, onValueModeChange, isPointsLeague,
}: {
  strengthsWeaknesses: { strong: CategoryEdge[]; weak: CategoryEdge[] };
  partners: TradePartnerSuggestion[];
  onPickPartner: (teamId: string) => void;
  showCategoryInsights: boolean;
  rosterOptions: { teamId: string; teamName: string }[];
  teamBId: string | null;
  onTeamBChange: (teamId: string | null) => void;
  valueMode: TradeValueMode;
  onValueModeChange: (v: TradeValueMode) => void;
  isPointsLeague: boolean;
}) {
  const { strong, weak } = strengthsWeaknesses;
  const hasInsights = showCategoryInsights && (strong.length > 0 || weak.length > 0);
  return (
    <div style={{ padding: 16, borderRadius: 14, border: "1px solid var(--rt-hairline)", marginBottom: 24 }}>
      {hasInsights && (
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--rt-muted)", marginBottom: 6 }}>Your team is strong in</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {strong.length > 0 ? strong.map((e) => <StrengthChip key={e.category} cat={e.category} kind="strong" />) : <span style={{ fontSize: 12.5, color: "var(--rt-muted)" }}>—</span>}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--rt-muted)", marginBottom: 6 }}>Your team is weak in</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {weak.length > 0 ? weak.map((e) => <StrengthChip key={e.category} cat={e.category} kind="weak" />) : <span style={{ fontSize: 12.5, color: "var(--rt-muted)" }}>—</span>}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--rt-muted)", marginBottom: 6 }}>Rank players by</div>
            {/* Display/sort order only (2026-08-23) — trade math never reads
                this. "Trade Value" (surplusV) always reflects
                baseValueByFantraxId, whatever the league-settings cascade
                produced for it, so it's always a meaningful sort now — not
                gated to dynasty leagues with salary data like the old
                Surplus $ figure was. */}
            <SegmentedControl<TradeValueMode>
              options={VALUE_MODE_OPTIONS}
              value={valueMode}
              onChange={onValueModeChange}
              disabledOptions={isPointsLeague ? [] : (["fpts"] as TradeValueMode[])}
            />
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-end" }}>
        {partners.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: "var(--rt-muted)", marginBottom: 8 }}>Suggested trade partners — complementary category fit</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {partners.map((p) => (
                <button
                  key={p.teamId}
                  type="button"
                  onClick={() => onPickPartner(p.teamId)}
                  style={{
                    textAlign: "left", padding: "10px 14px", borderRadius: 12, border: "1px solid var(--rt-hairline)",
                    background: "var(--rt-surface-soft)", cursor: "pointer", minWidth: 200, color: "var(--rt-ink)",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{p.teamName}</div>
                  {p.theyHelpMe.length > 0 && (
                    <div style={{ fontSize: 11.5, color: "var(--rt-muted)" }}>Strong in {p.theyHelpMe.map((c) => CATEGORY_LABEL[c]).join(", ")}</div>
                  )}
                  {p.iHelpThem.length > 0 && (
                    <div style={{ fontSize: 11.5, color: "var(--rt-muted)" }}>Needs {p.iHelpThem.map((c) => CATEGORY_LABEL[c]).join(", ")}</div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <label style={{ fontSize: 12, color: "var(--rt-muted)", display: "block", marginBottom: 6 }}>Trade partner</label>
          <select
            value={teamBId ?? ""}
            onChange={(e) => onTeamBChange(e.target.value || null)}
            style={{
              height: 38, padding: "0 12px", borderRadius: 10, border: "1px solid var(--rt-hairline)",
              background: "var(--rt-surface-soft)", color: "var(--rt-ink)", fontSize: 13, fontWeight: 600, minWidth: 220,
            }}
          >
            <option value="">Choose a team…</option>
            {rosterOptions.map((r) => (
              <option key={r.teamId} value={r.teamId}>{r.teamName}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function TradeEdgeContent() {
  const { saved, loading: loadingSaved } = useActiveLeague();
  const [analysis, setAnalysis] = useState<LeagueAnalysis | null>(null);
  const [enrich, setEnrich] = useState<EnrichData | null>(null);
  const [error, setError] = useState("");
  const [depth, setDepth] = useState(0);
  const [valueMode, setValueMode] = useState<TradeValueMode>("nineCatV");
  const [targetCats, setTargetCats] = useState<Set<FheCategory>>(new Set());
  const [teamBId, setTeamBId] = useState<string | null>(null);
  const [sendIds, setSendIds] = useState<Set<string>>(new Set());
  const [receiveIds, setReceiveIds] = useState<Set<string>>(new Set());
  // Draft picks selected on each side of the trade — keyed by the same
  // `${year}-${round}-${i}` string DraftPickCardsGrid already generates for
  // its own React keys, storing the pick object alongside it since the key
  // alone can't be turned back into a pick without duplicating that grid's
  // own year/round grouping (see DraftPickCardsGrid's onTogglePick doc).
  const [sendPickIds, setSendPickIds] = useState<Map<string, TeamDraftPick>>(new Map());
  const [receivePickIds, setReceivePickIds] = useState<Map<string, TeamDraftPick>>(new Map());
  const [statMode, setStatMode] = useState<"perGame" | "totals">("perGame");
  const [activePanel, setActivePanel] = useState<"none" | "rankings">("none");
  const [cols, setCols] = useState<{ salary: boolean; contract: boolean }>({ salary: false, contract: false });
  // Redraft's own base-value choice — a genuine valuation lens, not a
  // cosmetic sort (see trade-value.ts module doc's Redraft branch). Only
  // surfaced in the UI for leagueType "redraft"; a keeper league's redraft-
  // shaped blend component uses whatever this is set to as well.
  const [redraftBaseMode, setRedraftBaseMode] = useState<RedraftBaseMode>("native");
  // Site-wide population sizes the real-salary rank / dynasty consensus rank
  // were each computed within — NOT this league's own poolSize. See
  // trade-value.ts's module doc and roster-edge.ts's getSalaryRankByFheId/
  // getConsensusPoolSize doc comments for why these can't be conflated.
  const [realSalaryPoolSize, setRealSalaryPoolSize] = useState<number | null>(null);
  const [consensusPoolSize, setConsensusPoolSize] = useState<number | null>(null);
  // This league's own cached custom-valuations ledger (custom-valuations.ts,
  // built at /deep-edge/home/trade-edge/asset-values) — read-only here, never
  // recomputed on page load, same GET contract that page uses. Only fetched
  // when the league has opted in; still null otherwise.
  const [customLedger, setCustomLedger] = useState<CustomValuationsDoc | null>(null);

  useEffect(() => {
    if (!saved) return;
    const params = new URLSearchParams({
      leagueId: saved.leagueId,
      dataset: saved.settings.defaultDataset ?? "2027:projection",
      leagueType: saved.settings.leagueType ?? "redraft",
    });
    if (saved.teamId) params.set("teamId", saved.teamId);
    fetch(`/api/fantrax/roster-edge?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return; }
        const {
          salaryRankByFheId, contractByFheId, dynastyRankByFheId, ageByFheId, sophomoreByFheId,
          realSalaryPoolSize: rsPoolSize, consensusPoolSize: cPoolSize, ...rest
        } = data;
        setAnalysis(rest as LeagueAnalysis);
        setEnrich({ salaryRankByFheId, contractByFheId, dynastyRankByFheId, ageByFheId, sophomoreByFheId });
        setRealSalaryPoolSize(rsPoolSize ?? null);
        setConsensusPoolSize(cPoolSize ?? null);
      })
      .catch((err) => setError(String(err)));
  }, [saved]);

  useEffect(() => {
    // Fetched whenever EITHER opt-in is on — full custom valuations, or the
    // standard-league "generate draft pick values" flow (Ash, 2026-08-25).
    // Which one the fetched doc actually IS (doc.mode) still gates what it's
    // allowed to feed below — see baseValueByFantraxId's own doc.
    if (!saved?.settings.useCustomValuations && !saved?.settings.useGeneratedPickValues) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting derived state when the league/toggle this effect depends on changes, not a plain render-time computation (same pattern as this file's own teamBId resetKey guard above)
      setCustomLedger(null);
      return;
    }
    fetch(`/api/fantrax/custom-valuations?leagueId=${encodeURIComponent(saved.leagueId)}`)
      .then((r) => r.json())
      .then((d) => setCustomLedger(d.doc ?? null))
      .catch(() => setCustomLedger(null));
  }, [saved?.leagueId, saved?.settings.useCustomValuations, saved?.settings.useGeneratedPickValues]);

  const derivedFormat = useMemo(() => {
    if (!analysis || !saved) return null;
    return deriveRankingsFormat(analysis, {
      format: saved.settings.format ?? DEFAULT_LEAGUE_TAGS.format,
      formatConfirmed: saved.settings.formatConfirmed,
    });
  }, [analysis, saved]);

  // Trade valuation settings (league type / value basis / scoring format)
  // are LOCKED to the connected league's real settings (Ash, 2026-08-23:
  // "lock in the trade value settings - they can only be changed if user
  // clicks through to the league settings") — no in-page override anymore,
  // so these read straight off derivedFormat/derivedLeagueType/
  // derivedValueBasis below with no local state to reset on a league switch.
  const format = derivedFormat;

  // Salary/Contract column defaults — same "on for salary-format leagues,
  // off otherwise, user-overridable from there" convention as Roster Edge's
  // own Columns picker, reset once per league switch rather than every render.
  const [colsDefaultsFor, setColsDefaultsFor] = useState<string | null>(null);
  const salaryFormat: SalaryFormat = saved?.settings.salaryFormat ?? DEFAULT_LEAGUE_TAGS.salaryFormat;
  if (saved && colsDefaultsFor !== saved.leagueId) {
    setColsDefaultsFor(saved.leagueId);
    const on = salaryFormat !== "none";
    setCols({ salary: on, contract: on });
  }
  const showSalary = cols.salary && salaryFormat !== "none";
  const showContract = cols.contract && salaryFormat !== "none";

  // League type / value basis — locked to the real league settings, same as
  // format above. Value basis only means anything for dynasty leagues
  // (item 2 of the redesign spec: "dynasty: standard, real salary or custom
  // salary"), so it's forced to "standard" outside dynasty.
  const leagueType: LeagueType = saved?.settings.leagueType ?? DEFAULT_LEAGUE_TAGS.leagueType;
  const isDynasty = leagueType === "dynasty";
  const valueBasis: "standard" | "real" | "custom" =
    isDynasty ? (salaryFormat === "real" ? "real" : salaryFormat === "custom" ? "custom" : "standard") : "standard";

  // Trade preview's default per-game/totals basis follows the league's
  // format — totals is the more representative read for roto (roto
  // standings are literally built from each team's combined stat totals, and
  // switching bases can swing the Power Rankings compare panel dramatically,
  // Ash 2026-08-14), per-game stays the default everywhere else. Runs once
  // per format value via the same "adjust state during render" pattern used
  // for teamBId below — the toggle stays fully user-overridable afterward.
  const [statModeDefaultFor, setStatModeDefaultFor] = useState<string | null>(null);
  if (format && format !== "unconfirmed" && statModeDefaultFor !== format) {
    setStatModeDefaultFor(format);
    setStatMode(format === "roto" ? "totals" : "perGame");
  }

  const effective = useMemo(
    () => (analysis && saved ? resolveEffectiveScoring(analysis.league, saved.settings) : null),
    [analysis, saved],
  );

  const myTeamId = analysis?.myTeamId ?? null;
  const isPointsLeague = analysis?.league.scoringMode === "points";
  const rowFormat: RosterTableFormat = format === "points" ? "points" : format === "h2hcat" ? "h2hcat" : "roto";
  // What lineup CONSTRUCTION falls back to when valueMode is "surplusV" —
  // the same category mode the league would otherwise default to (and the
  // production input the base-value cascade's own Efficiency term uses for
  // custom-salary dynasty leagues). See lineupModeFor/trade-value.ts.
  const categoryFallbackMode: Exclude<TradeValueMode, "surplusV"> = isPointsLeague ? "fpts" : ((effective?.scored.length ?? 9) === 8 ? "eightCatV" : "nineCatV");
  // The trade-preview table's second rank column — Ash, 2026-08-23: "Minus1
  // rank (for 9cat leagues), 8Cat rank for for 8cat leagues, FPTS rank for
  // points leagues." Deliberately Minus1V, not nineCatV, for a 9-cat league
  // (unlike categoryFallbackMode above, which is a different concern — what
  // lineup construction falls back to).
  const secondRankMode: Exclude<TradeValueMode, "surplusV"> = isPointsLeague ? "fpts" : ((effective?.scored.length ?? 9) === 8 ? "eightCatV" : "minus1V");
  const secondRankLabel = isPointsLeague ? "FPTS RK" : ((effective?.scored.length ?? 9) === 8 ? "8CAT RK" : "MINUS1V RK");

  // "Rank players by" is purely a card DISPLAY/sort order now (2026-08-23) —
  // trade math always reads from baseValueByFantraxId below, never from this
  // state. Default display order mirrors base value ("surplusV" — labeled
  // "Trade Value", see TRADE_VALUE_MODE_LABEL) so the cards' natural order
  // matches what the Trade Verdict panel actually used; a user can freely
  // re-sort by a production stat instead from there. Same
  // recompute-then-stay-overridable pattern as statModeDefaultFor above
  // (Ash, 2026-08-14 precedent).
  const [valueModeDefaultFor, setValueModeDefaultFor] = useState<string | null>(null);
  const valueModeDefaultKey = format && format !== "unconfirmed" ? "surplusV" : null;
  if (valueModeDefaultKey && valueModeDefaultFor !== valueModeDefaultKey) {
    setValueModeDefaultFor(valueModeDefaultKey);
    setValueMode("surplusV");
  }

  const totalRosterSlots = useMemo(
    () => Object.values(effective?.positionSlots ?? {}).reduce((sum, n) => sum + n, 0),
    [effective],
  );

  const lineupCadence = saved?.settings.lineupCadence ?? DEFAULT_GAMES_CAP_SETTINGS.lineupCadence;
  const capPos = saved?.settings.capPos ?? DEFAULT_GAMES_CAP_SETTINGS.capPos;
  const capPosN = saved?.settings.capPosN ?? DEFAULT_GAMES_CAP_SETTINGS.capPosN;
  const capMatch = saved?.settings.capMatch ?? DEFAULT_GAMES_CAP_SETTINGS.capMatch;
  const capMatchN = saved?.settings.capMatchN ?? DEFAULT_GAMES_CAP_SETTINGS.capMatchN;
  const weight = useMemo(
    () => (format && format !== "unconfirmed" ? depthWeight(lineupCadence, format, capPos, capMatch) : 1),
    [lineupCadence, format, capPos, capMatch],
  );

  // Whole-league profiles at the currently-assessed depth, independent of
  // any trade partner — powers the upfront strengths/weaknesses summary and
  // suggested-partner cards below, which need to exist BEFORE a partner is
  // picked (that's the point of "upfront"). exactTeamId keeps only my own
  // lineup exact, same convention as Power Rankings/Roster Edge.
  const leagueProfiles = useMemo(() => {
    if (!analysis || !effective || !myTeamId) return null;
    return buildDepthWeightedProfiles(analysis, depth, weight, { ...effective, exactTeamId: myTeamId });
  }, [analysis, effective, myTeamId, depth, weight]);
  const leagueStandings = useMemo(
    () => (leagueProfiles && effective ? projectRotoStandings(leagueProfiles, effective.scored) : null),
    [leagueProfiles, effective],
  );
  const myEdges = useMemo(
    () => (leagueProfiles && leagueStandings && myTeamId && effective ? categoryEdges(myTeamId, leagueProfiles, leagueStandings, effective.scored) : []),
    [leagueProfiles, leagueStandings, myTeamId, effective],
  );
  const myStrengthsWeaknesses = useMemo(
    () => teamStrengthsWeaknesses(myEdges, analysis?.league.teamCount ?? 0),
    [myEdges, analysis],
  );
  const partnerSuggestions = useMemo(() => {
    if (!leagueProfiles || !leagueStandings || !myTeamId || !effective) return [];
    return suggestTradePartners(myTeamId, leagueProfiles, leagueStandings, effective.scored);
  }, [leagueProfiles, leagueStandings, myTeamId, effective]);

  // Selections + the revealed comparison panel reset on a partner switch — a
  // ticked fantraxId from a different team's roster would otherwise
  // silently survive and get traded from the wrong roster.
  const [resetKey, setResetKey] = useState<string | null>(null);
  if (teamBId !== resetKey) {
    setResetKey(teamBId);
    setSendIds(new Set());
    setReceiveIds(new Set());
    setSendPickIds(new Map());
    setReceivePickIds(new Map());
    setActivePanel("none");
  }

  const myRoster = useMemo(() => analysis?.rosters.find((r) => r.teamId === myTeamId) ?? null, [analysis, myTeamId]);
  const theirRoster = useMemo(() => analysis?.rosters.find((r) => r.teamId === teamBId) ?? null, [analysis, teamBId]);
  const leaguePlayers = useMemo(() => analysis?.rosters.flatMap((r) => r.players) ?? [], [analysis]);
  // Every asset's TRADE value — see trade-value.ts's module doc for the five
  // branches (redraft/standard-dynasty/real-salary-dynasty/custom-salary-
  // dynasty/keeper-blend). Computed for the WHOLE connected league (every
  // team), the same pool VAL RK/DYN RK already rank within, never just the
  // two trading rosters. Threaded through the rest of this page as the
  // "surplusV" mode's backing map — that tag now means "read from this
  // cascade-determined map" for every league type, not just a dynasty
  // surplus figure (see TRADE_VALUE_MODE_LABEL's "Trade Value" rename).
  const realSalaryRankMap = useMemo(
    () => (enrich?.salaryRankByFheId ? new Map(Object.entries(enrich.salaryRankByFheId)) : undefined),
    [enrich],
  );
  const defaultBaseValueByFantraxId = useMemo(() => {
    if (!analysis || leaguePlayers.length === 0 || consensusPoolSize == null) return new Map<string, number>();
    return computeBaseTradeValues({
      players: leaguePlayers,
      leagueType,
      valueBasis,
      categoryFallbackMode,
      redraftBaseMode,
      leaguePoolSize: analysis.league.poolSize,
      consensusPoolSize,
      realSalaryRankByFheId: realSalaryRankMap,
      realSalaryPoolSize: realSalaryPoolSize ?? undefined,
      keeperPolicy: saved?.settings.keeperPolicy,
      totalRosterSlots,
      contractRules: saved?.settings.contractRules,
      currentSeason: Number(saved?.settings.defaultDataset?.split(":")[0]) || new Date().getFullYear(),
    });
  }, [
    analysis, leaguePlayers, leagueType, valueBasis, categoryFallbackMode, redraftBaseMode,
    consensusPoolSize, realSalaryRankMap, realSalaryPoolSize, saved, totalRosterSlots,
  ]);
  // When this league has opted into custom valuations (Settings' toggle, set
  // from the asset-values page's Regenerate flow), the cached ledger's own
  // player values become the REAL base value — not just a display mode (Ash,
  // 2026-08-23: "if yes... produce that as the new base value"). Overlaid on
  // top of the default cascade rather than replacing it outright: the ledger
  // only carries a fantraxId for players it actually resolved (rostered +
  // free agents it could match against the identity registry), so any player
  // it missed still falls back to the always-complete default map instead of
  // silently reading as valueless. Picks are handled separately below
  // (ledgerRankByPickKey) — a pick has no fantraxId, so it can't join
  // through this map at all; the live trade-verdict panel's own pick math
  // (pickEquivalentValue) still reads off whichever player map this is, so
  // a custom pick's verdict contribution inherits the custom PLAYER floor
  // even though its own displayed rank comes from the ledger directly.
  const baseValueByFantraxId = useMemo(() => {
    // A picksOnly doc (the standard-league "generate draft pick values"
    // flow) carries no player/FA rows at all — every row is type "pick"
    // with fantraxId null — so this loop is naturally a no-op for one. The
    // mode check is still explicit rather than implicit: never let a
    // picks-only generation silently start overriding player base values
    // just because a future picksOnly doc happened to carry a fantraxId.
    if (!customLedger || customLedger.mode === "picksOnly") return defaultBaseValueByFantraxId;
    const merged = new Map(defaultBaseValueByFantraxId);
    for (const row of customLedger.rows) {
      if (row.fantraxId) merged.set(row.fantraxId, row.tradeValue);
    }
    return merged;
  }, [defaultBaseValueByFantraxId, customLedger]);
  // A CURRENT-year pick's real rank in the ledger's own full asset pool —
  // see DraftPickCardsGrid's ledgerRankByPickKey doc for why this fixed a
  // real bug (card and ledger showing two different ranks for the same
  // pick). Only current-year rows carry a pickKey (custom-valuations.ts
  // only prices a future pick as a generic per-round bracket, not a real
  // per-pick number), so this map is naturally empty for every future pick.
  const ledgerRankByPickKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of customLedger?.rows ?? []) {
      if (row.pickKey && row.tradeRank != null) map.set(row.pickKey, row.tradeRank);
    }
    return map;
  }, [customLedger]);
  // A player's real rank in the ledger's own full asset pool — the same
  // card/ledger-divergence bug as ledgerRankByPickKey above, but for
  // players: tradeValueRankFor previously always recomputed rank via
  // rankAmong(leaguePlayers, …), which only ranks within the two trading
  // rosters (a handful of teams), not the ledger's own ~552-asset pool
  // (30 teams' rosters + FAs + picks) — so a player's card rank silently
  // drifted from the asset-values page's own RANK column for the same
  // player (Ash, 2026-08-23: Buffalo Braves' cards read #30/#87/#129 for
  // players the ledger itself ranks #36/#104/#159). Read directly off
  // this map first, same priority as ledgerRankByPickKey.
  const ledgerRankByFantraxId = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of customLedger?.rows ?? []) {
      if (row.fantraxId && row.tradeRank != null) map.set(row.fantraxId, row.tradeRank);
    }
    return map;
  }, [customLedger]);
  // Every CURRENT-year pick's own real custom-computed VALUE, reindexed by
  // its bare overall-pick number — the real curve a projected FUTURE pick
  // samples from (pickTradeValueRank's tier 2) instead of the generic
  // ratio-model estimate, which was found to diverge wildly from it (Ash,
  // 2026-08-23: a real pick #44 the ledger ranks #357 read as rank #177 —
  // nearly twice as valuable — once carried through the generic model).
  const currentYearPickValueByOverallPick = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of customLedger?.rows ?? []) {
      if (!row.pickKey) continue;
      const overallPick = Number(row.pickKey.split(":")[1]);
      if (Number.isFinite(overallPick)) map.set(overallPick, row.tradeValue);
    }
    return map;
  }, [customLedger]);
  // Every ledger row's own tradeValue — the SAME pool custom-valuations.ts
  // itself ranks a row within (see roster-table.tsx's rankAmongValues doc
  // for why a decayed future-pick value has to rank against THIS, not
  // leaguePlayers, to stay monotonic with the ledger's own numbers).
  const ledgerValues = useMemo(() => (customLedger?.rows ?? []).map((r) => r.tradeValue), [customLedger]);
  // Draft-pick assets live on the raw league snapshot, not the resolved-player
  // rosters above — see LeagueRoster.draftPicks. Gate the whole grid on
  // whether ANY team has pick data — same reasoning as Roster Edge's own
  // hasAnyDraftPicks (a redraft league shouldn't show an all-empty grid).
  const draftPicksByTeamId = useMemo(
    () => new Map(analysis?.league.rosters.map((r) => [r.teamId, r.draftPicks]) ?? []),
    [analysis],
  );
  const hasAnyDraftPicks = useMemo(
    () => analysis?.league.rosters.some((r) => r.draftPicks.length > 0) ?? false,
    [analysis],
  );
  // Every year for which SOME team in the league owns at least one pick —
  // the league-wide signal DraftPickCardsGrid needs to tell "this team
  // traded its pick away" (a real, meaningful empty year) apart from "the
  // league hasn't introduced pick trading this far out yet" (no card at
  // all — Ash, 2026-08-23).
  const yearsWithLeagueData = useMemo(
    () => new Set(analysis?.league.rosters.flatMap((r) => r.draftPicks.map((p) => p.year)) ?? []),
    [analysis],
  );
  const draftStatus = useMemo(() => currentSeasonDraftStatus(analysis?.league.draft ?? null), [analysis]);

  const targetCatsArr = useMemo(() => [...targetCats], [targetCats]);
  const myPlayersSorted = useMemo(
    () => (myRoster ? sortForCards(myRoster.players, valueMode, targetCatsArr, baseValueByFantraxId) : []),
    [myRoster, valueMode, targetCatsArr, baseValueByFantraxId],
  );
  const theirPlayersSorted = useMemo(
    () => (theirRoster ? sortForCards(theirRoster.players, valueMode, targetCatsArr, baseValueByFantraxId) : []),
    [theirRoster, valueMode, targetCatsArr, baseValueByFantraxId],
  );

  // Before/after profiles are only ever read by the Power Rankings compare
  // panel below (PowerRankingsCompareTable), gated on activePanel — but
  // tradeProfiles() still solves 30 teams' greedy lineups
  // TWICE plus up to 4 branch-and-bound exact solves (the two trading teams,
  // before and after) to produce it. Without the activePanel check, every
  // single send/receive checkbox click paid that cost even with both compare
  // panels closed — the common case while someone is still trying combos
  // before ever revealing a comparison.
  const trade = useMemo(() => {
    if (!analysis || !effective || !myTeamId || !teamBId || activePanel === "none") return null;
    return tradeProfiles(analysis, myTeamId, teamBId, sendIds, receiveIds, depth, weight, valueMode, effective);
  }, [analysis, effective, myTeamId, teamBId, sendIds, receiveIds, depth, weight, valueMode, activePanel]);

  // Every team's projected rank AFTER this trade (Ash, 2026-08-23: "use the
  // AFTER power rankings to asses where the 2027-28 picks could land") —
  // reads trade.after directly rather than running its own simulation, so
  // this never pays tradeProfiles' own real cost (30-team lineup solves +
  // branch-and-bound for the two trading teams — see trade's own doc above)
  // a second time; it's simply unavailable (empty map, withProjectedSlot
  // falls back to the flat generic estimate) until the user has actually
  // opened the Power Rankings or Category Edge compare panel once.
  const postTradeRankByTeamId = useMemo(() => {
    const map = new Map<string, number>();
    if (!trade?.after || !effective) return map;
    if (rowFormat === "roto") {
      for (const row of projectRotoStandings(trade.after, effective.scored)) map.set(row.teamId, row.projectedRank);
    } else if (rowFormat === "h2hcat") {
      for (const row of simulateH2HCategoryStandings(trade.after, effective.scored)) map.set(row.teamId, row.rank);
    } else {
      for (const row of simulateH2HPointsStandings(trade.after)) map.set(row.teamId, row.rank);
    }
    return map;
  }, [trade, effective, rowFormat]);
  const teamIdByName = useMemo(
    () => new Map((analysis?.league.teams ?? []).map((t) => [t.name, t.id])),
    [analysis],
  );

  const hasTradeSelected = sendIds.size > 0 || receiveIds.size > 0 || sendPickIds.size > 0 || receivePickIds.size > 0;

  const sendPlayers = useMemo(() => myRoster?.players.filter((p) => sendIds.has(p.fantraxId)) ?? [], [myRoster, sendIds]);
  const receivePlayers = useMemo(() => theirRoster?.players.filter((p) => receiveIds.has(p.fantraxId)) ?? [], [theirRoster, receiveIds]);
  // My own team's combined roster salary, before this trade and after it —
  // cheap (a plain sum over already-loaded rosters, no lineup solving), so
  // this feeds the Trade Verdict's "Team Salary" tile immediately rather
  // than waiting on the Power Rankings compare panel the way Power
  // Rank/Avg FPTS do (Ash, 2026-08-23: "combined player Salary... before and
  // after"). Null in a league that doesn't play with salaries.
  const salaryBefore = useMemo(
    () => (salaryFormat !== "none" && myRoster ? sumSalary(myRoster.players).total : null),
    [salaryFormat, myRoster],
  );
  const salaryAfter = useMemo(
    () => (salaryBefore != null ? salaryBefore - sumSalary(sendPlayers).total + sumSalary(receivePlayers).total : null),
    [salaryBefore, sendPlayers, receivePlayers],
  );
  const seasonYear = analysis?.league.seasonYear ?? new Date().getFullYear();
  const teamCount = analysis?.league.teamCount ?? 30;
  const sendPicks = useMemo(
    () => [...sendPickIds.values()].map((p) => (myTeamId ? withProjectedSlot(p, myTeamId, seasonYear, teamCount, teamIdByName, postTradeRankByTeamId) : p)),
    [sendPickIds, myTeamId, seasonYear, teamCount, teamIdByName, postTradeRankByTeamId],
  );
  const receivePicks = useMemo(
    () => [...receivePickIds.values()].map((p) => (teamBId ? withProjectedSlot(p, teamBId, seasonYear, teamCount, teamIdByName, postTradeRankByTeamId) : p)),
    [receivePickIds, teamBId, seasonYear, teamCount, teamIdByName, postTradeRankByTeamId],
  );

  // Cheap relative to tradeProfiles (no 30-team lineup solve) — computed
  // eagerly on every selection change rather than gated behind activePanel.
  // sideA is what MY team ends up receiving, sideB what the partner ends up
  // receiving (i.e. what I'm sending) — see TradeVerdictPanel's own doc for
  // why that mapping, not the reverse, is what reads naturally on screen.
  const tradeVerdict = useMemo(() => {
    if (!myTeamId || !teamBId || !hasTradeSelected) return null;
    const myTeamGets = [
      ...receivePlayers.map((p) => ({ label: p.name, player: p })),
      ...receivePicks.map((pk) => ({ label: pickLabel(pk), pick: pk })),
    ];
    const theirTeamGets = [
      ...sendPlayers.map((p) => ({ label: p.name, player: p })),
      ...sendPicks.map((pk) => ({ label: pickLabel(pk), pick: pk })),
    ];
    const family = isPointsLeague ? "points" : "categories";
    return computeTradeVerdict(myTeamGets, theirTeamGets, leaguePlayers, baseValueByFantraxId, family);
  }, [myTeamId, teamBId, hasTradeSelected, sendPlayers, sendPicks, receivePlayers, receivePicks, leaguePlayers, baseValueByFantraxId, isPointsLeague]);

  const hasLeague = Boolean(saved);

  return (
    <HubShell hasLeague={hasLeague} breadcrumb={saved ? `${saved.leagueName} · Trade Edge` : "Trade Edge"}>
      <style>{DEEP_EDGE_TABLE_CSS + COMPARE_TABLE_CSS}</style>
      <Link href="/deep-edge/home" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--rt-muted)", fontSize: 13, textDecoration: "none", marginBottom: 16 }}>
        <IconChevronLeft size={14} /> Back to {saved?.leagueName ?? "home"}
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Trade Edge</h1>
        {format && format !== "unconfirmed" && (
          <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 10.5, padding: "4px 9px", borderRadius: 100, background: "var(--rt-surface-strong)", color: "var(--rt-muted)" }}>
            {isPointsLeague ? "POINTS" : `${effective?.scored.length ?? 9}-CAT`}
          </span>
        )}
      </div>

      {loadingSaved || (saved && !analysis && !error) ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>Loading…</p>
      ) : error ? (
        <p style={{ color: "var(--rt-down)", fontSize: 13.5 }}>{error}</p>
      ) : !saved || !analysis ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>No league connected yet.</p>
      ) : format === "unconfirmed" ? (
        <div style={{ maxWidth: 480 }}>
          <FormatConfirmPrompt
            onConfirm={(v) => {
              fetch("/api/fantrax/saved", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  leagueId: saved.leagueId, leagueName: saved.leagueName, teamId: saved.teamId, teamName: saved.teamName,
                  settings: { ...saved.settings, format: v, formatConfirmed: true },
                }),
              }).then(() => window.location.reload());
            }}
          />
        </div>
      ) : !myTeamId || !myRoster ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>
          This league doesn&apos;t have your team selected — pick your team from Settings first.
        </p>
      ) : (
        <>
          <p style={{ color: "var(--rt-body)", fontSize: 14, margin: "0 0 20px", maxWidth: 680 }}>
            Set how deep to assess each roster and how to rank players, pick a trade partner, tick who moves each way,
            then launch Power Rankings to see the real before/after side by side.
          </p>

          <div style={{ padding: 18, borderRadius: 16, border: "1px solid var(--rt-hairline)", marginBottom: 24, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--rt-muted)" }}>TRADE VALUATION SETTINGS</div>
              {saved && (
                <Link
                  href={`/deep-edge/home/settings?league=${encodeURIComponent(saved.leagueId)}`}
                  style={{ fontSize: 11.5, fontWeight: 600, color: "var(--rt-muted)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  🔒 Locked · adjust in league settings →
                </Link>
              )}
            </div>

            {/* Every control group sits side by side (wrapping only when the
                viewport is too narrow) rather than one-per-row — Ash,
                2026-08-23: "make those sit side by side as to not waste
                space on the webpage." League type / Value basis / Scoring
                format are LOCKED to the connected league's real settings
                (Ash, 2026-08-23: "lock in the trade value settings - they
                can only be changed if user clicks through to the league
                settings") — every option disabled, not just the inactive
                ones, so the only way to change what's actually selected is
                the "Adjust in league settings" link above. "Evaluate assets
                by" and "Rank players by" (moved below, next to strong/weak)
                stay interactive — both are page-local display choices, never
                a real league setting (see their own docs). */}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "16px 28px" }}>
              <div>
                <div style={{ fontSize: 12.5, color: "var(--rt-muted)", marginBottom: 6 }}>League type</div>
                <SegmentedControl<LeagueType>
                  options={[{ value: "redraft", label: "Redraft" }, { value: "keeper", label: "Keeper" }, { value: "dynasty", label: "Dynasty" }]}
                  value={leagueType}
                  onChange={() => {}}
                  disabledOptions={["redraft", "keeper", "dynasty"]}
                />
              </div>

              {isDynasty && (
                <div>
                  <div style={{ fontSize: 12.5, color: "var(--rt-muted)", marginBottom: 6 }}>Value basis</div>
                  <SegmentedControl<"standard" | "real" | "custom">
                    options={[{ value: "standard", label: "Standard" }, { value: "real", label: "Real salary" }, { value: "custom", label: "Custom salary" }]}
                    value={valueBasis}
                    onChange={() => {}}
                    disabledOptions={["standard", "real", "custom"]}
                  />
                </div>
              )}

              {leagueType === "redraft" && (
                <div>
                  <div style={{ fontSize: 12.5, color: "var(--rt-muted)", marginBottom: 6 }}>Evaluate assets by</div>
                  <SegmentedControl<RedraftBaseMode>
                    options={[{ value: "native", label: TRADE_VALUE_MODE_LABEL[categoryFallbackMode] }, { value: "minus1V", label: "Minus1V" }]}
                    value={redraftBaseMode}
                    onChange={setRedraftBaseMode}
                  />
                </div>
              )}

              <div>
                <div style={{ fontSize: 12.5, color: "var(--rt-muted)", marginBottom: 6 }}>Scoring format</div>
                <SegmentedControl<RankingsFormat>
                  options={[{ value: "roto", label: "CAT ROTO" }, { value: "h2hcat", label: "CAT H2H" }, { value: "points", label: "POINTS" }]}
                  value={format ?? "roto"}
                  onChange={() => {}}
                  disabledOptions={["roto", "h2hcat", "points"]}
                />
              </div>
            </div>

            {/* Descriptive (non-control) lines get their own compact wrapped
                row rather than a full-width line each. */}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 24px", fontSize: 12, color: "var(--rt-muted)" }}>
              {isDynasty && saved && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {saved.settings.useCustomValuations
                    ? customLedger
                      ? "Reading base value from this league's own custom asset ledger."
                      : "Custom valuations are on for this league, but nothing's been generated yet."
                    : saved.settings.useGeneratedPickValues
                      ? customLedger
                        ? "Draft picks priced from this league's own generated pick values; players stay on standard values."
                        : "Draft pick values are on for this league, but nothing's been generated yet."
                      : "Value your league's own assets — real dynasty rank per pick, house contract rules."}
                  <Link
                    href={`/deep-edge/home/trade-edge/asset-values?league=${encodeURIComponent(saved.leagueId)}`}
                    style={{ fontWeight: 600, color: "var(--rt-primary)", textDecoration: "none" }}
                  >
                    {saved.settings.useCustomValuations ? "View / regenerate →" : "Customize asset values →"}
                  </Link>
                </span>
              )}
              {analysis && (
                <span>
                  {analysis.league.poolClamped ? (
                    <>
                      {analysis.league.poolSize}-player pool (capped from this league&apos;s real {analysis.league.teamCount * totalRosterSlots} rostered
                      slots — {analysis.league.teamCount} teams × {totalRosterSlots}-man roster — the largest pool size the value engine models)
                    </>
                  ) : (
                    <>{analysis.league.poolSize}-player pool ({analysis.league.teamCount} teams × {totalRosterSlots}-man roster)</>
                  )}
                </span>
              )}
            </div>
          </div>

          <TeamInsightPanel
            strengthsWeaknesses={myStrengthsWeaknesses}
            partners={partnerSuggestions}
            onPickPartner={setTeamBId}
            showCategoryInsights={!isPointsLeague}
            rosterOptions={analysis.rosters.filter((r) => r.teamId !== myTeamId)}
            teamBId={teamBId}
            onTeamBChange={setTeamBId}
            valueMode={valueMode}
            onValueModeChange={setValueMode}
            isPointsLeague={isPointsLeague}
          />

          {!isPointsLeague && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12.5, color: "var(--rt-muted)", marginBottom: 6 }}>
                Target categories <span style={{ color: "var(--rt-muted)" }}>— optional: sorts and lights up both rosters&apos; cards by combined z-score</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {(effective?.scored ?? []).map((cat) => {
                  const active = targetCats.has(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setTargetCats((s) => { const n = new Set(s); if (n.has(cat)) n.delete(cat); else n.add(cat); return n; })}
                      style={{
                        padding: "6px 14px", borderRadius: 100, border: "1px solid var(--rt-hairline)", cursor: "pointer",
                        background: active ? "var(--rt-ink)" : "transparent",
                        color: active ? "var(--rt-canvas)" : "var(--rt-ink)", fontWeight: 600, fontSize: 12.5,
                      }}
                    >
                      {CATEGORY_LABEL[cat]}
                    </button>
                  );
                })}
                {targetCats.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setTargetCats(new Set())}
                    style={{ background: "none", border: "none", color: "var(--rt-primary)", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}

          {!theirRoster ? (
            <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>Pick a trade partner to start building a trade.</p>
          ) : (
            <>
              {([
                { roster: myRoster, players: myPlayersSorted, ids: sendIds, setIds: setSendIds, pickIds: sendPickIds, setPickIds: setSendPickIds, title: `${myRoster.teamName} — select who you send` },
                { roster: theirRoster, players: theirPlayersSorted, ids: receiveIds, setIds: setReceiveIds, pickIds: receivePickIds, setPickIds: setReceivePickIds, title: `${theirRoster.teamName} — select who you receive` },
              ] as const).map(({ roster, players, ids, setIds, pickIds, setPickIds, title }) => (
                <div key={roster.teamId} style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{title}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))", gap: 8 }}>
                    {players.map((p) => (
                      <PlayerMiniCard
                        key={p.fantraxId}
                        player={p}
                        checked={ids.has(p.fantraxId)}
                        tier={targetCatsArr.length > 0 ? categoryTier(meanZ(p.cats, targetCatsArr)) : null}
                        positionSlots={effective?.positionSlots ?? {}}
                        isSophomore={Boolean(p.fheId && enrich?.sophomoreByFheId?.[p.fheId])}
                        contractClass={p.fheId ? enrich?.contractByFheId[p.fheId]?.contractClass : undefined}
                        leaguePlayers={leaguePlayers}
                        baseValueByFantraxId={baseValueByFantraxId}
                        ledgerRankByFantraxId={ledgerRankByFantraxId}
                        onToggle={() => setIds((s) => { const n = new Set(s); if (n.has(p.fantraxId)) n.delete(p.fantraxId); else n.add(p.fantraxId); return n; })}
                      />
                    ))}
                  </div>
                  {hasAnyDraftPicks && analysis && (
                    <div style={{ marginTop: 14 }}>
                      <DraftPickCardsGrid
                        teamName={roster.teamName}
                        picks={(draftPicksByTeamId.get(roster.teamId) ?? []).map((p) => withProjectedSlot(p, roster.teamId, seasonYear, teamCount, teamIdByName, postTradeRankByTeamId))}
                        seasonYear={analysis.league.seasonYear}
                        draftStatus={draftStatus}
                        yearsWithLeagueData={yearsWithLeagueData}
                        selectedKeys={new Set(pickIds.keys())}
                        onTogglePick={(key, pick) => setPickIds((m) => {
                          const n = new Map(m);
                          if (n.has(key)) n.delete(key); else n.set(key, pick);
                          return n;
                        })}
                        leaguePlayers={leaguePlayers}
                        baseValueByFantraxId={baseValueByFantraxId}
                        family={isPointsLeague ? "points" : "categories"}
                        ledgerRankByPickKey={ledgerRankByPickKey}
                        currentYearPickValueByOverallPick={currentYearPickValueByOverallPick}
                        ledgerValues={ledgerValues}
                        onRequestValue={() => setActivePanel("rankings")}
                      />
                    </div>
                  )}
                </div>
              ))}

              {!hasTradeSelected ? (
                <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>Tick at least one player on either side to build a trade.</p>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Trade preview</h3>
                    <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
                      {(["perGame", "totals"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setStatMode(mode)}
                          style={{
                            padding: "6px 12px", border: "none", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer",
                            background: statMode === mode ? "var(--rt-canvas)" : "transparent",
                            color: statMode === mode ? "var(--rt-ink)" : "var(--rt-muted)",
                          }}
                        >
                          {mode === "perGame" ? "Per game" : "Totals"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {salaryFormat !== "none" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap", fontSize: 12 }}>
                      <span style={{ color: "var(--rt-muted)", marginRight: 2 }}>Columns:</span>
                      {([["salary", "Salary"], ["contract", "Contract"]] as [keyof typeof cols, string][]).map(([key, label]) => (
                        <label key={key} style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={cols[key]}
                            onChange={() => setCols((c) => ({ ...c, [key]: !c[key] }))}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  )}

                  <TradePreviewTable title={`${myRoster.teamName} sends`} players={sendPlayers} scored={effective?.scored ?? []} enrich={enrich} leaguePlayers={leaguePlayers} valueMode={valueMode} statMode={statMode} positionSlots={effective?.positionSlots ?? {}} showSalary={showSalary} showContract={showContract} salaryFormat={salaryFormat} surplusByFantraxId={baseValueByFantraxId} ledgerRankByFantraxId={ledgerRankByFantraxId} />
                  <TradePreviewTable title={`${theirRoster.teamName} sends`} players={receivePlayers} scored={effective?.scored ?? []} enrich={enrich} leaguePlayers={leaguePlayers} valueMode={valueMode} statMode={statMode} positionSlots={effective?.positionSlots ?? {}} showSalary={showSalary} showContract={showContract} salaryFormat={salaryFormat} surplusByFantraxId={baseValueByFantraxId} ledgerRankByFantraxId={ledgerRankByFantraxId} />

                  <NetImpactRow scored={effective?.scored ?? []} sendPlayers={sendPlayers} receivePlayers={receivePlayers} statMode={statMode} showSalary={showSalary} showContract={showContract} salaryFormat={salaryFormat} />

                  {tradeVerdict && myRoster && theirRoster && (
                    <TradeVerdictPanel
                      verdict={tradeVerdict}
                      myTeamName={myRoster.teamName}
                      theirTeamName={theirRoster.teamName}
                      myTeamId={myRoster.teamId}
                      myPlayers={receivePlayers} myPicks={receivePicks}
                      theirPlayers={sendPlayers} theirPicks={sendPicks}
                      leaguePlayers={leaguePlayers} baseValueByFantraxId={baseValueByFantraxId}
                      secondRankMode={secondRankMode} secondRankLabel={secondRankLabel}
                      showSalary={showSalary} salaryFormat={salaryFormat}
                      family={isPointsLeague ? "points" : "categories"} ledgerRankByPickKey={ledgerRankByPickKey}
                      ledgerRankByFantraxId={ledgerRankByFantraxId}
                      positionSlots={effective?.positionSlots ?? {}} enrich={enrich} seasonYear={seasonYear}
                      currentYearPickValueByOverallPick={currentYearPickValueByOverallPick} ledgerValues={ledgerValues}
                      onRequestValue={() => setActivePanel("rankings")}
                      trade={trade} rowFormat={rowFormat} scored={effective?.scored ?? []} teamCount={teamCount}
                      salaryBefore={salaryBefore} salaryAfter={salaryAfter} statMode={statMode}
                    />
                  )}

                  <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                    <button
                      type="button"
                      onClick={() => setActivePanel((m) => (m === "rankings" ? "none" : "rankings"))}
                      style={{
                        height: 42, padding: "0 20px", borderRadius: 100, fontWeight: 700, fontSize: 13.5, cursor: "pointer",
                        border: activePanel === "rankings" ? "none" : "1px solid var(--rt-hairline)",
                        background: activePanel === "rankings" ? "var(--rt-primary)" : "transparent",
                        color: activePanel === "rankings" ? "#fff" : "var(--rt-ink)",
                      }}
                    >
                      Launch Power Rankings compare
                    </button>
                  </div>

                  <div style={{ marginBottom: 28 }}>
                    <div style={{ fontSize: 12.5, color: "var(--rt-muted)", marginBottom: 6 }}>Assessing roster depth</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
                        {["Starters", "+1", "+2", "+3", "+4", "+5"].map((label, i) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => setDepth(i)}
                            style={{
                              padding: "7px 14px", border: "none", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                              background: depth === i ? "var(--rt-canvas)" : "transparent",
                              color: depth === i ? "var(--rt-ink)" : "var(--rt-muted)",
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <span style={{ fontSize: 12, color: "var(--rt-muted)", maxWidth: 420 }}>
                        {depthCaption(lineupCadence, format ?? "roto", capPos, capMatch, capPosN, capMatchN)}
                      </span>
                    </div>
                  </div>

                  {activePanel === "rankings" && trade && effective && (
                    <div style={{ marginBottom: 32 }}>
                      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Power Rankings — before vs. after</h3>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(480px, 1fr))", gap: 20 }}>
                        <div>
                          <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 11, letterSpacing: "0.04em", color: "var(--rt-muted)", marginBottom: 10 }}>BEFORE</div>
                          <PowerRankingsCompareTable profiles={trade.before} format={rowFormat} scored={effective.scored} myTeamId={myTeamId} teamBId={teamBId!} statMode={statMode} />
                        </div>
                        <div>
                          <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 11, letterSpacing: "0.04em", color: "var(--rt-muted)", marginBottom: 10 }}>AFTER</div>
                          <PowerRankingsCompareTable profiles={trade.after} format={rowFormat} scored={effective.scored} myTeamId={myTeamId} teamBId={teamBId!} statMode={statMode} />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </HubShell>
  );
}

export default function TradeEdgePage() {
  return (
    <Suspense fallback={null}>
      <TradeEdgeContent />
    </Suspense>
  );
}
