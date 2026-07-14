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
  initials,
  background,
  color,
  fontSize,
  rookie,
}: {
  name: string;
  size: number;
  initials: string;
  background: string;
  color: string;
  fontSize: number;
  rookie?: boolean;
}) {
  const [stage, setStage] = useState(0);

  const nbaUrl = nbaHeadshotUrl(name);
  const sources = rookie ? [prospectHeadshotUrl(name), nbaUrl] : [nbaUrl, prospectHeadshotUrl(name)];
  const url = sources.filter((u): u is string => !!u)[stage] ?? null;

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- headshots come from an external CDN / local prospect art keyed by player name, not a static local asset
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        onError={() => setStage((s) => s + 1)}
        style={{
          width: size,
          height: size,
          flex: `0 0 ${size}px`,
          borderRadius: 999,
          objectFit: "cover",
          background,
          display: "block",
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
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        borderRadius: 999,
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
