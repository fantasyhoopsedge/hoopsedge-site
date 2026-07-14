"use client";

import { useEffect, useState } from "react";
import { AppSidebar, type AppSidebarActiveKey } from "@/components/app-sidebar";
import { SiteNav } from "@/components/site-nav";

const STORAGE_KEY = "fhe-theme";

// Drop-in replacement for <SiteNav /> on content pages migrated to the
// left-rail sidebar (see plan: sync all platform content to one nav). Desktop
// renders AppSidebar fixed-left; mobile (<=767px, the site's existing
// breakpoint) falls back to the original top <nav> so mobile keeps its
// battle-tested compact layout instead of a half-built sidebar collapse.
// Theme is read from/written to the same `data-theme` attribute + "fhe-theme"
// localStorage key the rest of the site already uses (see layout.tsx's
// pre-hydration script and site-nav.tsx) — no separate theme state.
export function PlatformSidebarNav({ active }: { active: AppSidebarActiveKey }) {
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

  const mobileActive =
    active === "cat-values" || active === "dynasty" ? "rankings" : active === "rookie-board" ? "draft" : undefined;

  return (
    <>
      <div className="platform-sidebar-desktop">
        <AppSidebar active={active} theme={theme} onToggleTheme={handleToggleTheme} />
      </div>
      <div className="platform-sidebar-mobile">
        <SiteNav active={mobileActive} />
      </div>
    </>
  );
}
