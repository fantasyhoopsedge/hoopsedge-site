"use client";

import type { Player } from "./roster-data";
import { DepthChartBody } from "./depth-chart-body";

/** Pop-up depth chart for desktop/tablet, read from the published
 * /admin/depth-chart tool (projected 2026-27 role + minutes + usage — see
 * src/lib/depth-chart-store.ts). All the actual content (tier subheadings,
 * circular position badges, rows, team-logo watermark) lives in
 * DepthChartBody, shared with the mobile inline view (DepthChartInline) so
 * both breakpoints render the same design — this component only supplies
 * the modal chrome: backdrop, card, and a pinned header with a close button
 * that stays put while the roster list below it scrolls. */
export function DepthChartModal({
  team,
  teamName,
  players,
  onClose,
  isMobile,
}: {
  team: string;
  teamName: string;
  players: Player[];
  onClose: () => void;
  isMobile: boolean;
}) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 260, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)", padding: isMobile ? 8 : 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          // Capped tight to the row content's actual width (position circle +
          // headshot/name + MPG/GP + USG + signal — see the flex basis
          // values in DepthChartBody) plus this card's own padding. A wider
          // card just left dead air after the player name, since Player
          // used to be flex:"1 1 auto" and greedily filled whatever was
          // left over instead of sizing to its own (fixed, non-growing) width.
          width: "min(460px, 100%)",
          maxHeight: isMobile ? "80vh" : "calc(100vh - 48px)",
          display: "flex",
          flexDirection: "column",
          background: "var(--rt-canvas)",
          border: "1px solid var(--rt-hairline)",
          borderRadius: 20,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          overflow: "hidden",
        }}
      >
        {/* Pinned header — stays put while the roster list below scrolls, so
            the close button is always reachable (previously the whole modal,
            header included, scrolled as one block and the X could end up
            off-screen after scrolling through a full 18-20 player roster). */}
        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: isMobile ? "14px 14px 10px" : "24px 24px 12px",
            borderBottom: "1px solid var(--rt-hairline)",
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--rt-ink)" }}>Depth Chart</div>
            <div style={{ fontSize: 13, color: "var(--rt-muted)", marginTop: 2 }}>{teamName} · Projected 2026–27</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close depth chart"
            style={{ width: 36, height: 36, flex: "0 0 36px", borderRadius: 999, border: "1px solid var(--rt-hairline)", background: "none", color: "var(--rt-ink)", cursor: "pointer" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ margin: "0 auto" }} aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: isMobile ? "12px 12px 16px" : "16px 24px 24px" }}>
          <DepthChartBody team={team} teamName={teamName} players={players} />
        </div>
      </div>
    </div>
  );
}
