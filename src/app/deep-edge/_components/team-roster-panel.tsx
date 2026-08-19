"use client";

import { Fragment, useMemo, useState } from "react";
import type { ResolvedPlayer } from "@/lib/fantrax/analyze";
import { CATEGORY_LABEL, type FheCategory } from "@/lib/fantrax/league";
import type { SalaryFormat } from "@/lib/fantrax/league-tags";
import { formatTotal } from "@/lib/fantrax/power-rankings";
import {
  formatStat, meanStd, RosterTableHead, RosterTableRow, summedTotal, weightedAverage,
  type EnrichData, type RosterTableFormat,
} from "./roster-table";

export interface TeamRosterPanelProps {
  roster: { teamId: string; teamName: string; players: ResolvedPlayer[] } | null;
  enrich: EnrichData | null;
  format: RosterTableFormat;
  scored: readonly FheCategory[];
  positionSlots: Record<string, number>;
  /** Whole-league player pool, for the USG heatmap baseline and points-mode
   *  VALUE rank — same "stable baseline regardless of what's visible" idea
   *  Roster Edge's own usgStats uses. */
  leaguePlayers: ResolvedPlayer[];
  salaryFormat: SalaryFormat;
  /** Fantrax ids of the players actually counted into this team's standings
   *  row — the SAME TeamCategoryProfile.starters the page already computed
   *  via buildDepthWeightedProfiles (extended to whatever depth is selected),
   *  not a second lineup solve. Passing this in (rather than re-deriving it
   *  here) is load-bearing, not just tidier: an independent buildOptimalLineup
   *  call per team click duplicated a full branch-and-bound solve on the main
   *  thread for every team the user clicked through — exactly the
   *  "Page Unresponsive" failure mode buildDepthWeightedProfiles' own
   *  exactTeamId already exists to prevent (see its doc comment), just
   *  reintroduced through this panel instead of the standings table. */
  drivingIds: ReadonlySet<string>;
  /** Fantrax id → the BASE (depth-0) starting lineup's slot for that player
   *  ("PG", "SF", "C", "Flx", …) — absent for anyone not in that base
   *  lineup. Drives the Guards/Forwards/Centres/Flex/Reserves/Minors grouping
   *  below; omit it (or pass an empty map) and the roster falls back to one
   *  flat sorted list, same as before that grouping existed. */
  slotByFantraxId?: ReadonlyMap<string, string>;
  /** "totals" mirrors the standings table's own PER GAME/TOTALS toggle —
   *  every counting-stat column (not FG%/FT%) switches from a per-game rate
   *  to a season total, comma-formatted with no decimals (formatTotal).
   *  Defaults to "perGame". */
  statsMode?: "perGame" | "totals";
}

type OptionalCols = { salary: boolean; contract: boolean; dynastyRank: boolean; salaryRank: boolean };

/**
 * Roster sub-header groups (Ash, 2026-08-19: "add a small sub header for
 * Guards, Forwards, Centres, Flex, Reserves, Minors"). A player in the base
 * starting lineup is grouped by the SLOT he actually fills there (not raw
 * position eligibility — a G/F-eligible player who started at PF reads as a
 * Forward here, matching what the lineup actually did); everyone else is a
 * Reserve, or a Minors-slot player specifically if this league's roster has
 * one (Fantrax's own raw slot label, e.g. "Minors"/"Taxi" — the same
 * slot-name matching lineup.ts's RESERVE_SLOTS uses for the same strings).
 */
type PositionGroup = "Guards" | "Forwards" | "Centres" | "Flex" | "Reserves" | "Minors";
const GROUP_ORDER: readonly PositionGroup[] = ["Guards", "Forwards", "Centres", "Flex", "Reserves", "Minors"];
const MINORS_SLOT_NAMES = new Set(["minors", "min", "taxi", "na"]);
function groupForStartingSlot(slot: string): PositionGroup {
  const s = slot.toLowerCase();
  if (s === "pg" || s === "sg" || s === "g") return "Guards";
  if (s === "sf" || s === "pf" || s === "f") return "Forwards";
  if (s === "c") return "Centres";
  return "Flex"; // flx/flex/util or any other generic active slot
}
function groupForBenchPlayer(rawSlot: string): PositionGroup {
  return MINORS_SLOT_NAMES.has(rawSlot.toLowerCase()) ? "Minors" : "Reserves";
}

/**
 * Read-only "which roster is driving this team's power rank" table — Power
 * Rankings' own embed of Roster Edge's row/formatting code. RosterTableRow
 * exists precisely so another Deep Edge tool can show "a player, exactly as
 * Roster Edge shows them" without a second hand-copied version (see its own
 * doc comment in roster-table.tsx).
 *
 * Deliberately simpler than the full Roster Edge page: no per-player tick
 * editing, no tick-depth control of its own, no extra-category picker — the
 * "driving" set comes in as a prop (the standings' own profile), and the
 * leading column is an informational ✓ rather than a checkbox.
 */
