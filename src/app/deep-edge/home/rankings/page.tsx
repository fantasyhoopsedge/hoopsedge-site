"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { categoryEdges, projectRotoStandings, type LeagueAnalysis, type ResolvedPlayer, type RotoStandingRow } from "@/lib/fantrax/analyze";
import { CATEGORY_LABEL, type FheCategory } from "@/lib/fantrax/league";
import { DEFAULT_GAMES_CAP_SETTINGS, DEFAULT_LEAGUE_TAGS } from "@/lib/fantrax/league-tags";
import { FormatConfirmPrompt } from "@/lib/fantrax/format-confirm";
import {
  buildDepthWeightedProfiles, deriveRankingsFormat, depthCaption, depthWeight, formatPerGame, formatTotal,
  rotoStandingsByRawStat, simulateH2HCategoryStandings, simulateH2HPointsStandings, totalsValue, weightedPerGame,
  type RankingsFormat, type TeamH2HRecord,
} from "@/lib/fantrax/power-rankings";
import { buildOptimalLineup, greedyAssignment, resolveEffectiveScoring, RESERVE_SLOTS, UI_VALUE_MODE_OPTIONS, type LineupValueMode } from "@/lib/fantrax/lineup";
import { HubShell } from "../../_components/hub-shell";
import { IconChevronLeft } from "../../_components/icons";
import { YouVsTeamCells } from "../../_components/you-vs-team-cells";
import { StrengthBar } from "../../_components/strength-bar";
import { SegmentedControl } from "../../_components/segmented-control";
import { TeamRosterPanel } from "../../_components/team-roster-panel";
import { tierBg, tierFill } from "../../_components/tier-colors";
import { CategoryStrengthChart, DashboardCard, PercentileRing, type RadarPoint } from "../../_components/category-dashboard";
import type { EnrichData, RosterTableFormat } from "../../_components/roster-table";
import { DEEP_EDGE_TABLE_CSS, SortTh, useSortableTable } from "../../_components/sortable-table";
import { useActiveLeague } from "../../_lib/use-saved-leagues";

const FORMAT_LABEL: Record<string, string> = { roto: "ROTO · 9-CAT", h2hcat: "H2H · EACH CATEGORY", points: "H2H · POINTS" };
const FORMAT_TOGGLE_OPTIONS: { value: RankingsFormat; label: string }[] = [
  { value: "roto", label: "CAT ROTO" },
  { value: "h2hcat", label: "CAT H2H" },
  { value: "points", label: "POINTS" },
];
/** What each category cell shows: the raw per-game rate, the raw season
 *  total, or the roto points earned in that category. ROTO POINTS is the
 *  default (Ash, 2026-08-14: "should be... the default display for power
 *  rankings in all tools for roto formats") — PER GAME/TOTALS remain
 *  available for reading the underlying raw production. */
const ROTO_VIEW_OPTIONS: { value: "perGame" | "totals" | "points"; label: string }[] = [
  { value: "perGame", label: "PER GAME" },
  { value: "totals", label: "TOTALS" },
  { value: "points", label: "ROTO POINTS" },
];
/** Roto points are always derived from a raw-stat basis (see
 *  rotoStandingsByRawStat) — PER GAME/TOTALS tabs above double as that basis
 *  directly; ROTO POINTS needs its own basis selector since it isn't
 *  showing raw numbers itself (Ash, 2026-08-14: "the roto points needs to
 *  drive from either per game or totals — give the user the ability to
 *  select"). */
const POINTS_BASIS_OPTIONS: { value: "perGame" | "totals"; label: string }[] = [
  { value: "perGame", label: "Per-game basis" },
  { value: "totals", label: "Totals basis" },
];

