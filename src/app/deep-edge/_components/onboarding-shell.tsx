"use client";

import type { ReactNode } from "react";
import "@/app/team-rosters/_components/roster-tokens.css";

/**
 * Full-bleed, no-sidebar dark "court" screen — Welcome and Exit. No existing
 * surface in the app was this shape before The Deep Edge; every prior dark
 * .rt-shell surface is sidebar+content, and every prior full-bleed dark
 * overlay is a modal, not a standalone screen. Forces dark regardless of the
 * site's stored theme, matching the design's onboarding treatment — this is
 * the one place in the app that doesn't follow the fhe-theme toggle.
 */
export function OnboardingShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="rt-shell de-shell"
      data-rt-theme="dark"
      style={{
        flexDirection: "column",
        alignItems: "stretch",
        background: "var(--rt-canvas)",
        overflowY: "auto",
      }}
    >
      {children}
    </div>
  );
}
