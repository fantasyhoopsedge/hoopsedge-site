"use client";

import { Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import { HubShell } from "../../_components/hub-shell";
import { DEEP_EDGE_TABLE_CSS } from "../../_components/sortable-table";
import { useActiveLeague } from "../../_lib/use-saved-leagues";
import { TeamLogo, formatSalary, formatCustomSalary, formatRank } from "../../_components/roster-table";
import { PlayerHeadshot } from "@/app/team-rosters/_components/roster-headshot";
import { TAG_META } from "@/app/team-rosters/_components/trend-insight";
import { FANTRAX_DATASETS, type FantraxDatasetKey } from "@/lib/fantrax/league";
import { DEFAULT_LEAGUE_TAGS } from "@/lib/fantrax/league-tags";
import type { LeagueRankingsResult, RankingsBasis } from "@/lib/fantrax/league-rankings";

/**
 * League Rankings (Ash, 2026-08-25) — "a place to analyse/review the full
 * suite of valued assets within the league": every player, free agent, and
 * draft pick, ranked under whichever of the four value bases the league can
 * offer (custom generated ledger, standard consensus dynasty, real salary,
 * redraft/FHE-projection), with the same optional columns Roster Edge
 * offers (Salary/Contract/Dynasty Rank/Salary Rank) plus new ones (Asset
 * Trade Value, Fantasy Team, Age) and Roster Edge's own core stat columns
 * (Trend/GP/MIN/USG/Minus1V/9CatV/8CatV/FPTS) made optional here instead of
 * always-on. No column sort — the table is always sorted by the active
 * basis tab's rank (item 5 of the ask: "the sort remains static on the
 * ranking"); a Player/Draft/All Assets filter and a Fantasy Team filter
 * both re-rank the VISIBLE subset from scratch (so "Draft Assets" reads as
 * pick #1..N, not wherever those picks happened to fall in the full pool).
 */

type AssetTypeFilter = "all" | "player" | "pick";
type StatMode = "perGame" | "totals";

interface ColState {
  salary: boolean; contract: boolean; dynastyRank: boolean; salaryRank: boolean;
  tradeValue: boolean; fantasyTeam: boolean; age: boolean;
  trend: boolean; gp: boolean; min: boolean; usg: boolean;
  minus1: boolean; nineCat: boolean; eightCat: boolean; fpts: boolean;
}
const DEFAULT_COLS: ColState = {
  salary: true, contract: true, dynastyRank: true, salaryRank: true,
  tradeValue: true, fantasyTeam: true, age: true,
  trend: true, gp: true, min: true, usg: true,
  minus1: true, nineCat: false, eightCat: false, fpts: false,
};

const BASIS_LABEL: Record<RankingsBasis, string> = {
  custom: "Custom generated",
  standard: "Consensus dynasty",
  real: "Real salary",
  redraft: "Redraft (projections)",
};

function pill(active: boolean): CSSProperties {
  return {
    padding: "7px 14px", border: "none", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
    background: active ? "var(--rt-canvas)" : "transparent", color: active ? "var(--rt-ink)" : "var(--rt-muted)",
  };
}

function LeagueRankingsContent() {
  const { saved, loading: loadingSaved } = useActiveLeague();
  const [data, setData] = useState<LeagueRankingsResult | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState("");

  const [dataset, setDataset] = useState<FantraxDatasetKey>(FANTRAX_DATASETS[0].key);
  const [basis, setBasis] = useState<RankingsBasis>("standard");
  const [assetType, setAssetType] = useState<AssetTypeFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [statMode, setStatMode] = useState<StatMode>("perGame");
  const [cols, setCols] = useState<ColState>(DEFAULT_COLS);
  const [showCols, setShowCols] = useState(false);

  useEffect(() => {
    if (!saved) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting the dataset to this league's own default when the ACTIVE LEAGUE changes, not a plain render-time computation
    setDataset(saved.settings.defaultDataset ?? DEFAULT_LEAGUE_TAGS.defaultDataset);
  }, [saved?.leagueId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only when the ACTIVE LEAGUE changes, not on every settings tweak

  useEffect(() => {
    if (!saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting derived loading state when the league this effect depends on is absent, not a plain render-time computation
      setLoadingData(false);
      return;
    }
    setLoadingData(true);
    setError("");
    const params = new URLSearchParams({
      leagueId: saved.leagueId, dataset,
      leagueType: saved.settings.leagueType ?? DEFAULT_LEAGUE_TAGS.leagueType,
      salaryFormat: saved.settings.salaryFormat ?? DEFAULT_LEAGUE_TAGS.salaryFormat,
    });
    if (saved.teamId) params.set("teamId", saved.teamId);
    if (saved.settings.keeperPolicy) params.set("keeperPolicy", saved.settings.keeperPolicy);
    if (saved.settings.realSalaryEfficiencyWeight != null) params.set("realSalaryEfficiencyWeight", String(saved.settings.realSalaryEfficiencyWeight));
    if (saved.settings.contractRules?.length) params.set("contractRules", JSON.stringify(saved.settings.contractRules));
    if (saved.settings.rookieSalaryScale?.length) params.set("rookieSalaryScale", JSON.stringify(saved.settings.rookieSalaryScale));
    fetch(`/api/fantrax/league-rankings?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setData(d as LeagueRankingsResult);
        setBasis((prev) => (d.ledgerMode != null ? prev : prev === "custom" ? "standard" : prev));
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoadingData(false));
  }, [saved?.leagueId, saved?.teamId, dataset]); // eslint-disable-line react-hooks/exhaustive-deps -- settings fields read fresh each fetch, not tracked as deps (same pattern as trade-edge/roster-edge's own analysis fetch effects)

  const salaryFormat = saved?.settings.salaryFormat ?? DEFAULT_LEAGUE_TAGS.salaryFormat;
  const isCustomSalary = salaryFormat === "custom";
  const isPointsLeague = data?.family === "points";

  const owners = useMemo(() => (data ? [...new Set(data.assets.map((a) => a.owner))].sort() : []), [data]);

  const visibleBasisTabs = useMemo<RankingsBasis[]>(() => {
    const tabs: RankingsBasis[] = [];
    if (data?.ledgerMode != null) tabs.push("custom");
    tabs.push("standard", "real", "redraft");
    return tabs;
  }, [data?.ledgerMode]);

  useEffect(() => {
    if (visibleBasisTabs.length > 0 && !visibleBasisTabs.includes(basis)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- snapping the active tab back to a valid one when the available tabs change (e.g. a ledger appears/disappears), not a plain render-time computation
      setBasis(visibleBasisTabs[0]);
    }
  }, [visibleBasisTabs, basis]);

  // Filter -> rank WITHIN the visible subset (not the full pool's own rank —
  // "Draft Assets" should read #1..N among picks, not wherever a pick
  // happened to fall in a player-dominated full pool) -> that's the row order.
  const rankedRows = useMemo(() => {
    if (!data) return [];
    const values = data.values[basis];
    const filtered = data.assets.filter(
      (a) => (assetType === "all" || a.kind === assetType) && (ownerFilter === "all" || a.owner === ownerFilter),
    );
    const withValue = filtered
      .map((a) => ({ asset: a, value: values[a.key]?.value ?? null }))
      .filter((r) => r.value != null || basis !== "redraft" || r.asset.kind === "player");
    withValue.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
    return withValue.map((r, i) => ({ ...r, rank: r.value != null ? i + 1 : null }));
  }, [data, basis, assetType, ownerFilter]);

  const summary = useMemo(() => {
    let salary = 0, salaryCount = 0, gp = 0, gpCount = 0, min = 0, minCount = 0;
    for (const { asset: a } of rankedRows) {
      if (a.salary != null) { salary += a.salary; salaryCount++; }
      if (a.gamesPlayed != null) { gp += a.gamesPlayed; gpCount++; }
      if (a.minutesPerGame != null) { min += a.minutesPerGame; minCount++; }
    }
    return {
      count: rankedRows.length, salaryTotal: salary, salaryCount,
      gpAvg: gpCount > 0 ? gp / gpCount : null, minAvg: minCount > 0 ? min / minCount : null,
    };
  }, [rankedRows]);

  function fmtSalary(n: number | null): string {
    return isCustomSalary ? formatCustomSalary(n) : formatSalary(n);
  }

  const colDefs: { key: keyof ColState; label: string }[] = [
    { key: "tradeValue", label: "Asset trade value" },
    { key: "fantasyTeam", label: "Fantasy team" },
    { key: "age", label: "Age" },
    { key: "salary", label: "Salary" },
    { key: "contract", label: "Contract" },
    { key: "dynastyRank", label: "Dynasty rank" },
    { key: "salaryRank", label: "Salary rank" },
    { key: "trend", label: "Trend tag" },
    { key: "gp", label: "GP" },
    { key: "min", label: "MIN" },
    { key: "usg", label: "USG" },
    { key: "minus1", label: "Minus1V" },
    { key: "nineCat", label: "9CatV" },
    { key: "eightCat", label: "8CatV" },
    { key: "fpts", label: "FPTS" },
  ];

  return (
    <HubShell hasLeague={Boolean(saved)} breadcrumb={saved ? `${saved.leagueName} · League Rankings` : "League Rankings"}>
      <style>{DEEP_EDGE_TABLE_CSS}</style>
      <style>{`
        .lr-table th, .lr-table td { font-family: var(--rt-font-sans); }
        .lr-table td.l, .lr-table th.l { text-align: left; }
        .lr-summary { display: flex; gap: 24px; flex-wrap: wrap; padding: 14px 18px; border-radius: 12px; background: var(--rt-surface-soft); border: 1px solid var(--rt-hairline); margin-bottom: 16px; }
        .lr-summary .stat { display: flex; flex-direction: column; gap: 2px; }
        .lr-summary .stat .n { font-family: var(--rt-font-mono); font-weight: 700; font-size: 16px; }
        .lr-summary .stat .l { font-size: 11px; color: var(--rt-muted); text-transform: uppercase; letter-spacing: 0.04em; }
      `}</style>

      <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>League Rankings</h1>
      <p style={{ color: "var(--rt-body)", fontSize: 14, margin: "0 0 20px", maxWidth: 680 }}>
        Every valued asset in {saved?.leagueName ?? "your league"} — players, free agents, and draft picks — ranked
        under whichever basis you pick below. Always sorted by that basis&apos;s rank; there&apos;s no per-column sort here.
      </p>

      {loadingSaved ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>Loading…</p>
      ) : !saved ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>No league connected yet — add one from Home.</p>
      ) : (
        <>
          {/* Basis tabs */}
          <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999, marginBottom: 14 }}>
            {visibleBasisTabs.map((b) => (
              <button key={b} type="button" onClick={() => setBasis(b)} style={pill(basis === b)}>
                {BASIS_LABEL[b]}
              </button>
            ))}
          </div>
          {basis === "custom" && data?.ledgerGeneratedAt && (
            <p style={{ fontSize: 12, color: "var(--rt-muted)", margin: "0 0 14px" }}>
              Custom ledger last generated {new Date(data.ledgerGeneratedAt).toLocaleString()}
              {data.ledgerMode === "picksOnly" ? " — draft-pick values only; players read standard values." : "."}
            </p>
          )}

          {/* Asset type + filters row */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
              {(["all", "player", "pick"] as AssetTypeFilter[]).map((v) => (
                <button key={v} type="button" onClick={() => setAssetType(v)} style={pill(assetType === v)}>
                  {v === "all" ? "All assets" : v === "player" ? "Player assets" : "Draft assets"}
                </button>
              ))}
            </div>
            <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} style={{ height: 34, borderRadius: 8, border: "1px solid var(--rt-hairline)", background: "var(--rt-canvas)", color: "var(--rt-ink)", fontSize: 12.5, padding: "0 10px" }}>
              <option value="all">All fantasy teams</option>
              {owners.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <select value={dataset} onChange={(e) => setDataset(e.target.value as FantraxDatasetKey)} style={{ height: 34, borderRadius: 8, border: "1px solid var(--rt-hairline)", background: "var(--rt-canvas)", color: "var(--rt-ink)", fontSize: 12.5, padding: "0 10px" }}>
              {FANTRAX_DATASETS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
            <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
              {(["perGame", "totals"] as StatMode[]).map((v) => (
                <button key={v} type="button" onClick={() => setStatMode(v)} style={pill(statMode === v)}>
                  {v === "perGame" ? "Per game" : "Totals"}
                </button>
              ))}
            </div>
            <div style={{ position: "relative", marginLeft: "auto" }}>
              <button
                type="button"
                onClick={() => setShowCols((s) => !s)}
                style={{ height: 34, padding: "0 14px", borderRadius: 8, border: "1px solid var(--rt-hairline)", background: "var(--rt-canvas)", color: "var(--rt-ink)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
              >
                Columns
              </button>
              {showCols && (
                <div style={{ position: "absolute", right: 0, top: 40, zIndex: 5, width: 220, padding: 10, borderRadius: 10, background: "var(--rt-canvas)", border: "1px solid var(--rt-hairline)", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 8px" }}>
                  {colDefs.map(({ key, label }) => (
                    <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                      <input type="checkbox" checked={cols[key]} onChange={(e) => setCols((c) => ({ ...c, [key]: e.target.checked }))} />
                      {label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {error && <p style={{ color: "var(--rt-down)", fontSize: 13.5, marginBottom: 16 }}>{error}</p>}
          {loadingData ? (
            <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>Loading…</p>
          ) : data && (
            <>
              <div className="lr-summary">
                <div className="stat"><span className="n">{summary.count}</span><span className="l">Assets shown</span></div>
                {summary.salaryCount > 0 && <div className="stat"><span className="n">{fmtSalary(summary.salaryTotal)}</span><span className="l">Total salary</span></div>}
                {summary.gpAvg != null && <div className="stat"><span className="n">{summary.gpAvg.toFixed(1)}</span><span className="l">Avg GP</span></div>}
                {summary.minAvg != null && <div className="stat"><span className="n">{summary.minAvg.toFixed(1)}</span><span className="l">Avg MIN</span></div>}
              </div>

              <div className="de-table-wrap" style={{ maxHeight: "calc(100vh - 420px)", minHeight: 320, overflowY: "auto" }}>
                <table className="de-table lr-table">
                  <thead>
                    <tr>
                      <th>RANK</th>
                      <th className="l">ASSET</th>
                      <th>TEAM</th>
                      {cols.fantasyTeam && <th className="l">FANTASY TEAM</th>}
                      {cols.tradeValue && <th>ASSET VALUE</th>}
                      {cols.age && <th>AGE</th>}
                      {cols.salary && <th>SALARY</th>}
                      {cols.contract && <th>CONTRACT</th>}
                      {cols.dynastyRank && <th>DYN RANK</th>}
                      {cols.salaryRank && <th>SAL RANK</th>}
                      {cols.trend && <th>TREND</th>}
                      {cols.gp && <th>GP</th>}
                      {cols.min && <th>MIN</th>}
                      {cols.usg && <th>USG</th>}
                      {cols.minus1 && <th>MINUS1</th>}
                      {cols.nineCat && <th>9CAT</th>}
                      {cols.eightCat && <th>8CAT</th>}
                      {cols.fpts && isPointsLeague && <th>FPTS</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rankedRows.map(({ asset: a, rank }) => (
                      <tr key={a.key}>
                        <td>{rank != null && rank <= 10 ? <span style={{ color: "var(--rt-primary)", fontWeight: 700 }}>{rank}</span> : rank ?? "—"}</td>
                        <td className="l">
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {a.kind === "player" && (
                              <PlayerHeadshot name={a.name} size={26} initials={a.name.split(" ").map((w) => w[0]).slice(0, 2).join("")} background="var(--rt-surface-strong)" color="var(--rt-ink)" fontSize={10} rookie={a.isRookie} />
                            )}
                            <span>
                              <span className="de-player-name">{a.name}</span>
                              {a.pos && <span style={{ color: "var(--rt-muted)", marginLeft: 6, fontSize: 11 }}>{a.pos}</span>}
                            </span>
                          </div>
                        </td>
                        <td>{a.nbaTeam ? <TeamLogo team={a.nbaTeam} size={34} /> : <span style={{ color: "var(--rt-muted)" }}>—</span>}</td>
                        {cols.fantasyTeam && <td className="l">{a.owner}</td>}
                        {cols.tradeValue && <td style={{ fontWeight: 700 }}>{rank != null ? (data.values[basis][a.key]?.value ?? 0).toFixed(1) : "—"}</td>}
                        {cols.age && <td>{a.age != null ? a.age.toFixed(1) : "—"}</td>}
                        {cols.salary && <td>{fmtSalary(a.salary)}</td>}
                        {cols.contract && <td>{a.contract ?? "—"}</td>}
                        {cols.dynastyRank && <td>{formatRank(a.dynRank)}</td>}
                        {cols.salaryRank && <td>{formatRank(a.salaryRank)}</td>}
                        {cols.trend && (
                          <td>
                            {a.trendTag ? (
                              <span style={{ color: TAG_META[a.trendTag].color, fontWeight: 700, whiteSpace: "nowrap" }}>
                                {TAG_META[a.trendTag].emoji} {TAG_META[a.trendTag].label}
                              </span>
                            ) : "—"}
                          </td>
                        )}
                        {cols.gp && <td>{a.gamesPlayed ?? "—"}</td>}
                        {cols.min && <td>{a.minutesPerGame != null ? a.minutesPerGame.toFixed(1) : "—"}</td>}
                        {cols.usg && <td>{a.usgPct != null ? `${a.usgPct.toFixed(1)}%` : "—"}</td>}
                        {cols.minus1 && <td>{a.minus1V != null ? a.minus1V.toFixed(2) : "—"}</td>}
                        {cols.nineCat && <td>{a.nineCatV != null ? a.nineCatV.toFixed(2) : "—"}</td>}
                        {cols.eightCat && <td>{a.eightCatV != null ? a.eightCatV.toFixed(2) : "—"}</td>}
                        {cols.fpts && isPointsLeague && (
                          <td>{a.fpts != null ? a.fpts.toFixed(2) : "—"}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </HubShell>
  );
}

export default function LeagueRankingsPage() {
  return (
    <Suspense fallback={null}>
      <LeagueRankingsContent />
    </Suspense>
  );
}
