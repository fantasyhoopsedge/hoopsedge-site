"use client";

import { useState, type ReactNode } from "react";
import type { ResolvedPlayer } from "@/lib/fantrax/analyze";
import { CATEGORY_LABEL, type FheCategory } from "@/lib/fantrax/league";
import type { SalaryFormat } from "@/lib/fantrax/league-tags";
import type { ContractInfo } from "@/lib/fantrax/roster-edge";
import { normalizeTeamAbbr } from "@/lib/nba-teams";
import { TAG_META, type TrendTag } from "@/app/team-rosters/_components/trend-insight";
import { TEAM_LOGO } from "@/app/team-rosters/_components/roster-data";
import { PlayerHeadshot } from "@/app/team-rosters/_components/roster-headshot";

/**
 * The Roster Edge player row, extracted so any other Deep Edge tool that
 * needs to show "a player, exactly as Roster Edge shows them" (Trade Edge's
 * roster pickers and trade-preview rows, so far) renders through the same
 * formatting code instead of a second hand-copied version that can silently
 * drift from the original. Roster Edge itself renders through this component
 * too — there is only one implementation of a player row in Deep Edge.
 *
 * Deliberately NOT extracted: the sortable `<thead>` (Roster Edge's own
 * per-column SortTh wiring is specific to its own sort-key union and column
 * picker state) and the extra-category picker. Callers other than Roster
 * Edge write their own plain header — column labels are stable text, low
 * risk to duplicate, unlike the per-cell formatting/heatmap math below.
 */

export type ExtraCode = "A/TO" | "FGM" | "FTM" | "FGA" | "FTA";
export type EnrichData = {
  salaryRankByFheId: Record<string, number>;
  contractByFheId: Record<string, ContractInfo>;
  dynastyRankByFheId: Record<string, number>;
  /** Current age, computed live from nba_roster.dob (see getAgeByFheId) —
   *  optional because Roster Edge's own destructure predates this field and
   *  doesn't need it; Trade Edge's player cards are the first consumer. */
  ageByFheId?: Record<string, number>;
};
export type RosterTableFormat = "roto" | "h2hcat" | "points";

