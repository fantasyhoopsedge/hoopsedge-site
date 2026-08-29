"use client";

import { Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import { HubShell } from "../../_components/hub-shell";
import { DEEP_EDGE_TABLE_CSS, SortTh, useSortableTable } from "../../_components/sortable-table";
import { useActiveLeague } from "../../_lib/use-saved-leagues";
import { TeamLogo, formatCustomSalary, formatRank, formatSalary, statBg, valueBg } from "../../_components/roster-table";
import { PlayerHeadshot } from "@/app/team-rosters/_components/roster-headshot";
import { Modal } from "../../_components/modal";
import { CategoryRadarChart, DashboardCard, type RadarPoint } from "../../_components/category-dashboard";
import { CATEGORY_LABEL, FHE_CATEGORIES, type FheCategory } from "@/lib/fantrax/league";
import { categoryEdges, projectRotoStandings, type LeagueAnalysis, type ResolvedPlayer, type TeamCategoryProfile } from "@/lib/fantrax/analyze";
import { formatTotal } from "@/lib/fantrax/power-rankings";
import {
  deriveRankingsFormat, depthWeight, rotoStandingsByRawStat, simulateH2HCategoryStandings, simulateH2HPointsStandings,
} from "@/lib/fantrax/power-rankings";
import { resolveEffectiveScoring, type LineupValueMode } from "@/lib/fantrax/lineup";
import { addDropProfiles, categoryDeltas, type CategoryDelta } from "@/lib/fantrax/waiver-sim";
import { DEFAULT_GAMES_CAP_SETTINGS, DEFAULT_LEAGUE_TAGS } from "@/lib/fantrax/league-tags";
import type { SavedLeague } from "@/lib/fantrax/store";
import type { WaiverAssetRow, WaiverEdgeResult } from "@/lib/fantrax/waiver-edge";

/**
 * Waiver Edge (Ash, 2026-08-29, revised 2026-08-30) — every free agent in a
 * connected league, ranked for that league's own format. Same table shell
 * League Rankings uses (DEEP_EDGE_TABLE_CSS, roster-table.tsx's TeamLogo/
 * formatRank/formatSalary/formatCustomSalary/statBg/valueBg, PlayerHeadshot)
 * but scoped to free agents only.
 *
 * Column order (Ash, 2026-08-30): ADD, RANK, FREE AGENT, TEAM, AGE, LEAGUE
 * RANK, DYN RANK/SAL RANK (one slot — see below), SALARY (if applicable),
 * GP, MIN, USG, CATV/FPTS, then the 9 categories. Every column sorts
 * (SortTh/useSortableTable, the same pattern Category Edge/Power Rankings/
 * Roster Edge already use) — category columns sort by Z-SCORE, never the
 * raw stat (see sortValueOf's own doc for why that matters for FG%/FT%).
 *
 * CATV is the one category-value column, driven by a Minus1V/8CatV/9CatV
 * selector (not per-category punting, which read as unwired/confusing —
 * these three are the only value flavors FHE's engine actually names).
 * Picking 8CatV automatically greys out TO (that IS the definition of
 * 8CatV — see analyze.ts's eightCatVOf), no separate toggle needed. CATV
 * follows the Per-game/Totals toggle: Minus1V/9CatV read the precomputed
 * totals-mode columns, 8CatV re-derives the mean-of-8 from whichever catsZ
 * set (per-game or totals) the toggle currently selects.
 *
 * LEAGUE RANK is this free agent's rank within the LEAGUE'S OWN generated
 * custom-valuations ledger (not a re-derived number) — and it ONLY EXISTS
 * for a custom-salary league (canHaveLeagueRank): the "generate asset
 * values" flow (deep-edge/home/page.tsx) produces a FULL, player-priced
 * ledger exclusively for salaryFormat "custom"; every other format only
 * ever gets a picksOnly ledger with zero player/FA rows, no matter how many
 * times the generator runs. The column (and its "hasn't generated yet"
 * banner) is hidden entirely for any other format — showing either would
 * point the user at a fix that can never actually populate it. Within a
 * custom-salary league, it's blank with the banner until that league's own
 * ledger has been generated (see waiver-edge.ts's own header for what
 * "generated" means there). DYN RANK/SAL RANK share one column slot: a
 * real-salary league shows the site-wide Real Salary rank there instead of
 * dynasty consensus, since that's the number actually driving value for
 * that league. SALARY (a free agent's real-world NBA salary, since their
 * in-league salary is always null) shows for both real- and custom-salary
 * leagues; none of LEAGUE RANK/DYN RANK/SALARY apply to a points league.
 *
 * The Add/Drop Simulator (bottom of this file) answers "if I made this move,
 * what happens to my team?" — pick free agents here (the ADD column), pick
 * 0+ of your own roster to drop inside the simulator, and it reuses the same
 * depth-weighted lineup engine Power Rankings/Trade Edge already run
 * (buildDepthWeightedProfiles/buildOptimalLineup) to show Power Rank and
 * Roto Points/Win% before vs. after, plus the category-rank radar Category
 * Edge's own dashboard uses. See waiver-sim.ts's header for why the add-pool
 * is capped to the league's top-60 valued free agents (resolve.ts's own
 * waiverBoard) rather than every row in this table.
 */

type ClassFilterKey = "rookie" | "soph" | "vet";
const POSITION_OPTIONS = ["G", "F", "C"] as const;
type PositionFilterKey = (typeof POSITION_OPTIONS)[number];
type StatMode = "perGame" | "totals";
type CatvMode = "minus1" | "eightCat" | "nineCat";
const CATV_OPTIONS: { value: CatvMode; label: string }[] = [
  { value: "minus1", label: "Minus1V" },
  { value: "eightCat", label: "8CatV" },
  { value: "nineCat", label: "9CatV" },
];
type SortKey =
  | "name" | "team" | "age" | "leagueRank" | "dynRank" | "salaryRank" | "salary" | "gp" | "min" | "usg" | "value"
  | FheCategory;
interface CartEntry { fantraxId: string; name: string }

const STAT_CATS: readonly FheCategory[] = ["PTS", "FG3", "REB", "AST", "STL", "BLK", "FG", "FT", "TO"];
/** Stable reference for the "no scoring info yet" case — a fresh `[]`
 *  literal on every render would defeat downstream useMemo dependencies
 *  (categoryDeltas', radarFor's own scored.length checks) that key off it. */
const EMPTY_SCORED: readonly FheCategory[] = [];

function classOf(a: { isRookie: boolean; isSophomore: boolean }): ClassFilterKey {
  if (a.isRookie) return "rookie";
  if (a.isSophomore) return "soph";
  return "vet";
}

function touchesPosition(pos: string | null, group: PositionFilterKey): boolean {
  return Boolean(pos?.includes(group));
}

function pill(active: boolean, activeBg = "var(--rt-canvas)"): CSSProperties {
  return {
    padding: "7px 14px", border: "none", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
    background: active ? activeBg : "transparent", color: active ? "var(--rt-ink)" : "var(--rt-muted)",
  };
}

/** Mean of the 8 non-TO category z-scores — the fixed, universal definition
 *  of 8CatV (see analyze.ts's eightCatVOf), re-derived here (rather than a
 *  stored column) so it can run against EITHER the per-game or totals catsZ
 *  set depending on the Per-game/Totals toggle. Null when the player has no
 *  z-score for anything but TO. */
function eightCatTotal(catsZ: Partial<Record<FheCategory, number>>): number | null {
  let sum = 0, n = 0;
  for (const cat of FHE_CATEGORIES) {
    if (cat === "TO") continue;
    const z = catsZ[cat];
    if (z == null) continue;
    sum += z; n++;
  }
  return n > 0 ? sum / n : null;
}

/** CATV — whichever of Minus1V/8CatV/9CatV the viewer picked, following the
 *  Per-game/Totals toggle. Points leagues never call this (FPTS drives VALUE
 *  there instead — see waiverValueOf). */
function catvOf(a: WaiverAssetRow, mode: CatvMode, statMode: StatMode): number | null {
  if (mode === "minus1") return statMode === "totals" ? a.minus1VTotals : a.minus1V;
  if (mode === "nineCat") return statMode === "totals" ? a.nineCatVTotals : a.nineCatV;
  return eightCatTotal(statMode === "totals" ? a.catsZTotals : a.catsZ);
}

function waiverValueOf(a: WaiverAssetRow, family: "categories" | "points", catvMode: CatvMode, statMode: StatMode): number | null {
  return family === "points" ? a.fpts : catvOf(a, catvMode, statMode);
}

/** Category columns sort by Z-SCORE, never the raw stat — FG%/FT% in
 *  particular are volume-weighted in how the value engine standardizes them
 *  (CLAUDE.md: "FG%/FT% league averages are volume-weighted"), so the raw
 *  percentage alone would rank a low-volume hot streak above a genuinely
 *  better, higher-volume shooter. `statMode` picks per-game vs totals catsZ,
 *  matching whichever the viewer is currently looking at. */
function sortValueOf(row: { asset: WaiverAssetRow; value: number | null }, key: SortKey, statMode: StatMode): number | string | null {
  const a = row.asset;
  switch (key) {
    case "name": return a.name;
    case "team": return a.nbaTeam ?? "";
    case "age": return a.age;
    case "leagueRank": return a.leagueRank;
    case "dynRank": return a.dynRank;
    case "salaryRank": return a.salaryRank;
    case "salary": return a.salary;
    case "gp": return a.gamesPlayed;
    case "min": return a.minutesPerGame;
    case "usg": return a.usgPct;
    case "value": return row.value;
    default: return (statMode === "totals" ? a.catsZTotals[key] : a.catsZ[key]) ?? null;
  }
}

function statCell(raw: number | undefined, cat: FheCategory, gamesPlayed: number | null, statMode: StatMode): string {
  if (raw == null) return "—";
  if (cat === "FG" || cat === "FT") return `${(raw * 100).toFixed(1)}%`;
  if (statMode === "totals") return formatTotal(cat, raw * (gamesPlayed ?? 0));
  return raw.toFixed(1);
}

function WaiverEdgeContent() {
  const { saved, loading: loadingSaved } = useActiveLeague();
  const [data, setData] = useState<WaiverEdgeResult | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState("");

  const [catvMode, setCatvMode] = useState<CatvMode>("minus1");
  const [catvModeInitialized, setCatvModeInitialized] = useState(false);
  const [classFilter, setClassFilter] = useState<Set<ClassFilterKey>>(new Set());
  const [positionFilter, setPositionFilter] = useState<Set<PositionFilterKey>>(new Set());
  const [statMode, setStatMode] = useState<StatMode>("perGame");
  const [cart, setCart] = useState<Map<string, CartEntry>>(new Map());
  const [simOpen, setSimOpen] = useState(false);

  useEffect(() => {
    if (!saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting derived loading state when the league this effect depends on is absent, not a plain render-time computation
      setLoadingData(false);
      return;
    }
    setLoadingData(true);
    setError("");
    const params = new URLSearchParams({
      leagueId: saved.leagueId,
      dataset: saved.settings.defaultDataset ?? DEFAULT_LEAGUE_TAGS.defaultDataset,
      leagueType: saved.settings.leagueType ?? DEFAULT_LEAGUE_TAGS.leagueType,
      salaryFormat: saved.settings.salaryFormat ?? DEFAULT_LEAGUE_TAGS.salaryFormat,
    });
    if (saved.teamId) params.set("teamId", saved.teamId);
    if (saved.settings.useCustomValuations) params.set("useCustomValuations", "1");
    if (saved.settings.useGeneratedPickValues) params.set("useGeneratedPickValues", "1");
    fetch(`/api/fantrax/waiver-edge?${params}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setData(d as WaiverEdgeResult);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoadingData(false));
  }, [saved?.leagueId, saved?.teamId]); // eslint-disable-line react-hooks/exhaustive-deps -- settings fields read fresh each fetch, same convention league-rankings/page.tsx's own fetch effect uses

  // Default CATV flavor follows THIS league's own scored categories: a
  // 9-cat league opens on Minus1V, an 8-cat (punt-TO) league opens on 8CatV
  // — reproducing "default ranking for a 9cat league is Minus1, for an 8cat
  // league is 8cat" without hardcoding either. Only ever runs once per
  // league load, so a viewer's own manual pick is never overwritten
  // mid-session.
  useEffect(() => {
    if (!data || catvModeInitialized) return;
    const nineCat = data.scoredCategories.length === 9;
    const eightCatPuntTO = data.scoredCategories.length === 8 && !data.scoredCategories.includes("TO");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time default derived from the just-loaded league's own scored categories, not a plain render-time computation
    setCatvMode(nineCat ? "minus1" : eightCatPuntTO ? "eightCat" : "nineCat");
    setCatvModeInitialized(true);
  }, [data, catvModeInitialized]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a NEW league load must re-run the default-CATV effect above rather than keep the previous league's pick
    setCatvModeInitialized(false);
  }, [saved?.leagueId]);

  const isPoints = data?.family === "points";
  const salaryFormat = data?.salaryFormat ?? "none";
  // A real-salary league cares about the site-wide Real Salary rank more
  // than plain dynasty consensus, so it takes that column's ONE slot
  // instead of adding a second — every other format keeps Dyn Rank there.
  const useSalaryRank = !isPoints && salaryFormat === "real";
  const showSalary = !isPoints && (salaryFormat === "real" || salaryFormat === "custom");
  const fmtSalary = (n: number | null) => (salaryFormat === "custom" ? formatCustomSalary(n) : formatSalary(n));
  // LEAGUE RANK only ever exists for a custom-salary league: the "generate
  // asset values" flow produces a FULL (player-priced) ledger exclusively
  // for salaryFormat "custom" — every other format (none/real) only ever
  // gets a picksOnly ledger with zero player/FA rows, no matter how many
  // times the generator runs (deep-edge/home/page.tsx's own
  // isCustomSalaryLeague gate — the ONLY place "full" mode is dispatched).
  // Showing this column (or a "go generate it" banner) for any other format
  // would be pointing the user at a fix that can never actually populate it
  // — reported live on a real, non-custom-salary league that HAD already
  // run the generator (its picks were priced) yet still showed the
  // "hasn't generated" alert here.
  const canHaveLeagueRank = salaryFormat === "custom";

  const filteredRows = useMemo(() => {
    if (!data) return [];
    return data.assets.filter(
      (a) => (classFilter.size === 0 || classFilter.has(classOf(a)))
        && (positionFilter.size === 0 || [...positionFilter].some((g) => touchesPosition(a.pos, g))),
    );
  }, [data, classFilter, positionFilter]);

  const rowsWithValue = useMemo(
    () => filteredRows.map((a) => ({ asset: a, value: waiverValueOf(a, data?.family ?? "categories", catvMode, statMode) })),
    [filteredRows, catvMode, statMode, data?.family],
  );

  const { sort, onSort, sorted } = useSortableTable<{ asset: WaiverAssetRow; value: number | null }, SortKey>(
    rowsWithValue,
    { key: "value", dir: "desc" },
    (row, key) => sortValueOf(row, key, statMode),
  );

  function toggleCart(a: WaiverAssetRow) {
    setCart((prev) => {
      const next = new Map(prev);
      if (next.has(a.fantraxId)) next.delete(a.fantraxId);
      else next.set(a.fantraxId, { fantraxId: a.fantraxId, name: a.name });
      return next;
    });
  }

  function removeFromCart(fantraxId: string) {
    setCart((prev) => {
      const next = new Map(prev);
      next.delete(fantraxId);
      return next;
    });
  }

  return (
    <HubShell hasLeague={Boolean(saved)} breadcrumb={saved ? `${saved.leagueName} · Waiver Edge` : "Waiver Edge"}>
      <style>{DEEP_EDGE_TABLE_CSS}</style>
      <style>{`
        .we-table th, .we-table td { font-family: var(--rt-font-sans); }
        .we-table td.l, .we-table th.l { text-align: left; }
        .we-add-btn {
          width: 24px; height: 24px; border-radius: 999px; border: 1px solid var(--rt-hairline); background: var(--rt-canvas);
          color: var(--rt-ink); font-weight: 700; cursor: pointer; line-height: 1;
        }
        .we-add-btn-active { background: var(--rt-up); border-color: var(--rt-up); color: #fff; }
        .we-chip {
          display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px;
          background: var(--rt-surface-strong); font-size: 12px;
        }
        .we-chip button { background: none; border: none; color: var(--rt-muted); cursor: pointer; font-weight: 700; padding: 0; }
      `}</style>

      <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>Waiver Edge</h1>
      <p style={{ color: "var(--rt-body)", fontSize: 14, margin: "0 0 20px", maxWidth: 680 }}>
        Every free agent in {saved?.leagueName ?? "your league"}, ranked for its own scoring format. Every column sorts —
        click a header. Only free agents show here; nothing to filter by fantasy team.
      </p>

      {loadingSaved ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>Loading…</p>
      ) : !saved ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>No league connected yet — add one from Home.</p>
      ) : (
        <>
          {data && canHaveLeagueRank && !data.leagueValuesGenerated && (
            <p style={{ fontSize: 12.5, color: "var(--rt-muted)", background: "var(--rt-surface-soft)", border: "1px solid var(--rt-hairline)", borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
              This league hasn&apos;t generated custom asset values yet, so LEAGUE RANK is blank for every free agent.
              Generate them from{" "}
              <a href={`/deep-edge/home${saved.leagueId ? `?league=${encodeURIComponent(saved.leagueId)}` : ""}`} style={{ color: "var(--rt-primary)", fontWeight: 600 }}>
                Home
              </a>.
            </p>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
            {!isPoints && (
              <>
                <span style={{ fontSize: 11.5, color: "var(--rt-muted)", fontWeight: 600 }}>CATV</span>
                <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
                  {CATV_OPTIONS.map(({ value, label }) => (
                    <button key={value} type="button" onClick={() => setCatvMode(value)} style={pill(catvMode === value)}>
                      {label}
                    </button>
                  ))}
                </div>
                {catvMode === "eightCat" && (
                  <span style={{ fontSize: 11.5, color: "var(--rt-muted)" }}>TO excluded</span>
                )}
              </>
            )}
            <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999, marginLeft: "auto" }}>
              {(["perGame", "totals"] as StatMode[]).map((v) => (
                <button key={v} type="button" onClick={() => setStatMode(v)} style={pill(statMode === v)}>
                  {v === "perGame" ? "Per game" : "Totals"}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11.5, color: "var(--rt-muted)", fontWeight: 600 }}>Position</span>
            <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
              <button type="button" onClick={() => setPositionFilter(new Set())} style={pill(positionFilter.size === 0)}>ALL</button>
              {POSITION_OPTIONS.map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => setPositionFilter((prev) => {
                    const next = new Set(prev);
                    if (next.has(pos)) next.delete(pos); else next.add(pos);
                    return next;
                  })}
                  style={pill(positionFilter.has(pos))}
                >
                  {pos}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 11.5, color: "var(--rt-muted)", fontWeight: 600, marginLeft: 8 }}>Class</span>
            <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
              <button type="button" onClick={() => setClassFilter(new Set())} style={pill(classFilter.size === 0)}>ALL</button>
              {([["rookie", "Rookies"], ["soph", "Sophomores"], ["vet", "Veterans"]] as [ClassFilterKey, string][]).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setClassFilter((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key); else next.add(key);
                    return next;
                  })}
                  style={pill(classFilter.has(key))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap", padding: "10px 14px", border: "1px solid var(--rt-hairline)", borderRadius: 12, background: "var(--rt-surface-soft)" }}>
            <strong style={{ fontSize: 13 }}>Add/Drop Simulator</strong>
            <span style={{ fontSize: 12.5, color: "var(--rt-muted)" }}>
              {cart.size === 0 ? "Pick free agents with the + column, or open it to simulate a drop only." : `${cart.size} free agent${cart.size === 1 ? "" : "s"} selected to add`}
            </span>
            {cart.size > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[...cart.values()].map((c) => (
                  <span key={c.fantraxId} className="we-chip">
                    {c.name}
                    <button type="button" onClick={() => removeFromCart(c.fantraxId)} aria-label={`Remove ${c.name}`}>×</button>
                  </span>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setSimOpen(true)}
              style={{ marginLeft: "auto", height: 34, padding: "0 16px", borderRadius: 8, border: "none", background: "var(--rt-primary)", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
            >
              Open Simulator
            </button>
          </div>

          {error && <p style={{ color: "var(--rt-down)", fontSize: 13.5, marginBottom: 16 }}>{error}</p>}
          {loadingData ? (
            <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>Loading…</p>
          ) : data && (
            <div className="de-table-wrap" style={{ maxHeight: "calc(100vh - 460px)", minHeight: 320, overflowY: "auto" }}>
              <table className="de-table we-table">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>ADD</th>
                    <th>RANK</th>
                    <SortTh<SortKey> label="FREE AGENT" sortKey="name" sort={sort} onSort={onSort} align="left" />
                    <SortTh<SortKey> label="TEAM" sortKey="team" sort={sort} onSort={onSort} />
                    <SortTh<SortKey> label="AGE" sortKey="age" sort={sort} onSort={onSort} />
                    {canHaveLeagueRank && (
                      <SortTh<SortKey>
                        label="LEAGUE RANK"
                        sortKey="leagueRank"
                        sort={sort}
                        onSort={onSort}
                        title={data.leagueValuesGenerated ? undefined : "This league hasn't generated custom asset values yet"}
                      />
                    )}
                    <SortTh<SortKey> label={useSalaryRank ? "SAL RANK" : "DYN RANK"} sortKey={useSalaryRank ? "salaryRank" : "dynRank"} sort={sort} onSort={onSort} />
                    {showSalary && <SortTh<SortKey> label="SALARY" sortKey="salary" sort={sort} onSort={onSort} />}
                    <SortTh<SortKey> label="GP" sortKey="gp" sort={sort} onSort={onSort} />
                    <SortTh<SortKey> label="MIN" sortKey="min" sort={sort} onSort={onSort} />
                    <SortTh<SortKey> label="USG" sortKey="usg" sort={sort} onSort={onSort} />
                    <SortTh<SortKey> label={isPoints ? "FPTS" : "CATV"} sortKey="value" sort={sort} onSort={onSort} />
                    {STAT_CATS.map((cat) => {
                      const punted = !isPoints && catvMode === "eightCat" && cat === "TO";
                      return (
                        <SortTh<SortKey>
                          key={cat}
                          label={CATEGORY_LABEL[cat]}
                          sortKey={cat}
                          sort={sort}
                          onSort={onSort}
                          title={punted ? "Excluded from 8CatV" : undefined}
                        />
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(({ asset: a, value }, i) => {
                    const inCart = cart.has(a.fantraxId);
                    return (
                      <tr key={a.key}>
                        <td>
                          <button
                            type="button"
                            className={`we-add-btn${inCart ? " we-add-btn-active" : ""}`}
                            onClick={() => toggleCart(a)}
                            aria-pressed={inCart}
                            title={inCart ? "Remove from simulator" : "Add to simulator"}
                          >
                            {inCart ? "✓" : "+"}
                          </button>
                        </td>
                        <td>{i + 1 <= 10 ? <span style={{ color: "var(--rt-primary)", fontWeight: 700 }}>{i + 1}</span> : i + 1}</td>
                        <td className="l">
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <PlayerHeadshot name={a.name} size={26} initials={a.name.split(" ").map((w) => w[0]).slice(0, 2).join("")} background="var(--rt-surface-strong)" color="var(--rt-ink)" fontSize={10} rookie={a.isRookie} />
                            <span>
                              <span className="de-player-name">{a.name}</span>
                              {a.pos && <span style={{ color: "var(--rt-muted)", marginLeft: 6, fontSize: 11 }}>{a.pos}</span>}
                            </span>
                          </div>
                        </td>
                        <td>{a.nbaTeam ? <TeamLogo team={a.nbaTeam} size={34} /> : <span style={{ color: "var(--rt-muted)" }}>—</span>}</td>
                        <td>{a.age != null ? a.age.toFixed(1) : "—"}</td>
                        {canHaveLeagueRank && <td>{data.leagueValuesGenerated ? formatRank(a.leagueRank) : "—"}</td>}
                        <td>{formatRank(useSalaryRank ? a.salaryRank : a.dynRank)}</td>
                        {showSalary && <td>{fmtSalary(a.salary)}</td>}
                        <td>{a.gamesPlayed ?? "—"}</td>
                        <td>{a.minutesPerGame != null ? (statMode === "totals" ? Math.round(a.minutesPerGame * (a.gamesPlayed ?? 0)).toLocaleString("en-US") : a.minutesPerGame.toFixed(1)) : "—"}</td>
                        <td>{a.usgPct != null ? `${a.usgPct.toFixed(1)}%` : "—"}</td>
                        <td style={{ fontWeight: 700, background: valueBg(value) }}>{value != null ? value.toFixed(2) : "—"}</td>
                        {STAT_CATS.map((cat) => {
                          const punted = !isPoints && catvMode === "eightCat" && cat === "TO";
                          const z = statMode === "totals" ? a.catsZTotals[cat] : a.catsZ[cat];
                          return (
                            <td key={cat} style={punted ? { background: "var(--rt-surface-strong)", color: "var(--rt-muted)" } : { background: statBg(z) }}>
                              {statCell(a.catsRaw[cat], cat, a.gamesPlayed, statMode)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {simOpen && saved && (
        <AddDropSimulatorModal saved={saved} cart={cart} catvMode={catvMode} data={data} onRemoveFromCart={removeFromCart} onClose={() => setSimOpen(false)} />
      )}
    </HubShell>
  );
}

// ── Add/Drop Simulator ───────────────────────────────────────────────────

type SimFormat = "roto" | "h2hcat" | "points";
/** Same depth ladder Power Rankings' own "Starters/+1/../+5" control uses
 *  (rankings/page.tsx) — index into this array IS the depth value
 *  buildDepthWeightedProfiles expects, so the two controls stay identical
 *  in both label and meaning. */
const DEPTH_LABELS = ["Starters", "+1", "+2", "+3", "+4", "+5"];

/** A roster player's value under whichever CATV flavor (or FPTS) the main
 *  Waiver Edge table currently has selected — the ResolvedPlayer-shaped
 *  counterpart to the page's own catvOf(), used to order the "Dropping"
 *  checklist worst-to-best by that same metric. */
function rosterValueOf(p: ResolvedPlayer, isPoints: boolean, catvMode: CatvMode, statMode: StatMode): number | null {
  if (isPoints) return p.pointsValue;
  if (catvMode === "minus1") return statMode === "totals" ? p.catV?.totals.minus1V ?? null : p.catV?.perGame.minus1V ?? null;
  if (catvMode === "nineCat") return statMode === "totals" ? p.catV?.totals.nineCatV ?? null : p.catV?.perGame.nineCatV ?? null;
  return eightCatTotal(statMode === "totals" ? p.catsTotals : p.cats);
}

function StatCompare({
  label, before, after, format, higherBetter = true,
}: {
  label: string;
  before: number | null;
  after: number | null;
  /** How to render the two numbers — "rank" shows "#N", "pct" shows a
   *  percentage, "num" shows a plain fixed-1 number. */
  format: "rank" | "pct" | "num";
  /** Rank is lower-is-better; everything else here is higher-is-better. */
  higherBetter?: boolean;
}) {
  const fmt = (v: number | null) => {
    if (v == null) return "—";
    if (format === "rank") return `#${v}`;
    if (format === "pct") return `${(v * 100).toFixed(1)}%`;
    return v.toFixed(1);
  };
  const better = before != null && after != null && (higherBetter ? after > before : after < before);
  const worse = before != null && after != null && (higherBetter ? after < before : after > before);
  const color = better ? "var(--rt-up)" : worse ? "var(--rt-down)" : "var(--rt-ink)";
  return (
    <div style={{ padding: 14, borderRadius: 12, border: "1px solid var(--rt-hairline)", minWidth: 150 }}>
      <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 10.5, color: "var(--rt-muted)", marginBottom: 6 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>
        <span style={{ color: "var(--rt-muted)" }}>{fmt(before)}</span>
        {" → "}
        <span style={{ color }}>{fmt(after)}</span>
      </div>
    </div>
  );
}

function CategoryDeltaList({ title, color, deltas }: { title: string; color: string; deltas: CategoryDelta[] }) {
  return (
    <div style={{ minWidth: 200 }}>
      <h4 style={{ fontSize: 12.5, fontWeight: 700, color, margin: "0 0 8px" }}>{title}</h4>
      {deltas.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--rt-muted)", margin: 0 }}>None</p>
      ) : (
        deltas.map((d) => (
          <div key={d.category} style={{ fontSize: 12.5, marginBottom: 4 }}>
            <strong>{CATEGORY_LABEL[d.category]}</strong>{" "}
            <span style={{ color: "var(--rt-muted)" }}>#{d.rankBefore} → #{d.rankAfter}</span>
          </div>
        ))
      )}
    </div>
  );
}

/** Σ salary across a roster/add slate, reading a per-fantraxId override
 *  first — a free agent's own ResolvedPlayer.salary is always null (never
 *  rostered), so ADD candidates need the real-world fallback the main
 *  Waiver Edge table already computed (data.assets[].salary), while DROP
 *  candidates (already rostered) use their own real in-league salary as-is. */
function sumSalary(players: { fantraxId: string; salary: number | null }[], overrideByFantraxId?: ReadonlyMap<string, number | null>): number {
  let total = 0;
  for (const p of players) {
    const s = overrideByFantraxId?.get(p.fantraxId) ?? p.salary;
    if (s != null) total += s;
  }
  return total;
}

/** One standings row this modal's "full standings" popup needs — rank +
 *  the metric this league's own format actually reads (roto points, or
 *  win% for either H2H flavor), independent of `format` from then on. */
interface StandingsRow { teamId: string; teamName: string; rank: number; metric: string }

function standingsRows(format: SimFormat, profiles: TeamCategoryProfile[], scored: readonly FheCategory[], statMode: StatMode): StandingsRow[] {
  if (format === "roto") {
    return rotoStandingsByRawStat(profiles, scored, statMode)
      .map((r) => ({ teamId: r.teamId, teamName: r.teamName, rank: r.projectedRank, metric: r.totalPoints.toFixed(1) }))
      .sort((a, b) => a.rank - b.rank);
  }
  const rows = format === "h2hcat" ? simulateH2HCategoryStandings(profiles, scored) : simulateH2HPointsStandings(profiles);
  return rows
    .map((r) => ({ teamId: r.teamId, teamName: r.teamName, rank: r.rank, metric: `${(r.winPct * 100).toFixed(1)}%` }))
    .sort((a, b) => a.rank - b.rank);
}

function StandingsTable({ title, rows, myTeamId }: { title: string; rows: StandingsRow[]; myTeamId: string }) {
  return (
    <div>
      <h4 style={{ fontSize: 12, fontFamily: "var(--rt-font-mono)", color: "var(--rt-muted)", margin: "0 0 8px" }}>{title}</h4>
      <div style={{ maxHeight: 420, overflowY: "auto" }}>
        <table className="de-table">
          <thead><tr><th>RANK</th><th className="l">TEAM</th><th>PTS/WIN%</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.teamId} className={r.teamId === myTeamId ? "mine" : undefined}>
                <td>{r.rank}</td>
                <td className="l">{r.teamName}</td>
                <td>{r.metric}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FullStandingsModal({
  format, before, after, scored, statMode, myTeamId, onClose,
}: {
  format: SimFormat;
  before: TeamCategoryProfile[];
  after: TeamCategoryProfile[];
  scored: readonly FheCategory[];
  statMode: StatMode;
  myTeamId: string;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} width={640}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Full Power Rankings</h2>
        <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, lineHeight: 1, cursor: "pointer", color: "var(--rt-muted)" }} aria-label="Close">×</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <StandingsTable title="BEFORE" rows={standingsRows(format, before, scored, statMode)} myTeamId={myTeamId} />
        <StandingsTable title="AFTER" rows={standingsRows(format, after, scored, statMode)} myTeamId={myTeamId} />
      </div>
    </Modal>
  );
}

