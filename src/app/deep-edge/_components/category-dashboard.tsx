"use client";

import { CATEGORY_LABEL, type FheCategory } from "@/lib/fantrax/league";
import { rankTierIndex, rankTierLabel } from "@/lib/fantrax/lineup";

/** 11th/12th/13th are the well-known exception to the 1st/2nd/3rd rule. */
export function ordinal(rank: number): string {
  if (rank % 100 >= 11 && rank % 100 <= 13) return `${rank}th`;
  const suffix = rank % 10 === 1 ? "st" : rank % 10 === 2 ? "nd" : rank % 10 === 3 ? "rd" : "th";
  return `${rank}${suffix}`;
}

/** A genuine green→amber→red status scale for this dashboard's charts —
 *  deliberately NOT tier-colors.ts's tierFill(), whose 6 buckets are two
 *  green shades + two red shades with nothing in between (Good's pale green
 *  sits directly next to Average's pale red — no amber at all). That scale
 *  is left alone everywhere else it's already used (Power Rankings' tables,
 *  etc.); this one is scoped to the ring/bars/radar built for Category
 *  Edge's dashboard, where a mid-pack rank reading as amber — not a
 *  washed-out green or red — was the actual ask. Same bucket boundaries as
 *  rankTierIndex()/RANK_TIER_LABELS, so the color and the ELITE/EXCELLENT/…
 *  text next to it always agree on which tier a rank is in. */
const STATUS_COLORS = [
  "#15803d", // Elite (top 10%) — strong green
  "#22c55e", // Excellent
  "#84cc16", // Good — green sliding toward amber
  "#f59e0b", // Average — amber
  "#ea580c", // Fair — amber sliding toward red
  "#dc2626", // Poor (bottom 10%) — strong red
];
export function statusColor(rank: number, of: number): string {
  return STATUS_COLORS[rankTierIndex(rank, of)];
}

/** 1 = best (rank 1), trending to ~0 at last place — never literally 0 so a
 *  last-place ring/bar still shows a thin sliver rather than reading as
 *  empty/broken. Shared by the ring, the horizontal bars, and the radar so
 *  "how full" always means the same thing everywhere on this dashboard. */
function percentileOf(rank: number, of: number): number {
  if (of <= 0) return 0;
  return Math.max(0.03, 1 - (rank - 1) / of);
}

/**
 * Circular percentile ring — the "Nth of M" gauge Category Edge's dashboard
 * summary and its per-category rows both use, just sized differently. Color
 * comes from statusColor() (this file's own green→amber→red scale, above)
 * so a ring reads consistently with the tier pill next to it.
 */
export function PercentileRing({
  rank, of, size = 120, strokeWidth, centerLabel, subLabel, greyed,
}: {
  rank: number;
  of: number;
  size?: number;
  strokeWidth?: number;
  /** Big text in the center — defaults to the ordinal rank. */
  centerLabel?: string;
  /** Smaller text under the center label — omit for the compact per-row size.
   *  Takes a node (not just a string) so a caller can stack a second line
   *  (e.g. "OF 30" + a win%/roto-score line) inside the ring itself, rather
   *  than as a trailing element below it — keeps every dashboard card's
   *  shape the same (header + one centered visual, nothing after), so a row
   *  of cards lines up instead of the ring card alone growing an extra line. */
  subLabel?: React.ReactNode;
  /** 8-Cat lens viewing TO — same "shown but de-emphasized" treatment
   *  RosterTableRow's isEightCatDrop uses, not hidden entirely. */
  greyed?: boolean;
}) {
  const sw = strokeWidth ?? Math.max(4, Math.round(size * 0.09));
  const pct = percentileOf(rank, of);
  const r = (size - sw) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * pct;
  const color = greyed ? "var(--rt-hairline)" : statusColor(rank, of);

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--rt-surface-strong)" strokeWidth={sw} />
        <circle
          cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={`${dash} ${Math.max(0, circumference - dash)}`}
          style={{ transition: "stroke-dasharray 0.25s ease" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: Math.round(size * 0.22), fontWeight: 800, lineHeight: 1, color: greyed ? "var(--rt-muted)" : "var(--rt-ink)" }}>
          {centerLabel ?? ordinal(rank)}
        </div>
        {subLabel && (
          <div
            style={{
              fontSize: Math.max(8.5, Math.round(size * 0.075)), color: "var(--rt-muted)", marginTop: 4,
              fontFamily: "var(--rt-font-mono)", textAlign: "center", lineHeight: 1.5,
              // Hard width cap so a longer sub-label wraps INSIDE the ring's
              // own chord instead of overflowing past its stroke — the
              // circle only has ~size*0.75 of usable horizontal room at the
              // sub-label's vertical position, not the full diameter.
              maxWidth: Math.round(size * 0.72), overflowWrap: "break-word",
            }}
          >
            {subLabel}
          </div>
        )}
      </div>
    </div>
  );
}

