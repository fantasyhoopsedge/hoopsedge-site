"use client";

import { useState } from "react";
import { nbaHeadshotUrl, prospectHeadshotUrl } from "@/lib/dynasty-rankings";

/**
 * Headshot for a roster player, falling back to the same initials-in-plate
 * circle used elsewhere on this page when no image is available.
 * Incoming rookies try the local /images/prospects/ art first (seeded from
 * the rookie board) since they rarely have an nba.com id yet; everyone else
 * tries the cdn.nba.com headshot first. Either way, a failed image falls
 * through to the other source before giving up on initials.
 */
export function PlayerHeadshot({
  name,
  size,
  width,
  height,
  radius,
  fadeEdge,
  initials,
  background,
  color,
  fontSize,
  rookie,
}: {
  name: string;
  size: number;
  /** Overrides `size` for a non-square render (Trade Edge's asset-card photo
   *  bleed) — width/height default to `size` when omitted, so every existing
   *  circular caller is unaffected. A string (e.g. "100%") lets a caller
   *  size the image to fill a percentage-sized container — Trade Edge's
   *  quadrant-filling headshot (Ash, 2026-08-23) — rather than a fixed px
   *  guess that drifts as the card's own grid column stretches. */
  width?: number | string;
  height?: number | string;
  /** Corner radius; defaults to 999 (a full circle, every pre-existing
   *  caller's look). Trade Edge's asset cards pass a smaller radius so the
   *  image reads as a photo bleeding off the card, not a stamped-on avatar. */
  radius?: number;
  /** When true, masks the image's left edge to transparent so it blends into
   *  whatever sits behind it — the asset-card "photo bleed" effect. Only
   *  meaningful with a real image (falls back to the initials plate as
   *  normal when no photo resolves). */
  fadeEdge?: boolean;
  initials: string;
  background: string;
  color: string;
  fontSize: number;
  rookie?: boolean;
}) {
  const [stage, setStage] = useState(0);
  const w = width ?? size;
  const h = height ?? size;
  const r = radius ?? 999;
  // flex-basis needs a real CSS length — a bare number means px, a string
  // (e.g. "100%") is already a valid CSS value on its own.
  const flexBasis = typeof w === "number" ? `${w}px` : w;

  const nbaUrl = nbaHeadshotUrl(name);
  const sources = rookie ? [prospectHeadshotUrl(name), nbaUrl] : [nbaUrl, prospectHeadshotUrl(name)];
  const url = sources.filter((u): u is string => !!u)[stage] ?? null;

  if (url) {
    const maskCss = fadeEdge ? "linear-gradient(to right, transparent, black 38%)" : undefined;
    return (
      // eslint-disable-next-line @next/next/no-img-element -- headshots come from an external CDN / local prospect art keyed by player name, not a static local asset
      <img
        src={url}
        alt=""
        onError={() => setStage((s) => s + 1)}
        style={{
          width: w,
          height: h,
          flex: `0 0 ${flexBasis}`,
          borderRadius: r,
          objectFit: "cover",
          background,
          display: "block",
          maskImage: maskCss,
          WebkitMaskImage: maskCss,
        }}
      />
    );
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: w,
        height: h,
        flex: `0 0 ${flexBasis}`,
        borderRadius: r,
        background,
        color,
        fontFamily: "var(--rt-font-sans)",
        fontSize,
        fontWeight: 600,
      }}
    >
      {initials}
    </span>
  );
}