export function formatSalary(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${(n / 1_000_000).toFixed(2)}M`;
}
export function formatContract(info: ContractInfo | undefined): string {
  if (!info) return "—";
  return `${info.yearsRemaining}yr/$${(info.totalRemaining / 1_000_000).toFixed(1)}M`;
}
/** A custom-salary league's cap unit is whatever the commissioner defined —
 *  not real NBA-scale dollars — so this is a plain integer, never divided by
 *  1_000_000 the way formatSalary() assumes. Verified live 2026-08-13
 *  against a real custom-salary league: raw values are already small ints
 *  (21, 15, 40, …) matching what the league's own Fantrax page shows. */
export function formatCustomSalary(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("en-US");
}
/** Fantrax's own contract-year label ("28-29", "R-2nd", "E-1st", …) for a
 *  custom-salary league — see LeagueRosterSpot.contract. Distinct from
 *  formatContract() above, which formats FHE's real-world dynasty contract. */
export function formatCustomContract(contract: string | null | undefined): string {
  return contract ?? "—";
}
/** The 5 true positions — always shown regardless of league settings. */
const MAIN_POSITIONS = new Set(["PG", "SG", "SF", "PF", "C"]);
/**
 * Position-eligibility display: PG/SG/SF/PF/C always show; the "G"/"F"
 * combo-eligibility tags only show when this league's OWN roster actually
 * plays a G or F slot (positionSlots.G / .F > 0) — otherwise every player
 * eligible at guard/forward carries the tag regardless of whether the league
 * has any use for it, which is just noise (Ash, 2026-08-14: "only display
 * PG, SG, SF, PF, C unless the settings are customised to be G, F, C").
 * Numbered flex slots (Flx2, Flx3, Util, …) never show either way — same
 * historic reasoning as the flx regex this supersedes.
 */
export function posDisplayFor(eligible: string[], positionSlots: Record<string, number> | undefined): string[] {
  const showG = (positionSlots?.G ?? 0) > 0;
  const showF = (positionSlots?.F ?? 0) > 0;
  return eligible.filter((e) => {
    const upper = e.toUpperCase();
    if (MAIN_POSITIONS.has(upper)) return true;
    if (upper === "G") return showG;
    if (upper === "F") return showF;
    return false;
  });
}
export function formatStat(cat: FheCategory | ExtraCode, raw: number | null): string {
  if (raw == null || !Number.isFinite(raw)) return "—";
  if (cat === "FG" || cat === "FT") return raw.toFixed(3).replace(/^0(?=\.)/, "");
  return raw.toFixed(1);
}
export function statValue(p: ResolvedPlayer, cat: FheCategory | ExtraCode): number | null {
  const s = p.statLine;
  if (!s) return null;
  switch (cat) {
    case "PTS": return s.pts; case "FG3": return s.fg3m; case "REB": return s.reb;
    case "AST": return s.ast; case "STL": return s.stl; case "BLK": return s.blk;
    case "TO": return s.tov; case "FG": return s.fg_pct; case "FT": return s.ft_pct;
    case "FGM": return s.fga != null && s.fg_pct != null ? s.fga * s.fg_pct : null;
    case "FTM": return s.fta != null && s.ft_pct != null ? s.fta * s.ft_pct : null;
    case "A/TO": return s.ast != null && s.tov ? s.ast / s.tov : null;
    case "FGA": return s.fga; case "FTA": return s.fta;
  }
}
/** This player's single weakest scored category by z-score — the one
 *  Minus1V excludes for him specifically. */
export function weakestCat(p: ResolvedPlayer, scored: readonly FheCategory[]): FheCategory | null {
  let worst: FheCategory | null = null;
  let worstZ = Infinity;
  for (const cat of scored) {
    const z = p.cats[cat];
    if (z != null && z < worstZ) { worstZ = z; worst = cat; }
  }
  return worst;
}
/** Weighted per-game average across a set of players: combined season totals
 *  ÷ combined games played. */
export function weightedAverage(players: ResolvedPlayer[], cat: FheCategory | ExtraCode): number | null {
  if (cat === "FG" || cat === "FT") {
    let makes = 0, atts = 0;
    for (const p of players) {
      const s = p.statLine; const g = p.gamesPlayed ?? 0;
      if (!s || g <= 0) continue;
      const a = (cat === "FG" ? s.fga : s.fta) ?? 0;
      const pct = (cat === "FG" ? s.fg_pct : s.ft_pct) ?? 0;
      atts += a * g; makes += a * pct * g;
    }
    return atts > 0 ? makes / atts : null;
  }
  if (cat === "A/TO") {
    let ast = 0, tov = 0;
    for (const p of players) {
      const s = p.statLine; const g = p.gamesPlayed ?? 0;
      if (!s || g <= 0) continue;
      ast += (s.ast ?? 0) * g; tov += (s.tov ?? 0) * g;
    }
    return tov > 0 ? ast / tov : null;
  }
  let total = 0, games = 0;
  for (const p of players) {
    const s = p.statLine; const g = p.gamesPlayed ?? 0;
    if (!s || g <= 0) continue;
    const raw = statValue(p, cat);
    if (raw == null) continue;
    total += raw * g; games += g;
  }
  return games > 0 ? total / games : null;
}

// ── conditional formatting — byte-for-byte the /seasonal-rankings "Player Cat
// Value" table's own scheme: a continuous green/red opacity gradient off the
// raw z-score, anchors tighter for the overall Value/Minus1V column than the
// per-category cells, text always default ink. ─────────────────────────────
export function vBg(v: number | null | undefined, posAnchor: number, negAnchor: number): string {
  if (v == null || !Number.isFinite(v)) return "transparent";
  if (v >= 0) {
    const t = Math.min(v / posAnchor, 1);
    return `rgba(34, 197, 94, ${(t * 0.34).toFixed(3)})`;
  }
  const t = Math.min(-v / negAnchor, 1);
  return `rgba(239, 68, 68, ${(t * 0.34).toFixed(3)})`;
}
export const statBg = (v: number | null | undefined) => vBg(v, 2.0, 2.0);
export const valueBg = (v: number | null | undefined) => vBg(v, 1.0, 0.6);
export function meanStd(values: number[]): { mu: number; sigma: number } {
  if (values.length === 0) return { mu: 0, sigma: 0 };
  const mu = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mu) ** 2, 0) / values.length;
  return { mu, sigma: Math.sqrt(variance) };
}
export function zOf(raw: number | null | undefined, ms: { mu: number; sigma: number }): number | null {
  if (raw == null || !Number.isFinite(raw) || ms.sigma === 0) return null;
  return (raw - ms.mu) / ms.sigma;
}
/** 1-based rank of `target` within `players` by descending `value` — used
 *  only for the points-mode VALUE column, which has no precomputed FPTS rank
 *  anywhere else. Categories-mode VALUE/MINUS1 instead read the real
 *  precomputed catVRank fields. */
export function rankAmong(players: ResolvedPlayer[], value: (p: ResolvedPlayer) => number | null, target: number | null): number | null {
  if (target == null) return null;
  let rank = 1;
  for (const p of players) {
    const v = value(p);
    if (v != null && v > target) rank++;
  }
  return rank;
}
export function formatRank(n: number | null | undefined): string {
  return n == null ? "—" : `#${n}`;
}

