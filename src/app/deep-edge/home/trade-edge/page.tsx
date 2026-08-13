"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CategoryEdge, LeagueAnalysis, ResolvedPlayer, TeamCategoryProfile, TradePartnerSuggestion } from "@/lib/fantrax/analyze";
import { categoryEdges, projectRotoStandings, suggestTradePartners, teamStrengthsWeaknesses } from "@/lib/fantrax/analyze";
import { CATEGORY_LABEL, currentSeasonDraftStatus, type FheCategory } from "@/lib/fantrax/league";
import { DEFAULT_GAMES_CAP_SETTINGS, DEFAULT_LEAGUE_TAGS, type SalaryFormat } from "@/lib/fantrax/league-tags";
import { FormatConfirmPrompt } from "@/lib/fantrax/format-confirm";
import { buildOptimalLineup, categoryTier, rankTierLabel, resolveEffectiveScoring, teamPerGameStat, type CategoryTier, type OptimalLineup } from "@/lib/fantrax/lineup";
import {
  buildDepthWeightedProfiles, deriveRankingsFormat, depthCaption, depthWeight, formatPerGame,
  rotoStandingsByRawStat, simulateH2HCategoryStandings, simulateH2HPointsStandings,
} from "@/lib/fantrax/power-rankings";
import {
  lineupModeFor, tradeProfiles, TRADE_VALUE_MODE_LABEL, valueOf,
  type TradeValueMode,
} from "@/lib/fantrax/trade-edge";
import {
  DraftPickCardsGrid, formatContract, formatCustomContract, formatCustomSalary, formatSalary,
  posDisplayFor, rankAmong, statValue, weightedAverage, type EnrichData, type RosterTableFormat,
} from "../../_components/roster-table";
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

/** Per-game display is the AVERAGE across a lineup's players, not
 *  teamPerGameStat()'s own team-combined sum — same convention Category
 *  Edge's own page uses for its headline per-game row. */