/** The tier pill ("ELITE"/"FAIR"/…) meant to sit directly under a
 *  PercentileRing — same text/colors as the badge the category rows already
 *  used, just decoupled from the rank number now that the ring shows that. */
export function TierPill({ rank, of, greyed }: { rank: number; of: number; greyed?: boolean }) {
  if (greyed) {
    return (
      <span style={{ fontSize: 10, fontFamily: "var(--rt-font-mono)", fontWeight: 700, padding: "2px 7px", borderRadius: 100, background: "var(--rt-surface-strong)", color: "var(--rt-muted)" }}>
        N/A
      </span>
    );
  }
  return (
    <span
      style={{
        fontSize: 10, fontFamily: "var(--rt-font-mono)", fontWeight: 700, padding: "2px 7px", borderRadius: 100,
        background: `${statusColor(rank, of)}26`, color: statusColor(rank, of),
      }}
    >
      {rankTierLabel(rank, of).toUpperCase()}
    </span>
  );
}

/** One row of the horizontal "quick rank" bar list — thin track, a fill
 *  sized to the same percentile the ring uses, ordinal on the right.
 *  `rank === null` means there's genuinely nothing to rank (e.g. a real
 *  punt-TO league with no TO category at all) — renders a flat empty row
 *  rather than a fake 0%. */
export function RankBarRow({
  label, rank, of, greyed,
}: {
  label: string;
  rank: number | null;
  of: number;
  greyed?: boolean;
}) {
  const pct = rank != null ? percentileOf(rank, of) : 0;
  const color = greyed || rank == null ? "var(--rt-hairline)" : statusColor(rank, of);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
      <div style={{ width: 40, flexShrink: 0, fontSize: 11.5, fontWeight: 700, color: greyed ? "var(--rt-muted)" : "var(--rt-ink)" }}>
        {label}
      </div>
      <div style={{ flex: 1, height: 8, borderRadius: 100, background: "var(--rt-surface-strong)", overflow: "hidden" }}>
        <div style={{ width: `${pct * 100}%`, height: "100%", borderRadius: 100, background: color, transition: "width 0.25s ease" }} />
      </div>
      <div style={{ width: 42, flexShrink: 0, textAlign: "right", fontSize: 11, fontFamily: "var(--rt-font-mono)", fontWeight: 700, color: greyed || rank == null ? "var(--rt-muted)" : color }}>
        {rank != null ? ordinal(rank) : "—"}
      </div>
    </div>
  );
}

/** A titled card wrapping a stack of RankBarRows — the "2 mini charts side
 *  by side" the dashboard summary splits the 9 categories (+ MPG) across.
 *  Same [header][flex:1 vertically-centered content] shape as DashboardCard
 *  below, so all four summary cards' visuals line up in one row regardless
 *  of how much taller a ring/radar naturally is than a 5-row bar list. */
