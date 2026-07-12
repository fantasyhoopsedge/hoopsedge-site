"use client";

import { useEffect, useState } from "react";
import { deriveFinalTake, LOOKBACK_BLOCKS, TAG_META, type TrendMetric, type TrendPlayer } from "./trend-insight";
import { caret, changeColor, noTrendMessage, recentRankOf, resolveModeStat, type ModeStatInput } from "./roster-helpers";
import type { SeasonMode } from "./roster-data";

// Recent = the trailing 8 weeks = the last 4 of the 10 charted blocks; that region
// gets shaded on the (always 20-week) chart when Recent is selected.
const RECENT_CHART_BLOCKS = 4;

export type { TrendMetric } from "./trend-insight";

/** Fetches one player's block-level value trend from /api/player-trends (built by `npm run trends:build`).
 * `skip` short-circuits entirely (used for the postseason side-fetch below when the
 * primary metric being shown is already the postseason, to avoid a circular re-fetch;
 * also used by TrendHero when a `prefetched` result is passed in, so callers sharing
 * one fetch across the trend chart and a 9-cat profile don't double-request). */
export function usePlayerTrend(playerId: string, season: number, seasonType: string, skip = false) {
  // Keyed by the request it belongs to, so data/notFound can be DERIVED against
  // the CURRENT request key below instead of stored as separate state — storing
  // them separately let a switch to a synthetic (no-fetch) player keep the
  // PREVIOUS player's payload in state forever (the effect just returned early,
  // never clearing it), so TrendHero computed a trend tag/blurb off a random
  // other player's real data for rookies with 0 games. Same class of bug would
  // also flash the previous player's chart during the loading window on an
  // ordinary switch, since `!data` was the only "still loading" signal.
  const [result, setResult] = useState<{ key: string; data: TrendPlayer | null; notFound: boolean } | null>(null);

  // Synthetic "n_..." ids (roster-live-data.ts:205) mean no real season row (rookies) — nothing to fetch.
  const isSynthetic = skip || playerId.startsWith("n_");
  const requestKey = `${playerId}:${season}:${seasonType}`;
  const fresh = !isSynthetic && result?.key === requestKey;
  const data = fresh ? result!.data : null;
  const notFound = fresh ? result!.notFound : false;
  const loading = !isSynthetic && !fresh;

  useEffect(() => {
    if (isSynthetic) return;
    let cancelled = false;
    fetch(`/api/player-trends?player_id=${encodeURIComponent(playerId)}&season=${season}&type=${seasonType}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        setResult({ key: requestKey, data: json, notFound: !json });
      })
      .catch(() => {
        if (cancelled) return;
        setResult({ key: requestKey, data: null, notFound: true });
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
  cur,
  prior,
  priorPrior,
  consensusRank,
  consensusDir,
  age,
  isRookie = false,
  compact = false,
  mode = "cur",
  prefetched,
}: {
  playerId: string;
  season: number;
  seasonType: string;
  metric: TrendMetric;
  metricLabel: string;
  /** Full-season (2025-26) anchor for the selected metric: rank + GP + MPG. */
  cur: ModeStatInput;
  /** Prior-season (2024-25) anchor. */
  prior: ModeStatInput;
  /** Season-before-prior (2023-24) anchor — the arrow reference for Prior mode. */
  priorPrior: ModeStatInput;
  consensusRank: number | null;
  /** Dynasty consensus movement (currently near-always "flat" until consensus
   * rank v1.1 is published with real period-over-period deltas — see
   * dynasty-rankings.json's `trend` field, the same source roster-app.tsx's
   * list/grid views already use for this). */
  consensusDir: "up" | "down" | "flat";
  age: number | null;
  /** First-year player in the charted season (Player.tag === "soph" for the
   * completed 2025-26 season) — drives the rookie-aware DEVELOPING read (R15). */
  isRookie?: boolean;
  /** Shrinks the stat-row fonts/gaps and the insight callout for narrow
   * contexts (the compare modal's ~220px-wide cards) — the sparkline itself
   * is already responsive and needs no changes. */
  compact?: boolean;
  /** Which season lens the header (GP / ValueRank / arrow) reads: "recent" =
   * the 8-week block from data.recent (arrow vs full season); "cur" = full
   * 2025-26 season (arrow vs prior); "prior" = 2024-25 (arrow vs 2023-24);
   * "proj" = hidden ("coming soon"). The trend chart is always the 20-week
   * current-season line, shaded/overlaid per mode. */
  mode?: SeasonMode;
  /** Pre-fetched trend data (from a `usePlayerTrend` call the caller already
   * made, e.g. to also build a Recent-mode 9-cat profile) — skips this
   * component's own fetch so the two consumers share one request. */
  prefetched?: ReturnType<typeof usePlayerTrend>;
}) {
  const ownFetch = usePlayerTrend(playerId, season, seasonType, !!prefetched);
  const { data, notFound, loading, isSynthetic } = prefetched ?? ownFetch;
  // Same season's playoff form, when the player's team made it — feeds
  // deriveFinalTake()'s postseason-review step below. Skipped entirely (no
  // fetch) when this card is already showing the postseason itself.
  const postseason = usePlayerTrend(playerId, season, "postseason", seasonType !== "regular");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const numSize = compact ? 15 : 20;
  const labelSize = compact ? 9 : 10;
  const isProj = mode === "proj";
  const isPrior = mode === "prior";

  // ── Header (GP / ValueRank / arrow) — always resolved via the shared helper, so
  // Current/Prior print off the Player's season ranks even when there's no trend
  // payload. Recent's anchor is the trends-payload 8-week window. ──
  const recentInput: ModeStatInput | null = data?.recent
    ? { rank: recentRankOf(data.recent, metric), gp: data.recent.gamesPlayed, mpg: data.recent.mpg }
    : null;
  const modeStat = resolveModeStat(mode, cur, prior, priorPrior, recentInput);
  const arrow = modeStat.arrowDelta;
  const showArrow = arrow != null && arrow !== 0;

  // ── Chart (always the 20-week current-season cumRank line for `metric`) ──
  const chartBlocks = data ? data.blocks.slice(-LOOKBACK_BLOCKS) : [];
  const ranks = chartBlocks.map((b) => b[metric].cumRank);
  const pts = buildRankLine(ranks);
  const windowGp = chartBlocks.reduce((a, b) => a + b.gamesInBlock, 0);
  const blockX = (i: number) => PAD_X + (chartBlocks.length <= 1 ? 0 : (i / (chartBlocks.length - 1)) * (W - 2 * PAD_X));

  const postseasonArg = data && postseason.data ? { blocks: postseason.data.blocks, gamesPlayed: postseason.data.gamesPlayed } : null;
  const insight = data ? deriveFinalTake(data.blocks, data.seasonHistory, age, metric, consensusRank, postseasonArg, isRookie) : null;
  const color = insight ? TAG_META[insight.tag].color : "var(--rt-hero-ink-soft)";
  const line = pts
    ?.filter((p): p is { x: number; y: number } => p != null)
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const hoverPt = hoverIdx != null ? (pts?.[hoverIdx] ?? null) : null;
  const hoverRank = hoverIdx != null ? ranks[hoverIdx] : null;

  // The shaded region of analysis: Recent → trailing 4 blocks; Current → full width.
  const shade =
    mode === "recent"
      ? { x: blockX(Math.max(0, chartBlocks.length - RECENT_CHART_BLOCKS)), w: W - blockX(Math.max(0, chartBlocks.length - RECENT_CHART_BLOCKS)) }
      : mode === "cur"
        ? { x: 0, w: W }
        : null;

  // Golden rule: if a real trend tag exists, it ALWAYS prints — Current/Recent/
  // Prior alike — because it describes the player's real current-season 20-week
  // chart, independent of whichever mode's own GP happens to be zero (Prior, for
  // a player who wasn't in the league yet, still has a real Current trend to
  // show). "No trend history yet" is reserved for when insight itself is null,
  // i.e. there's genuinely no real data anywhere (chartUnavailable below). Only
  // Projection hides it (that mode replaces the header/stats entirely).
  const showInsight = insight != null && mode !== "proj";
  const chartUnavailable = isSynthetic || notFound || (!loading && !data);

  return (
    <div style={{ marginTop: compact ? 10 : 16, paddingTop: compact ? 10 : 16, borderTop: "1px solid var(--rt-hero-hairline)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: compact ? 14 : 26 }}>
          {isProj ? (
            <div>
              <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: numSize, fontWeight: 700, color: "var(--rt-hero-ink-soft)" }}>—</div>
              <div style={{ fontSize: labelSize, color: "var(--rt-hero-ink-soft)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>
                GP &amp; rank · projection coming soon
              </div>
            </div>
          ) : (
            <>
              <div>
                <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: numSize, fontWeight: 700, color: "var(--rt-hero-ink)" }}>{modeStat.gp ?? "—"}</div>
                <div style={{ fontSize: labelSize, color: "var(--rt-hero-ink-soft)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>Games played</div>
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                  <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: numSize, fontWeight: 700, color: "var(--rt-hero-ink)" }}>
                    {modeStat.rank != null ? "#" + modeStat.rank : "—"}
                  </span>
                  {showArrow && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 700, color: arrow >= 0 ? "var(--rt-up)" : "var(--rt-down)" }}>
                      <span style={{ fontSize: 9 }}>{arrow >= 0 ? "▲" : "▼"}</span>
                      {Math.abs(arrow)}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: labelSize, color: "var(--rt-hero-ink-soft)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>{metricLabel} rank</div>
              </div>
            </>
          )}
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

      {/* Caption: the trend tag always wins when it exists — golden rule, see
          showInsight above. When it doesn't (no real data anywhere), the chart
          region below already prints "No trend history yet"/noTrendMessage, so
          this slot stays empty rather than duplicating that message. The gate
          message only fills this slot for Prior/Current when insight itself is
          null (e.g. no consensus rank) but the player still has some games;
          Recent's own "< 10 GP" note lives at the bottom, in place of the stat
          profile, not here (see player-compare-card.tsx / roster-app.tsx). Fixed
          min-height in compact mode so every card's chart starts at the same
          offset regardless of whether this slot is empty, one line, or wraps. */}
      <div style={{ marginTop: compact ? 8 : 12, minHeight: compact ? 20 : undefined }}>
        {!isProj && !insight && mode !== "recent" && !modeStat.gateOk && modeStat.gateMessage && (
          <div style={{ fontSize: compact ? 11 : 12, color: "var(--rt-hero-ink-soft)" }}>{modeStat.gateMessage}</div>
        )}
        {showInsight && insight && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 7, height: 7, flex: "0 0 7px", borderRadius: 999, background: color }} />
              <span style={{ fontSize: compact ? 12 : 13, fontWeight: 700, color }}>{TAG_META[insight.tag].emoji} {insight.title}</span>
            </div>
            {!compact && <div style={{ fontSize: 11, color: "var(--rt-hero-ink-soft)", marginTop: 3, lineHeight: 1.4 }}>{insight.detail}</div>}
          </div>
        )}
      </div>

      {/* Embedded games-over-the-20-week-window count — still the current season's
          chart underneath Prior's "not available" overlay, so keep printing it
          there too; hiding it made Prior's card a line shorter than Current/
          Recent's, which broke the height match across mode switches. */}
      {data && !chartUnavailable && (
        <div style={{ fontSize: 9, color: "var(--rt-hero-ink-soft)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: compact ? 8 : 12 }}>
          {windowGp} games · 20wk
        </div>
      )}

      <div style={{ position: "relative", marginTop: data && !chartUnavailable ? 2 : 12 }}>
        {chartUnavailable ? (
          <div style={{ fontSize: compact ? 11 : 12, color: "var(--rt-hero-ink-soft)", padding: "18px 0", textAlign: "center" }}>
            {isSynthetic ? "No trend history yet" : notFound ? noTrendMessage(cur.gp, cur.mpg) : "—"}
          </div>
        ) : loading && !data ? (
          <div style={{ fontSize: compact ? 11 : 12, color: "var(--rt-hero-ink-soft)", padding: "18px 0", textAlign: "center" }}>Loading trend…</div>
        ) : (
          <>
            {hoverPt && hoverRank != null && !isPrior && (
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
            {isPrior && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 1,
                  pointerEvents: "none",
                  fontSize: compact ? 11 : 12,
                  fontWeight: 700,
                  color: "var(--rt-hero-ink)",
                  background: "color-mix(in srgb, var(--rt-hero-bg) 55%, transparent)",
                  borderRadius: 8,
                }}
              >
                Prior season chart not available
              </div>
            )}
            {/* No preserveAspectRatio="none" — the box keeps the viewBox's own
                aspect ratio via CSS instead of stretching to a fixed 84px height,
                which visibly squashed the line on narrow (mobile) containers. */}
            <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible", aspectRatio: `${W} / ${H}` }}>
              {shade && <rect x={shade.x} y={0} width={shade.w} height={H} fill={color} opacity={0.13} rx={4} />}
              {line && <polyline points={line} fill="none" stroke={color} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />}
              {!isPrior &&
                pts?.map(
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
          </>
        )}
      </div>
      {data && !chartUnavailable && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          {chartBlocks.map((b, i) => {
            // Every other label, anchored to the most recent point so "now" is always shown.
            const show = (chartBlocks.length - 1 - i) % 2 === 0;
            return (
              <span key={b.block} style={{ fontSize: 9, color: "var(--rt-hero-ink-soft)" }}>
                {show ? fmtDate(b.dateRange[0]) : ""}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
