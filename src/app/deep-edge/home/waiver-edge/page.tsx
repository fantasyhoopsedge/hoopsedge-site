"use client";

import { Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import { HubShell } from "../../_components/hub-shell";
import { DEEP_EDGE_TABLE_CSS } from "../../_components/sortable-table";
import { useActiveLeague } from "../../_lib/use-saved-leagues";
import { TeamLogo, formatRank, statBg, valueBg } from "../../_components/roster-table";
import { PlayerHeadshot } from "@/app/team-rosters/_components/roster-headshot";
import { CATEGORY_LABEL, FHE_CATEGORIES, type FheCategory } from "@/lib/fantrax/league";
import { formatTotal } from "@/lib/fantrax/power-rankings";
import { DEFAULT_LEAGUE_TAGS } from "@/lib/fantrax/league-tags";
import type { WaiverAssetRow, WaiverEdgeResult } from "@/lib/fantrax/waiver-edge";

/**
 * Waiver Edge (Ash, 2026-08-29) — every free agent in a connected league,
 * ranked for that league's own format. Same table shell League Rankings
 * uses (DEEP_EDGE_TABLE_CSS, roster-table.tsx's TeamLogo/formatRank/statBg/
 * valueBg, PlayerHeadshot) but scoped to free agents only — no fantasy-team
 * or asset-type filter (every row here IS a free agent), no salary/contract/
 * trade-value columns (nothing to price a claim against).
 *
 * The one real difference from League Rankings: the ranking metric is
 * user-tunable. A category header is a button — clicking it punts that
 * category (greys out, "PUNT" label) and the VALUE column recomputes as the
 * mean z-score over whatever's left, live, client-side (see waiverValueOf
 * below). With no punts active, a 9-cat league reads Minus1V (each player's
 * own best-8-of-9) and an 8/N-cat league reads the mean over whatever it
 * actually scores (mechanically identical to 8CatV when the missing
 * category is TO) — see PUNT_DEFAULTS. A separate "Rank by" control switches
 * the sort itself to this league's own dynasty consensus order, for a
 * manager who trusts the board over any single-league re-scoring.
 */

type ClassFilterKey = "rookie" | "soph" | "vet";
const POSITION_OPTIONS = ["G", "F", "C"] as const;
type PositionFilterKey = (typeof POSITION_OPTIONS)[number];
type StatMode = "perGame" | "totals";
type RankBy = "value" | "consensus";

const STAT_CATS: readonly FheCategory[] = ["PTS", "FG3", "REB", "AST", "STL", "BLK", "FG", "FT", "TO"];

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

/** The metric actually driving the sort right now. Minus1V only applies with
 *  ZERO punts active — the moment a viewer punts anything, Minus1V's own
 *  per-player "drop your own worst" logic would double up with (or fight)
 *  the fixed punt the viewer just asked for, so this switches to the fixed
 *  customTotal the instant punts.size > 0, family === "categories" only. */
function waiverValueOf(a: WaiverAssetRow, family: "categories" | "points", punts: ReadonlySet<FheCategory>): number | null {
  if (family === "points") return a.fpts;
  if (punts.size === 0) return a.minus1V;
  return customTotal(a.catsZ, punts);
}

function statCell(raw: number | undefined, cat: FheCategory, gamesPlayed: number | null, statMode: StatMode): string {
  if (raw == null) return "—";
  if (cat === "FG" || cat === "FT") return `${(raw * 100).toFixed(1)}%`;
  if (statMode === "totals") return formatTotal(cat, raw * (gamesPlayed ?? 0));
  return raw.toFixed(1);
}

function weightedCatAverage(rows: WaiverAssetRow[], cat: FheCategory): number | null {
  let total = 0, games = 0;
  for (const a of rows) {
    const raw = a.catsRaw[cat];
    const g = a.gamesPlayed ?? 0;
    if (raw == null || g <= 0) continue;
    total += raw * g; games += g;
  }
  return games > 0 ? total / games : null;
}

function summedCatTotal(rows: WaiverAssetRow[], cat: FheCategory): number | null {
  let total = 0, any = false;
  for (const a of rows) {
    const raw = a.catsRaw[cat];
    const g = a.gamesPlayed ?? 0;
    if (raw == null || g <= 0) continue;
    total += raw * g; any = true;
  }
  return any ? total : null;
}

function summaryCatCell(rows: WaiverAssetRow[], cat: FheCategory, statMode: StatMode): string {
  if (cat === "FG" || cat === "FT") {
    const avg = weightedCatAverage(rows, cat);
    return avg != null ? `${(avg * 100).toFixed(1)}%` : "—";
  }
  if (statMode === "totals") {
    const total = summedCatTotal(rows, cat);
    return total != null ? formatTotal(cat, total) : "—";
  }
  const avg = weightedCatAverage(rows, cat);
  return avg != null ? avg.toFixed(1) : "—";
}

function avgOf<T>(rows: T[], pick: (row: T) => number | null): number | null {
  let sum = 0, n = 0;
  for (const row of rows) {
    const v = pick(row);
    if (v != null) { sum += v; n++; }
  }
  return n > 0 ? sum / n : null;
}

function WaiverEdgeContent() {
  const { saved, loading: loadingSaved } = useActiveLeague();
  const [data, setData] = useState<WaiverEdgeResult | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState("");

  const [rankBy, setRankBy] = useState<RankBy>("value");
  const [punts, setPunts] = useState<Set<FheCategory>>(new Set());
  const [puntsInitialized, setPuntsInitialized] = useState(false);
  const [classFilter, setClassFilter] = useState<Set<ClassFilterKey>>(new Set());
  const [positionFilter, setPositionFilter] = useState<Set<PositionFilterKey>>(new Set());
  const [statMode, setStatMode] = useState<StatMode>("perGame");

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

  const rankedRows = useMemo(() => {
    const withValue = filteredRows.map((a) => ({ asset: a, value: waiverValueOf(a, data?.family ?? "categories", punts) }));
    if (rankBy === "consensus") {
      withValue.sort((a, b) => (a.asset.dynRank ?? Infinity) - (b.asset.dynRank ?? Infinity));
    } else {
      withValue.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
    }
    return withValue.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [filteredRows, punts, rankBy, data?.family]);

  const summary = useMemo(() => {
    let gp = 0, gpCount = 0, min = 0, minCount = 0;
    for (const { asset: a } of rankedRows) {
      if (a.gamesPlayed != null) { gp += a.gamesPlayed; gpCount++; }
      if (a.minutesPerGame != null) {
        min += statMode === "totals" ? a.minutesPerGame * (a.gamesPlayed ?? 0) : a.minutesPerGame;
        minCount++;
      }
    }
    const cats: Partial<Record<FheCategory, string>> = {};
    for (const cat of STAT_CATS) cats[cat] = summaryCatCell(rankedRows.map((r) => r.asset), cat, statMode);
    return {
      count: rankedRows.length,
      gpAvg: gpCount > 0 ? gp / gpCount : null, minAvg: minCount > 0 ? min / minCount : null,
      ageAvg: avgOf(rankedRows, (r) => r.asset.age),
      dynRankAvg: avgOf(rankedRows, (r) => r.asset.dynRank),
      usgAvg: avgOf(rankedRows, (r) => r.asset.usgPct),
      valueAvg: avgOf(rankedRows, (r) => r.value),
      cats,
    };
  }, [rankedRows, statMode]);

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

  return (
    <HubShell hasLeague={Boolean(saved)} breadcrumb={saved ? `${saved.leagueName} · Waiver Edge` : "Waiver Edge"}>
      <style>{DEEP_EDGE_TABLE_CSS}</style>
      <style>{`
        .we-table th, .we-table td { font-family: var(--rt-font-sans); }
        .we-table td.l, .we-table th.l { text-align: left; }
        .we-table tr.we-summary-row td { background: var(--rt-surface-soft); font-weight: 700; border-bottom: 2px solid var(--rt-hairline); }
        .we-table tr.we-summary-row .l { color: var(--rt-muted); font-weight: 600; }
        .we-cat-btn { background: none; border: none; cursor: pointer; font: inherit; color: inherit; padding: 0; width: 100%; }
        .we-cat-btn .we-punt-label { display: block; font-size: 9px; letter-spacing: 0.04em; margin-top: 2px; color: var(--rt-muted); }
      `}</style>

      <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>Waiver Edge</h1>
      <p style={{ color: "var(--rt-body)", fontSize: 14, margin: "0 0 20px", maxWidth: 680 }}>
        Every free agent in {saved?.leagueName ?? "your league"}, ranked for its own scoring format. Click a category to
        punt it — the total recomputes over whatever&apos;s left. Only free agents show here; nothing to filter by fantasy team.
      </p>

      {loadingSaved ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>Loading…</p>
      ) : !saved ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>No league connected yet — add one from Home.</p>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11.5, color: "var(--rt-muted)", fontWeight: 600 }}>Rank by</span>
            <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
              <button type="button" onClick={() => setRankBy("value")} style={pill(rankBy === "value")}>
                {isPoints ? "FPTS" : "Value"}
              </button>
              <button type="button" onClick={() => setRankBy("consensus")} style={pill(rankBy === "consensus")}>
                Dynasty consensus
              </button>
            </div>
            {!isPoints && (
              <>
                <span style={{ fontSize: 11.5, color: "var(--rt-muted)" }}>
                  {punts.size === 0 ? "No categories punted — showing Minus1V" : `${punts.size} punted — showing ${defaultMetricLabel}`}
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

          {error && <p style={{ color: "var(--rt-down)", fontSize: 13.5, marginBottom: 16 }}>{error}</p>}
          {loadingData ? (
            <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>Loading…</p>
          ) : data && (
            <div className="de-table-wrap" style={{ maxHeight: "calc(100vh - 380px)", minHeight: 320, overflowY: "auto" }}>
              <table className="de-table we-table">
                <thead>
                  <tr>
                    <th>RANK</th>
                    <th className="l">FREE AGENT</th>
                    <th>TEAM</th>
                    <th>AGE</th>
                    <th>DYN RANK</th>
                    <th>GP</th>
                    <th>MIN</th>
                    <th>USG</th>
                    <th>{defaultMetricLabel}</th>
                    {STAT_CATS.map((cat) => {
                      const punted = !isPoints && punts.has(cat);
                      return (
                        <th key={cat} style={punted ? { background: "var(--rt-surface-strong)", color: "var(--rt-muted)" } : undefined}>
                          {isPoints ? (
                            CATEGORY_LABEL[cat]
                          ) : (
                            <button type="button" className="we-cat-btn" onClick={() => togglePunt(cat)} title={punted ? "Click to include this category" : "Click to punt this category"}>
                              {CATEGORY_LABEL[cat]}
                              {punted && <span className="we-punt-label">PUNT</span>}
                            </button>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rankedRows.length > 0 && (
                    <tr className="we-summary-row">
                      <td colSpan={2} className="l">Σ {summary.count} free agents{statMode === "totals" ? " — totals" : " — per game"}</td>
                      <td>—</td>
                      <td>{summary.ageAvg != null ? summary.ageAvg.toFixed(1) : "—"}</td>
                      <td>{summary.dynRankAvg != null ? formatRank(Math.round(summary.dynRankAvg)) : "—"}</td>
                      <td>{summary.gpAvg != null ? summary.gpAvg.toFixed(1) : "—"}</td>
                      <td>{summary.minAvg != null ? summary.minAvg.toFixed(1) : "—"}</td>
                      <td>{summary.usgAvg != null ? `${summary.usgAvg.toFixed(1)}%` : "—"}</td>
                      <td>{summary.valueAvg != null ? summary.valueAvg.toFixed(2) : "—"}</td>
                      {STAT_CATS.map((cat) => <td key={cat}>{summary.cats[cat] ?? "—"}</td>)}
                    </tr>
                  )}
                  {rankedRows.map(({ asset: a, rank, value }) => (
                    <tr key={a.key}>
                      <td>{rank <= 10 ? <span style={{ color: "var(--rt-primary)", fontWeight: 700 }}>{rank}</span> : rank}</td>
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </HubShell>
  );
}

export default function WaiverEdgePage() {
  return (
    <Suspense fallback={null}>
      <WaiverEdgeContent />
    </Suspense>
  );
}