function AddDropSimulatorModal({
  saved, cart, catvMode, data, onRemoveFromCart, onClose,
}: {
  saved: SavedLeague;
  cart: Map<string, CartEntry>;
  /** The main table's CATV selection — the "Dropping" checklist orders your
   *  roster worst-to-best by this same flavor (Ash: "dynamically linked to
   *  whatever value is selected"). Read-only here; changing it happens on
   *  the main table, not inside the simulator. */
  catvMode: CatvMode;
  /** The main table's own fetched result — reused here for two things a
   *  ResolvedPlayer alone can't give: a free agent's real-world salary
   *  fallback (data.assets[].salary) and this league's ledger-wide
   *  leagueRankByFantraxId (rostered players included, unlike `assets`,
   *  which is free agents only). Null before the main table's own fetch
   *  resolves — the simulator degrades gracefully (no salary/league-rank
   *  annotations) rather than blocking on it. */
  data: WaiverEdgeResult | null;
  onRemoveFromCart: (fantraxId: string) => void;
  onClose: () => void;
}) {
  const [analysis, setAnalysis] = useState<LeagueAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dropIds, setDropIds] = useState<Set<string>>(new Set());
  const [depth, setDepth] = useState(0);
  const [statMode, setStatMode] = useState<StatMode>("perGame");
  const [result, setResult] = useState<{ before: TeamCategoryProfile[]; after: TeamCategoryProfile[] } | null>(null);
  const [showStandings, setShowStandings] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting loading/error state at the start of a new fetch triggered by this effect's own deps changing, not a plain render-time computation
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      leagueId: saved.leagueId,
      dataset: saved.settings.defaultDataset ?? DEFAULT_LEAGUE_TAGS.defaultDataset,
      leagueType: saved.settings.leagueType ?? DEFAULT_LEAGUE_TAGS.leagueType,
    });
    if (saved.teamId) params.set("teamId", saved.teamId);
    // Same league analysis Power Rankings/Trade Edge/Roster Edge already
    // fetch from — reused here rather than a Waiver-Edge-only route so the
    // simulator's add-pool (waiverBoard) and roster data match exactly what
    // those tools already compute (see waiver-sim.ts's own header).
    fetch(`/api/fantrax/roster-edge?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setAnalysis(d as LeagueAnalysis);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [saved.leagueId, saved.teamId]); // eslint-disable-line react-hooks/exhaustive-deps -- settings fields read fresh, same convention every other Deep Edge fetch effect uses

  const myTeamId = analysis?.myTeamId ?? null;
  const myRoster = useMemo(() => analysis?.rosters.find((r) => r.teamId === myTeamId) ?? null, [analysis, myTeamId]);
  const isPointsLeague = analysis?.league.scoringMode === "points";
  // Worst-to-best by the SAME CATV/FPTS flavor the main table is showing —
  // the drop candidates most worth cutting sort to the top of the checklist.
  const dropCandidates = useMemo(() => {
    if (!myRoster) return [];
    return [...myRoster.players]
      .map((p) => ({ player: p, value: rosterValueOf(p, isPointsLeague, catvMode, statMode) }))
      .sort((a, b) => (a.value ?? -Infinity) - (b.value ?? -Infinity));
  }, [myRoster, isPointsLeague, catvMode, statMode]);
  const waiverByFantraxId = useMemo(() => new Map((analysis?.waiverBoard ?? []).map((p) => [p.fantraxId, p] as const)), [analysis]);
  const resolvedAdds = useMemo(
    () => [...cart.values()].map((c) => ({ ...c, player: waiverByFantraxId.get(c.fantraxId) ?? null })),
    [cart, waiverByFantraxId],
  );
  const addPlayers = useMemo(
    () => resolvedAdds.map((r) => r.player).filter((p): p is ResolvedPlayer => p !== null),
    [resolvedAdds],
  );
  const unresolvedAdds = resolvedAdds.filter((r) => r.player === null);

  // Real-world salary fallback for a free agent (see this modal's own prop
  // doc) and this league's full ledger rank (rostered players included) —
  // both sourced from the main table's already-fetched `data`, never
  // refetched here.
  const freeAgentSalaryByFantraxId = useMemo(() => new Map((data?.assets ?? []).map((a) => [a.fantraxId, a.salary] as const)), [data]);
  const leagueRankByFantraxId = data?.leagueRankByFantraxId ?? {};
  const salaryFormat = saved.settings.salaryFormat ?? "none";
  const showSalary = salaryFormat !== "none";
  const fmtSalary = (n: number | null) => (n == null ? "—" : salaryFormat === "custom" ? formatCustomSalary(n) : formatSalary(n));
  const salaryBefore = useMemo(() => (myRoster ? sumSalary(myRoster.players) : null), [myRoster]);
  const salaryAfter = useMemo(() => {
    if (salaryBefore == null || !myRoster) return null;
    const dropped = myRoster.players.filter((p) => dropIds.has(p.fantraxId));
    return salaryBefore - sumSalary(dropped) + sumSalary(addPlayers, freeAgentSalaryByFantraxId);
  }, [salaryBefore, myRoster, dropIds, addPlayers, freeAgentSalaryByFantraxId]);
  const salaryCapTotal = saved.settings.salaryCapTotal ?? 0;
  const capDelta = salaryAfter != null && salaryCapTotal > 0 ? salaryAfter - salaryCapTotal : null;

  const format: SimFormat | null = useMemo(() => {
    if (!analysis) return null;
    const derived = deriveRankingsFormat(analysis, {
      format: saved.settings.format ?? DEFAULT_LEAGUE_TAGS.format,
      formatConfirmed: saved.settings.formatConfirmed,
    });
    if (derived !== "unconfirmed") return derived;
    return analysis.league.scoringMode === "points" ? "points" : "roto";
  }, [analysis, saved.settings.format, saved.settings.formatConfirmed]);

  const effective = useMemo(
    () => (analysis ? resolveEffectiveScoring(analysis.league, saved.settings) : null),
    [analysis, saved.settings],
  );
  const scored = effective?.scored ?? EMPTY_SCORED;
  const teamCount = analysis?.league.teamCount ?? 0;

  function toggleDrop(fantraxId: string) {
    setDropIds((prev) => {
      const next = new Set(prev);
      if (next.has(fantraxId)) next.delete(fantraxId); else next.add(fantraxId);
      return next;
    });
  }

  function runSimulation() {
    if (!analysis || !myTeamId || !effective || !format) return;
    const weight = depthWeight(DEFAULT_GAMES_CAP_SETTINGS.lineupCadence, format, DEFAULT_GAMES_CAP_SETTINGS.capPos, DEFAULT_GAMES_CAP_SETTINGS.capMatch);
    const valueMode: LineupValueMode = analysis.league.scoringMode === "points" ? "fpts" : scored.length === 8 ? "eightCatV" : "nineCatV";
    setResult(addDropProfiles(analysis, myTeamId, dropIds, addPlayers, depth, weight, valueMode, effective));
  }

  function powerRankOf(profiles: TeamCategoryProfile[]): number | null {
    if (!myTeamId || !format) return null;
    if (format === "roto") return rotoStandingsByRawStat(profiles, scored, statMode).find((r) => r.teamId === myTeamId)?.projectedRank ?? null;
    const rows = format === "h2hcat" ? simulateH2HCategoryStandings(profiles, scored) : simulateH2HPointsStandings(profiles);
    return rows.find((r) => r.teamId === myTeamId)?.rank ?? null;
  }
  function winPctOf(profiles: TeamCategoryProfile[]): number | null {
    if (!myTeamId || (format !== "h2hcat" && format !== "points")) return null;
    const rows = format === "h2hcat" ? simulateH2HCategoryStandings(profiles, scored) : simulateH2HPointsStandings(profiles);
    return rows.find((r) => r.teamId === myTeamId)?.winPct ?? null;
  }
  function rotoPointsOf(profiles: TeamCategoryProfile[]): number | null {
    if (!myTeamId || format !== "roto") return null;
    return rotoStandingsByRawStat(profiles, scored, statMode).find((r) => r.teamId === myTeamId)?.totalPoints ?? null;
  }
  function fptsOf(profiles: TeamCategoryProfile[]): number | null {
    if (!myTeamId || format !== "points") return null;
    const p = profiles.find((pr) => pr.teamId === myTeamId);
    if (!p || p.statTotals.gamesPlayed <= 0) return null;
    return statMode === "totals" ? (p.pointsTotal ?? 0) : (p.pointsTotal ?? 0) / p.statTotals.gamesPlayed;
  }

  function radarFor(profiles: TeamCategoryProfile[]): RadarPoint[] | null {
    if (!myTeamId || format === "points" || scored.length === 0) return null;
    const edges = categoryEdges(myTeamId, profiles, projectRotoStandings(profiles, scored), scored);
    const byCat = new Map(edges.map((e) => [e.category, e]));
    return scored.map((cat) => ({ category: cat, rank: byCat.get(cat)?.rank ?? null, of: teamCount }));
  }

  const radarBefore = result ? radarFor(result.before) : null;
  const radarAfter = result ? radarFor(result.after) : null;
  const deltas = useMemo(
    () => (result && myTeamId ? categoryDeltas(myTeamId, result.before, result.after, scored) : []),
    [result, myTeamId, scored],
  );
  const improved = [...deltas].filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3);
  const worsened = [...deltas].filter((d) => d.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3);

  const canRun = addPlayers.length > 0 || dropIds.size > 0;

  return (
    <>
    <Modal onClose={onClose} width={880}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Add/Drop Simulator</h2>
        <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, lineHeight: 1, cursor: "pointer", color: "var(--rt-muted)" }} aria-label="Close">×</button>
      </div>

      {loading ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>Loading your roster…</p>
      ) : error ? (
        <p style={{ color: "var(--rt-down)", fontSize: 13.5 }}>{error}</p>
      ) : !myTeamId || !myRoster ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>Connect your own team in this league (Settings) to simulate roster moves.</p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 20 }}>
            <div>
              <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Adding</h3>
              {cart.size === 0 && <p style={{ fontSize: 12.5, color: "var(--rt-muted)" }}>No free agents selected — pick some from the table (the + column), or run a drop-only move below.</p>}
              {resolvedAdds.filter((r) => r.player).map((r) => (
                <div key={r.fantraxId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--rt-hairline)" }}>
                  <span style={{ fontSize: 13 }}>
                    {r.name}
                    {leagueRankByFantraxId[r.fantraxId] != null && (
                      <span style={{ color: "var(--rt-muted)", marginLeft: 6 }}>(#{leagueRankByFantraxId[r.fantraxId]})</span>
                    )}
                  </span>
                  <button type="button" onClick={() => onRemoveFromCart(r.fantraxId)} style={{ background: "none", border: "none", color: "var(--rt-muted)", fontSize: 12, cursor: "pointer" }}>Remove</button>
                </div>
              ))}
              {unresolvedAdds.length > 0 && (
                <p style={{ fontSize: 11.5, color: "var(--rt-muted)", marginTop: 8 }}>
                  {unresolvedAdds.map((r) => r.name).join(", ")} {unresolvedAdds.length === 1 ? "isn't" : "aren't"} in this
                  league&apos;s top-60 valued free agents, so the simulator can&apos;t score {unresolvedAdds.length === 1 ? "it" : "them"} yet.
                </p>
              )}
            </div>
            <div>
              <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Dropping (optional)</h3>
              <p style={{ fontSize: 11, color: "var(--rt-muted)", margin: "0 0 6px" }}>
                Sorted worst → best by {isPointsLeague ? "FPTS" : CATV_OPTIONS.find((o) => o.value === catvMode)?.label}
              </p>
              <div style={{ maxHeight: 220, overflowY: "auto" }}>
                {dropCandidates.map(({ player: p, value }) => (
                  <label key={p.fantraxId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={dropIds.has(p.fantraxId)} onChange={() => toggleDrop(p.fantraxId)} />
                    {p.name}
                    {leagueRankByFantraxId[p.fantraxId] != null && (
                      <span style={{ color: "var(--rt-muted)" }}>(#{leagueRankByFantraxId[p.fantraxId]})</span>
                    )}
                    <span style={{ color: "var(--rt-muted)", fontSize: 11.5 }}>{p.nbaTeam}</span>
                    <span style={{ color: "var(--rt-muted)", fontSize: 11.5, fontFamily: "var(--rt-font-mono)", marginLeft: "auto" }}>
                      {value != null ? value.toFixed(2) : "—"}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
              {DEPTH_LABELS.map((label, i) => (
                <button key={label} type="button" onClick={() => setDepth(i)} style={pill(depth === i)}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
              {(["perGame", "totals"] as StatMode[]).map((v) => (
                <button key={v} type="button" onClick={() => setStatMode(v)} style={pill(statMode === v)}>
                  {v === "perGame" ? "Per game" : "Totals"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={runSimulation}
              disabled={!canRun}
              style={{ marginLeft: "auto", height: 34, padding: "0 18px", borderRadius: 8, border: "none", background: canRun ? "var(--rt-primary)" : "var(--rt-surface-strong)", color: canRun ? "#fff" : "var(--rt-muted)", fontSize: 12.5, fontWeight: 700, cursor: canRun ? "pointer" : "default" }}
            >
              Run simulation
            </button>
          </div>

          {result && (
            <div>
              <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <StatCompare label="Power Rank" before={powerRankOf(result.before)} after={powerRankOf(result.after)} format="rank" higherBetter={false} />
                  {format && (
                    <button
                      type="button"
                      onClick={() => setShowStandings(true)}
                      style={{ fontSize: 11, color: "var(--rt-primary)", fontWeight: 600, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
                    >
                      View full standings →
                    </button>
                  )}
                </div>
                {format === "roto" && <StatCompare label="Roto Points" before={rotoPointsOf(result.before)} after={rotoPointsOf(result.after)} format="num" />}
                {(format === "h2hcat" || format === "points") && <StatCompare label="Win%" before={winPctOf(result.before)} after={winPctOf(result.after)} format="pct" />}
                {format === "points" && <StatCompare label={statMode === "totals" ? "FPTS (season)" : "FPTS/GM"} before={fptsOf(result.before)} after={fptsOf(result.after)} format="num" />}
                {showSalary && (
                  <div style={{ padding: 14, borderRadius: 12, border: "1px solid var(--rt-hairline)", minWidth: 170 }}>
                    <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 10.5, color: "var(--rt-muted)", marginBottom: 6 }}>TEAM SALARY</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>
                      <span style={{ color: "var(--rt-muted)" }}>{fmtSalary(salaryBefore)}</span>
                      {" → "}
                      <span>{fmtSalary(salaryAfter)}</span>
                    </div>
                    {capDelta != null && (
                      <div style={{ fontSize: 11.5, marginTop: 6, fontWeight: 600, color: capDelta > 0 ? "var(--rt-down)" : "var(--rt-up)" }}>
                        {fmtSalary(Math.abs(capDelta))} {capDelta > 0 ? "over cap" : "under cap"}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {format !== "points" && radarBefore && radarAfter && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
                  <DashboardCard title="BEFORE"><CategoryRadarChart points={radarBefore} size={220} showRank /></DashboardCard>
                  <DashboardCard title="AFTER"><CategoryRadarChart points={radarAfter} size={220} showRank /></DashboardCard>
                </div>
              )}

              {format !== "points" && (
                <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
                  <CategoryDeltaList title="IMPROVES" color="var(--rt-up)" deltas={improved} />
                  <CategoryDeltaList title="WORSENS" color="var(--rt-down)" deltas={worsened} />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
    {showStandings && result && format && myTeamId && (
      <FullStandingsModal
        format={format}
        before={result.before}
        after={result.after}
        scored={scored}
        statMode={statMode}
        myTeamId={myTeamId}
        onClose={() => setShowStandings(false)}
      />
    )}
    </>
  );
}

export default function WaiverEdgePage() {
  return (
    <Suspense fallback={null}>
      <WaiverEdgeContent />
    </Suspense>
  );
}