export function TeamRosterPanel({ roster, enrich, format, scored, positionSlots, leaguePlayers, salaryFormat, drivingIds, slotByFantraxId, statsMode = "perGame" }: TeamRosterPanelProps) {
  const [cols, setCols] = useState<OptionalCols>({ salary: true, contract: true, dynastyRank: true, salaryRank: true });
  const [hiddenCats, setHiddenCats] = useState<Set<FheCategory>>(new Set());

  const drivingPlayers = useMemo(
    () => (roster ? roster.players.filter((p) => drivingIds.has(p.fantraxId)) : []),
    [roster, drivingIds],
  );
  const sortedPlayers = useMemo(() => {
    if (!roster) return [];
    return [...roster.players].sort((a, b) => {
      const av = (format === "points" ? a.pointsValue : a.leagueV) ?? -Infinity;
      const bv = (format === "points" ? b.pointsValue : b.leagueV) ?? -Infinity;
      return bv - av;
    });
  }, [roster, format]);
  const groupedPlayers = useMemo(() => {
    const buckets = new Map<PositionGroup, ResolvedPlayer[]>(GROUP_ORDER.map((g) => [g, []]));
    for (const p of sortedPlayers) {
      const startingSlot = slotByFantraxId?.get(p.fantraxId);
      const group = startingSlot ? groupForStartingSlot(startingSlot) : groupForBenchPlayer(p.slot);
      buckets.get(group)!.push(p);
    }
    return GROUP_ORDER
      .map((group) => ({ group, players: buckets.get(group)! }))
      .filter(({ players }) => players.length > 0);
  }, [sortedPlayers, slotByFantraxId]);

  const usgStats = useMemo(
    () => meanStd(leaguePlayers.map((p) => p.usgPct).filter((v): v is number => v != null)),
    [leaguePlayers],
  );
  const visibleCats = useMemo(() => scored.filter((c) => !hiddenCats.has(c)), [scored, hiddenCats]);

  const showSalary = cols.salary && salaryFormat !== "none";
  const showContract = cols.contract && salaryFormat !== "none";
  // ✓/PLAYER/TEAM/POS/TREND/GP/MIN/USG/VALUE = 9 always-present columns, plus
  // whichever of SAL$/CONTRACT$/DYN RK/SAL RK are currently shown. MINUS1 is
  // deliberately excluded — it renders as its own <td> right after this
  // colSpan cell, not folded into it (same layout Roster Edge's ticked row uses).
  const colSpanBeforeStats = 9 + (showSalary ? 1 : 0) + (showContract ? 1 : 0) + (cols.dynastyRank ? 1 : 0) + (cols.salaryRank ? 1 : 0);
  const totalCols = colSpanBeforeStats + (format !== "points" ? 1 : 0) + visibleCats.length;

  if (!roster) return null;

  return (
    <div>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{roster.teamName} — Roster</h3>
      <p style={{ fontSize: 12.5, color: "var(--rt-muted)", margin: "0 0 14px", maxWidth: 640 }}>
        The {drivingPlayers.length} players (✓) driving this team&apos;s ranking at the depth selected above, alongside the full roster.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap", fontSize: 12 }}>
        <span style={{ color: "var(--rt-muted)", marginRight: 2 }}>Columns:</span>
        {([
          ["salary", "Salary"], ["contract", "Contract"], ["dynastyRank", "Dynasty rank"], ["salaryRank", "Salary rank"],
        ] as [keyof OptionalCols, string][]).map(([key, label]) => (
          <label key={key} style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
            <input type="checkbox" checked={cols[key]} onChange={() => setCols((c) => ({ ...c, [key]: !c[key] }))} />
            {label}
          </label>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap", fontSize: 12 }}>
        <span style={{ color: "var(--rt-muted)", marginRight: 2 }}>Stats:</span>
        {scored.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setHiddenCats((s) => { const n = new Set(s); if (n.has(cat)) n.delete(cat); else n.add(cat); return n; })}
            style={{
              padding: "4px 10px", borderRadius: 100, border: "1px solid var(--rt-hairline)", cursor: "pointer",
              background: hiddenCats.has(cat) ? "transparent" : "var(--rt-surface-strong)",
              color: hiddenCats.has(cat) ? "var(--rt-muted)" : "var(--rt-ink)", fontWeight: 600,
            }}
          >
            {CATEGORY_LABEL[cat]}
          </button>
        ))}
      </div>

      <div className="de-table-wrap">
        <table className="de-table de-table-roster">
          <thead>
            <RosterTableHead
              leadingLabel="✓"
              visibleCats={visibleCats}
              showSalary={showSalary}
              showContract={showContract}
              showDynastyRank={cols.dynastyRank}
              showSalaryRank={cols.salaryRank}
              isPoints={format === "points"}
            />
          </thead>
          <tbody>
            {drivingPlayers.length > 0 && (
              <tr className="mine">
                <td colSpan={colSpanBeforeStats} className="l">
                  Σ {drivingPlayers.length} DRIVING — {statsMode === "totals" ? "season totals" : "weighted per-game average"}
                </td>
                {format !== "points" && <td>—</td>}
                {visibleCats.map((cat) => {
                  const raw = statsMode === "totals" ? summedTotal(drivingPlayers, cat) : weightedAverage(drivingPlayers, cat);
                  const text = raw == null ? "—" : statsMode === "totals" ? formatTotal(cat, raw) : formatStat(cat, raw);
                  return <td key={cat}>{text}</td>;
                })}
              </tr>
            )}
            {groupedPlayers.map(({ group, players }) => (
              <Fragment key={group}>
                <tr>
                  <td
                    colSpan={totalCols}
                    className="l"
                    style={{
                      background: "var(--rt-surface-strong)", color: "var(--rt-muted)", fontFamily: "var(--rt-font-mono)",
                      fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
                    }}
                  >
                    {group}
                  </td>
                </tr>
                {players.map((p) => (
                  <RosterTableRow
                    key={p.fantraxId}
                    player={p}
                    enrich={enrich}
                    format={format}
                    scored={scored}
                    visibleCats={visibleCats}
                    showSalary={showSalary}
                    showContract={showContract}
                    showDynastyRank={cols.dynastyRank}
                    showSalaryRank={cols.salaryRank}
                    salaryFormat={salaryFormat}
                    statsMode={statsMode}
                    positionSlots={positionSlots}
                    leaguePlayers={leaguePlayers}
                    usgStats={usgStats}
                    leadingCell={<td>{drivingIds.has(p.fantraxId) ? "✓" : ""}</td>}
                  />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