function perPlayerAverage(players: ResolvedPlayer[], cat: FheCategory): number {
  const raw = teamPerGameStat(players, cat);
  if (cat === "FG" || cat === "FT") return raw;
  return players.length > 0 ? raw / players.length : 0;
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
function sortForCards(players: ResolvedPlayer[], valueMode: TradeValueMode, targetCats: FheCategory[]): ResolvedPlayer[] {
  return [...players].sort((a, b) => {
    if (targetCats.length > 0) return (meanZ(b.cats, targetCats) ?? -Infinity) - (meanZ(a.cats, targetCats) ?? -Infinity);
    return (valueOf(b, valueMode) ?? -Infinity) - (valueOf(a, valueMode) ?? -Infinity);
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

/** Which of a lineup's players count as "being assessed" at a given roster
 *  depth — every starter, plus the top `depth` bench players. Module-level
 *  (not a component closure) so useMemo's dependency array stays exact. */
function assessedIdsFor(lineup: OptimalLineup | null, depth: number): Set<string> {
  if (!lineup) return new Set();
  return new Set([...lineup.starters.map((a) => a.player.fantraxId), ...lineup.bench.slice(0, depth).map((p) => p.fantraxId)]);
}

interface Headline { rank: number; of: number; label: string; sub: string; }

function headlineFor(
  profiles: TeamCategoryProfile[], format: RosterTableFormat, scored: readonly FheCategory[], teamId: string,
): Headline | null {
  if (format === "roto") {
    const rows = projectRotoStandings(profiles, scored);
    const row = rows.find((r) => r.teamId === teamId);
    if (!row) return null;
    return { rank: row.projectedRank, of: rows.length, label: `${row.totalPoints} roto pts`, sub: `of ${scored.length * rows.length} max` };
  }
  const rows = format === "h2hcat" ? simulateH2HCategoryStandings(profiles, scored) : simulateH2HPointsStandings(profiles);
  const row = rows.find((r) => r.teamId === teamId);
  if (!row) return null;
  const sub = format === "h2hcat" ? `${row.categoryWins}-${row.categoryDraws}-${row.categoryLosses}` : `${row.totalWins}-${row.totalDraws}-${row.totalLosses}`;
  return { rank: row.rank, of: rows.length, label: `${(row.winPct * 100).toFixed(1)}% win`, sub };
}

/** A small player card for the trade pickers — headshot, name, position
 *  eligibility, dynasty rank, and value rank under the chosen TradeValueMode.
 *  Dimmed when the player falls outside the roster depth currently being
 *  assessed (still selectable — a benched piece can still be traded, it
 *  just isn't part of the "starters + N" comparison). When one or more
 *  target categories are selected, the ring color reads as a combined-z
 *  tier (green/amber/red) for exactly those categories instead of the
 *  default hairline/checked color — "checked" is shown via the background
 *  wash instead, so both signals stay visible at once. */
function PlayerMiniCard({
  player, checked, onToggle, assessed, dynastyRank, valueRank, valueMode, tier, positionSlots,
}: {
  player: ResolvedPlayer; checked: boolean; onToggle: () => void; assessed: boolean;
  dynastyRank: number | null; valueRank: number | null; valueMode: TradeValueMode; tier: CategoryTier | null;
  positionSlots: Record<string, number>;
}) {
  const initials = player.name.split(" ").map((w) => w[0]).slice(0, 2).join("");
  const posDisplay = posDisplayFor(player.eligible, positionSlots).join("/");
  const ringColor = tier ? TIER_COLOR[tier] : checked ? "var(--rt-primary)" : "var(--rt-hairline)";
  // Assessed (within the currently-selected roster depth) reads as a slight
  // background tint rather than dimming everyone else — greying out the
  // majority of a 15-man roster made the picker feel broken, not informative.
  const background = checked ? "rgba(93,95,239,0.10)" : assessed ? "var(--rt-surface-soft)" : "var(--rt-canvas)";
  return (
    <button
      type="button"
      onClick={onToggle}
      title={player.name}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "10px 6px", borderRadius: 14,
        border: `1px solid ${ringColor}`, background, cursor: "pointer", textAlign: "center", color: "var(--rt-ink)",
      }}
    >
      <PlayerHeadshot name={player.name} size={44} initials={initials} background="var(--rt-surface-strong)" color="var(--rt-ink)" fontSize={13} />
      <div
        style={{
          fontSize: 11.5, fontWeight: 700, lineHeight: 1.2, minHeight: "2.4em", width: "100%", color: "var(--rt-ink)",
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
        }}
      >
        {player.name}
      </div>
      <div style={{ fontSize: 10, color: "var(--rt-muted)" }}>{posDisplay || "—"}</div>
      <div style={{ fontSize: 10, color: "var(--rt-muted)", fontFamily: "var(--rt-font-mono)" }}>
        DYN {dynastyRank != null ? `#${dynastyRank}` : "—"}
      </div>
      <div style={{ fontSize: 10, color: "var(--rt-muted)", fontFamily: "var(--rt-font-mono)" }}>
        {TRADE_VALUE_MODE_LABEL[valueMode]} {valueRank != null ? `#${valueRank}` : "—"}
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

/** The aligned trade-preview table — PLAYER/POS/AGE/DYN RK/VAL RK plus every
 *  scored category, fixed column widths (`te-preview-table` + `<colgroup>`)
 *  shared with its counterpart on the other side of the trade, so the two
 *  line up exactly whether read stacked or side by side. */
function TradePreviewTable({
  title, players, scored, enrich, leaguePlayers, valueMode, statMode, positionSlots, showSalary, showContract, salaryFormat,
}: {
  title: string; players: ResolvedPlayer[]; scored: readonly FheCategory[]; enrich: EnrichData | null;
  leaguePlayers: ResolvedPlayer[]; valueMode: TradeValueMode; statMode: "perGame" | "totals";
  positionSlots: Record<string, number>;
  /** Mirrors Roster Edge's own Salary/Contract column toggles — off by
   *  default in leagues with no salary data (salaryFormat "none"). */
  showSalary: boolean; showContract: boolean; salaryFormat: SalaryFormat;
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
              const valueRank = rankAmong(leaguePlayers, (pl) => valueOf(pl, valueMode), valueOf(p, valueMode));
              const posDisplay = posDisplayFor(p.eligible, positionSlots).join("/");
              return (
                <tr key={p.fantraxId}>
                  <td className="l">
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <PlayerHeadshot name={p.name} size={22} initials={p.name.split(" ").map((w) => w[0]).slice(0, 2).join("")} background="var(--rt-surface-strong)" color="var(--rt-ink)" fontSize={9} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    </div>
                  </td>
                  <td>{posDisplay || "—"}</td>
                  <td>{age != null ? age.toFixed(1) : "—"}</td>
                  {showSalary && <td>{isCustomSalary ? formatCustomSalary(p.salary) : formatSalary(p.salary)}</td>}
                  {showContract && <td>{isCustomSalary ? formatCustomContract(p.contract) : formatContract(contract)}</td>}
                  <td>{dynastyRank ?? "—"}</td>
                  <td>{valueRank ?? "—"}</td>
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

function CategoryChip({ name, ring }: { name: string; ring: string }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("");
  return (
    <div title={name} style={{ width: 40, height: 40, borderRadius: "50%", padding: 2, border: `2px solid ${ring}`, flexShrink: 0 }}>
      <PlayerHeadshot name={name} size={36} initials={initials} background="var(--rt-surface-strong)" color={ring} fontSize={12} />
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

/** Category Edge's category-strength read, before or after: headline
 *  score/win%, then every scored category with its real per-game average
 *  and rank + tier label. The chip row is scoped to just the players this
 *  trade actually moves — sendPlayers for the Before column (who's about to
 *  leave), receivePlayers for After (who just arrived) — and only when that
 *  player is a promoter or detractor in the category; a passive contributor
 *  isn't worth a chip. */
function CategoryEdgeCompareColumn({
  label, profiles, format, scored, teamId, teamCount, tradedPlayers,
}: {
  label: string; profiles: TeamCategoryProfile[]; format: RosterTableFormat; scored: readonly FheCategory[]; teamId: string; teamCount: number;
  tradedPlayers: ResolvedPlayer[];
}) {
  const headline = headlineFor(profiles, format, scored, teamId);
  const standings = projectRotoStandings(profiles, scored);
  const edges = categoryEdges(teamId, profiles, standings, scored);
  const edgeByCategory = new Map(edges.map((e) => [e.category, e]));
  const starters = profiles.find((p) => p.teamId === teamId)?.starters ?? [];

  return (
    <div>
      <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 11, letterSpacing: "0.04em", color: "var(--rt-muted)", marginBottom: 10 }}>{label.toUpperCase()}</div>
      <div style={{ padding: 14, borderRadius: 14, border: "1px solid var(--rt-hairline)", marginBottom: 16 }}>
        <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 10, color: "var(--rt-muted)", marginBottom: 4 }}>{format === "roto" ? "ROTO SCORE" : "WIN %"}</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{headline ? headline.label : "—"}</div>
        {headline && <div style={{ fontSize: 11, color: "var(--rt-muted)" }}>{ordinal(headline.rank)} of {headline.of}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {/* Fixed canonical category order (not each column's own best-rank-first
         *  order) so row N is the SAME category in both the Before and After
         *  columns — the whole point of a side-by-side compare is that a row
         *  means the same thing on both sides. */}
        {scored.map((cat) => {
          const e = edgeByCategory.get(cat);
          if (!e) return null;
          const raw = perPlayerAverage(starters, cat);
          const notable = tradedPlayers
            .map((p) => ({ p, tier: categoryTier(p.cats[cat]) }))
            .filter((x): x is { p: ResolvedPlayer; tier: "promoter" | "detractor" } => x.tier === "promoter" || x.tier === "detractor");
          return (
            <div
              key={cat}
              style={{
                display: "grid", gridTemplateColumns: "46px 68px 150px 1fr", alignItems: "center", columnGap: 14,
                minHeight: 56, padding: "8px 14px", borderRadius: 12, background: "var(--rt-surface-soft)",
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 700 }}>{CATEGORY_LABEL[cat]}</div>
              <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 16, fontWeight: 700 }}>{formatPerGame(cat, raw)}</div>
              <span
                style={{
                  fontSize: 12, fontFamily: "var(--rt-font-mono)", fontWeight: 700, padding: "3px 10px", borderRadius: 100,
                  width: "fit-content", background: tierBg(e.rank, teamCount), color: "var(--rt-ink)",
                }}
              >
                {ordinal(e.rank)} · {rankTierLabel(e.rank, teamCount)}
              </span>
              {/* Left-justified within its own grid column (not marginLeft:auto
               *  right-aligned) — a fixed-width grid column means the headshots
               *  start at the same x offset on every row, down the page and
               *  between the Before/After columns, regardless of chip count. */}
              <div style={{ display: "flex", gap: 8 }}>
                {notable.map(({ p, tier }) => <CategoryChip key={p.fantraxId} name={p.name} ring={TIER_COLOR[tier]} />)}
              </div>
            </div>
          );
        })}
      </div>
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
 *  Points-mode leagues have no category dimension to read this from, so the
 *  caller skips this block entirely for them. */
function TeamInsightPanel({
  strengthsWeaknesses, partners, onPickPartner,
}: {
  strengthsWeaknesses: { strong: CategoryEdge[]; weak: CategoryEdge[] };
  partners: TradePartnerSuggestion[];
  onPickPartner: (teamId: string) => void;
}) {
  const { strong, weak } = strengthsWeaknesses;
  if (strong.length === 0 && weak.length === 0) return null;
  return (
    <div style={{ padding: 16, borderRadius: 14, border: "1px solid var(--rt-hairline)", marginBottom: 24 }}>
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginBottom: partners.length > 0 ? 16 : 0 }}>
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
      </div>
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
                  <div style={{ fontSize: 11.5, color: "var(--rt-muted)" }}>Strong where you&apos;re weak: {p.theyHelpMe.map((c) => CATEGORY_LABEL[c]).join(", ")}</div>
                )}
                {p.iHelpThem.length > 0 && (
                  <div style={{ fontSize: 11.5, color: "var(--rt-muted)" }}>Needs what you have: {p.iHelpThem.map((c) => CATEGORY_LABEL[c]).join(", ")}</div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
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
  const [statMode, setStatMode] = useState<"perGame" | "totals">("perGame");
  const [activePanel, setActivePanel] = useState<"none" | "rankings" | "category">("none");
  const [cols, setCols] = useState<{ salary: boolean; contract: boolean }>({ salary: false, contract: false });

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
        const { salaryRankByFheId, contractByFheId, dynastyRankByFheId, ageByFheId, ...rest } = data;
        setAnalysis(rest as LeagueAnalysis);
        setEnrich({ salaryRankByFheId, contractByFheId, dynastyRankByFheId, ageByFheId });
      })
      .catch((err) => setError(String(err)));
  }, [saved]);

  const format = useMemo(() => {
    if (!analysis || !saved) return null;
    return deriveRankingsFormat(analysis, {
      format: saved.settings.format ?? DEFAULT_LEAGUE_TAGS.format,
      formatConfirmed: saved.settings.formatConfirmed,
    });
  }, [analysis, saved]);

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
  const formula = valueMode === "fpts" ? analysis?.league.pointsFormula ?? null : null;
  const lineupMode = lineupModeFor(valueMode);

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
    setActivePanel("none");
  }

  const myRoster = useMemo(() => analysis?.rosters.find((r) => r.teamId === myTeamId) ?? null, [analysis, myTeamId]);
  const theirRoster = useMemo(() => analysis?.rosters.find((r) => r.teamId === teamBId) ?? null, [analysis, teamBId]);
  const leaguePlayers = useMemo(() => analysis?.rosters.flatMap((r) => r.players) ?? [], [analysis]);
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
  const draftStatus = useMemo(() => currentSeasonDraftStatus(analysis?.league.draft ?? null), [analysis]);

  const myBaseLineup: OptimalLineup | null = useMemo(() => {
    if (!myRoster || !effective) return null;
    return buildOptimalLineup(myRoster.players, effective.positionSlots, formula, { valueMode: lineupMode });
  }, [myRoster, effective, formula, lineupMode]);
  const theirBaseLineup: OptimalLineup | null = useMemo(() => {
    if (!theirRoster || !effective) return null;
    return buildOptimalLineup(theirRoster.players, effective.positionSlots, formula, { valueMode: lineupMode });
  }, [theirRoster, effective, formula, lineupMode]);

  const myAssessed = useMemo(() => assessedIdsFor(myBaseLineup, depth), [myBaseLineup, depth]);
  const theirAssessed = useMemo(() => assessedIdsFor(theirBaseLineup, depth), [theirBaseLineup, depth]);
  const starterCount = myBaseLineup?.starters.length ?? 0;

  const targetCatsArr = useMemo(() => [...targetCats], [targetCats]);
  const myPlayersSorted = useMemo(
    () => (myRoster ? sortForCards(myRoster.players, valueMode, targetCatsArr) : []),
    [myRoster, valueMode, targetCatsArr],
  );
  const theirPlayersSorted = useMemo(
    () => (theirRoster ? sortForCards(theirRoster.players, valueMode, targetCatsArr) : []),
    [theirRoster, valueMode, targetCatsArr],
  );

  const trade = useMemo(() => {
    if (!analysis || !effective || !myTeamId || !teamBId) return null;
    return tradeProfiles(analysis, myTeamId, teamBId, sendIds, receiveIds, depth, weight, valueMode, effective);
  }, [analysis, effective, myTeamId, teamBId, sendIds, receiveIds, depth, weight, valueMode]);

  const hasTradeSelected = sendIds.size > 0 || receiveIds.size > 0;

  const sendPlayers = useMemo(() => myRoster?.players.filter((p) => sendIds.has(p.fantraxId)) ?? [], [myRoster, sendIds]);
  const receivePlayers = useMemo(() => theirRoster?.players.filter((p) => receiveIds.has(p.fantraxId)) ?? [], [theirRoster, receiveIds]);

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
            then launch Power Rankings or Category Edge to see the real before/after side by side.
          </p>

          {!isPointsLeague && (
            <TeamInsightPanel
              strengthsWeaknesses={myStrengthsWeaknesses}
              partners={partnerSuggestions}
              onPickPartner={setTeamBId}
            />
          )}

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12.5, color: "var(--rt-muted)", marginBottom: 6 }}>Assessing roster depth</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
                {["Best", "+1", "+2", "+3", "+4", "+5"].map((label, i) => (
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
                    {i === 0 ? `Best ${starterCount || ""}` : label}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 12, color: "var(--rt-muted)", maxWidth: 420 }}>
                {depthCaption(lineupCadence, format ?? "roto", capPos, capMatch, capPosN, capMatchN)}
              </span>
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12.5, color: "var(--rt-muted)", marginBottom: 6 }}>Rank players by</div>
            <SegmentedControl<TradeValueMode>
              options={VALUE_MODE_OPTIONS}
              value={valueMode}
              onChange={setValueMode}
              disabledOptions={isPointsLeague ? [] : ["fpts"]}
            />
          </div>

          {salaryFormat !== "none" && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap", fontSize: 12 }}>
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

          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12.5, color: "var(--rt-muted)", display: "block", marginBottom: 6 }}>Trade partner</label>
            <select
              value={teamBId ?? ""}
              onChange={(e) => setTeamBId(e.target.value || null)}
              style={{
                height: 38, padding: "0 12px", borderRadius: 10, border: "1px solid var(--rt-hairline)",
                background: "var(--rt-surface-soft)", color: "var(--rt-ink)", fontSize: 13, fontWeight: 600, minWidth: 220,
              }}
            >
              <option value="">Choose a team…</option>
              {analysis.rosters.filter((r) => r.teamId !== myTeamId).map((r) => (
                <option key={r.teamId} value={r.teamId}>{r.teamName}</option>
              ))}
            </select>
          </div>

          {!theirRoster ? (
            <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>Pick a trade partner to start building a trade.</p>
          ) : (
            <>
              {([
                { roster: myRoster, players: myPlayersSorted, ids: sendIds, setIds: setSendIds, assessed: myAssessed, title: `${myRoster.teamName} — select who you send` },
                { roster: theirRoster, players: theirPlayersSorted, ids: receiveIds, setIds: setReceiveIds, assessed: theirAssessed, title: `${theirRoster.teamName} — select who you receive` },
              ] as const).map(({ roster, players, ids, setIds, assessed, title }) => (
                <div key={roster.teamId} style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{title}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))", gap: 8 }}>
                    {players.map((p) => (
                      <PlayerMiniCard
                        key={p.fantraxId}
                        player={p}
                        checked={ids.has(p.fantraxId)}
                        assessed={assessed.has(p.fantraxId)}
                        dynastyRank={p.fheId ? enrich?.dynastyRankByFheId[p.fheId] ?? null : null}
                        valueRank={rankAmong(leaguePlayers, (pl) => valueOf(pl, valueMode), valueOf(p, valueMode))}
                        valueMode={valueMode}
                        tier={targetCatsArr.length > 0 ? categoryTier(meanZ(p.cats, targetCatsArr)) : null}
                        positionSlots={effective?.positionSlots ?? {}}
                        onToggle={() => setIds((s) => { const n = new Set(s); if (n.has(p.fantraxId)) n.delete(p.fantraxId); else n.add(p.fantraxId); return n; })}
                      />
                    ))}
                  </div>
                  {hasAnyDraftPicks && analysis && (
                    <div style={{ marginTop: 14 }}>
                      <DraftPickCardsGrid
                        teamName={roster.teamName}
                        picks={draftPicksByTeamId.get(roster.teamId) ?? []}
                        seasonYear={analysis.league.seasonYear}
                        draftStatus={draftStatus}
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

                  <TradePreviewTable title={`${myRoster.teamName} sends`} players={sendPlayers} scored={effective?.scored ?? []} enrich={enrich} leaguePlayers={leaguePlayers} valueMode={valueMode} statMode={statMode} positionSlots={effective?.positionSlots ?? {}} showSalary={showSalary} showContract={showContract} salaryFormat={salaryFormat} />
                  <TradePreviewTable title={`${theirRoster.teamName} sends`} players={receivePlayers} scored={effective?.scored ?? []} enrich={enrich} leaguePlayers={leaguePlayers} valueMode={valueMode} statMode={statMode} positionSlots={effective?.positionSlots ?? {}} showSalary={showSalary} showContract={showContract} salaryFormat={salaryFormat} />

                  <NetImpactRow scored={effective?.scored ?? []} sendPlayers={sendPlayers} receivePlayers={receivePlayers} statMode={statMode} showSalary={showSalary} showContract={showContract} salaryFormat={salaryFormat} />

                  <div style={{ display: "flex", gap: 10, marginBottom: 28 }}>
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
                    <button
                      type="button"
                      onClick={() => setActivePanel((m) => (m === "category" ? "none" : "category"))}
                      disabled={isPointsLeague}
                      title={isPointsLeague ? "Category Edge doesn't apply to points-scored leagues" : undefined}
                      style={{
                        height: 42, padding: "0 20px", borderRadius: 100, fontWeight: 700, fontSize: 13.5,
                        cursor: isPointsLeague ? "not-allowed" : "pointer", opacity: isPointsLeague ? 0.45 : 1,
                        border: activePanel === "category" ? "none" : "1px solid var(--rt-hairline)",
                        background: activePanel === "category" ? "var(--rt-primary)" : "transparent",
                        color: activePanel === "category" ? "#fff" : "var(--rt-ink)",
                      }}
                    >
                      Launch Category Edge compare
                    </button>
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

                  {activePanel === "category" && trade && effective && !isPointsLeague && (
                    <div style={{ marginBottom: 32 }}>
                      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Category Edge — before vs. after</h3>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24 }}>
                        <CategoryEdgeCompareColumn label="Before" profiles={trade.before} format={rowFormat} scored={effective.scored} teamId={myTeamId} teamCount={analysis.league.teamCount} tradedPlayers={sendPlayers} />
                        <CategoryEdgeCompareColumn label="After" profiles={trade.after} format={rowFormat} scored={effective.scored} teamId={myTeamId} teamCount={analysis.league.teamCount} tradedPlayers={receivePlayers} />
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