export function TeamLogo({ team, size = 22 }: { team: string; size?: number }) {
  const [ok, setOk] = useState(true);
  const t = normalizeTeamAbbr(team) ?? team;
  const file = TEAM_LOGO[t];
  if (!file || !ok) {
    return <span style={{ fontSize: 10.5, color: "var(--rt-muted)", fontFamily: "var(--rt-font-mono)" }}>{t}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static team wordmark from public/
    <img
      src={`/images/nba%20team%20images/${file}`}
      alt={t}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setOk(false)}
      style={{ display: "block" }}
    />
  );
}

export interface RosterTableRowProps {
  player: ResolvedPlayer;
  enrich: EnrichData | null;
  format: RosterTableFormat;
  scored: readonly FheCategory[];
  visibleCats: readonly FheCategory[];
  extraCols?: readonly ExtraCode[];
  showSalary: boolean;
  showContract: boolean;
  showDynastyRank: boolean;
  showSalaryRank: boolean;
  /** "custom" reads SAL$/CONTRACT$ off the player's own Fantrax fields
   *  (p.salary as a plain unit, p.contract's Fantrax label) instead of FHE's
   *  real-world salary/contract data — see formatCustomSalary/
   *  formatCustomContract. Defaults to "real" (today's behavior) so existing
   *  callers that don't pass it are unaffected. */
  salaryFormat?: SalaryFormat;
  /** League's own roster slot config — see posDisplayFor(). */
  positionSlots: Record<string, number>;
  /** Whole-league player pool, for the USG z-score baseline and the
   *  points-mode VALUE rank (see rankAmong). */
  leaguePlayers: ResolvedPlayer[];
  usgStats: { mu: number; sigma: number };
  /** First `<td>` in the row — a checkbox, a rank number, or nothing
   *  (`<td />`). Callers own what selection means here (lineup tick in
   *  Roster Edge, trade selection in Trade Edge). */
  leadingCell: ReactNode;
  className?: string;
}

