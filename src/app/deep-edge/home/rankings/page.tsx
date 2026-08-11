"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { LeagueAnalysis, RotoStandingRow } from "@/lib/fantrax/analyze";
import { projectRotoStandings } from "@/lib/fantrax/analyze";
import { CATEGORY_LABEL, type FheCategory } from "@/lib/fantrax/league";
import { DEFAULT_GAMES_CAP_SETTINGS, DEFAULT_LEAGUE_TAGS } from "@/lib/fantrax/league-tags";
import { FormatConfirmPrompt } from "@/lib/fantrax/format-confirm";
import { buildDepthWeightedProfiles, deriveRankingsFormat, depthCaption, depthWeight, simulateH2HCategoryStandings, simulateH2HPointsStandings, type RankingsFormat, type TeamH2HRecord } from "@/lib/fantrax/power-rankings";
import { resolveEffectiveScoring } from "@/lib/fantrax/lineup";
import { HubShell } from "../../_components/hub-shell";
import { IconChevronLeft } from "../../_components/icons";
import { WdlBadge } from "../../_components/wdl-badge";
import { StrengthBar } from "../../_components/strength-bar";
import { SegmentedControl } from "../../_components/segmented-control";
import { tierBg, tierFill } from "../../_components/tier-colors";
import { DEEP_EDGE_TABLE_CSS, SortTh, useSortableTable } from "../../_components/sortable-table";
import { useSavedLeagues } from "../../_lib/use-saved-leagues";

const FORMAT_LABEL: Record<string, string> = { roto: "ROTO · 9-CAT", h2hcat: "H2H · EACH CATEGORY", points: "H2H · POINTS" };
const FORMAT_TOGGLE_OPTIONS: { value: RankingsFormat; label: string }[] = [
  { value: "roto", label: "CAT ROTO" },
  { value: "h2hcat", label: "CAT H2H" },
  { value: "points", label: "POINTS" },
];
const ROTO_VIEW_OPTIONS: { value: "perGame" | "totals" | "points"; label: string }[] = [
  { value: "perGame", label: "PER GAME" },
  { value: "totals", label: "TOTALS" },
  { value: "points", label: "ROTO POINTS" },
];

const STAT_KEY: Record<FheCategory, "pts" | "fg3m" | "reb" | "ast" | "stl" | "blk" | "tov"> = {
  PTS: "pts", FG3: "fg3m", REB: "reb", AST: "ast", STL: "stl", BLK: "blk", TO: "tov", FG: "pts", FT: "pts",
};

/** Team-combined raw season totals for the lineup — the "Totals" roto view,
 *  and the base figure weightedPerGame() below divides down to a per-game
 *  rate. FG%/FT% are already attempts-weighted inside statTotals. */
function totalsValue(statTotals: { pts: number; fg3m: number; reb: number; ast: number; stl: number; blk: number; tov: number; fg_pct: number | null; ft_pct: number | null }, cat: FheCategory): number {
  if (cat === "FG") return statTotals.fg_pct ?? 0;
  if (cat === "FT") return statTotals.ft_pct ?? 0;
  return statTotals[STAT_KEY[cat]];
}
function formatTotal(cat: FheCategory, raw: number): string {
  return cat === "FG" || cat === "FT" ? raw.toFixed(3).replace(/^0(?=\.)/, "") : Math.round(raw).toLocaleString("en-US");
}
/** FG%/FT% drop the leading zero (.485, not 0.485) since they're always
 *  sub-1 percentages; every counting stat keeps it (0.6 STL, not .6) — a
 *  bare ".6" reads as a typo, not a small number. */
function formatPerGame(cat: FheCategory, raw: number): string {
  return cat === "FG" || cat === "FT" ? raw.toFixed(3).replace(/^0(?=\.)/, "") : raw.toFixed(1);
}

/** Weighted per-game average across the lineup: combined season totals
 *  divided by combined games played — matches Ash's own reference table
 *  exactly (Σ 6 TICKED: 7,251 PTS / 408 GP = 17.8, 738 3PM / 408 = 1.8, etc.),
 *  confirmed digit-for-digit against a real screenshot. This is a blended
 *  per-player rate, not a team-combined total — it recalculates the same way
 *  as depth increases (+1, +2, …) since statTotals grows with the lineup.
 *  FG%/FT% are already attempts-weighted inside statTotals, so they pass
 *  through as-is rather than being divided again. */
