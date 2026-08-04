"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { FantraxConnector } from "./_connector";

const STORAGE_KEY = "fhe-theme";

/** Same shell the Depth Chart Adjuster uses: fixed sidebar rail on desktop,
 *  hidden on mobile, theme synced to the sitewide localStorage key. */
export function FantraxShell() {
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
    document.documentElement.setAttribute("data-theme", next);
  };

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--rt-canvas)" }}>
      <div className="fx-sidebar-desktop">
        <AppSidebar active="fantrax" theme={theme} onToggleTheme={handleToggleTheme} />
      </div>
      <div style={{ flex: "1 1 auto", overflow: "hidden" }}>
        <FantraxConnector />
      </div>
      <style>{`
        @media (max-width: 767px) {
          .fx-sidebar-desktop { display: none; }
        }
      `}</style>
    </div>
  );
}
