"use client";

import { useState, type ReactNode } from "react";
import type { ResolvedPlayer } from "@/lib/fantrax/analyze";
import {
  CATEGORY_LABEL, DRAFT_PICK_YEARS_IMPORTED, type CurrentSeasonDraftStatus, type FheCategory, type TeamDraftPick,
} from "@/lib/fantrax/league";
import type { SalaryFormat } from "@/lib/fantrax/league-tags";
import type { LineupValueMode } from "@/lib/fantrax/lineup";
import { formatTotal } from "@/lib/fantrax/power-rankings";
import type { ContractInfo } from "@/lib/fantrax/roster-edge";
import { ASSET_TIER_COLOR, pickAssetTier } from "./asset-tiers";
import { pickEquivalentValue } from "@/lib/fantrax/trade-verdict";
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
  /** True for a 2nd-year NBA player (see getSophomoreByFheId) — optional for
   *  the same reason as ageByFheId above; Trade Edge's asset-tier card color
   *  (_components/asset-tiers.ts) is the first consumer. */
  sophomoreByFheId?: Record<string, boolean>;
};
export type RosterTableFormat = "roto" | "h2hcat" | "points";
/** Which "value" flavor the roster table's per-category cell decoration
 *  should read as — matches the "Rank lineup by" selector's options (minus
 *  "league", which none of these callers expose as a user choice). Minus1V
 *  dynamically excludes each player's own weakest scored category; 8-Cat
 *  always excludes TO for everyone; 9-Cat and FPTS decorate nothing. */
export type ValueDisplayMode = Exclude<LineupValueMode, "league">;

