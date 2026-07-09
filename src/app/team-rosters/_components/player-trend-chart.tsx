"use client";

import { useEffect, useState } from "react";
import { deriveFinalTake, LOOKBACK_BLOCKS, TONE_COLOR, type TrendMetric, type TrendPlayer } from "./trend-insight";

export type { TrendMetric } from "./trend-insight";

/** Fetches one player's block-level value trend from /api/player-trends (built by `npm run trends:build`). */
function usePlayerTrend(playerId: string, season: number, seasonType: string) {
  const [data, setData] = useState<TrendPlayer | null>(null);
  const [notFound, setNotFound] = useState(false);
  // Key of the request the current data/notFound state reflects, so `loading`
  // can be DERIVED (not set synchronously in the effect body below).
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // Synthetic "n_..." ids (roster-live-data.ts:205) mean no real season row (rookies) — nothing to fetch.
  const isSynthetic = playerId.startsWith("n_");
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

const mutedRow = (label: string) => (
  <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--rt-hero-hairline)" }}>
    <div style={{ fontSize: 12, color: "var(--rt-hero-ink-soft)" }}>{label}</div>
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
  age,
  gamesPlayed,
  mpg,
}: {
  playerId: string;
  season: number;
  seasonType: string;
  metric: TrendMetric;
  metricLabel: string;
  rank: number | null;
  consensusRank: number | null;
  age: number | null;
  gamesPlayed: number;
  mpg: number;
}) {
  const { data, notFound, loading, isSynthetic } = usePlayerTrend(playerId, season, seasonType);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (isSynthetic) return mutedRow("No trend history yet");
  if (loading) return mutedRow("Loading trend…");
  if (notFound || !data) return mutedRow(noTrendMessage(gamesPlayed, mpg));

  const recent = data.blocks.slice(-LOOKBACK_BLOCKS);
  const ranks = recent.map((b) => b[metric].cumRank);
  const pts = buildRankLine(ranks);
  const rankedIdx = ranks.map((r, i) => (r != null ? i : -1)).filter((i) => i >= 0);
  const firstIdx = rankedIdx[0];
  const lastIdx = rankedIdx[rankedIdx.length - 1];
  const rankDelta = firstIdx != null && lastIdx != null ? ranks[firstIdx]! - ranks[lastIdx]! : null; // positive = improved

  const insight = deriveFinalTake(data.blocks, data.seasonHistory, age, metric, consensusRank);
  const color = insight ? TONE_COLOR[insight.tone] : "var(--rt-hero-ink-soft)";
  const line = pts
    ?.filter((p): p is { x: number; y: number } => p != null)
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const hoverPt = hoverIdx != null ? (pts?.[hoverIdx] ?? null) : null;
  const hoverRank = hoverIdx != null ? ranks[hoverIdx] : null;

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--rt-hero-hairline)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", gap: 26 }}>
          <div>
            <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 20, fontWeight: 700, color: "var(--rt-hero-ink)" }}>{data.gamesPlayed}</div>
            <div style={{ fontSize: 10, color: "var(--rt-hero-ink-soft)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>Games played</div>
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
              <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 26, fontWeight: 700, color: "var(--rt-hero-ink)" }}>
                {rank != null ? "#" + rank : "—"}
              </span>
              {rankDelta != null && rankDelta !== 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 700, color: rankDelta >= 0 ? "var(--rt-up)" : "var(--rt-down)" }}>
                  <span style={{ fontSize: 9 }}>{rankDelta >= 0 ? "▲" : "▼"}</span>
                  {Math.abs(rankDelta)}
                </span>
              )}
            </div>
            <div style={{ fontSize: 10, color: "var(--rt-hero-ink-soft)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>{metricLabel} rank · 20wk</div>
          </div>
        </div>
      </div>

      {insight && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, flex: "0 0 7px", borderRadius: 999, background: color }} />
            <span style={{ fontSize: 13, fontWeight: 700, color }}>{insight.title}</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--rt-hero-ink-soft)", marginTop: 3, lineHeight: 1.4 }}>{insight.detail}</div>
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
