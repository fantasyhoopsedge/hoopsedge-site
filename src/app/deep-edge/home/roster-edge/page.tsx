"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { LeagueAnalysis, ResolvedPlayer } from "@/lib/fantrax/analyze";
import { CATEGORY_LABEL, FANTRAX_DATASETS, type FantraxDatasetKey, type FheCategory } from "@/lib/fantrax/league";
import { DEFAULT_GAMES_CAP_SETTINGS, DEFAULT_LEAGUE_TAGS, EXTRA_CATEGORIES } from "@/lib/fantrax/league-tags";
import { FormatConfirmPrompt } from "@/lib/fantrax/format-confirm";
import { buildOptimalLineup, resolveEffectiveScoring } from "@/lib/fantrax/lineup";
import { buildDepthWeightedProfiles, deriveRankingsFormat, depthWeight, simulateH2HCategoryStandings } from "@/lib/fantrax/power-rankings";
import type { ContractInfo } from "@/lib/fantrax/roster-edge";
import { normalizeTeamAbbr } from "@/lib/nba-teams";
import { TAG_META, type TrendTag } from "@/app/team-rosters/_components/trend-insight";
import { TEAM_LOGO } from "@/app/team-rosters/_components/roster-data";
import { PlayerHeadshot } from "@/app/team-rosters/_components/roster-headshot";
import { HubShell } from "../../_components/hub-shell";
import { IconChevronLeft } from "../../_components/icons";
import { DEEP_EDGE_TABLE_CSS, SortTh, useSortableTable } from "../../_components/sortable-table";
import { useActiveLeague } from "../../_lib/use-saved-leagues";

/** Depth index matching the rest of Deep Edge's depth ladder (Best N = 0,
 *  +1..+5) — "Starters + 3 reserves" is exactly depth 3. */
const POWER_RANK_DEPTH = 3;

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
type ExtraCode = "A/TO" | "FGM" | "FTM" | "FGA" | "FTA";
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

function formatSalary(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${(n / 1_000_000).toFixed(2)}M`;
}
function formatContract(info: ContractInfo | undefined): string {
  if (!info) return "—";
  return `${info.yearsRemaining}yr/$${(info.totalRemaining / 1_000_000).toFixed(1)}M`;
}
function formatStat(cat: FheCategory | ExtraCode, raw: number | null): string {
  if (raw == null || !Number.isFinite(raw)) return "—";
  if (cat === "FG" || cat === "FT") return raw.toFixed(3).replace(/^0(?=\.)/, "");
  return raw.toFixed(1);
}
function statValue(p: ResolvedPlayer, cat: FheCategory | ExtraCode): number | null {
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
 *  Minus1V excludes for him specifically (see LineupValueMode's own note:
 *  Minus1V is a per-player floor, not a league-wide punt). */
function weakestCat(p: ResolvedPlayer, scored: readonly FheCategory[]): FheCategory | null {
  let worst: FheCategory | null = null;
  let worstZ = Infinity;
  for (const cat of scored) {
    const z = p.cats[cat];
    if (z != null && z < worstZ) { worstZ = z; worst = cat; }
  }
  return worst;
}

/** Weighted per-game average across a set of players: combined season totals
 *  ÷ combined games played — same convention verified against Ash's own
 *  reference table for Power Rankings' PER GAME view (see rankings/page.tsx),
 *  applied here to whichever players are ticked rather than a team profile. */
function weightedAverage(players: ResolvedPlayer[], cat: FheCategory | ExtraCode): number | null {
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

// ── conditional formatting — byte-for-byte the /seasonal-rankings "Player
// Cat Value" table's own scheme (seasonal-rankings-table.tsx's vBg/statBg/
// valueBg/meanStd/zOf), per Ash's explicit "apply the same formatting
// exactly" (2026-08-12): a continuous green/red opacity gradient off the raw
// z-score, anchors tighter for the overall Value/Minus1V column than the
// per-category cells, text always default ink (never recolored). ──────────
function vBg(v: number | null | undefined, posAnchor: number, negAnchor: number): string {
  if (v == null || !Number.isFinite(v)) return "transparent";
  if (v >= 0) {
    const t = Math.min(v / posAnchor, 1);
    return `rgba(34, 197, 94, ${(t * 0.34).toFixed(3)})`;
  }
  const t = Math.min(-v / negAnchor, 1);
  return `rgba(239, 68, 68, ${(t * 0.34).toFixed(3)})`;
}
const statBg = (v: number | null | undefined) => vBg(v, 2.0, 2.0);
const valueBg = (v: number | null | undefined) => vBg(v, 1.0, 0.6);
function meanStd(values: number[]): { mu: number; sigma: number } {
  if (values.length === 0) return { mu: 0, sigma: 0 };
  const mu = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mu) ** 2, 0) / values.length;
  return { mu, sigma: Math.sqrt(variance) };
}
function zOf(raw: number | null | undefined, ms: { mu: number; sigma: number }): number | null {
  if (raw == null || !Number.isFinite(raw) || ms.sigma === 0) return null;
  return (raw - ms.mu) / ms.sigma;
}

/** 1-based rank of `target` within `players` by descending `value` — used
 *  only for the points-mode VALUE column, which has no precomputed FPTS
 *  rank anywhere else in the ecosystem (points-mode is a Fantrax-specific
 *  concept; nothing site-wide ranks by it). Categories-mode VALUE/MINUS1
 *  instead read the REAL precomputed catVRank fields below — the same
 *  numbers /seasonal-rankings itself shows — rather than a locally-computed
 *  approximation. */
function rankAmong(players: ResolvedPlayer[], value: (p: ResolvedPlayer) => number | null, target: number | null): number | null {
  if (target == null) return null;
  let rank = 1;
  for (const p of players) {
    const v = value(p);
    if (v != null && v > target) rank++;
  }
  return rank;
}
function formatRank(n: number | null | undefined): string {
  return n == null ? "—" : `#${n}`;
}