export function RankBarPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 20, borderRadius: 16, border: "1px solid var(--rt-hairline)", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 10.5, color: "var(--rt-muted)", marginBottom: 4 }}>{title}</div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>{children}</div>
    </div>
  );
}

/** The other three summary cards' shared shape (ring, radar) — a titled
 *  header pinned to the top and whatever visual a caller passes vertically
 *  centered in the remaining space, so its center lines up with
 *  RankBarPanel's row stack above regardless of the visual's own height. */
export function DashboardCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 20, borderRadius: 16, border: "1px solid var(--rt-hairline)", height: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 10.5, color: "var(--rt-muted)", alignSelf: "flex-start", marginBottom: 4 }}>{title}</div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>{children}</div>
    </div>
  );
}

export interface RadarPoint {
  category: FheCategory;
  /** 1-based finish, or null when this league doesn't score this category at
   *  all (real punt league) — plotted at a neutral floor rather than guessed. */
  rank: number | null;
  of: number;
  greyed?: boolean;
}

/**
 * Spider/radar chart — one axis per scored category (fixed FHE order, not
 * sorted best-to-worst, so the shape is stable and comparable render to
 * render), radius = percentileOf(rank, of). TO needs no special inversion
 * here: categoryEdges()/projectRotoStandings() already sign-flip TO upstream
 * (fewer turnovers = a BETTER rank), so plotting by rank alone already puts
 * "good at TO" at the outer edge like every other axis — the thing to avoid
 * is plotting raw stat magnitude instead of rank, which would put a
 * turnover-prone team's axis facing the WRONG way.
 */
export function CategoryRadarChart({ points, size = 260 }: { points: RadarPoint[]; size?: number }) {
  const n = points.length;
  if (n === 0) return null;
  const center = size / 2;
  const maxR = size / 2 - 30;
  const angleFor = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pointAt = (i: number, r: number): [number, number] => {
    const a = angleFor(i);
    return [center + r * Math.cos(a), center + r * Math.sin(a)];
  };
  const radiusFor = (p: RadarPoint) => (p.rank != null ? percentileOf(p.rank, p.of) : 0.03) * maxR;
  const dataPath = points.map((p, i) => pointAt(i, radiusFor(p)).join(",")).join(" ");
  const gridLevels = [0.25, 0.5, 0.75, 1];

  return (
    <svg width={size} height={size} role="img" aria-label="Category rank radar chart">
      {gridLevels.map((lvl) => (
        <polygon
          key={lvl}
          points={points.map((_, i) => pointAt(i, lvl * maxR).join(",")).join(" ")}
          fill="none" stroke="var(--rt-hairline)" strokeWidth={1}
        />
      ))}
      {points.map((_, i) => {
        const [x, y] = pointAt(i, maxR);
        return <line key={i} x1={center} y1={center} x2={x} y2={y} stroke="var(--rt-hairline)" strokeWidth={1} />;
      })}
      <polygon points={dataPath} fill="var(--rt-primary)" fillOpacity={0.22} stroke="var(--rt-primary)" strokeWidth={2} strokeLinejoin="round" />
      {points.map((p, i) => {
        const [x, y] = pointAt(i, radiusFor(p));
        const dotColor = p.greyed ? "var(--rt-muted)" : p.rank != null ? statusColor(p.rank, p.of) : "var(--rt-hairline)";
        return <circle key={i} cx={x} cy={y} r={4} fill={dotColor} stroke="var(--rt-canvas)" strokeWidth={1.5} />;
      })}
      {points.map((p, i) => {
        const [x, y] = pointAt(i, maxR + 16);
        return (
          <text
            key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            fontSize={11} fontWeight={700} fontFamily="var(--rt-font-mono)"
            fill={p.greyed ? "var(--rt-muted)" : "var(--rt-body)"}
          >
            {CATEGORY_LABEL[p.category]}
          </text>
        );
      })}
    </svg>
  );
}
