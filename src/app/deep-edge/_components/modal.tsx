"use client";

import type { ReactNode } from "react";

/**
 * Shared modal overlay, extracted from the inline-style pattern already used
 * (independently, twice) in team-rosters' player-quickview-modal.tsx and
 * compare-modal.tsx — both on the current --rt-* token set, unlike the
 * older sign-up-modal.tsx which still uses the legacy --modal-* tokens.
 * The Fantrax auth modal and Add-league modal both use this.
 */
export function Modal({
  onClose,
  children,
  width = 440,
}: {
  onClose: () => void;
  children: ReactNode;
  width?: number | string;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 260,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: `min(${typeof width === "number" ? `${width}px` : width}, 100%)`,
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          background: "var(--rt-canvas)",
          border: "1px solid var(--rt-hairline)",
          borderRadius: 24,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          padding: 28,
        }}
      >
        {children}
      </div>
    </div>
  );
}
