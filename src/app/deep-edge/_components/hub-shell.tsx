"use client";

import { useEffect, useState, type ReactNode } from "react";
import "@/app/team-rosters/_components/roster-tokens.css";
import { DeepEdgeSidebar } from "./deep-edge-sidebar";

const STORAGE_KEY = "fhe-theme";

/**
 * The Home hub shell — sidebar + top bar + scrollable content. Distinct from
 * OnboardingShell (dark, no sidebar, forced theme) and from
 * admin/fantrax/_shell.tsx's FantraxShell (uses AppSidebar, not
 * DeepEdgeSidebar).
 *
 * Toggleable light/dark, same mechanism /team-rosters' TeamRostersShell uses:
 * `[data-rt-theme]` on this shell's own `.rt-shell` root (scoped, independent
 * of the rest of the site's `[data-theme]` on <html> — see roster-tokens.css's
 * own header comment), but sharing the SAME "fhe-theme" localStorage key and
 * also setting the sitewide `[data-theme]` attribute, so a preference set on
 * either surface carries over to the other — "the Deep Edge ecosystem" reads
 * as one system, not two independently-remembered toggles. Defaults to
 * light (not team-rosters' dark) since every Home/Settings/Category
 * Edge/Power Rankings screenshot in the original design handoff was light —
 * that's this shell's own baseline, just no longer forced.
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
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- external-system read (localStorage) after mount, not derived from props/state; reading it eagerly during initial render would return the real value client-side but not server-side, causing a hydration mismatch (same pattern as deep-edge/providers/page.tsx's own sessionStorage restore)
      if (stored === "light" || stored === "dark") setTheme(stored);
    } catch {
      // localStorage unavailable — keep the default theme.
    }
  }, []);

  function handleToggleTheme(next: "light" | "dark") {
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore — theme just won't persist across reloads
    }
    document.documentElement.setAttribute("data-theme", next);
  }

  return (
    <div className="rt-shell de-shell" data-rt-theme={theme} style={{ height: "100vh" }}>
      <DeepEdgeSidebar hasLeague={hasLeague} theme={theme} onToggleTheme={handleToggleTheme} />
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
