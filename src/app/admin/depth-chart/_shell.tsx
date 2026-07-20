"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { DepthChartEditor } from "./_editor";

const STORAGE_KEY = "fhe-theme";

export function DepthChartShell() {
  // Matches every other rt- page: dark-first default, synced to the same
  // localStorage key so a theme change here carries over sitewide.
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
      <div className="dc-sidebar-desktop">
        <AppSidebar active="depth-chart" theme={theme} onToggleTheme={handleToggleTheme} />
      </div>
      <div style={{ flex: "1 1 auto", overflow: "hidden" }}>
        <DepthChartEditor />
      </div>
      <style>{`
        @media (max-width: 767px) {
          .dc-sidebar-desktop { display: none; }
        }
      `}</style>
    </div>
  );
}
