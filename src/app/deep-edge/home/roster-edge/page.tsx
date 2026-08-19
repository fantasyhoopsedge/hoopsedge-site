"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { LeagueAnalysis, ResolvedPlayer } from "@/lib/fantrax/analyze";
import { categoryEdges, projectRotoStandings, teamStrengthsWeaknesses } from "@/lib/fantrax/analyze";
import { CATEGORY_LABEL, currentSeasonDraftStatus, FANTRAX_DATASETS, type FantraxDatasetKey, type FheCategory } from "@/lib/fantrax/league";
import { DEFAULT_GAMES_CAP_SETTINGS, DEFAULT_LEAGUE_TAGS, EXTRA_CATEGORIES } from "@/lib/fantrax/league-tags";
import { FormatConfirmPrompt } from "@/lib/fantrax/format-confirm";
import { buildOptimalLineup, resolveEffectiveScoring, UI_VALUE_MODE_OPTIONS } from "@/lib/fantrax/lineup";
import { buildDepthWeightedProfiles, deriveRankingsFormat, depthWeight, simulateH2HCategoryStandings } from "@/lib/fantrax/power-rankings";
import { HubShell } from "../../_components/hub-shell";
import { IconChevronLeft } from "../../_components/icons";
import { SegmentedControl } from "../../_components/segmented-control";
import {
  DraftPicksPanel, formatStat, meanStd, RosterTableRow, statValue, weightedAverage,
  type EnrichData, type ExtraCode, type RosterTableFormat, type ValueDisplayMode,
} from "../../_components/roster-table";
import { DEEP_EDGE_TABLE_CSS, SortTh, useSortableTable } from "../../_components/sortable-table";
import { useActiveLeague } from "../../_lib/use-saved-leagues";

/** Depth-ladder labels matching the rest of Deep Edge (Starters = 0, +1..+5)
 *  — used for both the tick-set depth pill and the Power Rank badge's
 *  caption, which now track the same user-chosen depth (Ash, 2026-08-13). */
const DEPTH_LABELS = ["Starters", "+1", "+2", "+3", "+4", "+5"];

/** Same flavor the roster table's cell decoration reads — see
 *  ValueDisplayMode in roster-table.tsx. Options/order/labels come from
 *  lineup.ts's UI_VALUE_MODE_OPTIONS — the same "Rank lineup by" set
 *  Category Edge and Trade Edge use (Ash's consistency sweep, 2026-08-18). */
type TickValueMode = ValueDisplayMode;
/** Maps a TickValueMode onto the roster table's own sort key — see the
 *  render-time sync below (Ash, 2026-08-14: "dynamically sort the roster
 *  based on those values from best to worst"). FPTS sorts by the VALUE
 *  column, which already reads pointsValue for a points-format league. */
const SORT_KEY_FOR_TICK_MODE: Record<TickValueMode, SortKey> = {
  minus1V: "minus1", nineCatV: "nineCat", eightCatV: "eightCat", fpts: "value",
};

/** The Settings screen's "Add category" codes that Roster Edge can actually
 *  compute from real data — ast/tov and the two makes counts already have a
 *  source; everything else in EXTRA_CATEGORIES (DD/TD/TREB/PF/TF/OREB/DREB)
 *  has no data source anywhere in FHE's stat pipeline, and MPG/GP are
 *  already core columns (MIN/GP) rather than optional extras. Disabled
 *  options stay IN the picker (matching Settings' own list one-for-one, per
 *  Ash's request) rather than being silently omitted. */
const EXTRA_DISABLED_REASON: Record<string, string> = {
  DD: "No data source in FHE's stat pipeline",
  TD: "No data source in FHE's stat pipeline",
  TREB: "No data source — same number as REB, already shown",
  PF: "No data source in FHE's stat pipeline",
  TF: "No data source in FHE's stat pipeline",
  OREB: "No data source in FHE's stat pipeline",
  DREB: "No data source in FHE's stat pipeline",
  MPG: "Already shown as MIN",
  GP: "Already shown as GP",
};
/** Shooting-volume extras Ash asked for directly (2026-08-12) — not part of
 *  the shared EXTRA_CATEGORIES/Settings picker list (those are Fantrax
 *  SCORING categories a league might play with; FGA/FTA are supporting
 *  volume stats for the FG%/FT% columns already shown, a Roster-Edge-only
 *  display concept), so kept as a second small list rather than added to
 *  the shared one and pulling them into Settings' own picker too. */