function TeamLogo({ team, size = 22 }: { team: string; size?: number }) {
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

type SortKey = "name" | "dynastyRank" | "salaryRank" | "gp" | "min" | "usg" | "value" | "minus1" | FheCategory | ExtraCode;
type EnrichData = { salaryRankByFheId: Record<string, number>; contractByFheId: Record<string, ContractInfo>; dynastyRankByFheId: Record<string, number> };
type OptionalCols = { salary: boolean; contract: boolean; dynastyRank: boolean; salaryRank: boolean };

function RosterEdgeContent() {
  const { saved, loading: loadingSaved } = useActiveLeague();
  const [analysis, setAnalysis] = useState<LeagueAnalysis | null>(null);
  const [enrich, setEnrich] = useState<EnrichData | null>(null);
  const [error, setError] = useState("");
  const [dataset, setDataset] = useState<FantraxDatasetKey>(FANTRAX_DATASETS[0].key);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string> | null>(null);
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
        const { salaryRankByFheId, contractByFheId, dynastyRankByFheId, ...rest } = data;
        setAnalysis(rest as LeagueAnalysis);
        setEnrich({ salaryRankByFheId, contractByFheId, dynastyRankByFheId });
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

  const lineupCadence = saved?.settings.lineupCadence ?? DEFAULT_GAMES_CAP_SETTINGS.lineupCadence;
  const capPos = saved?.settings.capPos ?? DEFAULT_GAMES_CAP_SETTINGS.capPos;
  const capMatch = saved?.settings.capMatch ?? DEFAULT_GAMES_CAP_SETTINGS.capMatch;

  // Power ranking for the selected team, "Starters + 3 reserves" depth —
  // exactTeamId keeps ONLY that team's lineup exact (branch-and-bound), every
  // other team greedy, same fix as Power Rankings' own depth toggle (see
  // power-rankings.ts's exactTeamId doc — running the exact solver 30 times
  // per team switch was the real "Page Unresponsive" freeze).
  const powerRank = useMemo(() => {
    if (!analysis || !effective || !format || format === "unconfirmed" || !teamId) return null;
    const weight = depthWeight(lineupCadence, format, capPos, capMatch);
    const profiles = buildDepthWeightedProfiles(analysis, POWER_RANK_DEPTH, weight, { ...effective, exactTeamId: teamId });
    if (format === "h2hcat") {
      const records = simulateH2HCategoryStandings(profiles, effective.scored);
      const sorted = [...records].sort((a, b) => b.winPct - a.winPct);
      const idx = sorted.findIndex((r) => r.teamId === teamId);
      const mine = sorted[idx];
      return mine ? { rank: idx + 1, of: sorted.length, winPct: mine.winPct } : null;
    }
    return null; // Roto/points power-rank display: fast-follow, not in this pass
  }, [analysis, effective, format, teamId, lineupCadence, capPos, capMatch]);

  // Default ticked set = starters + 3 reserves, matching the power-ranking
  // calc's own depth — reset whenever the selected team or dataset changes.
  const defaultTicked = useMemo(() => {
    if (!roster || !effective) return new Set<string>();
    const lineup = buildOptimalLineup(roster.players, effective.positionSlots, null);
    const ids = [...lineup.starters.map((a) => a.player.fantraxId), ...lineup.bench.slice(0, 3).map((p) => p.fantraxId)];
    return new Set(ids);
  }, [roster, effective]);
  const [resetKey, setResetKey] = useState<string | null>(null);
  if (roster && resetKey !== `${roster.teamId}:${dataset}`) {
    setResetKey(`${roster.teamId}:${dataset}`);
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
    { key: "value", dir: "desc" },
    (row, key) => {
      if (key === "name") return row.name;
      if (key === "dynastyRank") return (row.fheId ? enrich?.dynastyRankByFheId[row.fheId] : null) ?? Infinity;
      if (key === "salaryRank") return (row.fheId ? enrich?.salaryRankByFheId[row.fheId] : null) ?? Infinity;
      if (key === "gp") return row.gamesPlayed ?? -Infinity;
      if (key === "min") return row.minutesPerGame ?? -Infinity;
      if (key === "usg") return row.usgPct ?? -Infinity;
      if (key === "value") return (format === "points" ? row.pointsValue : row.leagueV) ?? -Infinity;
      if (key === "minus1") return row.catV?.perGame.minus1V ?? -Infinity;
      return statValue(row, key) ?? -Infinity;
    },
  );

  const hasLeague = Boolean(saved);
  const showSalary = cols.salary && salaryFormat !== "none";
  const showContract = cols.contract && salaryFormat !== "none";
  const isDynasty = (saved?.settings.leagueType ?? DEFAULT_LEAGUE_TAGS.leagueType) === "dynasty";
  // ✓/PLAYER/TEAM/POS/TREND/GP/MIN/USG/VALUE = 9 always-present columns,
  // plus whichever of SAL$/CONTRACT$/DYN RK/SAL RK are currently shown.
  // MINUS1 is deliberately excluded — it renders as its own <td> right after
  // this colSpan cell, not folded into it.
  const colSpanBeforeStats = 9 + (showSalary ? 1 : 0) + (showContract ? 1 : 0) + (cols.dynastyRank ? 1 : 0) + (cols.salaryRank ? 1 : 0);

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
                <span style={{ color: "var(--rt-muted)", marginLeft: 6 }}>(Starters + 3)</span>
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
            <table className="de-table">
              <thead>
                <tr>
                  <th>✓</th>
                  <th className="l">PLAYER</th>
                  <th>TEAM</th>
                  <th>POS</th>
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
                {rotoSort.sorted.map((p) => {
                  const salaryRank = cols.salaryRank && p.fheId ? enrich?.salaryRankByFheId[p.fheId] : null;
                  const dynastyRank = cols.dynastyRank && p.fheId ? enrich?.dynastyRankByFheId[p.fheId] : null;
                  const contract = p.fheId ? enrich?.contractByFheId[p.fheId] : undefined;
                  const trendTag: TrendTag | null = p.trendTags?.nineCatV ?? null;
                  const weak = format !== "points" && effective ? weakestCat(p, effective.scored) : null;
                  const value = format === "points" ? p.pointsValue : p.leagueV;
                  // Rank displayed in the cell; z-score (`value`/minus1V) still
                  // drives the background — see valueBg() calls below, untouched.
                  const valueRank = format === "points"
                    ? rankAmong(leaguePlayers, (pl) => pl.pointsValue, p.pointsValue)
                    : (p.catVRank?.perGame.nineCatV ?? null);
                  const minus1Rank = p.catVRank?.perGame.minus1V ?? null;
                  const usgZ = zOf(p.usgPct, usgStats);
                  const posDisplay = p.eligible.filter((e) => !/^(flx|flex)$/i.test(e));
                  return (
                    <tr key={p.fantraxId}>
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
                      <td className="l">
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <PlayerHeadshot name={p.name} size={26} initials={p.name.split(" ").map((w) => w[0]).slice(0, 2).join("")} background="var(--rt-surface-strong)" color="var(--rt-ink)" fontSize={10} />
                          <span style={{ fontWeight: 600 }}>{p.name}</span>
                        </div>
                      </td>
                      <td><TeamLogo team={p.nbaTeam} /></td>
                      <td>{posDisplay.join("/")}</td>
                      {showSalary && <td>{formatSalary(p.salary)}</td>}
                      {showContract && <td>{formatContract(contract)}</td>}
                      {cols.dynastyRank && <td>{dynastyRank ?? "—"}</td>}
                      {cols.salaryRank && <td>{salaryRank ?? "—"}</td>}
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
                      {[...extraCols].map((col) => (
                        <td key={col}>{formatStat(col, statValue(p, col))}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--rt-muted)" }}>
            Offensive/defensive rebound splits aren&apos;t in FHE&apos;s stat pipeline yet, so OREB/DREB aren&apos;t offered — everything else in the picker that&apos;s enabled is real data.
          </p>
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
