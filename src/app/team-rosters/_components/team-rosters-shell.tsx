"use client";

import { useEffect, useState } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AppSidebar } from "@/components/app-sidebar";
import { RosterApp } from "./roster-app";
import type { Player } from "./roster-data";

const STORAGE_KEY = "fhe-theme";

export function TeamRostersShell({ team, players }: { team: string; players: Player[] }) {
  // Screenshots for this design were authored dark-first, matching the rest
  // of the site's default theme (see src/app/layout.tsx).
  const [theme, setTheme] = useState<"light" | "dark">("dark");

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
      <AppSidebar active="rosters" theme={theme} onToggleTheme={handleToggleTheme} />
      <RosterApp theme={theme} team={team} players={players} />
    </div>
  );
}