function PowerRankingsContent() {
  const { saved, loading: loadingSaved } = useActiveLeague();
  const [analysis, setAnalysis] = useState<LeagueAnalysis | null>(null);
  const [enrich, setEnrich] = useState<EnrichData | null>(null);
  const [error, setError] = useState("");
  const [depth, setDepth] = useState(0);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [h2hSort, setH2hSort] = useState<"matchup" | "winpct">("winpct");
  const [formatOverride, setFormatOverride] = useState<RankingsFormat | null>(null);
  const [rotoView, setRotoView] = useState<"perGame" | "totals" | "points">("points");
  const [pointsBasis, setPointsBasis] = useState<"perGame" | "totals">("perGame");
  // "" = All teams. Only relevant when the league has Standings conferences
  // turned on (Settings → League basics → Standings) — otherwise there's
  // nothing to filter by and this control doesn't render at all.
  const [conferenceFilter, setConferenceFilter] = useState<string>("");
  const rotoBasis: "perGame" | "totals" = rotoView === "points" ? pointsBasis : rotoView;
  // Which value flavor fills each position slot with the best-ranked eligible
  // player (buildOptimalLineup's own valueMode) — same "Rank lineup by" set
  // Category Edge/Roster Edge/Trade Edge already expose, now driving Power
  // Rankings' own starter selection too instead of silently defaulting to
  // LeagueV (Ash, 2026-08-19: "this should drive the power rankings").
  const [valueMode, setValueMode] = useState<LineupValueMode>("nineCatV");

  useEffect(() => {
    if (!saved) return;
    const params = new URLSearchParams({
      leagueId: saved.leagueId,
      dataset: saved.settings.defaultDataset ?? "2027:projection",
      leagueType: saved.settings.leagueType ?? "redraft",
    });
    if (saved.teamId) params.set("teamId", saved.teamId);
    // Same league analysis /api/fantrax/league builds, plus the salary/
    // contract/dynasty-rank enrichment the roster panel below needs — see
    // /api/fantrax/roster-edge's own doc for why it's not folded into the
    // shared route.
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

  const derivedFormat = useMemo(() => {
    if (!analysis || !saved) return null;
    return deriveRankingsFormat(analysis, {
      format: saved.settings.format ?? DEFAULT_LEAGUE_TAGS.format,
      formatConfirmed: saved.settings.formatConfirmed,
    });
  }, [analysis, saved]);

  // Local preview only — never persisted. Defaults to the league's confirmed
  // format, but lets the user freely flick between the two formats their
  // scoring type actually supports (see disabledFormatOption below). Reset
  // on league switch via the render-time "adjusting state when a prop
  // changes" pattern, not an effect, to avoid a cascading-render lint error.
  const [resetKey, setResetKey] = useState(saved?.leagueId ?? null);
  if ((saved?.leagueId ?? null) !== resetKey) {
    setResetKey(saved?.leagueId ?? null);
    setFormatOverride(null);
    setConferenceFilter("");
  }
  const format = formatOverride ?? derivedFormat;
  const scoringMode = analysis?.league.scoringMode ?? null;
  const disabledFormatOption: RankingsFormat | null =
    scoringMode === "points" ? "h2hcat" : scoringMode === "categories" ? "points" : null;

  const lineupCadence = saved?.settings.lineupCadence ?? DEFAULT_GAMES_CAP_SETTINGS.lineupCadence;
  const capPos = saved?.settings.capPos ?? DEFAULT_GAMES_CAP_SETTINGS.capPos;
  const capPosN = saved?.settings.capPosN ?? DEFAULT_GAMES_CAP_SETTINGS.capPosN;
  const capMatch = saved?.settings.capMatch ?? DEFAULT_GAMES_CAP_SETTINGS.capMatch;
  const capMatchN = saved?.settings.capMatchN ?? DEFAULT_GAMES_CAP_SETTINGS.capMatchN;

  const effective = useMemo(
    () => (analysis && saved ? resolveEffectiveScoring(analysis.league, saved.settings) : null),
    [analysis, saved],
  );
  const scored = useMemo(() => effective?.scored ?? [], [effective]);
  const teamCount = analysis?.league.teamCount ?? 0;
  const leaguePlayers = useMemo(() => analysis?.rosters.flatMap((r) => r.players) ?? [], [analysis]);
  const salaryFormat = saved?.settings.salaryFormat ?? DEFAULT_LEAGUE_TAGS.salaryFormat;
  // RosterTableFormat excludes "unconfirmed"/null — the roster panel never
  // renders while format is unresolved (see the `!rosterTeam` guard below).
  const rowFormat: RosterTableFormat = format === "points" ? "points" : format === "h2hcat" ? "h2hcat" : "roto";

  const profiles = useMemo(() => {
    if (!analysis || !format || format === "unconfirmed" || !effective) return null;
    const weight = depthWeight(lineupCadence, format, capPos, capMatch);
    // exactTeamId keeps MY team's displayed lineup exact (matches Category
    // Edge's own answer for the same team/depth, by design) while every
    // other team falls back to greedy — the fix for real "Page Unresponsive"
    // freezes on large leagues toggling depth (Ash, 2026-08-11): the exact
    // branch-and-bound solver was running 30 times per click when only my
    // own team's precision actually matters to what's displayed.
    return buildDepthWeightedProfiles(analysis, depth, weight, { ...effective, exactTeamId: analysis.myTeamId ?? undefined, valueMode });
  }, [analysis, format, depth, lineupCadence, capPos, capMatch, effective, valueMode]);

  // Dynamically derived from whichever raw-stat basis (per-game rate vs
  // season totals) is currently selected — NOT the z-score-based standings
  // analyze.ts's projectRotoStandings would give (see rotoStandingsByRawStat's
  // own doc for why per-game and totals genuinely disagree here).
  const rotoStandings = useMemo(
    () => (profiles && format === "roto" ? rotoStandingsByRawStat(profiles, scored, rotoBasis) : null),
    [profiles, format, scored, rotoBasis],
  );
  const h2hRecords: TeamH2HRecord[] | null = useMemo(() => {
    if (!profiles) return null;
    if (format === "h2hcat") return simulateH2HCategoryStandings(profiles, scored);
    if (format === "points") return simulateH2HPointsStandings(profiles);
    return null;
  }, [profiles, format, scored]);

  const rotoSort = useSortableTable<RotoStandingRow, "team" | "totalPoints" | FheCategory>(
    rotoStandings ?? [],
    { key: "totalPoints", dir: "desc" },
    (row, key) => (key === "team" ? row.teamName : key === "totalPoints" ? row.totalPoints : row.points[key] ?? 0),
  );
  const h2hSorted = useMemo(() => {
    if (!h2hRecords) return [];
    const arr = [...h2hRecords];
    if (h2hSort === "matchup") arr.sort((a, b) => b.totalWins - a.totalWins || b.winPct - a.winPct);
    else arr.sort((a, b) => b.winPct - a.winPct);
    return arr;
  }, [h2hRecords, h2hSort]);

  // Standings conferences (Settings → League basics) — only teams the user
  // actually grouped, so an unassigned team never silently vanishes from
  // "All" but also never shows up under a conference filter it isn't in.
  const conferences = useMemo(() => saved?.settings.conferences ?? [], [saved?.settings.conferences]);
  const conferencesEnabled = (saved?.settings.conferencesEnabled ?? false) && conferences.length > 0;
  const conferenceTeamIds = useMemo(() => {
    if (!conferenceFilter) return null;
    const conf = conferences.find((c) => c.name === conferenceFilter);
    return conf ? new Set(conf.teamIds) : null;
  }, [conferenceFilter, conferences]);
  const rotoRows = useMemo(
    () => (conferenceTeamIds ? rotoSort.sorted.filter((r) => conferenceTeamIds.has(r.teamId)) : rotoSort.sorted),
    [rotoSort.sorted, conferenceTeamIds],
  );
  const h2hRows = useMemo(
    () => (conferenceTeamIds ? h2hSorted.filter((r) => conferenceTeamIds.has(r.teamId)) : h2hSorted),
    [h2hSorted, conferenceTeamIds],
  );

  const myTeamId = analysis?.myTeamId ?? null;

  // Chart 1 (top-of-page "POWER RANKING" ring): my own team's finish in
  // whichever standings view is active — roto has no win% notion (a pure
  // points-total ranking), so only h2hcat/points carry a secondary line.
  const myPowerRank = useMemo(() => {
    if (!myTeamId) return null;
    if (format === "roto") {
      const idx = rotoSort.sorted.findIndex((r) => r.teamId === myTeamId);
      return idx < 0 ? null : { rank: idx + 1, of: rotoSort.sorted.length, winPct: null as number | null };
    }
    const idx = h2hSorted.findIndex((r) => r.teamId === myTeamId);
    return idx < 0 ? null : { rank: idx + 1, of: h2hSorted.length, winPct: h2hSorted[idx].winPct };
  }, [myTeamId, format, rotoSort.sorted, h2hSorted]);

  // Chart 2 (category strength, strongest→weakest): z-score category ranks
  // for my own team — the same categoryEdges() Category Edge's own dashboard
  // reads, format-independent (roto and h2h-categories score the same
  // categories), so it comes straight off `profiles` rather than re-deriving
  // from whichever DISPLAY-only standings view (rotoStandingsByRawStat/
  // h2hRecords) happens to be active. Points leagues have no category
  // dimension at all (see analyze.ts).
  const categoryStrengthPoints: RadarPoint[] | null = useMemo(() => {
    if (!profiles || !myTeamId || format === "points" || scored.length === 0) return null;
    const zStandings = projectRotoStandings(profiles, scored);
    const edges = categoryEdges(myTeamId, profiles, zStandings, scored);
    const byCat = new Map(edges.map((e) => [e.category, e]));
    return scored.map((cat) => ({ category: cat, rank: byCat.get(cat)?.rank ?? null, of: teamCount }));
  }, [profiles, myTeamId, format, scored, teamCount]);

  // Which team's roster the panel below shows — the same selectedTeamId a
  // click on either standings table sets, defaulting to the user's own team
  // and falling back to the top-ranked team so the panel always has
  // something to show once standings exist.
  const rosterTeamId = selectedTeamId
    ?? saved?.teamId
    ?? (format === "roto" ? rotoSort.sorted[0]?.teamId : h2hSorted[0]?.teamId)
    ?? null;
  const rosterTeam = useMemo(
    () => analysis?.rosters.find((r) => r.teamId === rosterTeamId) ?? null,
    [analysis, rosterTeamId],
  );
  // Reads the SAME lineup buildDepthWeightedProfiles already solved for this
  // team (extended to the current depth) instead of re-solving it — a second
  // independent buildOptimalLineup call per team click was a real perf
  // regression (full branch-and-bound on the main thread on every click).
  const drivingIds = useMemo(() => {
    const starters = profiles?.find((p) => p.teamId === rosterTeamId)?.starters;
    return new Set(starters?.map((p) => p.fantraxId) ?? []);
  }, [profiles, rosterTeamId]);

  // Slot-tagged BASE lineup (depth 0, no bench extension) for the currently-
  // viewed team only — TeamCategoryProfile.starters (used by drivingIds
  // above) is already flattened to plain ResolvedPlayer[] by profileFromLineup,
  // discarding which slot each player actually fills. Needed for the
  // Guards/Forwards/Centres/Flex/Reserves/Minors grouping (Ash, 2026-08-19),
  // which is about the real starting-lineup slot, not the depth toggle's
  // bench-weighting. A fresh buildOptimalLineup call for one team is cheap —
  // it's cached when this is the same team/settings profiles already solved
  // exactly, and bounded even when it isn't (see lineup.ts's cache + backtrack
  // budget) — nothing like the 30-team freeze that pattern used to cause.
  const baseLineup = useMemo(() => {
    if (!rosterTeam || !effective || !analysis) return null;
    const formula = analysis.league.scoringMode === "points" ? analysis.league.pointsFormula : null;
    return buildOptimalLineup(rosterTeam.players, effective.positionSlots, formula, { valueMode, exact: true });
  }, [rosterTeam, effective, analysis, valueMode]);
  const rosterStatsMode: "perGame" | "totals" = format === "roto" ? rotoBasis : "perGame";
  // Re-labels the SAME already-chosen driving set (baseLineup.starters —
  // unchanged, still the exact solver's value-maximizing pick, so real
  // scoring/standings math is untouched) into WHICH named slot each of those
  // players displays under, via the scarcity-first greedy algorithm instead
  // of the exact solver's own slot choice (Ash, 2026-08-19: "order players by
  // position, then value rank — the top ranked guard would show up in the PG
  // or G slots not the flex slot"). The exact solver can legitimately bench
  // the single best player into Flex if that maximizes total value (see
  // lineup.ts's own header comment on why that's usually correct for
  // scoring) — this is purely a display re-sort of a fixed set of already-
  // selected players into slot labels, matching what a reader expects to see
  // grouped as "Guards"/"Forwards"/etc. Value ranking respects the same
  // per-game/totals toggle already driving this panel's stat display.
  const slotByFantraxId = useMemo(() => {
    const map = new Map<string, string>();
    if (!baseLineup || !effective) return map;
    const slotInstances: string[] = [];
    for (const [slot, count] of Object.entries(effective.positionSlots)) {
      if (RESERVE_SLOTS.has(slot.toLowerCase())) continue;
      for (let i = 0; i < count; i++) slotInstances.push(slot);
    }
    const rankValue = (p: ResolvedPlayer): number | null => {
      if (valueMode === "fpts" || valueMode === "league") return p.pointsValue;
      const set = rosterStatsMode === "totals" ? p.catV?.totals : p.catV?.perGame;
      return set?.[valueMode] ?? null;
    };
    const relabeled = greedyAssignment(slotInstances, baseLineup.starters.map((a) => a.player), rankValue);
    relabeled.forEach((p, i) => { if (p) map.set(p.fantraxId, slotInstances[i]); });
    return map;
  }, [baseLineup, effective, valueMode, rosterStatsMode]);

  const hasLeague = Boolean(saved);
  const settingsSummary = `${lineupCadence === "daily" ? "Daily" : "Weekly"} lineups · ${capPos ? `Position cap ${capPosN}/pos` : "No position cap"} · ${capMatch ? `Matchup cap ${capMatchN} gms` : "No matchup cap"}`;

  // The two summary charts — lives in the header row's own right-hand column
  // (top-right whitespace beside the title/toggles, Ash's own placement,
  // 2026-08-19) rather than a full-width row below it. Plain JSX, not a
  // second useMemo: myPowerRank/categoryStrengthPoints are already null until
  // a league is loaded/format-confirmed, so this naturally renders nothing
  // through every loading/error/unconfirmed state without duplicating them.
  const chartsPanel = (myPowerRank || categoryStrengthPoints) ? (
    <div style={{ display: "flex", gap: 48, flexWrap: "wrap", alignItems: "flex-start" }}>
      {myPowerRank && (
        <DashboardCard title="POWER RANKING" bordered={false}>
          <PercentileRing
            rank={myPowerRank.rank} of={myPowerRank.of} size={110}
            subLabel={
              <>
                OF {myPowerRank.of}
                {myPowerRank.winPct != null && (
                  <>
                    <br />
                    <span style={{ color: "var(--rt-ink)", fontWeight: 700 }}>{(myPowerRank.winPct * 100).toFixed(1)}% WIN</span>
                  </>
                )}
              </>
            }
          />
        </DashboardCard>
      )}
      {categoryStrengthPoints && (
        <div>
          <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 10.5, color: "var(--rt-muted)", marginBottom: 10 }}>CATEGORY STRENGTH · STRONGEST TO WEAKEST</div>
          <CategoryStrengthChart points={categoryStrengthPoints} height={130} barWidth={24} gap={8} />
        </div>
      )}
    </div>
  ) : null;

  return (
    <HubShell hasLeague={hasLeague} breadcrumb={saved ? `${saved.leagueName} · Power Rankings` : "Power Rankings"}>
      <style>{DEEP_EDGE_TABLE_CSS}</style>
      <Link href="/deep-edge/home" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--rt-muted)", fontSize: 13, textDecoration: "none", marginBottom: 16 }}>
        <IconChevronLeft size={14} /> Back to {saved?.leagueName ?? "home"}
      </Link>

      <div style={{ display: "grid", gridTemplateColumns: chartsPanel ? "auto 1fr" : "auto", alignItems: "flex-start", gap: 24 }}>
        <div style={{ minWidth: 280 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Power Rankings</h1>
            {format && format !== "unconfirmed" && (
              <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 10.5, padding: "4px 9px", borderRadius: 100, background: "var(--rt-surface-strong)", color: "var(--rt-muted)" }}>
                {teamCount} TEAMS
              </span>
            )}
          </div>
          {format && format !== "unconfirmed" && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
              <SegmentedControl<RankingsFormat>
                options={FORMAT_TOGGLE_OPTIONS}
                value={format}
                onChange={setFormatOverride}
                disabledOptions={disabledFormatOption ? [disabledFormatOption] : []}
              />
              {formatOverride && formatOverride !== derivedFormat && (
                <span style={{ fontSize: 11.5, color: "var(--rt-muted)" }}>
                  Previewing {FORMAT_LABEL[formatOverride]} · your league is set to {derivedFormat ? FORMAT_LABEL[derivedFormat] : ""}
                </span>
              )}
            </div>
          )}
          {format && format !== "unconfirmed" && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, color: "var(--rt-muted)" }}>Rank lineup by</span>
              <SegmentedControl<LineupValueMode>
                options={UI_VALUE_MODE_OPTIONS}
                value={valueMode}
                onChange={setValueMode}
                disabledOptions={scoringMode !== "points" ? ["fpts"] : []}
              />
            </div>
          )}
        </div>

        {chartsPanel && (
          <div style={{ display: "flex", justifyContent: "center" }}>
            {chartsPanel}
          </div>
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
      ) : (
        <>
          <p style={{ color: "var(--rt-body)", fontSize: 14, margin: "0 0 20px", maxWidth: 640 }}>
            Every team in {saved.leagueName}, ranked by your league&apos;s scoring format.
          </p>


          <div
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderRadius: 100,
              background: "var(--rt-surface-soft)", border: "1px solid var(--rt-hairline)", marginBottom: 20, fontSize: 12.5,
            }}
          >
            ⚙ {settingsSummary}
            <Link href={`/deep-edge/home/settings?league=${encodeURIComponent(saved.leagueId)}`} style={{ color: "var(--rt-primary)", fontWeight: 600, textDecoration: "none", marginLeft: "auto" }}>
              adjust in settings
            </Link>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
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
            <span style={{ fontSize: 12.5, color: "var(--rt-muted)", maxWidth: 420 }}>
              {depthCaption(lineupCadence, format!, capPos, capMatch, capPosN, capMatchN)}
            </span>
          </div>

          {conferencesEnabled && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, color: "var(--rt-muted)" }}>Conference</span>
              <SegmentedControl<string>
                options={[{ value: "", label: "All" }, ...conferences.map((c) => ({ value: c.name, label: c.name }))]}
                value={conferenceFilter}
                onChange={setConferenceFilter}
              />
            </div>
          )}

          {format === "roto" && rotoStandings && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                <SegmentedControl<"perGame" | "totals" | "points"> options={ROTO_VIEW_OPTIONS} value={rotoView} onChange={setRotoView} />
                {rotoView === "points" && (
                  <SegmentedControl<"perGame" | "totals"> options={POINTS_BASIS_OPTIONS} value={pointsBasis} onChange={setPointsBasis} />
                )}
              </div>
              <div className="de-table-wrap">
                <table className="de-table de-table-compact de-table-roster">
                  <colgroup>
                    <col style={{ width: 36 }} />
                    <col style={{ width: 150 }} />
                    <col style={{ width: 56 }} />
                    {scored.map((cat) => <col key={cat} style={{ width: 44 }} />)}
                  </colgroup>
                  <thead>
                    <tr>
                      <th>#</th>
                      <SortTh<"team" | "totalPoints" | FheCategory> label="TEAM" sortKey="team" sort={rotoSort.sort} onSort={rotoSort.onSort} align="left" />
                      <SortTh<"team" | "totalPoints" | FheCategory> label="ROTO" sortKey="totalPoints" sort={rotoSort.sort} onSort={rotoSort.onSort} />
                      {scored.map((cat) => (
                        <SortTh<"team" | "totalPoints" | FheCategory> key={cat} label={CATEGORY_LABEL[cat]} sortKey={cat} sort={rotoSort.sort} onSort={rotoSort.onSort} />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rotoRows.map((row, i) => {
                      const profile = profiles!.find((p) => p.teamId === row.teamId)!;
                      return (
                        <tr
                          key={row.teamId}
                          className={row.teamId === saved.teamId ? "mine" : ""}
                          onClick={() => setSelectedTeamId(row.teamId)}
                          style={{ cursor: "pointer" }}
                        >
                          <td style={{ boxShadow: row.teamId === rosterTeamId ? "inset 3px 0 0 var(--rt-primary)" : undefined }}>{i + 1}</td>
                          <td className="l"><span className="de-player-name">{row.teamName}{row.teamId === saved.teamId ? " · YOU" : ""}</span></td>
                          <td style={{ fontWeight: 700 }}>{Math.round(row.totalPoints)}</td>
                          {scored.map((cat) => (
                            <td key={cat} style={{ background: tierBg(row.ranks[cat] ?? teamCount, teamCount) }}>
                              {rotoView === "perGame"
                                ? formatPerGame(cat, weightedPerGame(profile.statTotals, cat))
                                : rotoView === "totals"
                                  ? formatTotal(cat, totalsValue(profile.statTotals, cat))
                                  : Math.round(row.points[cat] ?? 0)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {(format === "h2hcat" || format === "points") && h2hSorted.length > 0 && (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 12.5, color: "var(--rt-muted)", marginRight: 4 }}>Sort by</span>
                {(format === "h2hcat"
                  ? [["matchup", "Matchup record"], ["winpct", "Win %"]]
                  : [["matchup", "Record"], ["winpct", "Fantasy points"]]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setH2hSort(key as typeof h2hSort)}
                    style={{
                      padding: "6px 13px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer",
                      border: "1px solid var(--rt-hairline)",
                      background: h2hSort === key ? "var(--rt-ink)" : "transparent",
                      color: h2hSort === key ? "var(--rt-canvas)" : "var(--rt-ink)",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="de-table-wrap" style={{ marginBottom: 24 }}>
                <table className="de-table de-table-roster" style={{ minWidth: format === "h2hcat" ? 860 : 720 }}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th className="l">TEAM</th>
                      <th>WIN %</th>
                      {format === "h2hcat" ? <th>CATEGORY W-D-L</th> : <th>RECORD</th>}
                      {format === "h2hcat" ? <th className="l">YOU VS TEAM</th> : <th>FPTS/GM</th>}
                      <th style={{ minWidth: 120 }}>STRENGTH</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h2hRows.map((row, i) => (
                      <tr
                        key={row.teamId}
                        className={row.teamId === saved.teamId ? "mine" : ""}
                        onClick={() => setSelectedTeamId(row.teamId)}
                        style={{ cursor: "pointer" }}
                      >
                        <td style={{ boxShadow: row.teamId === rosterTeamId ? "inset 3px 0 0 var(--rt-primary)" : undefined }}>{i + 1}</td>
                        <td className="l"><span className="de-player-name">{row.teamName}{row.teamId === saved.teamId ? " · YOU" : ""}</span></td>
                        <td>{(row.winPct * 100).toFixed(1)}%</td>
                        {format === "h2hcat" ? (
                          <>
                            <td>{row.categoryWins}-{row.categoryDraws}-{row.categoryLosses}</td>
                            <td className="l">
                              <YouVsTeamCells myRecord={h2hSorted.find((r) => r.teamId === saved.teamId)} opponentTeamId={row.teamId} scored={scored} />
                            </td>
                          </>
                        ) : (
                          <>
                            <td>{row.totalWins}-{row.totalDraws}-{row.totalLosses}</td>
                            <td>{(profiles!.find((p) => p.teamId === row.teamId)!.pointsTotal! / Math.max(1, profiles!.find((p) => p.teamId === row.teamId)!.statTotals.gamesPlayed)).toFixed(1)}</td>
                          </>
                        )}
                        <td><StrengthBar ratio={row.winPct} color={tierFill(i + 1, h2hSorted.length)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {rosterTeam && (
            <div style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid var(--rt-hairline)" }}>
              <TeamRosterPanel
                roster={rosterTeam}
                enrich={enrich}
                format={rowFormat}
                scored={scored}
                positionSlots={effective?.positionSlots ?? {}}
                leaguePlayers={leaguePlayers}
                salaryFormat={salaryFormat}
                drivingIds={drivingIds}
                slotByFantraxId={slotByFantraxId}
                statsMode={rosterStatsMode}
              />
            </div>
          )}
        </>
      )}
    </HubShell>
  );
}

export default function PowerRankingsPage() {
  return (
    <Suspense fallback={null}>
      <PowerRankingsContent />
    </Suspense>
  );
}