export function formatSalary(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${(n / 1_000_000).toFixed(1)}M`;
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
/** Σ each player's own season total (rate × his own GP) — the TOTALS-mode
 *  counterpart to weightedAverage's blended per-game rate, for a summary row
 *  like Power Rankings' embedded roster panel. FG%/FT% still read as a
 *  blended attempts-weighted rate (weightedAverage) — a season shooting
 *  percentage isn't meaningful summed across players. */
export function summedTotal(players: ResolvedPlayer[], cat: FheCategory): number | null {
  if (cat === "FG" || cat === "FT") return weightedAverage(players, cat);
  let total = 0;
  let any = false;
  for (const p of players) {
    const raw = statValue(p, cat);
    const g = p.gamesPlayed ?? 0;
    if (raw == null || g <= 0) continue;
    total += raw * g;
    any = true;
  }
  return any ? total : null;
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
  /** Drives the per-category cell decoration: gold box on the weakest stat
   *  under "minus1V", grey-out on TO under "eightCatV", nothing under
   *  "nineCatV". Defaults to "minus1V" (today's only caller). */
  valueMode?: ValueDisplayMode;
  /** "totals" shows each visible category as a season total (this player's
   *  own per-game rate × his own GP, comma-formatted with no decimals via
   *  formatTotal) instead of the per-game rate — FG%/FT% are exempt (always
   *  a rate, never summed). Defaults to "perGame" (today's only behavior);
   *  Power Rankings' embedded roster panel is the first "totals" caller,
   *  mirroring the team-level PER GAME/TOTALS toggle above it. */
  statsMode?: "perGame" | "totals";
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
  showDynastyRank, showSalaryRank, salaryFormat = "real", valueMode = "minus1V", statsMode = "perGame", positionSlots, leaguePlayers, usgStats, leadingCell, className,
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
          <PlayerHeadshot name={p.name} size={26} initials={p.name.split(" ").map((w) => w[0]).slice(0, 2).join("")} background="var(--rt-surface-strong)" color="var(--rt-ink)" fontSize={10} rookie={p.isRookie} />
          <span className="de-player-name">{p.name}</span>
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
      <td style={{ background: valueBg(value) }} title={value != null ? `z-score ${value.toFixed(2)}` : undefined}>
        {formatRank(valueRank)}
      </td>
      {format !== "points" && (
        <td style={{ background: valueBg(p.catV?.perGame.minus1V) }} title={p.catV?.perGame.minus1V != null ? `z-score ${p.catV.perGame.minus1V.toFixed(2)}` : undefined}>
          {formatRank(minus1Rank)}
        </td>
      )}
      {visibleCats.map((cat) => {
        const z = p.cats[cat];
        // Cell decoration reads as whichever value flavor is currently
        // selected — not all three at once (Ash, 2026-08-14): Minus1V gold-
        // boxes just this player's own weakest stat, 8-Cat greys out TO for
        // everyone (it's dropped from every player's score, not just his),
        // 9-Cat decorates nothing.
        const isWeak = valueMode === "minus1V" && format !== "points" && weak === cat;
        const isEightCatDrop = valueMode === "eightCatV" && format !== "points" && cat === "TO";
        const title = isWeak
          ? "Excluded from this player's Minus1V"
          : isEightCatDrop ? "Excluded from 8-Cat scoring" : undefined;
        const rawStat = statValue(p, cat);
        const cellText = rawStat == null
          ? "—"
          : statsMode === "totals" && cat !== "FG" && cat !== "FT"
            ? formatTotal(cat, rawStat * (p.gamesPlayed ?? 0))
            : formatStat(cat, rawStat);
        return (
          <td
            key={cat}
            title={title}
            style={{
              background: isEightCatDrop ? "var(--rt-surface-strong)" : statBg(z),
              color: isEightCatDrop ? "var(--rt-muted)" : undefined,
              position: "relative",
              boxShadow: isWeak ? "inset 0 0 0 2px #f59e0b" : undefined,
            }}
          >
            {cellText}
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

/** One pick's display label. Current-season picks (once draft order is set)
 *  carry an exact slot — "{round}-{pickInRound} ({overallPick})", same
 *  format Fantrax's own "Draft Picks" panel uses; future picks have no slot
 *  yet, so they fall back to a bare round number. Either form gets the
 *  original owner's name in parens when it was acquired by trade. */
export function formatDraftPick(pick: TeamDraftPick): string {
  const slot = pick.pickInRound != null
    ? `${pick.round}-${pick.pickInRound}${pick.overallPick != null ? ` (${pick.overallPick})` : ""}`
    : `${pick.round}`;
  return pick.originalOwnerLabel ? `${slot} (${pick.originalOwnerLabel})` : slot;
}

/** Flat picks list -> one row per year across the FULL imported window
 *  (seasonYear..seasonYear+3), even years with zero picks — an empty year is
 *  meaningful (see buildDraftPickAssets in league.ts), not a gap to hide by
 *  only rendering years that happen to have data — UNLESS `yearsWithLeagueData`
 *  says nobody in the whole league owns a pick that year either, in which case
 *  the year hasn't actually been introduced to the league yet (a team-level
 *  empty year — this team traded theirs away, but the league tracks the year —
 *  still renders; Ash, 2026-08-23: "if future years picks are not introduced
 *  to the league, then don't show a trading card"). The current season always
 *  renders regardless — its own empty state (draft pending/concluded) is
 *  meaningful on its own, per emptyYearLabel. */
function draftPickYearRows(
  picks: readonly TeamDraftPick[],
  seasonYear: number,
  yearsWithLeagueData?: ReadonlySet<number>,
): { year: number; picks: TeamDraftPick[] }[] {
  const byYear = new Map<number, TeamDraftPick[]>();
  for (const p of picks) {
    const list = byYear.get(p.year) ?? [];
    list.push(p);
    byYear.set(p.year, list);
  }
  return Array.from({ length: DRAFT_PICK_YEARS_IMPORTED }, (_, i) => {
    const year = seasonYear + i;
    return { year, picks: (byYear.get(year) ?? []).sort((a, b) => a.round - b.round) };
  }).filter((row) => row.year === seasonYear || !yearsWithLeagueData || yearsWithLeagueData.has(row.year));
}

/** What an empty year's row/card says. Only the CURRENT season year reads as
 *  "the draft happened" — and only when it actually has, per
 *  currentSeasonDraftStatus() (league.ts): "concluded" means every known
 *  slot already has a player attached, "pending" means the board exists but
 *  this specific team just doesn't hold a pick in it this year (traded away,
 *  or never had one), "unknown" means Fantrax has no draft board for this
 *  league at all. A later empty year always reads as a neutral dash — that
 *  just means this league's own pick-tracking doesn't extend that far out
 *  yet (verified live: leagues varied between 2 and 3 years of real future
 *  data even though the window imports 4). */
function emptyYearLabel(year: number, seasonYear: number, draftStatus: CurrentSeasonDraftStatus): string {
  if (year !== seasonYear) return "—";
  if (draftStatus === "concluded") return "Draft complete — rookies already on rosters";
  if (draftStatus === "pending") return "No picks owned this year";
  return "—";
}

/**
 * A team's owned future draft-pick assets, dynasty leagues only, as a
 * Year/Draft Picks table — Roster Edge's own placement (one panel, the
 * selected team, below the player table). Callers gate whether to render
 * this at all on whether the LEAGUE tracks pick assets (any team has any
 * picks) — this component itself always shows the full imported year
 * window once asked to render, since an empty year is informative (see
 * emptyYearLabel).
 */
export function DraftPicksPanel({
  teamName, picks, seasonYear, draftStatus,
}: {
  teamName: string; picks: readonly TeamDraftPick[]; seasonYear: number; draftStatus: CurrentSeasonDraftStatus;
}) {
  const rows = draftPickYearRows(picks, seasonYear);
  return (
    <div style={{ padding: 16, borderRadius: 14, border: "1px solid var(--rt-hairline)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{teamName} — Draft Picks</div>
      <div className="de-table-wrap">
        <table className="de-table de-table-compact">
          <thead>
            <tr>
              <th className="l">YEAR</th>
              <th className="l">DRAFT PICKS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ year, picks: yearPicks }) => (
              <tr key={year}>
                <td className="l" style={{ fontWeight: 700 }}>{year}</td>
                <td className="l" style={yearPicks.length === 0 ? { color: "var(--rt-muted)" } : undefined}>
                  {yearPicks.length > 0 ? yearPicks.map(formatDraftPick).join(", ") : emptyYearLabel(year, seasonYear, draftStatus)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  const suffix = n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/** Same sign-aware year-decay as custom-valuations.ts's own decayFromAnchor
 *  (kept as a separate small copy here rather than imported — that module is
 *  `server-only` and this one runs client-side): shrinks a positive baseline
 *  toward zero, pushes a negative baseline further from zero — either way
 *  strictly worse than the anchor, since a plain multiplicative decay gets a
 *  negative baseline backwards (pulls it toward zero = numerically HIGHER =
 *  reads as MORE valuable). */
const YEAR_DECAY = 0.8;
function decayFromAnchor(anchor: number, yearsOut: number): number {
  const factor = YEAR_DECAY ** yearsOut;
  return anchor >= 0 ? anchor * factor : anchor / factor;
}

/** 1-based rank of `target` within a COMBINED pool: real players (`players`,
 *  filtered through `valueOf`) together with every OTHER valued asset's raw
 *  number (`extraValues` — a league's real+bracket draft-pick values, e.g.
 *  the generated ledger's own rows). One consistent counting method for
 *  every card on Trade Edge — player or pick, ledger-covered or not — so
 *  numbers from two differently-shaped pools never end up displayed
 *  side by side as though they meant the same thing.
 *
 *  This replaced two separate, INCOMPATIBLE approaches that used to coexist
 *  here:
 *   - A player's card used to rank him against `leaguePlayers` ALONE
 *     (plain `rankAmong`, no picks at all), so his rank silently omitted
 *     every draft pick the league actually holds — undercounting his TRUE
 *     rank by exactly however many picks out-valued him (Ash, 2026-08-27:
 *     Kyrie Irving's card read #74 against League Rankings' own #85 for the
 *     SAME player — the 11-pick gap was exactly Woolridge DMD30's 11
 *     real+bracket picks valued above him).
 *   - A pick's card used to trust the generated ledger's OWN precomputed
 *     rank verbatim for a current-year slot, but fall back to ranking a
 *     projected/future value against ONLY the ledger's pick rows
 *     (`extraValues` here, with no real players at all) for a future pick,
 *     and ranking a no-ledger pick against `leaguePlayers` ALONE for a
 *     standard/real-salary league with no ledger — three different pools
 *     used across three tiers of the same function, patched onto League
 *     Rankings' own toRanked() rank via a post-hoc override for whichever
 *     picks the ledger covered. Mixing a subset of ledger-pool ranks into a
 *     page otherwise numbered from a DIFFERENT pool produced a real,
 *     visible bug: a later, lower-value row displaying a BETTER (smaller)
 *     rank number than the row directly above it (Ash, 2026-08-27, League
 *     Rankings: a 2026 1st (#16) row ranked 170 sat directly above a 2029
 *     #4-8 bracket row ranked 167 — impossible within one consistently
 *     numbered pool). */
export function rankAmongCombined(
  players: readonly ResolvedPlayer[],
  valueOf: (p: ResolvedPlayer) => number | null,
  extraValues: readonly number[],
  target: number | null,
): number | null {
  if (target == null) return null;
  let rank = 1;
  for (const p of players) {
    const v = valueOf(p);
    if (v != null && v > target) rank++;
  }
  for (const v of extraValues) if (v > target) rank++;
  return rank;
}

export interface PickValueStatus {
  /** "#47" once resolved, "—" while unresolved. */
  label: string;
  /** True for a FUTURE-year pick in a league that HAS custom-ledger data
   *  (so a real, accurate number genuinely exists to compute) but hasn't
   *  been computed yet — the compare panel hasn't been opened, so there's
   *  no post-trade standing to project a slot from. The caller should offer
   *  a "Value?" trigger instead of guessing (Ash, 2026-08-23: "currently
   *  those cards display the wrong value.. not even close to ballpark
   *  value... not display a rank value to those cards until the trade is
   *  proposed"). False whenever a real value WAS found, and also false for
   *  a league with no custom ledger at all — there, the generic ratio-model
   *  estimate is the best available number and isn't withheld. */
  needsCalc: boolean;
}

/** A pick's own trade value, in priority order — but ALWAYS ranked the same
 *  way once found: rankAmongCombined() against real players (leaguePlayers)
 *  plus every OTHER pick's value (pickLedgerValues), the one combined pool
 *  every card on this page uses. Never the ledger's own precomputed
 *  tradeRank verbatim — that number lives inside a differently-shaped pool
 *  (custom-valuations.ts's own combined sort), and mixing it into a page
 *  numbered from THIS pool is exactly what produced a real, visible bug: a
 *  later, lower-value row displaying a smaller (better) rank than the row
 *  above it (see rankAmongCombined's own doc for the live example).
 *  1. The ledger's own real VALUE for a CURRENT-year pick with a known slot
 *     (the precise number the asset-values page itself shows), ranked here.
 *  2. For a FUTURE-year pick with a projected slot (see trade-edge/page.tsx's
 *     withProjectedSlot — team-standing-based, only populated once the
 *     Power Rankings/Category Edge compare panel has been opened), the SAME
 *     real custom-computed value a current-year pick at that identical slot
 *     would carry, sign-aware-decayed for the year gap — not the generic
 *     ratio-model estimate, which was found to diverge wildly from the real
 *     custom curve (Ash, 2026-08-23: caught a real pick #44 the ledger ranks
 *     #357 showing as rank #177 — nearly twice as valuable — once carried
 *     through the generic model instead of the real curve at that slot).
 *  3. UNRESOLVED (needsCalc: true) — a future pick in a custom-ledger league
 *     whose slot hasn't been projected yet. No number is guessed here at
 *     all; the caller shows a "Value?" trigger instead once the pick is
 *     part of a proposed trade.
 *  4. The generic ratio-model estimate (pickEquivalentValue) — only reached
 *     when there's no custom ledger to be more precise than (a standard/
 *     real-salary league), where this really is the best number available,
 *     not a wrong one being hidden.
 *  Shared by DraftPickCardsGrid's own cards and Trade Edge's Trade Verdict
 *  table so a pick reads the same number everywhere. */
export function pickValueStatus(
  pick: TeamDraftPick,
  opts: {
    leaguePlayers?: readonly ResolvedPlayer[];
    baseValueByFantraxId?: ReadonlyMap<string, number>;
    family?: "categories" | "points";
    /** overallPick -> that CURRENT-year pick's real custom-computed trade
     *  value — every ledger pick row that carries a pickKey, reindexed by
     *  its bare slot number so a future pick projected to the same slot can
     *  sample the real curve there. A non-empty map is also this function's
     *  signal that "this league HAS custom-ledger data," gating tier 3
     *  (needsCalc) vs. tier 4 (the generic fallback). */
    currentYearPickValueByOverallPick?: ReadonlyMap<number, number>;
    /** This league's current/imminent draft year — a pick beyond it is a
     *  future pick eligible for tiers 2/3 above. */
    seasonYear?: number;
    /** Every OTHER pick's own value — the generated ledger's rows, PICK
     *  rows only (a full-mode ledger's PLAYER rows must never end up here;
     *  they're already counted once through `leaguePlayers` above, via
     *  baseValueByFantraxId's own ledger-value overlay — see
     *  trade-edge/page.tsx's own ledgerValues doc). Combined with
     *  leaguePlayers via rankAmongCombined for every tier below. */
    pickLedgerValues?: readonly number[];
  },
): PickValueStatus {
  const { leaguePlayers, baseValueByFantraxId, family, currentYearPickValueByOverallPick, seasonYear, pickLedgerValues } = opts;
  const rankOf = (value: number | null): number | null =>
    leaguePlayers
      ? rankAmongCombined(leaguePlayers, (p) => baseValueByFantraxId?.get(p.fantraxId) ?? null, pickLedgerValues ?? [], value)
      : null;

  const isFuture = seasonYear != null && pick.year > seasonYear;
  // currentYearPickValueByOverallPick is keyed by bare overall-pick number,
  // with no year attached — it only ever holds THIS league's current draft
  // class. A future pick can carry a real overallPick too (withProjectedSlot
  // in trade-edge/page.tsx assigns one from a team's projected standing), so
  // this tier must explicitly exclude a future pick rather than let it match
  // the current-year value at that same slot number undecayed — that's
  // exactly what tier 2 below exists to compute correctly instead.
  if (!isFuture && pick.overallPick != null && currentYearPickValueByOverallPick) {
    const v = currentYearPickValueByOverallPick.get(pick.overallPick);
    if (v != null) return { label: formatRank(rankOf(v)), needsCalc: false };
  }
  const hasLedgerData = Boolean(currentYearPickValueByOverallPick && currentYearPickValueByOverallPick.size > 0);
  if (isFuture && hasLedgerData) {
    if (pick.overallPick != null) {
      const anchor = currentYearPickValueByOverallPick!.get(pick.overallPick);
      if (anchor != null) {
        const value = decayFromAnchor(anchor, pick.year - seasonYear!);
        return { label: formatRank(rankOf(value)), needsCalc: false };
      }
    }
    return { label: "—", needsCalc: true };
  }
  if (!leaguePlayers || !baseValueByFantraxId || !family) return { label: "—", needsCalc: false };
  const v = pickEquivalentValue(pick, leaguePlayers, baseValueByFantraxId, family);
  return { label: formatRank(rankOf(v)), needsCalc: false };
}

/** One draft-pick "card" — same footprint (grid cell width, padding, corner
 *  radius) and now the same solid-fill/asset-tier treatment as
 *  PlayerMiniCard (Ash, 2026-08-23: gold for this year's pick, darker FHE
 *  orange for a future 1st, lighter FHE orange for a future 2nd — see
 *  asset-tiers.ts's pickAssetTier). `checked`/`onToggle` are optional —
 *  display-only callers (Roster Edge's own pick panel) pass neither and get
 *  a plain non-interactive card; Trade Edge (the only selectable caller so
 *  far) passes both, mirroring PlayerMiniCard's own checked/onToggle shape
 *  so a pick and a player read as the same kind of selectable trade asset. */
function DraftPickCard({
  pick, seasonYear, checked, onToggle, valueRankLabel, needsCalc, onRequestValue,
}: {
  pick: TeamDraftPick; seasonYear: number; checked?: boolean; onToggle?: () => void;
  /** "#N" — this pick's equivalent trade value, computed by the caller (see
   *  DraftPickCardsGrid's own doc). "—" when that data wasn't supplied
   *  (Roster Edge's own plain display usage) OR when `needsCalc` is true —
   *  the ONLY number this card shows when it shows one at all — Ash,
   *  2026-08-23: "the only value to display on the card is the trade value
   *  rank," always plain white so it reads the same across every tier
   *  color, matching PlayerMiniCard's own rank styling. No source/tier-name
   *  text — the card's a small square with no room for it, and the color
   *  alone already carries the tier. */
  valueRankLabel: string;
  /** True when this is a future pick whose real value hasn't been computed
   *  yet (see pickValueStatus) — the card shows nothing (unchecked) or a
   *  "Value?" trigger (checked) instead of the misleading generic-model
   *  guess this session found reading "not even close to ballpark value"
   *  (Ash, 2026-08-23). */
  needsCalc?: boolean;
  /** Launches the Power Rankings compare (the same computation that
   *  resolves needsCalc) — only rendered once the pick is checked, i.e.
   *  actually part of a proposed trade. */
  onRequestValue?: () => void;
}) {
  const assetTier = pickAssetTier(pick, seasonYear);
  const { bg } = ASSET_TIER_COLOR[assetTier];
  const selectable = Boolean(onToggle);
  const Tag = selectable ? "button" : "div";
  const textShadow = "0 1px 3px rgba(0,0,0,0.45)";
  const inkSoft = "rgba(255,255,255,0.85)";
  const showCalcTrigger = needsCalc && checked && onRequestValue;
  return (
    <Tag
      type={selectable ? "button" : undefined}
      onClick={onToggle}
      title={pick.originalOwnerLabel ? `Acquired from ${pick.originalOwnerLabel}` : undefined}
      style={{
        position: "relative", display: "flex", flexDirection: "column", aspectRatio: "1 / 1",
        padding: 10, borderRadius: 16, border: checked ? "2px solid var(--rt-ink)" : "2px solid transparent",
        background: bg, textAlign: "center", color: "#fff", cursor: selectable ? "pointer" : "default",
        font: "inherit", width: "100%", overflow: "hidden",
      }}
    >
      {checked && (
        <span style={{ position: "absolute", top: 8, right: 8, width: 20, height: 20, borderRadius: 999, background: "var(--rt-ink)", color: "var(--rt-canvas)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>
          ✓
        </span>
      )}
      <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "var(--rt-font-mono)", textShadow }}>{pick.year}</div>
      <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2, textShadow }}>
        {ordinal(pick.round)}
        {pick.overallPick != null && <span style={{ fontSize: 10, fontWeight: 700, color: inkSoft }}> · #{pick.overallPick}</span>}
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {showCalcTrigger ? (
          // A real <button> can't nest inside the card's own <button> (Tag
          // above) — this is a keyboard-accessible span standing in for one,
          // with its own click swallowed before it reaches the card's
          // onToggle so tapping it never un-selects the pick.
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onRequestValue(); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); onRequestValue(); } }}
            style={{
              fontSize: 12, fontWeight: 800, lineHeight: 1, fontFamily: "var(--rt-font-mono)", color: "#fff",
              background: "rgba(0,0,0,0.28)", border: "1px solid rgba(255,255,255,0.6)", borderRadius: 999,
              padding: "6px 12px", cursor: "pointer",
            }}
          >
            Value?
          </span>
        ) : (
          <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, fontFamily: "var(--rt-font-mono)", color: "#fff", textShadow }}>
            {valueRankLabel}
          </div>
        )}
      </div>
      {pick.originalOwnerLabel && (
        <div style={{ fontSize: 9, color: inkSoft, textShadow, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>via {pick.originalOwnerLabel}</div>
      )}
    </Tag>
  );
}

/** A blank placeholder card for a year with zero picks — same footprint as
 *  DraftPickCard, neutral (no round to color it by), carrying emptyYearLabel
 *  as its own message so a missing current-season year is still visible as
 *  a card, not a silent gap in the grid. */
function DraftPickEmptyCard({ year, seasonYear, draftStatus }: { year: number; seasonYear: number; draftStatus: CurrentSeasonDraftStatus }) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5,
        aspectRatio: "1 / 1", padding: 10, borderRadius: 16, border: "1px dashed var(--rt-hairline)",
        textAlign: "center", color: "var(--rt-muted)",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--rt-font-mono)" }}>{year}</div>
      <div style={{ fontSize: 10.5, lineHeight: 1.3 }}>{emptyYearLabel(year, seasonYear, draftStatus)}</div>
    </div>
  );
}

/**
 * A team's owned future draft-pick assets as a grid of pick "cards" —
 * Trade Edge's own placement (one grid per side, matching PlayerMiniCard's
 * grid immediately above it), asset-tier colored so this year's picks read
 * gold and future 1sts/2nds split by shade of orange (see asset-tiers.ts).
 * Same full-year-window behavior as DraftPicksPanel: an empty year still
 * renders (as DraftPickEmptyCard) rather than disappearing.
 */
export function DraftPickCardsGrid({
  teamName, picks, seasonYear, draftStatus, selectedKeys, onTogglePick, leaguePlayers, baseValueByFantraxId, family,
  currentYearPickValueByOverallPick, ledgerValues, onRequestValue, yearsWithLeagueData,
}: {
  teamName: string; picks: readonly TeamDraftPick[]; seasonYear: number; draftStatus: CurrentSeasonDraftStatus;
  /** Every year for which ANY team in the league owns at least one pick —
   *  when supplied, a future year (never the current season) absent from
   *  this set is dropped entirely rather than rendered as an empty
   *  placeholder card, since that means the league hasn't introduced pick
   *  trading that far out yet, not that this one team simply has none this
   *  year (Ash, 2026-08-23). Omit for Roster Edge's own display grid
   *  (unaffected — falls back to the full-window behavior). */
  yearsWithLeagueData?: ReadonlySet<number>;
  /** Trade Edge only — omit all four for a plain display grid (Roster Edge's
   *  own usage), which falls back to "—" for the hero value-rank instead of
   *  computing one. `selectedKeys` holds the same `${year}-${round}-${i}`
   *  string each card is already keyed by below, so the caller doesn't need
   *  a separate id scheme for picks the way it does for players' fantraxId.
   *  `onTogglePick` hands back the pick object alongside its key — the key
   *  alone isn't enough for the caller to reconstruct WHICH pick was
   *  toggled without duplicating this grid's own year/round grouping. */
  selectedKeys?: ReadonlySet<string>;
  onTogglePick?: (key: string, pick: TeamDraftPick) => void;
  /** Last-resort fallback: feed pickEquivalentValue for each card's hero
   *  stat — "this pick's equivalent trade value" — used only when
   *  currentYearPickValueByOverallPick has no entry for a given pick (no
   *  custom ledger at all, or the compare panel hasn't been opened yet to
   *  project a future pick's slot). Always ranked the same combined-pool
   *  way regardless of which tier supplied the value. */
  leaguePlayers?: readonly ResolvedPlayer[];
  baseValueByFantraxId?: ReadonlyMap<string, number>;
  family?: "categories" | "points";
  /** overallPick -> that CURRENT-year pick's real custom-computed trade
   *  value — the precise number for a CURRENT-year pick with a known slot,
   *  ranked (via pickValueStatus's rankOf) against leaguePlayers + every
   *  other pick's value together, taking priority over the generic
   *  ratio-model fallback below. Also what a FUTURE pick projected to the
   *  same slot samples from instead of the generic model — see
   *  pickTradeValueRank's own doc (a real bug: the generic model showed a
   *  future pick nearly TWICE as valuable as the real curve says the same
   *  slot is worth). */
  currentYearPickValueByOverallPick?: ReadonlyMap<number, number>;
  /** Every OTHER pick's own value (the generated ledger's PICK rows only) —
   *  combined with leaguePlayers for every tier of pickValueStatus's rankOf,
   *  so a pick's card and a player's card are always counted against the
   *  SAME pool. See pickValueStatus's own pickLedgerValues doc for why this
   *  must never include a full-mode ledger's PLAYER rows. */
  ledgerValues?: readonly number[];
  /** Launches the Power Rankings compare (see trade-edge/page.tsx) so an
   *  unresolved future pick's real value gets computed — passed only once
   *  a trade partner is picked; the "Value?" trigger only ever renders on a
   *  CHECKED pick, so this being present is what makes that trigger appear. */
  onRequestValue?: () => void;
}) {
  const rows = draftPickYearRows(picks, seasonYear, yearsWithLeagueData);
  const statusFor = (pick: TeamDraftPick) => pickValueStatus(pick, { leaguePlayers, baseValueByFantraxId, family, currentYearPickValueByOverallPick, seasonYear, pickLedgerValues: ledgerValues });
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{teamName} — Draft Picks</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))", gap: 8 }}>
        {rows.map(({ year, picks: yearPicks }) =>
          yearPicks.length > 0
            ? yearPicks.map((p, i) => {
                const key = `${year}-${p.round}-${i}`;
                const status = statusFor(p);
                return (
                  <DraftPickCard
                    key={key}
                    pick={p}
                    seasonYear={seasonYear}
                    checked={selectedKeys?.has(key)}
                    onToggle={onTogglePick ? () => onTogglePick(key, p) : undefined}
                    valueRankLabel={status.label}
                    needsCalc={status.needsCalc}
                    onRequestValue={onRequestValue}
                  />
                );
              })
            : <DraftPickEmptyCard key={year} year={year} seasonYear={seasonYear} draftStatus={draftStatus} />,
        )}
      </div>
    </div>
  );
}