export function RosterTableRow({
  player: p, enrich, format, scored, visibleCats, extraCols = [], showSalary, showContract,
  showDynastyRank, showSalaryRank, salaryFormat = "real", positionSlots, leaguePlayers, usgStats, leadingCell, className,
}: RosterTableRowProps) {
  const isCustomSalary = salaryFormat === "custom";
  const salaryRank = showSalaryRank && p.fheId ? enrich?.salaryRankByFheId[p.fheId] : null;
  const dynastyRank = showDynastyRank && p.fheId ? enrich?.dynastyRankByFheId[p.fheId] : null;
  const contract = p.fheId ? enrich?.contractByFheId[p.fheId] : undefined;
  const trendTag: TrendTag | null = p.trendTags?.nineCatV ?? null;
  const weak = format !== "points" ? weakestCat(p, scored) : null;
  const value = format === "points" ? p.pointsValue : p.leagueV;
  const valueRank = format === "points"
    ? rankAmong(leaguePlayers, (pl) => pl.pointsValue, p.pointsValue)
    : (p.catVRank?.perGame.nineCatV ?? null);
  const minus1Rank = p.catVRank?.perGame.minus1V ?? null;
  const usgZ = zOf(p.usgPct, usgStats);
  const posDisplay = posDisplayFor(p.eligible, positionSlots);

  return (
    <tr className={className}>
      {leadingCell}
      <td className="l">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <PlayerHeadshot name={p.name} size={26} initials={p.name.split(" ").map((w) => w[0]).slice(0, 2).join("")} background="var(--rt-surface-strong)" color="var(--rt-ink)" fontSize={10} />
          <span style={{ fontWeight: 600 }}>{p.name}</span>
        </div>
      </td>
      <td><TeamLogo team={p.nbaTeam} /></td>
      <td>{posDisplay.join("/")}</td>
      {showSalary && <td>{isCustomSalary ? formatCustomSalary(p.salary) : formatSalary(p.salary)}</td>}
      {showContract && <td>{isCustomSalary ? formatCustomContract(p.contract) : formatContract(contract)}</td>}
      {showDynastyRank && <td>{dynastyRank ?? "—"}</td>}
      {showSalaryRank && <td>{salaryRank ?? "—"}</td>}
      <td>
        {trendTag ? (
          <span style={{ color: TAG_META[trendTag].color, fontWeight: 700, whiteSpace: "nowrap" }}>
            {TAG_META[trendTag].emoji} {TAG_META[trendTag].label}
          </span>
        ) : "—"}
      </td>
      <td>{p.gamesPlayed ?? "—"}</td>
      <td>{p.minutesPerGame != null ? p.minutesPerGame.toFixed(1) : "—"}</td>
      <td style={{ background: statBg(usgZ) }}>{p.usgPct != null ? `${p.usgPct.toFixed(1)}%` : "—"}</td>
      <td style={{ background: valueBg(value), fontWeight: 700 }} title={value != null ? `z-score ${value.toFixed(2)}` : undefined}>
        {formatRank(valueRank)}
      </td>
      {format !== "points" && (
        <td style={{ background: valueBg(p.catV?.perGame.minus1V) }} title={p.catV?.perGame.minus1V != null ? `z-score ${p.catV.perGame.minus1V.toFixed(2)}` : undefined}>
          {formatRank(minus1Rank)}
        </td>
      )}
      {visibleCats.map((cat) => {
        const z = p.cats[cat];
        const isWeak = weak === cat;
        return (
          <td key={cat} style={{ background: statBg(z), position: "relative" }}>
            {formatStat(cat, statValue(p, cat))}
            {isWeak && (
              <span title="Excluded from this player's Minus1V" style={{ marginLeft: 3, fontSize: 9, color: "var(--rt-muted)" }}>−1</span>
            )}
          </td>
        );
      })}
      {extraCols.map((col) => (
        <td key={col}>{formatStat(col, statValue(p, col))}</td>
      ))}
    </tr>
  );
}

/** Column labels/order matching RosterTableRow exactly — Roster Edge keeps
 *  its own sortable header (SortTh wiring is specific to its sort-key
 *  union); this plain version is for callers that don't need per-column
 *  sorting (Trade Edge's roster pickers). */
export function RosterTableHead({
  leadingLabel, visibleCats, extraCols = [], showSalary, showContract, showDynastyRank, showSalaryRank, isPoints,
}: {
  leadingLabel: ReactNode;
  visibleCats: readonly FheCategory[];
  extraCols?: readonly ExtraCode[];
  showSalary: boolean;
  showContract: boolean;
  showDynastyRank: boolean;
  showSalaryRank: boolean;
  isPoints: boolean;
}) {
  return (
    <tr>
      <th>{leadingLabel}</th>
      <th className="l">PLAYER</th>
      <th>TEAM</th>
      <th>POS</th>
      {showSalary && <th>SAL$</th>}
      {showContract && <th>CONTRACT$</th>}
      {showDynastyRank && <th>DYN RK</th>}
      {showSalaryRank && <th>SAL RK</th>}
      <th>TREND</th>
      <th>GP</th>
      <th>MIN</th>
      <th>USG</th>
      <th>{isPoints ? "FPTS" : "VALUE"}</th>
      {!isPoints && <th>MINUS1</th>}
      {visibleCats.map((cat) => <th key={cat}>{CATEGORY_LABEL[cat]}</th>)}
      {extraCols.map((col) => <th key={col}>{col}</th>)}
    </tr>
  );
}
