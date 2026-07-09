"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { nbaHeadshotUrl, prospectHeadshotUrl } from "@/lib/dynasty-rankings";

type IconTone = "neutral" | "brand" | "amber";

function tierTone(tier: number): IconTone {
  if (tier === 1) return "brand";
  if (tier === 2) return "amber";
  return "neutral";
}

const ICON_TONES: Record<IconTone, CSSProperties> = {
  neutral: { background: "var(--rt-surface-strong)", color: "var(--rt-ink)" },
  brand: { background: "var(--rt-primary)", color: "var(--rt-on-primary)" },
  amber: { background: "#f0a500", color: "#0c0d0e" },
};

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/**
 * Headshot with a fallback chain: rookies try local prospect art first (they
 * rarely have an nba.com id yet), everyone else tries the cdn.nba.com
 * headshot first — either way, a failed image falls through to the other
 * source, then finally to an initials plate. Mirrors
 * team-rosters/_components/roster-headshot.tsx.
 */
function Headshot({ name, isRookie, tier }: { name: string; isRookie: boolean; tier: number }) {
  const [stage, setStage] = useState(0);
  const nbaUrl = nbaHeadshotUrl(name);
  const sources = (isRookie ? [prospectHeadshotUrl(name), nbaUrl] : [nbaUrl, prospectHeadshotUrl(name)]).filter(
    (u): u is string => !!u,
  );
  const url = sources[stage] ?? null;

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- headshots come from an external CDN / local prospect art keyed by player name, not a static local asset
      <img
        src={url}
        alt=""
        width={32}
        height={32}
        onError={() => setStage((s) => s + 1)}
        style={{ width: 32, height: 32, flex: "0 0 32px", borderRadius: 9999, objectFit: "cover", display: "block" }}
      />
    );
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        flex: "0 0 32px",
        borderRadius: 9999,
        fontFamily: "var(--rt-font-sans)",
        fontSize: 12,
        fontWeight: 600,
        ...ICON_TONES[tierTone(tier)],
      }}
    >
      {initialsFor(name)}
    </span>
  );
}

/**
 * The brand's signature data row — rank, headshot, name/team, and the
 * average expert rank with a caret showing how the consensus tie-break moved
 * a player relative to that raw average (real derived numbers, not a
 * fabricated week-over-week trend, which this dataset doesn't track).
 */
export function PlayerRow({
  rank,
  name,
  team,
  position,
  tier,
  avgRank,
  isRookie = false,
  dark = false,
}: {
  rank: number;
  name: string;
  team: string;
  position: string;
  tier: number;
  avgRank: number;
  isRookie?: boolean;
  dark?: boolean;
}) {
  const delta = Math.round(avgRank - rank);
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const changeColor =
    direction === "up" ? "var(--rt-up)" : direction === "down" ? "var(--rt-down)" : dark ? "var(--rt-on-dark-soft)" : "var(--rt-muted)";
  const caret = direction === "up" ? "▲" : direction === "down" ? "▼" : "–";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "28px 32px 1fr auto auto",
        alignItems: "center",
        gap: 16,
        padding: "12px 0",
        borderBottom: dark ? "1px solid rgba(255,255,255,0.1)" : "1px solid var(--rt-hairline)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--rt-font-mono)",
          fontSize: 14,
          fontWeight: 500,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          color: dark ? "var(--rt-on-dark-soft)" : "var(--rt-muted)",
        }}
      >
        {rank}
      </span>
      <Headshot name={name} isRookie={isRookie} tier={tier} />
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontFamily: "var(--rt-font-sans)",
            fontSize: 15,
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: dark ? "var(--rt-on-dark)" : "var(--rt-ink)",
          }}
        >
          {name}
        </span>
        <span
          style={{
            fontFamily: "var(--rt-font-sans)",
            fontSize: 12,
            color: dark ? "var(--rt-on-dark-soft)" : "var(--rt-muted)",
          }}
        >
          {team} · {position}
        </span>
      </span>
      <span
        style={{
          fontFamily: "var(--rt-font-mono)",
          fontSize: 16,
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
          minWidth: 40,
          color: dark ? "var(--rt-on-dark)" : "var(--rt-ink)",
        }}
      >
        {avgRank.toFixed(1)}
      </span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          justifyContent: "flex-end",
          minWidth: 32,
          fontFamily: "var(--rt-font-mono)",
          fontSize: 14,
          color: changeColor,
        }}
      >
        <span style={{ fontSize: "0.75em" }}>{caret}</span>
        {delta !== 0 ? Math.abs(delta) : null}
      </span>
    </div>
  );
}
