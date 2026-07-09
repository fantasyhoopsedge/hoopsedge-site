"use client";

import { useEffect, useState } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AppSidebar } from "@/components/app-sidebar";
import { BRAND_LOGO_HEIGHT } from "@/lib/brand";
import { RosterApp } from "./roster-app";
import type { Player } from "./roster-data";

const STORAGE_KEY = "fhe-theme";

export function TeamRostersShell({
  team,
  players,
  ageRank,
}: {
  team: string;
  players: Player[];
  ageRank: { rank: number; total: number } | null;
}) {
  // Screenshots for this design were authored dark-first, matching the rest
  // of the site's default theme (see src/app/layout.tsx).
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark") setTheme(stored);
    } catch {
      // localStorage unavailable — keep the default theme.
    }
  }, []);

  const handleToggleTheme = (next: "light" | "dark") => {
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore — theme just won't persist across reloads
    }
    // Shared with the rest of the site's theme toggle (src/components/site-nav.tsx)
    // so switching here stays consistent if the user visits another page.
    document.documentElement.setAttribute("data-theme", next);
  };

  return (
    <div className={`rt-shell ${GeistSans.variable} ${GeistMono.variable}`} data-rt-theme={theme}>
      {/* Desktop: fixed-left rail, same AppSidebar every other platform page uses. */}
      <div className="rt-sidebar-desktop">
        <AppSidebar active="rosters" theme={theme} onToggleTheme={handleToggleTheme} />
      </div>

      {/* Mobile: compact top bar + hamburger opening AppSidebar as a drawer —
          reuses the exact same component/theme state as desktop rather than
          duplicating nav logic (unlike PlatformSidebarNav's SiteNav fallback,
          which manages its own independent theme state — not viable here
          since RosterApp itself needs this shell's single `theme` value). */}
      <div className="rt-mobile-topbar">
        <button
          type="button"
          className="rt-mobile-menu-btn"
          aria-label="Open menu"
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen(true)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element -- brand SVG lockup, no next/image config needed */}
        <img
          src={theme === "dark" ? "/brand/logo-wordmark-on-dark.svg" : "/brand/logo-wordmark.svg"}
          alt="Fantasy Hoops Edge"
          style={{ height: BRAND_LOGO_HEIGHT, width: "auto" }}
        />
        <span style={{ width: 36 }} aria-hidden />
      </div>

      {mobileNavOpen && (
        <div className="rt-mobile-drawer-backdrop" onClick={() => setMobileNavOpen(false)}>
          <div className="rt-mobile-drawer" onClick={(e) => e.stopPropagation()}>
            <AppSidebar active="rosters" theme={theme} onToggleTheme={handleToggleTheme} />
          </div>
        </div>
      )}

      <RosterApp theme={theme} team={team} players={players} ageRank={ageRank} />
    </div>
  );
}
