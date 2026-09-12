"use client";

import { PlayerHeadshot } from "@/app/team-rosters/_components/roster-headshot";

/**
 * The Deep Edge asset card — square, solid color fill, name/sub-label
 * top-left, one big number bottom-left, headshot bleeding off the
 * bottom-right corner.
 *
 * Extracted from Trade Edge's own PlayerMiniCard (Ash's color-coding spec,
 * 2026-08-23) when Category Edge asked for the same card with a different
 * meaning (Ash, 2026-09-12: "rework the category edge tool to use the player
 * trade cards... replacing the player headshots with the player trading
 * cards"). Deliberately ONE component with two callers rather than a second
 * copy of the same geometry: the fade-edge headshot quadrant, the white-on-
 * any-fill text shadow and the corner clipping were all tuned against real
 * screenshots, and a duplicate would drift from that tuning the first time
 * either screen was adjusted.
 *
 * What the card MEANS is entirely the caller's:
 *   Trade Edge   — `bg` is the asset tier (rookie/sophomore/rookie-scale/
 *                  veteran), `headline` the trade-value rank.
 *   Category Edge — `bg` is that player's promoter/passive/detractor tier IN
 *                  THE CATEGORY being shown, `headline` his rank in it.
 * So this file holds no color table and no rank logic of its own.
 *
 * Every text element is plain white with a soft drop shadow so it reads the
 * same on every fill, light or dark (Ash: "player names etc should all be in
 * white").
 */
export function AssetMiniCard({
  name, subLabel, bg, headline, isRookie, checked, onToggle, dot, width, dimmed, title,
}: {
  name: string;
  /** The line under the name — "PG/SG · OKC" in Trade Edge, lineup slot plus
   *  team in Category Edge. */
  subLabel: string;
  /** Card fill. The caller's own tier color; see this file's header. */
  bg: string;
  /** The single big number, bottom-left. Already formatted ("#12", "—"). */
  headline: string;
  isRookie?: boolean;
  /** Selection state — only meaningful alongside onToggle. */
  checked?: boolean;
  /** Omit for a display-only card: it renders a div rather than a button,
   *  with no pointer cursor and nothing focusable, which is what a card in a
   *  read-only list should be. */
  onToggle?: () => void;
  /** Small dot, top-right — Trade Edge uses it for the category tier that
   *  Category Edge instead carries in the fill itself. */
  dot?: string | null;
  /** Fixed card width in px. Omit to fill the grid cell (Trade Edge's own
   *  auto-fill columns); Category Edge sets one because its cards sit in a
   *  wrapping flex row beside the category's stat block, not a grid. */
  width?: number;
  dimmed?: boolean;
  title?: string;
}) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("");
  const textShadow = "0 1px 3px rgba(0,0,0,0.45)";
  const selectable = Boolean(onToggle);
  const Tag = selectable ? "button" : "div";
  return (
    <Tag
      type={selectable ? "button" : undefined}
      onClick={onToggle}
      title={title ?? name}
      style={{
        position: "relative", aspectRatio: "1 / 1", borderRadius: 16,
        border: checked ? "2px solid var(--rt-ink)" : "2px solid transparent",
        background: bg, cursor: selectable ? "pointer" : "default", textAlign: "left", color: "#fff",
        overflow: "hidden", font: "inherit", width: width ?? "100%", flexShrink: 0,
        opacity: dimmed ? 0.55 : 1, padding: 0,
      }}
    >
      {/* Headshot fills the card's own bottom-right quadrant, flush to the
          real corner (unpadded, so it can bleed to the card's true edge —
          the card's own overflow:hidden + border-radius clips its outer
          corner to match). fadeEdge blends its left edge into the card's
          fill instead of a hard rectangular cut. */}
      <div style={{ position: "absolute", right: 0, bottom: 0, width: "48%", height: "50%" }}>
        <PlayerHeadshot
          name={name} size={44} width="100%" height="100%" radius={0} fadeEdge
          initials={initials} background="transparent" color="#fff" fontSize={13} rookie={isRookie}
        />
      </div>
      {dot && (
        <span style={{ position: "absolute", top: 10, right: checked ? 32 : 10, width: 9, height: 9, borderRadius: 999, background: dot, boxShadow: "0 0 0 2px rgba(255,255,255,0.6)" }} />
      )}
      {checked && (
        <span style={{ position: "absolute", top: 8, right: 8, width: 20, height: 20, borderRadius: 999, background: "var(--rt-ink)", color: "var(--rt-canvas)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>
          ✓
        </span>
      )}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100%", padding: 10 }}>
        <div style={{ maxWidth: "78%" }}>
          <div
            style={{
              fontSize: 11.5, fontWeight: 800, lineHeight: 1.15, textShadow,
              overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
            }}
          >
            {name}
          </div>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.85)", textShadow, marginTop: 2 }}>
            {subLabel}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ maxWidth: "48%" }}>
          <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1, fontFamily: "var(--rt-font-mono)", color: "#fff", textShadow }}>
            {headline}
          </span>
        </div>
      </div>
    </Tag>
  );
}
