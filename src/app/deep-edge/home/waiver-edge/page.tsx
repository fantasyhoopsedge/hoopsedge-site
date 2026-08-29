"use client";

import { Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import { HubShell } from "../../_components/hub-shell";
import { DEEP_EDGE_TABLE_CSS, SortTh, useSortableTable } from "../../_components/sortable-table";
import { useActiveLeague } from "../../_lib/use-saved-leagues";
import { TeamLogo, formatRank, statBg, valueBg } from "../../_components/roster-table";
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
 * Waiver Edge (Ash, 2026-08-29, revised 2026-08-29) — every free agent in a
 * connected league, ranked for that league's own format. Same table shell
 * League Rankings uses (DEEP_EDGE_TABLE_CSS, roster-table.tsx's TeamLogo/
 * formatRank/statBg/valueBg, PlayerHeadshot) but scoped to free agents only.
 *
 * Every column is sortable (SortTh/useSortableTable, the same pattern
 * Category Edge/Power Rankings/Roster Edge already use) — clicking a header
 * toggles ascending/descending, same as everywhere else in Deep Edge. A
 * category header carries TWO independent controls stacked vertically: the
 * label itself sorts by that category's raw stat, and a small "Punt"/
 * "Punted" pill button underneath (a real, always-visible button — not an
 * overloaded click on the label, which read as inert/unwired before this
 * revision) toggles that category out of the VALUE total. With no punts
 * active, a 9-cat league reads Minus1V (each player's own best-8-of-9) and
 * an 8/N-cat league reads the mean over whatever it actually scores
 * (mechanically identical to 8CatV when the missing category is TO).
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
type SortKey = "name" | "team" | "age" | "dynRank" | "gp" | "min" | "usg" | "value" | FheCategory;
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

/** Mean of the z-scores for whatever categories AREN'T in `punts` — the
 *  generalized form of 8CatV (see waiver-edge.ts's own header): punting TO
 *  alone reproduces that exact formula, punting nothing reproduces 9CatV.
 *  Null when every scored category has been punted, or the player has no
 *  z-score for anything left. */
function customTotal(catsZ: Partial<Record<FheCategory, number>>, punts: ReadonlySet<FheCategory>): number | null {
  let sum = 0, n = 0;
  for (const cat of FHE_CATEGORIES) {
    if (punts.has(cat)) continue;
    const z = catsZ[cat];
    if (z == null) continue;
    sum += z; n++;
  }
  return n > 0 ? sum / n : null;
}

/** The metric actually driving VALUE right now. Minus1V only applies with
 *  ZERO punts active — the moment a viewer punts anything, Minus1V's own
 *  per-player "drop your own worst" logic would double up with (or fight)
 *  the fixed punt the viewer just asked for, so this switches to the fixed
 *  customTotal the instant punts.size > 0, family === "categories" only. */
function waiverValueOf(a: WaiverAssetRow, family: "categories" | "points", punts: ReadonlySet<FheCategory>): number | null {
  if (family === "points") return a.fpts;
  if (punts.size === 0) return a.minus1V;
  return customTotal(a.catsZ, punts);
}

function sortValueOf(row: { asset: WaiverAssetRow; value: number | null }, key: SortKey): number | string | null {
  const a = row.asset;
  switch (key) {
    case "name": return a.name;
    case "team": return a.nbaTeam ?? "";
    case "age": return a.age;
    case "dynRank": return a.dynRank;
    case "gp": return a.gamesPlayed;
    case "min": return a.minutesPerGame;
    case "usg": return a.usgPct;
    case "value": return row.value;
    default: return a.catsRaw[key] ?? null;
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

  const [punts, setPunts] = useState<Set<FheCategory>>(new Set());
  const [puntsInitialized, setPuntsInitialized] = useState(false);
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
    });
    if (saved.teamId) params.set("teamId", saved.teamId);
    fetch(`/api/fantrax/waiver-edge?${params}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setData(d as WaiverEdgeResult);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoadingData(false));
  }, [saved?.leagueId, saved?.teamId]); // eslint-disable-line react-hooks/exhaustive-deps -- settings fields read fresh each fetch, same convention league-rankings/page.tsx's own fetch effect uses

  // Default punt set follows THIS league's own scored categories — whatever
  // it doesn't score starts punted (Ash: "default for an 8cat league is
  // 8cat value"), reproducing that without hardcoding TO. Only ever runs
  // once per league load, so a viewer's own manual punts are never
  // overwritten mid-session.
  useEffect(() => {
    if (!data || puntsInitialized) return;
    const missing = FHE_CATEGORIES.filter((c) => !data.scoredCategories.includes(c));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time default derived from the just-loaded league's own scored categories, not a plain render-time computation
    setPunts(new Set(missing));
    setPuntsInitialized(true);
  }, [data, puntsInitialized]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a NEW league load must re-run the default-punt effect above rather than keep the previous league's punts
    setPuntsInitialized(false);
  }, [saved?.leagueId]);

  const isPoints = data?.family === "points";
  const defaultMetricLabel = isPoints ? "FPTS" : punts.size === 0 ? "MINUS1" : "VALUE";

  const filteredRows = useMemo(() => {
    if (!data) return [];
    return data.assets.filter(
      (a) => (classFilter.size === 0 || classFilter.has(classOf(a)))
        && (positionFilter.size === 0 || [...positionFilter].some((g) => touchesPosition(a.pos, g))),
    );
  }, [data, classFilter, positionFilter]);

  const rowsWithValue = useMemo(
    () => filteredRows.map((a) => ({ asset: a, value: waiverValueOf(a, data?.family ?? "categories", punts) })),
    [filteredRows, punts, data?.family],
  );

  const { sort, onSort, sorted } = useSortableTable<{ asset: WaiverAssetRow; value: number | null }, SortKey>(
    rowsWithValue,
    { key: "value", dir: "desc" },
    sortValueOf,
  );

  function togglePunt(cat: FheCategory) {
    setPunts((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  function resetPunts() {
    if (!data) return;
    setPunts(new Set(FHE_CATEGORIES.filter((c) => !data.scoredCategories.includes(c))));
  }

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
        .we-cat-th { display: flex; flex-direction: column; align-items: center; gap: 4px; }
        .we-punt-btn {
          font-family: var(--rt-font-sans); text-transform: none; letter-spacing: 0; font-size: 9.5px; font-weight: 700;
          padding: 2px 8px; border-radius: 999px; border: 1px solid var(--rt-hairline); background: var(--rt-canvas);
          color: var(--rt-muted); cursor: pointer;
        }
        .we-punt-btn-active { background: var(--rt-down); border-color: var(--rt-down); color: #fff; }
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
        click a header. Click a category&apos;s Punt button to exclude it from the total. Only free agents show here;
        nothing to filter by fantasy team.
      </p>

      {loadingSaved ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>Loading…</p>
      ) : !saved ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>No league connected yet — add one from Home.</p>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
            {!isPoints && (
              <>
                <span style={{ fontSize: 11.5, color: "var(--rt-muted)" }}>
                  {punts.size === 0 ? "No categories punted — VALUE shows Minus1V" : `${punts.size} punted — VALUE excludes them`}
                </span>
                <button
                  type="button"
                  onClick={resetPunts}
                  style={{ background: "none", border: "none", color: "var(--rt-primary)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}
                >
                  Reset punts
                </button>
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
                    <SortTh<SortKey> label="DYN RANK" sortKey="dynRank" sort={sort} onSort={onSort} />
                    <SortTh<SortKey> label="GP" sortKey="gp" sort={sort} onSort={onSort} />
                    <SortTh<SortKey> label="MIN" sortKey="min" sort={sort} onSort={onSort} />
                    <SortTh<SortKey> label="USG" sortKey="usg" sort={sort} onSort={onSort} />
                    <SortTh<SortKey> label={defaultMetricLabel} sortKey="value" sort={sort} onSort={onSort} />
                    {STAT_CATS.map((cat) => {
                      const punted = !isPoints && punts.has(cat);
                      const active = sort.key === cat;
                      return (
                        <th key={cat} style={punted ? { background: "var(--rt-surface-strong)" } : undefined}>
                          <div className="we-cat-th">
                            <span
                              className={`de-th-sortable${active ? " de-th-active" : ""}`}
                              onClick={() => onSort(cat)}
                              style={{ color: punted ? "var(--rt-muted)" : undefined }}
                            >
                              {CATEGORY_LABEL[cat]}
                              <span className="de-sort-arrow">{active ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}</span>
                            </span>
                            {!isPoints && (
                              <button
                                type="button"
                                className={`we-punt-btn${punted ? " we-punt-btn-active" : ""}`}
                                onClick={(e) => { e.stopPropagation(); togglePunt(cat); }}
                                title={punted ? "Click to include this category in VALUE" : "Click to exclude this category from VALUE"}
                              >
                                {punted ? "Punted" : "Punt"}
                              </button>
                            )}
                          </div>
                        </th>
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
                        <td>{formatRank(a.dynRank)}</td>
                        <td>{a.gamesPlayed ?? "—"}</td>
                        <td>{a.minutesPerGame != null ? (statMode === "totals" ? Math.round(a.minutesPerGame * (a.gamesPlayed ?? 0)).toLocaleString("en-US") : a.minutesPerGame.toFixed(1)) : "—"}</td>
                        <td>{a.usgPct != null ? `${a.usgPct.toFixed(1)}%` : "—"}</td>
                        <td style={{ fontWeight: 700, background: valueBg(value) }}>{value != null ? value.toFixed(2) : "—"}</td>
                        {STAT_CATS.map((cat) => {
                          const punted = !isPoints && punts.has(cat);
                          return (
                            <td key={cat} style={punted ? { background: "var(--rt-surface-strong)", color: "var(--rt-muted)" } : { background: statBg(a.catsZ[cat]) }}>
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
        <AddDropSimulatorModal saved={saved} cart={cart} onRemoveFromCart={removeFromCart} onClose={() => setSimOpen(false)} />
      )}
    </HubShell>
  );
}

// ── Add/Drop Simulator ───────────────────────────────────────────────────

type SimFormat = "roto" | "h2hcat" | "points";
type DepthMode = "starters" | "starters+";

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

function AddDropSimulatorModal({
  saved, cart, onRemoveFromCart, onClose,
}: {
  saved: SavedLeague;
  cart: Map<string, CartEntry>;
  onRemoveFromCart: (fantraxId: string) => void;
  onClose: () => void;
}) {
  const [analysis, setAnalysis] = useState<LeagueAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dropIds, setDropIds] = useState<Set<string>>(new Set());
  const [depthMode, setDepthMode] = useState<DepthMode>("starters");
  const [statMode, setStatMode] = useState<StatMode>("perGame");
  const [result, setResult] = useState<{ before: TeamCategoryProfile[]; after: TeamCategoryProfile[] } | null>(null);

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
    const depth = depthMode === "starters" ? 0 : 1;
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
                  <span style={{ fontSize: 13 }}>{r.name}</span>
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
              <div style={{ maxHeight: 220, overflowY: "auto" }}>
                {myRoster.players.map((p) => (
                  <label key={p.fantraxId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={dropIds.has(p.fantraxId)} onChange={() => toggleDrop(p.fantraxId)} />
                    {p.name}
                    <span style={{ color: "var(--rt-muted)", fontSize: 11.5 }}>{p.nbaTeam}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
              {(["starters", "starters+"] as DepthMode[]).map((v) => (
                <button key={v} type="button" onClick={() => setDepthMode(v)} style={pill(depthMode === v)}>
                  {v === "starters" ? "Starters" : "Starters+"}
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
                <StatCompare label="Power Rank" before={powerRankOf(result.before)} after={powerRankOf(result.after)} format="rank" higherBetter={false} />
                {format === "roto" && <StatCompare label="Roto Points" before={rotoPointsOf(result.before)} after={rotoPointsOf(result.after)} format="num" />}
                {(format === "h2hcat" || format === "points") && <StatCompare label="Win%" before={winPctOf(result.before)} after={winPctOf(result.after)} format="pct" />}
                {format === "points" && <StatCompare label={statMode === "totals" ? "FPTS (season)" : "FPTS/GM"} before={fptsOf(result.before)} after={fptsOf(result.after)} format="num" />}
              </div>

              {format !== "points" && radarBefore && radarAfter && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
                  <DashboardCard title="BEFORE"><CategoryRadarChart points={radarBefore} size={220} /></DashboardCard>
                  <DashboardCard title="AFTER"><CategoryRadarChart points={radarAfter} size={220} /></DashboardCard>
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
  );
}

export default function WaiverEdgePage() {
  return (
    <Suspense fallback={null}>
      <WaiverEdgeContent />
    </Suspense>
  );
}