function weightedPerGame(statTotals: { pts: number; fg3m: number; reb: number; ast: number; stl: number; blk: number; tov: number; fg_pct: number | null; ft_pct: number | null; gamesPlayed: number }, cat: FheCategory): number {
  const raw = totalsValue(statTotals, cat);
  if (cat === "FG" || cat === "FT") return raw;
  return statTotals.gamesPlayed > 0 ? raw / statTotals.gamesPlayed : 0;
}

export default function PowerRankingsPage() {
  const { leagues, loading: loadingSaved } = useSavedLeagues();
  const saved = leagues[0] ?? null;
  const [analysis, setAnalysis] = useState<LeagueAnalysis | null>(null);
  const [error, setError] = useState("");
  const [depth, setDepth] = useState(0);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [h2hSort, setH2hSort] = useState<"matchup" | "winpct" | "category">("winpct");
  const [formatOverride, setFormatOverride] = useState<RankingsFormat | null>(null);
  const [rotoView, setRotoView] = useState<"perGame" | "totals" | "points">("perGame");

  useEffect(() => {
    if (!saved) return;
    const params = new URLSearchParams({
      leagueId: saved.leagueId,
      dataset: saved.settings.defaultDataset ?? "2027:projection",
      leagueType: saved.settings.leagueType ?? "redraft",
    });
    if (saved.teamId) params.set("teamId", saved.teamId);
    fetch(`/api/fantrax/league?${params}`)
      .then((r) => r.json())
      .then((data) => (data.error ? setError(data.error) : setAnalysis(data)))
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

  const profiles = useMemo(() => {
    if (!analysis || !format || format === "unconfirmed" || !effective) return null;
    const weight = depthWeight(lineupCadence, format, capPos, capMatch);
    return buildDepthWeightedProfiles(analysis, depth, weight, effective);
  }, [analysis, format, depth, lineupCadence, capPos, capMatch, effective]);

  const rotoStandings = useMemo(
    () => (profiles && format === "roto" ? projectRotoStandings(profiles, scored) : null),
    [profiles, format, scored],
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
    else if (h2hSort === "category") arr.sort((a, b) => b.categoryWins - a.categoryWins);
    else arr.sort((a, b) => b.winPct - a.winPct);
    return arr;
  }, [h2hRecords, h2hSort]);

  const selected = h2hSorted.find((r) => r.teamId === selectedTeamId) ?? h2hSorted.find((r) => r.teamId === saved?.teamId) ?? h2hSorted[0] ?? null;

  const hasLeague = Boolean(saved);
  const settingsSummary = `${lineupCadence === "daily" ? "Daily" : "Weekly"} lineups · ${capPos ? `Position cap ${capPosN}/pos` : "No position cap"} · ${capMatch ? `Matchup cap ${capMatchN} gms` : "No matchup cap"}`;

  return (
    <HubShell hasLeague={hasLeague} breadcrumb={saved ? `${saved.leagueName} · Power Rankings` : "Power Rankings"}>
      <style>{DEEP_EDGE_TABLE_CSS}</style>
      <Link href="/deep-edge/home" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--rt-muted)", fontSize: 13, textDecoration: "none", marginBottom: 16 }}>
        <IconChevronLeft size={14} /> Back to {saved?.leagueName ?? "home"}
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Power Rankings</h1>
        {format && format !== "unconfirmed" && (
          <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 10.5, padding: "4px 9px", borderRadius: 100, background: "var(--rt-surface-strong)", color: "var(--rt-muted)" }}>
            {teamCount} TEAMS
          </span>
        )}
      </div>
      {format && format !== "unconfirmed" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
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
            <Link href="/deep-edge/home/settings" style={{ color: "var(--rt-primary)", fontWeight: 600, textDecoration: "none", marginLeft: "auto" }}>
              adjust in settings
            </Link>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
              {["Best lineup", "+1", "+2", "+3", "+4", "+5"].map((label, i) => (
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

          {format === "roto" && rotoStandings && (
            <>
              <div style={{ marginBottom: 14 }}>
                <SegmentedControl<"perGame" | "totals" | "points"> options={ROTO_VIEW_OPTIONS} value={rotoView} onChange={setRotoView} />
              </div>
              <div className="de-table-wrap">
                <table className="de-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <SortTh<"team" | "totalPoints" | FheCategory> label="TEAM" sortKey="team" sort={rotoSort.sort} onSort={rotoSort.onSort} align="left" />
                      {scored.map((cat) => (
                        <SortTh<"team" | "totalPoints" | FheCategory> key={cat} label={CATEGORY_LABEL[cat]} sortKey={cat} sort={rotoSort.sort} onSort={rotoSort.onSort} />
                      ))}
                      <SortTh<"team" | "totalPoints" | FheCategory> label="ROTO" sortKey="totalPoints" sort={rotoSort.sort} onSort={rotoSort.onSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {rotoSort.sorted.map((row, i) => {
                      const profile = profiles!.find((p) => p.teamId === row.teamId)!;
                      return (
                        <tr key={row.teamId} className={row.teamId === saved.teamId ? "mine" : ""}>
                          <td>{i + 1}</td>
                          <td className="l">{row.teamName}{row.teamId === saved.teamId ? " · YOU" : ""}</td>
                          {scored.map((cat) => (
                            <td key={cat} style={{ background: tierBg(row.ranks[cat] ?? teamCount, teamCount) }}>
                              {rotoView === "perGame"
                                ? formatPerGame(cat, weightedPerGame(profile.statTotals, cat))
                                : rotoView === "totals"
                                  ? formatTotal(cat, totalsValue(profile.statTotals, cat))
                                  : (row.points[cat] ?? 0).toFixed(1)}
                            </td>
                          ))}
                          <td style={{ fontWeight: 700 }}>{row.totalPoints}</td>
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
                  ? [["matchup", "Matchup record"], ["winpct", "Win %"], ["category", "Category record"]]
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
                <table className="de-table" style={{ minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th className="l">TEAM</th>
                      <th>{format === "h2hcat" ? "MATCHUP W-D-L" : "RECORD"}</th>
                      <th>WIN %</th>
                      {format === "h2hcat" ? <th>CATEGORY W-D-L</th> : <th>FPTS/GM</th>}
                      <th style={{ minWidth: 120 }}>STRENGTH</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h2hSorted.map((row, i) => (
                      <tr
                        key={row.teamId}
                        className={row.teamId === saved.teamId ? "mine" : ""}
                        onClick={() => setSelectedTeamId(row.teamId)}
                        style={{ cursor: "pointer" }}
                      >
                        <td>{i + 1}</td>
                        <td className="l">{row.teamName}{row.teamId === saved.teamId ? " · YOU" : ""}</td>
                        <td>{row.totalWins}-{row.totalDraws}-{row.totalLosses}</td>
                        <td>{(row.winPct * 100).toFixed(1)}%</td>
                        {format === "h2hcat" ? (
                          <td>{row.categoryWins}-{row.categoryDraws}-{row.categoryLosses}</td>
                        ) : (
                          <td>{(profiles!.find((p) => p.teamId === row.teamId)!.pointsTotal! / Math.max(1, profiles!.find((p) => p.teamId === row.teamId)!.statTotals.gamesPlayed)).toFixed(1)}</td>
                        )}
                        <td><StrengthBar ratio={row.winPct} color={tierFill(i + 1, h2hSorted.length)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selected && (
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{selected.teamName} — head to head</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
                    {selected.matchups
                      .slice()
                      .sort((a, b) => {
                        const order = { win: 0, draw: 1, loss: 2 } as const;
                        return order[a.matchupResult] - order[b.matchupResult] || a.opponentName.localeCompare(b.opponentName);
                      })
                      .map((m) => (
                        <div key={m.opponentId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, border: "1px solid var(--rt-hairline)" }}>
                          <WdlBadge result={m.matchupResult} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.opponentName}</div>
                            <div style={{ fontSize: 11, color: "var(--rt-muted)", fontFamily: "var(--rt-font-mono)" }}>
                              {m.scoreline ? `${m.scoreline.mine.toFixed(1)} vs ${m.scoreline.theirs.toFixed(1)}` : `${m.wins}-${m.draws}-${m.losses}`}
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </HubShell>
  );
}