const ROSTER_ONLY_EXTRAS: { code: ExtraCode; label: string }[] = [
  { code: "FGA", label: "Field goal attempts (FGA)" },
  { code: "FTA", label: "Free throw attempts (FTA)" },
];

type SortKey = "name" | "dynastyRank" | "salaryRank" | "gp" | "min" | "usg" | "value" | "minus1" | "nineCat" | "eightCat" | FheCategory | ExtraCode;
type OptionalCols = { salary: boolean; contract: boolean; dynastyRank: boolean; salaryRank: boolean };

function RosterEdgeContent() {
  const { saved, loading: loadingSaved } = useActiveLeague();
  const [analysis, setAnalysis] = useState<LeagueAnalysis | null>(null);
  const [enrich, setEnrich] = useState<EnrichData | null>(null);
  const [error, setError] = useState("");
  const [dataset, setDataset] = useState<FantraxDatasetKey>(FANTRAX_DATASETS[0].key);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string> | null>(null);
  const [tickDepth, setTickDepth] = useState(0);
  const [tickValueMode, setTickValueMode] = useState<TickValueMode>("minus1V");
  const [extraCols, setExtraCols] = useState<Set<ExtraCode>>(new Set());
  const [hiddenCats, setHiddenCats] = useState<Set<FheCategory>>(new Set());
  const [cols, setCols] = useState<OptionalCols>({ salary: true, contract: true, dynastyRank: true, salaryRank: true });

  useEffect(() => {
    if (!saved) return;
    const params = new URLSearchParams({
      leagueId: saved.leagueId,
      dataset,
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
  }, [saved, dataset]);

  const format = useMemo(() => {
    if (!analysis || !saved) return null;
    return deriveRankingsFormat(analysis, {
      format: saved.settings.format ?? DEFAULT_LEAGUE_TAGS.format,
      formatConfirmed: saved.settings.formatConfirmed,
    });
  }, [analysis, saved]);

  const effective = useMemo(
    () => (analysis && saved ? resolveEffectiveScoring(analysis.league, saved.settings) : null),
    [analysis, saved],
  );

  const teamId = selectedTeamId ?? saved?.teamId ?? analysis?.myTeamId ?? null;
  const roster = useMemo(() => analysis?.rosters.find((r) => r.teamId === teamId) ?? null, [analysis, teamId]);
  // Draft-pick assets live on the raw league snapshot (analysis.league.rosters),
  // not the resolved-player roster above — see LeagueRoster.draftPicks. Gate
  // the whole panel on whether ANY team has pick data — a league that
  // doesn't track future picks at all (redraft, or getDraftPicks returned
  // nothing) shouldn't show an all-empty panel for every team.
  const teamDraftPicks = useMemo(
    () => analysis?.league.rosters.find((r) => r.teamId === teamId)?.draftPicks ?? [],
    [analysis, teamId],
  );
  const hasAnyDraftPicks = useMemo(
    () => analysis?.league.rosters.some((r) => r.draftPicks.length > 0) ?? false,
    [analysis],
  );
  const draftStatus = useMemo(() => currentSeasonDraftStatus(analysis?.league.draft ?? null), [analysis]);

  const lineupCadence = saved?.settings.lineupCadence ?? DEFAULT_GAMES_CAP_SETTINGS.lineupCadence;
  const capPos = saved?.settings.capPos ?? DEFAULT_GAMES_CAP_SETTINGS.capPos;
  const capMatch = saved?.settings.capMatch ?? DEFAULT_GAMES_CAP_SETTINGS.capMatch;

  // Whole-league profiles at the user's chosen tick depth — exactTeamId
  // keeps ONLY the selected team's lineup exact (branch-and-bound), every
  // other team greedy, same fix as Power Rankings' own depth toggle (see
  // power-rankings.ts's exactTeamId doc — running the exact solver 30 times
  // per team switch was the real "Page Unresponsive" freeze). Powers both
  // the Power Rank badge below (h2hcat only, unchanged) and the strengths/
  // weaknesses summary (roto + h2hcat — see myStrengthsWeaknesses).
  const leagueProfiles = useMemo(() => {
    if (!analysis || !effective || !format || format === "unconfirmed" || !teamId) return null;
    const weight = depthWeight(lineupCadence, format, capPos, capMatch);
    return buildDepthWeightedProfiles(analysis, tickDepth, weight, { ...effective, exactTeamId: teamId });
  }, [analysis, effective, format, teamId, tickDepth, lineupCadence, capPos, capMatch]);

  const powerRank = useMemo(() => {
    if (!leagueProfiles || !effective || format !== "h2hcat" || !teamId) return null;
    const records = simulateH2HCategoryStandings(leagueProfiles, effective.scored);
    const sorted = [...records].sort((a, b) => b.winPct - a.winPct);
    const idx = sorted.findIndex((r) => r.teamId === teamId);
    const mine = sorted[idx];
    return mine ? { rank: idx + 1, of: sorted.length, winPct: mine.winPct } : null;
    // Roto/points power-rank display: fast-follow, not in this pass
  }, [leagueProfiles, effective, format, teamId]);

  const isPointsLeague = format === "points";
  const myStandings = useMemo(
    () => (leagueProfiles && effective ? projectRotoStandings(leagueProfiles, effective.scored) : null),
    [leagueProfiles, effective],
  );
  const myEdges = useMemo(
    () => (leagueProfiles && myStandings && teamId && effective ? categoryEdges(teamId, leagueProfiles, myStandings, effective.scored) : []),
    [leagueProfiles, myStandings, teamId, effective],
  );
  const myStrengthsWeaknesses = useMemo(
    () => teamStrengthsWeaknesses(myEdges, analysis?.league.teamCount ?? 0),
    [myEdges, analysis],
  );

  // Default ticked set = starters + the user-chosen depth/value-mode
  // combination (Ash, 2026-08-13: default projections + Minus1V, toggle to
  // 9-Cat and/or a deeper bench) — reset whenever the selected team,
  // dataset, depth, or value mode changes.
  const defaultTicked = useMemo(() => {
    if (!roster || !effective) return new Set<string>();
    const lineup = buildOptimalLineup(roster.players, effective.positionSlots, null, { valueMode: tickValueMode });
    const ids = [...lineup.starters.map((a) => a.player.fantraxId), ...lineup.bench.slice(0, tickDepth).map((p) => p.fantraxId)];
    return new Set(ids);
  }, [roster, effective, tickDepth, tickValueMode]);
  const [resetKey, setResetKey] = useState<string | null>(null);
  const currentResetKey = `${roster?.teamId}:${dataset}:${tickDepth}:${tickValueMode}`;
  if (roster && resetKey !== currentResetKey) {
    setResetKey(currentResetKey);
    setTicked(defaultTicked);
  }
  const tickedIds = ticked ?? defaultTicked;
  const tickedPlayers = useMemo(
    () => (roster ? roster.players.filter((p) => tickedIds.has(p.fantraxId)) : []),
    [roster, tickedIds],
  );

  const visibleCats = useMemo(
    () => (effective ? effective.scored.filter((c) => !hiddenCats.has(c)) : []),
    [effective, hiddenCats],
  );

  // Optional-column defaults reset once per league switch (not on every
  // render) — on for salary-format leagues, off otherwise; user-overridable
  // from there via the checkboxes below.
  const [colsDefaultsFor, setColsDefaultsFor] = useState<string | null>(null);
  const salaryFormat = saved?.settings.salaryFormat ?? DEFAULT_LEAGUE_TAGS.salaryFormat;
  if (saved && colsDefaultsFor !== saved.leagueId) {
    setColsDefaultsFor(saved.leagueId);
    const on = salaryFormat !== "none";
    setCols({ salary: on, contract: on, dynastyRank: on, salaryRank: on });
  }

  // Population mean/σ for the USG heatmap — the whole league's rostered
  // players, not just the selected team's dozen-ish (too small a sample to
  // mean anything, and would shift the baseline every team switch) — same
  // "stable baseline regardless of what's visible" idea seasonal-rankings'
  // own USG/FGA/FTA heatmap uses.
  const leaguePlayers = useMemo(() => analysis?.rosters.flatMap((r) => r.players) ?? [], [analysis]);
  const usgStats = useMemo(
    () => meanStd(leaguePlayers.map((p) => p.usgPct).filter((v): v is number => v != null)),
    [leaguePlayers],
  );

  const rotoSort = useSortableTable<ResolvedPlayer, SortKey>(
    roster?.players ?? [],
    { key: SORT_KEY_FOR_TICK_MODE[tickValueMode], dir: "desc" },
    (row, key) => {
      if (key === "name") return row.name;
      if (key === "dynastyRank") return (row.fheId ? enrich?.dynastyRankByFheId[row.fheId] : null) ?? Infinity;
      if (key === "salaryRank") return (row.fheId ? enrich?.salaryRankByFheId[row.fheId] : null) ?? Infinity;
      if (key === "gp") return row.gamesPlayed ?? -Infinity;
      if (key === "min") return row.minutesPerGame ?? -Infinity;
      if (key === "usg") return row.usgPct ?? -Infinity;
      if (key === "value") return (format === "points" ? row.pointsValue : row.leagueV) ?? -Infinity;
      if (key === "minus1") return row.catV?.perGame.minus1V ?? -Infinity;
      if (key === "nineCat") return row.catV?.perGame.nineCatV ?? -Infinity;
      if (key === "eightCat") return row.catV?.perGame.eightCatV ?? -Infinity;
      return statValue(row, key) ?? -Infinity;
    },
  );
  // The roster table's sort order follows whichever value flavor the
  // tick-set selector is on — best to worst (Ash, 2026-08-14). Runs once per
  // distinct tickValueMode CHANGE via the same render-time-reset pattern used
  // elsewhere in this file (skips the very first render — useSortableTable's
  // own `initial` param above already seeds the matching key/desc, and
  // onSort() TOGGLES direction when called with the key it's already on, so
  // calling it here on mount would immediately flip to ascending).
  const [sortSyncFor, setSortSyncFor] = useState<TickValueMode | null>(null);
  if (sortSyncFor === null) {
    setSortSyncFor(tickValueMode);
  } else if (sortSyncFor !== tickValueMode) {
    setSortSyncFor(tickValueMode);
    rotoSort.onSort(SORT_KEY_FOR_TICK_MODE[tickValueMode]);
  }

  const hasLeague = Boolean(saved);
  const showSalary = cols.salary && salaryFormat !== "none";
  const showContract = cols.contract && salaryFormat !== "none";
  const isDynasty = (saved?.settings.leagueType ?? DEFAULT_LEAGUE_TAGS.leagueType) === "dynasty";
  // ✓/PLAYER/TEAM/TREND/GP/MIN/USG/VALUE = 8 always-present columns (POS now
  // renders inline inside PLAYER, to the left of the name — Ash, 2026-08-19),
  // plus whichever of SAL$/CONTRACT$/DYN RK/SAL RK are currently shown.
  // MINUS1 is deliberately excluded — it renders as its own <td> right after
  // this colSpan cell, not folded into it.
  const colSpanBeforeStats = 8 + (showSalary ? 1 : 0) + (showContract ? 1 : 0) + (cols.dynastyRank ? 1 : 0) + (cols.salaryRank ? 1 : 0);
  // RosterTableRow's `format` prop excludes "unconfirmed"/null (that state
  // never reaches this table — see the `format === "unconfirmed"` guard and
  // `!roster` guard below, both bailing out before the table renders).
  const rowFormat: RosterTableFormat = format === "points" ? "points" : format === "h2hcat" ? "h2hcat" : "roto";

  return (
    <HubShell hasLeague={hasLeague} breadcrumb={saved ? `${saved.leagueName} · Roster Edge` : "Roster Edge"}>
      <style>{DEEP_EDGE_TABLE_CSS}</style>
      <Link href="/deep-edge/home" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--rt-muted)", fontSize: 13, textDecoration: "none", marginBottom: 16 }}>
        <IconChevronLeft size={14} /> Back to {saved?.leagueName ?? "home"}
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Roster Edge</h1>
        {format && format !== "unconfirmed" && (
          <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 10.5, padding: "4px 9px", borderRadius: 100, background: "var(--rt-surface-strong)", color: "var(--rt-muted)" }}>
            {format === "points" ? "POINTS" : `${effective?.scored.length ?? 9}-CAT`}
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
      ) : !roster ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>No roster found for the selected team.</p>
      ) : (
        <>
          <p style={{ color: "var(--rt-body)", fontSize: 14, margin: "0 0 20px", maxWidth: 640 }}>
            {roster.teamName}&apos;s full roster — real per-game production, salary and dynasty context in one table.
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <select
              value={teamId ?? ""}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              style={{
                height: 38, padding: "0 12px", borderRadius: 10, border: "1px solid var(--rt-hairline)",
                background: "var(--rt-surface-soft)", color: "var(--rt-ink)", fontSize: 13, fontWeight: 600,
              }}
            >
              {analysis.rosters.map((r) => (
                <option key={r.teamId} value={r.teamId}>{r.teamName}</option>
              ))}
            </select>

            {powerRank && (
              <span style={{ fontSize: 12.5, padding: "8px 14px", borderRadius: 100, background: "var(--rt-surface-strong)" }}>
                Power Rank <strong>#{powerRank.rank}</strong> of {powerRank.of} · {(powerRank.winPct * 100).toFixed(1)}% proj. win
                <span style={{ color: "var(--rt-muted)", marginLeft: 6 }}>({DEPTH_LABELS[tickDepth]})</span>
              </span>
            )}

            {isDynasty && (
              <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
                {FANTRAX_DATASETS.map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setDataset(d.key)}
                    style={{
                      padding: "7px 12px", border: "none", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer",
                      background: dataset === d.key ? "var(--rt-canvas)" : "transparent",
                      color: dataset === d.key ? "var(--rt-ink)" : "var(--rt-muted)",
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12.5, color: "var(--rt-muted)", marginBottom: 6 }}>Auto-select starters + reserves by</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
                {DEPTH_LABELS.map((label, i) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setTickDepth(i)}
                    style={{
                      padding: "7px 14px", border: "none", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                      background: tickDepth === i ? "var(--rt-canvas)" : "transparent",
                      color: tickDepth === i ? "var(--rt-ink)" : "var(--rt-muted)",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <SegmentedControl<TickValueMode>
                options={UI_VALUE_MODE_OPTIONS} value={tickValueMode} onChange={setTickValueMode}
                disabledOptions={format !== "points" ? ["fpts"] : []}
              />
            </div>
          </div>

          {!isPointsLeague && (myStrengthsWeaknesses.strong.length > 0 || myStrengthsWeaknesses.weak.length > 0) && (
            <div style={{ padding: 16, borderRadius: 14, border: "1px solid var(--rt-hairline)", marginBottom: 20 }}>
              <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 12, color: "var(--rt-muted)", marginBottom: 6 }}>Strong in</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {myStrengthsWeaknesses.strong.length > 0
                      ? myStrengthsWeaknesses.strong.map((e) => (
                        <span key={e.category} style={{ padding: "5px 12px", borderRadius: 100, fontSize: 12.5, fontWeight: 700, background: "rgba(34,197,94,0.14)", color: "var(--rt-ink)" }}>
                          {CATEGORY_LABEL[e.category]}
                        </span>
                      ))
                      : <span style={{ fontSize: 12.5, color: "var(--rt-muted)" }}>—</span>}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "var(--rt-muted)", marginBottom: 6 }}>Weak in</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {myStrengthsWeaknesses.weak.length > 0
                      ? myStrengthsWeaknesses.weak.map((e) => (
                        <span key={e.category} style={{ padding: "5px 12px", borderRadius: 100, fontSize: 12.5, fontWeight: 700, background: "rgba(239,68,68,0.14)", color: "var(--rt-ink)" }}>
                          {CATEGORY_LABEL[e.category]}
                        </span>
                      ))
                      : <span style={{ fontSize: 12.5, color: "var(--rt-muted)" }}>—</span>}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Link href="/deep-edge/home/category-edge" style={{ padding: "7px 14px", borderRadius: 100, border: "1px solid var(--rt-hairline)", color: "var(--rt-ink)", textDecoration: "none", fontSize: 12.5, fontWeight: 600 }}>
                  Open Category Edge →
                </Link>
                <Link href="/deep-edge/home/trade-edge" style={{ padding: "7px 14px", borderRadius: 100, border: "1px solid var(--rt-hairline)", color: "var(--rt-ink)", textDecoration: "none", fontSize: 12.5, fontWeight: 600 }}>
                  Open Trade Edge →
                </Link>
                <Link href="/deep-edge/home/rankings" style={{ padding: "7px 14px", borderRadius: 100, border: "1px solid var(--rt-hairline)", color: "var(--rt-ink)", textDecoration: "none", fontSize: 12.5, fontWeight: 600 }}>
                  Open Power Rankings →
                </Link>
              </div>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap", fontSize: 12 }}>
            <span style={{ color: "var(--rt-muted)", marginRight: 2 }}>Columns:</span>
            {([
              ["salary", "Salary"], ["contract", "Contract"], ["dynastyRank", "Dynasty rank"], ["salaryRank", "Salary rank"],
            ] as [keyof OptionalCols, string][]).map(([key, label]) => (
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

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap", fontSize: 12 }}>
            <span style={{ color: "var(--rt-muted)", marginRight: 2 }}>Stats:</span>
            {effective?.scored.map((cat) => (
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
            <span style={{ width: 1, height: 16, background: "var(--rt-hairline)", margin: "0 4px" }} />
            <select
              value=""
              onChange={(e) => {
                const code = e.target.value as ExtraCode;
                if (code) setExtraCols((s) => new Set(s).add(code));
              }}
              style={{
                height: 28, padding: "0 8px", borderRadius: 100, border: "1px solid var(--rt-hairline)",
                background: "transparent", color: "var(--rt-ink)", fontSize: 12,
              }}
            >
              <option value="">Select a category to add…</option>
              <optgroup label="Shooting volume">
                {ROSTER_ONLY_EXTRAS.map((c) => (
                  <option key={c.code} value={c.code} disabled={extraCols.has(c.code)}>{c.label}</option>
                ))}
              </optgroup>
              <optgroup label="League categories">
                {EXTRA_CATEGORIES.map((c) => (
                  <option key={c.code} value={c.code} disabled={!!EXTRA_DISABLED_REASON[c.code] || extraCols.has(c.code as ExtraCode)}>
                    {c.label}{EXTRA_DISABLED_REASON[c.code] ? ` — ${EXTRA_DISABLED_REASON[c.code]}` : ""}
                  </option>
                ))}
              </optgroup>
            </select>
            {[...extraCols].map((col) => (
              <button
                key={col}
                type="button"
                onClick={() => setExtraCols((s) => { const n = new Set(s); n.delete(col); return n; })}
                title="Remove"
                style={{
                  padding: "4px 10px", borderRadius: 100, border: "1px solid var(--rt-hairline)", cursor: "pointer",
                  background: "var(--rt-surface-strong)", color: "var(--rt-ink)", fontWeight: 600,
                }}
              >
                {col} ×
              </button>
            ))}
          </div>

          <div className="de-table-wrap" style={{ marginBottom: 16 }}>
            <table className="de-table de-table-roster">
              <thead>
                <tr>
                  <th>✓</th>
                  <th className="l">PLAYER</th>
                  <th>TEAM</th>
                  {showSalary && <th>SAL$</th>}
                  {showContract && <th>CONTRACT$</th>}
                  {cols.dynastyRank && <SortTh<SortKey> label="DYN RK" sortKey="dynastyRank" sort={rotoSort.sort} onSort={rotoSort.onSort} />}
                  {cols.salaryRank && <SortTh<SortKey> label="SAL RK" sortKey="salaryRank" sort={rotoSort.sort} onSort={rotoSort.onSort} />}
                  <th>TREND</th>
                  <SortTh<SortKey> label="GP" sortKey="gp" sort={rotoSort.sort} onSort={rotoSort.onSort} />
                  <SortTh<SortKey> label="MIN" sortKey="min" sort={rotoSort.sort} onSort={rotoSort.onSort} />
                  <SortTh<SortKey> label="USG" sortKey="usg" sort={rotoSort.sort} onSort={rotoSort.onSort} />
                  <SortTh<SortKey> label={format === "points" ? "FPTS" : "VALUE"} sortKey="value" sort={rotoSort.sort} onSort={rotoSort.onSort} />
                  {format !== "points" && <SortTh<SortKey> label="MINUS1" sortKey="minus1" sort={rotoSort.sort} onSort={rotoSort.onSort} />}
                  {visibleCats.map((cat) => (
                    <SortTh<SortKey> key={cat} label={CATEGORY_LABEL[cat]} sortKey={cat} sort={rotoSort.sort} onSort={rotoSort.onSort} />
                  ))}
                  {[...extraCols].map((col) => (
                    <SortTh<SortKey> key={col} label={col} sortKey={col} sort={rotoSort.sort} onSort={rotoSort.onSort} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickedPlayers.length > 0 && (
                  <tr className="mine">
                    <td colSpan={colSpanBeforeStats} className="l">Σ {tickedPlayers.length} TICKED — weighted per-game average</td>
                    {format !== "points" && <td>—</td>}
                    {visibleCats.map((cat) => (
                      <td key={cat}>{formatStat(cat, weightedAverage(tickedPlayers, cat))}</td>
                    ))}
                    {[...extraCols].map((col) => (
                      <td key={col}>{formatStat(col, weightedAverage(tickedPlayers, col))}</td>
                    ))}
                  </tr>
                )}
                {rotoSort.sorted.map((p) => (
                  <RosterTableRow
                    key={p.fantraxId}
                    player={p}
                    enrich={enrich}
                    format={rowFormat}
                    scored={effective?.scored ?? []}
                    visibleCats={visibleCats}
                    extraCols={[...extraCols]}
                    showSalary={showSalary}
                    showContract={showContract}
                    showDynastyRank={cols.dynastyRank}
                    showSalaryRank={cols.salaryRank}
                    salaryFormat={salaryFormat}
                    valueMode={tickValueMode}
                    positionSlots={effective?.positionSlots ?? {}}
                    leaguePlayers={leaguePlayers}
                    usgStats={usgStats}
                    leadingCell={
                      <td>
                        <input
                          type="checkbox"
                          checked={tickedIds.has(p.fantraxId)}
                          onChange={() => setTicked((s) => {
                            const n = new Set(s ?? defaultTicked);
                            if (n.has(p.fantraxId)) n.delete(p.fantraxId); else n.add(p.fantraxId);
                            return n;
                          })}
                        />
                      </td>
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--rt-muted)", marginBottom: hasAnyDraftPicks ? 20 : 0 }}>
            Offensive/defensive rebound splits aren&apos;t in FHE&apos;s stat pipeline yet, so OREB/DREB aren&apos;t offered — everything else in the picker that&apos;s enabled is real data.
          </p>
          {hasAnyDraftPicks && (
            <DraftPicksPanel teamName={roster.teamName} picks={teamDraftPicks} seasonYear={analysis.league.seasonYear} draftStatus={draftStatus} />
          )}
        </>
      )}
    </HubShell>
  );
}

export default function RosterEdgePage() {
  return (
    <Suspense fallback={null}>
      <RosterEdgeContent />
    </Suspense>
  );
}
