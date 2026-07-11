"use client";

import { useEffect, useState } from "react";
import { deriveFinalTake, LOOKBACK_BLOCKS, TAG_META, type TrendMetric, type TrendPlayer } from "./trend-insight";
import { caret, changeColor } from "./roster-helpers";

export type { TrendMetric } from "./trend-insight";

/** Fetches one player's block-level value trend from /api/player-trends (built by `npm run trends:build`).
 * `skip` short-circuits entirely (used for the postseason side-fetch below when the
 * primary metric being shown is already the postseason, to avoid a circular re-fetch). */
function usePlayerTrend(playerId: string, season: number, seasonType: string, skip = false) {
  const [data, setData] = useState<TrendPlayer | null>(null);
  const [notFound, setNotFound] = useState(false);
  // Key of the request the current data/notFound state reflects, so `loading`
  // can be DERIVED (not set synchronously in the effect body below).
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // Synthetic "n_..." ids (roster-live-data.ts:205) mean no real season row (rookies) — nothing to fetch.
  const isSynthetic = skip || playerId.startsWith("n_");
  const requestKey = `${playerId}:${season}:${seasonType}`;
  const loading = !isSynthetic && loadedKey !== requestKey;

  useEffect(() => {
    if (isSynthetic) return;
    let cancelled = false;
    fetch(`/api/player-trends?player_id=${encodeURIComponent(playerId)}&season=${season}&type=${seasonType}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        setData(json);
        setNotFound(!json);
        setLoadedKey(requestKey);
      })
      .catch(() => {
        if (cancelled) return;
        setNotFound(true);
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [playerId, season, seasonType, isSynthetic, requestKey]);

  return { data, notFound, loading, isSynthetic };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}-${MONTHS[m - 1]}`;
}

const W = 400;
const H = 84;
const PAD_X = 4;
const PAD_TOP = 8;
const PAD_BOTTOM = 6;

/**
 * Plots rank as -rank so a BETTER (lower-number) rank sits higher on the chart.
 * Returns one entry PER INPUT INDEX (null where the rank itself is null) so a
 * point's index always lines up with the same index into `ranks`/`recent` —
 * needed for hover to show the right date/rank pair.
 */
function buildRankLine(ranks: (number | null)[]): ({ x: number; y: number } | null)[] | null {
  const nums = ranks.filter((v): v is number => v != null).map((r) => -r);
  if (!nums.length) return null;
  const domainMin = Math.min(...nums) - 2;
  const domainMax = Math.max(...nums) + 2;
  const span = domainMax - domainMin || 1;
  const n = ranks.length;
  return ranks.map((r, i) => {
    if (r == null) return null;
    const x = PAD_X + (n <= 1 ? 0 : (i / (n - 1)) * (W - 2 * PAD_X));
    const y = PAD_TOP + (1 - (-r - domainMin) / span) * (H - PAD_TOP - PAD_BOTTOM);
    return { x, y };
  });
}

// Dynasty rank shows here too (not just the main trend-hero layout below) so
// it's visible for every player, including ones with no trend history yet
// (brand-new rookies, 0 games played).
const mutedRow = (label: string, consensusRank: number | null, consensusDir: "up" | "down" | "flat", compact: boolean) => (
  <div style={{ marginTop: compact ? 10 : 16, paddingTop: compact ? 10 : 16, borderTop: "1px solid var(--rt-hero-hairline)" }}>
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: compact ? 15 : 20, fontWeight: 700, color: "var(--rt-hero-ink)" }}>
          {consensusRank == null || consensusRank >= 999 ? "U/R" : "#" + consensusRank}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: changeColor(consensusDir) }}>{caret(consensusDir)}</span>
      </div>
      <div style={{ fontSize: compact ? 9 : 10, color: "var(--rt-hero-ink-soft)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>Dynasty rank</div>
    </div>
    <div style={{ fontSize: compact ? 11 : 12, color: "var(--rt-hero-ink-soft)", marginTop: compact ? 8 : 12 }}>{label}</div>
  </div>
);

// Must match MIN_GAMES_DISPLAY / MIN_MPG_DISPLAY in scripts/build-player-trends.ts —
// players under this bar are excluded from the trend dataset entirely (too few
// games or too few minutes/game to score a stable per-block value against).
const TREND_MIN_GAMES = 10;
const TREND_MIN_MPG = 10;

/** Distinguishes "hasn't played" from "played, but too little volume yet to trend" — same fallback UI otherwise looked like a data gap. */
function noTrendMessage(gamesPlayed: number, mpg: number): string {
  if (gamesPlayed <= 0) return "No trend history yet";
  const shortGames = gamesPlayed <= TREND_MIN_GAMES;
  const shortMinutes = mpg <= TREND_MIN_MPG;
  if (shortGames && shortMinutes) return `Limited sample — ${gamesPlayed} GP at ${mpg.toFixed(1)} MPG (trend needs 10+ games at 10+ minutes)`;
  if (shortGames) return `Limited sample — ${gamesPlayed} GP so far (trend needs 10+ games)`;
  if (shortMinutes) return `Limited sample — ${mpg.toFixed(1)} MPG so far (trend needs 10+ minutes/game)`;
  return "No trend history yet";
}

/**
 * Hero trend widget for the roster detail panel — sits directly under the
 * player name/tier tag on the dark hero background. Shows the real cumulative
 * rank trend (from /api/player-trends) for whichever fantasy metric is active,
 * as a ~20-week sparkline, plus a plain-language callout blending it with the
 * dynasty consensus rank.
 */
export function TrendHero({
  playerId,
  season,
  seasonType,
  metric,
  metricLabel,
  rank,
  consensusRank,
  consensusDir,
  age,
  gamesPlayed,
  mpg,
  isRookie = false,
  compact = false,
}: {
  playerId: string;
  season: number;
  seasonType: string;
  metric: TrendMetric;
  metricLabel: string;
  rank: number | null;
  consensusRank: number | null;
  /** Dynasty consensus movement (currently near-always "flat" until consensus
   * rank v1.1 is published with real period-over-period deltas — see
   * dynasty-rankings.json's `trend` field, the same source roster-app.tsx's
   * list/grid views already use for this). */
  consensusDir: "up" | "down" | "flat";
  age: number | null;
  gamesPlayed: number;
  mpg: number;
  /** First-year player in the charted season (Player.tag === "soph" for the
   * completed 2025-26 season) — drives the rookie-aware DEVELOPING read (R15). */
  isRookie?: boolean;
  /** Shrinks the stat-row fonts/gaps and the insight callout for narrow
   * contexts (the compare modal's ~220px-wide cards) — the sparkline itself
   * is already responsive and needs no changes. */
  compact?: boolean;
}) {
  const { data, notFound, loading, isSynthetic } = usePlayerTrend(playerId, season, seasonType);
  // Same season's playoff form, when the player's team made it — feeds
  // deriveFinalTake()'s postseason-review step below. Skipped entirely (no
  // fetch) when this card is already showing the postseason itself.
  const postseason = usePlayerTrend(playerId, season, "postseason", seasonType !== "regular");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (isSynthetic) return mutedRow("No trend history yet", consensusRank, consensusDir, compact);
  if (loading) return mutedRow("Loading trend…", consensusRank, consensusDir, compact);
  if (notFound || !data) return mutedRow(noTrendMessage(gamesPlayed, mpg), consensusRank, consensusDir, compact);

  const recent = data.blocks.slice(-LOOKBACK_BLOCKS);
  const ranks = recent.map((b) => b[metric].cumRank);
  const pts = buildRankLine(ranks);
  // The header shows the CUMULATIVE rank over the charted window (the chart's last
  // point), NOT the season-ending rank prop — they differ (e.g. Josh Hart 104 vs
  // 108) because the season rank is a full-season pool rank while this is the
  // trend-window cumulative rank the chart, arrow, and callout are all built on.
  const nowCumRank = [...ranks].reverse().find((r): r is number => r != null) ?? null;

  const postseasonArg = postseason.data ? { blocks: postseason.data.blocks, gamesPlayed: postseason.data.gamesPlayed } : null;
  const insight = deriveFinalTake(data.blocks, data.seasonHistory, age, metric, consensusRank, postseasonArg, isRookie);
  const color = insight ? TAG_META[insight.tag].color : "var(--rt-hero-ink-soft)";
  // Header arrow is driven by the insight's own headline move (the exact first-to-last
  // number the callout cites — start cumRank → now cumRank), NOT an independent delta —
  // so a green ▲ can never sit next to "Regressing", nor a red ▼ next to "Climbing".
  // Override tags (injury/aging) and sub-floor noise carry headlineMove 0 → no arrow.
  const headlineMove = insight ? Math.round(insight.headlineMove) : 0;
  const rankDelta = Math.abs(headlineMove) >= 5 ? headlineMove : null; // positive = improved
  const line = pts
    ?.filter((p): p is { x: number; y: number } => p != null)
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const hoverPt = hoverIdx != null ? (pts?.[hoverIdx] ?? null) : null;
  const hoverRank = hoverIdx != null ? ranks[hoverIdx] : null;

  const numSize = compact ? 15 : 20;
  const labelSize = compact ? 9 : 10;

  return (
    <div style={{ marginTop: compact ? 10 : 16, paddingTop: compact ? 10 : 16, borderTop: "1px solid var(--rt-hero-hairline)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: compact ? 14 : 26 }}>
          <div>
            <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: numSize, fontWeight: 700, color: "var(--rt-hero-ink)" }}>{data.gamesPlayed}</div>
            <div style={{ fontSize: labelSize, color: "var(--rt-hero-ink-soft)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>Games played</div>
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
              <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: numSize, fontWeight: 700, color: "var(--rt-hero-ink)" }}>
                {nowCumRank != null ? "#" + nowCumRank : rank != null ? "#" + rank : "—"}
              </span>
              {rankDelta != null && rankDelta !== 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 700, color: rankDelta >= 0 ? "var(--rt-up)" : "var(--rt-down)" }}>
                  <span style={{ fontSize: 9 }}>{rankDelta >= 0 ? "▲" : "▼"}</span>
                  {Math.abs(rankDelta)}
                </span>
              )}
            </div>
            <div style={{ fontSize: labelSize, color: "var(--rt-hero-ink-soft)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>{metricLabel} rank · 20wk</div>
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: numSize, fontWeight: 700, color: "var(--rt-hero-ink)" }}>
                {consensusRank == null || consensusRank >= 999 ? "U/R" : "#" + consensusRank}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: changeColor(consensusDir) }}>{caret(consensusDir)}</span>
            </div>
            <div style={{ fontSize: labelSize, color: "var(--rt-hero-ink-soft)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>Dynasty rank</div>
          </div>
        </div>
      </div>

      {insight && (
        <div style={{ marginTop: compact ? 8 : 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, flex: "0 0 7px", borderRadius: 999, background: color }} />
            <span style={{ fontSize: compact ? 12 : 13, fontWeight: 700, color }}>{TAG_META[insight.tag].emoji} {insight.title}</span>
          </div>
          {!compact && <div style={{ fontSize: 11, color: "var(--rt-hero-ink-soft)", marginTop: 3, lineHeight: 1.4 }}>{insight.detail}</div>}
        </div>
      )}

      <div style={{ position: "relative", marginTop: 12 }}>
        {hoverPt && hoverRank != null && (
          <div
            style={{
              position: "absolute",
              left: `${(hoverPt.x / W) * 100}%`,
              top: `${(hoverPt.y / H) * 100}%`,
              transform: "translate(-50%, -130%)",
              background: "var(--rt-hero-elevated)",
              border: "1px solid var(--rt-hero-elevated-border)",
              borderRadius: 6,
              padding: "3px 8px",
              fontSize: 11,
              fontWeight: 700,
              color: "var(--rt-hero-ink)",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              zIndex: 1,
            }}
          >
            #{hoverRank}
          </div>
        )}
        {/* No preserveAspectRatio="none" — the box keeps the viewBox's own
            aspect ratio via CSS instead of stretching to a fixed 84px height,
            which visibly squashed the line on narrow (mobile) containers. */}
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible", aspectRatio: `${W} / ${H}` }}>
          {line && <polyline points={line} fill="none" stroke={color} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />}
          {pts?.map(
            (p, i) =>
              p && (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r={i === hoverIdx ? 4.5 : i === pts.length - 1 ? 3.25 : 2.25} fill={color} stroke={i === hoverIdx ? "var(--rt-hero-ink)" : "none"} strokeWidth="1.5" />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={9}
                    fill="transparent"
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() => setHoverIdx(i)}
                    onMouseLeave={() => setHoverIdx(null)}
                  />
                </g>
              ),
          )}
        </svg>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {recent.map((b, i) => {
          // Every other label, anchored to the most recent point so "now" is always shown.
          const show = (recent.length - 1 - i) % 2 === 0;
          return (
            <span key={b.block} style={{ fontSize: 9, color: "var(--rt-hero-ink-soft)" }}>
              {show ? fmtDate(b.dateRange[0]) : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}
