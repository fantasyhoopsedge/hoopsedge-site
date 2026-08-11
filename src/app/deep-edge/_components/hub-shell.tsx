"use client";

import type { ReactNode } from "react";
import "@/app/team-rosters/_components/roster-tokens.css";
import { DeepEdgeSidebar } from "./deep-edge-sidebar";

/**
 * The light "Home hub" shell — sidebar + top bar + scrollable content.
 * Distinct from OnboardingShell (dark, no sidebar, forced theme) and from
 * admin/fantrax/_shell.tsx's FantraxShell (uses AppSidebar, not
 * DeepEdgeSidebar). Forced light, matching every Home/Settings/Category
 * Edge/Power Rankings screenshot in the design handoff (none of them show a
 * dark variant) — unlike /team-rosters' identical `.rt-shell` usage, which
 * does sync to the site's light/dark toggle. Revisit if a dark hub design
 * ever ships.
 */
export function HubShell({
  hasLeague,
  breadcrumb,
  children,
}: {
  hasLeague: boolean;
  breadcrumb?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rt-shell de-shell" data-rt-theme="light" style={{ height: "100vh" }}>
      <DeepEdgeSidebar hasLeague={hasLeague} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "100%" }}>
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
            padding: "0 28px", height: 56, borderBottom: "1px solid var(--rt-hairline)", flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 13.5, color: "var(--rt-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {breadcrumb}
          </div>
          <div
            style={{
              flexShrink: 0, width: 220, height: 34, borderRadius: 100, background: "var(--rt-surface-strong)",
              display: "flex", alignItems: "center", padding: "0 14px", fontSize: 12.5, color: "var(--rt-muted)",
            }}
          >
            Search players, leagues…
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px 80px" }}>{children}</div>
      </div>
    </div>
  );
}
