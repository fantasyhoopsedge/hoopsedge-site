"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AppSidebar } from "@/components/app-sidebar";
import { BRAND_LOGO_HEIGHT } from "@/lib/brand";
import { useAuth } from "@/context/AuthContext";
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
  const { user, openSignUp, signOut, supabase } = useAuth();

  // Screenshots for this design were authored dark-first, matching the rest
  // of the site's default theme (see src/app/layout.tsx).
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileRankingsOpen, setMobileRankingsOpen] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark") setTheme(stored);
    } catch {
      // localStorage unavailable — keep the default theme.
    }
  }, []);

  // Full-screen takeover, same behavior as SiteNav's mobile menu: lock
  // background scroll while it's open, close on Escape.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", handler);
    };
  }, [mobileNavOpen]);

  const closeMobileMenu = () => {
    setMobileNavOpen(false);
    setMobileRankingsOpen(false);
  };

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

  // Show the rookie-board editor link to admins (and always on localhost) —
  // same check SiteNav's mobile menu uses, so this row shows/hides identically.
  const [isBoardAdmin, setIsBoardAdmin] = useState(false);
  useEffect(() => {
    if (!user || !supabase) {
      setIsBoardAdmin(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const sb = supabase as unknown as { rpc(fn: string): Promise<{ data: boolean | null }> };
        const { data } = await sb.rpc("is_rb_admin");
        if (!cancelled) setIsBoardAdmin(Boolean(data));
      } catch {
        if (!cancelled) setIsBoardAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, supabase]);
  const showBoardEditor = process.env.NODE_ENV !== "production" || isBoardAdmin;

  return (
    <div className={`rt-shell ${GeistSans.variable} ${GeistMono.variable}`} data-rt-theme={theme}>
      {/* Desktop: fixed-left rail, same AppSidebar every other platform page uses. */}
      <div className="rt-sidebar-desktop">
        <AppSidebar active="rosters" theme={theme} onToggleTheme={handleToggleTheme} />
      </div>

      {/* Mobile: compact top bar + hamburger opening a full-screen takeover —
          same content/behavior as SiteNav's mobile menu on every other
          platform page (Home / Rankings accordion / Team Rosters / Arena /
          theme toggle / sign-in footer), rebuilt here rather than mounting
          SiteNav itself so the theme toggle stays wired to this shell's own
          `theme` state (which RosterApp also reads) instead of SiteNav's
          independent theme state. */}
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
        <div className="rt-mobile-panel" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="rt-mobile-panel-header">
            {/* eslint-disable-next-line @next/next/no-img-element -- brand SVG lockup, no next/image config needed */}
            <img
              src={theme === "dark" ? "/brand/logo-wordmark-on-dark.svg" : "/brand/logo-wordmark.svg"}
              alt="Fantasy Hoops Edge"
              style={{ height: 24, width: "auto" }}
            />
            <button
              type="button"
              className="rt-mobile-panel-close"
              aria-label="Close menu"
              onClick={closeMobileMenu}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="rt-mobile-panel-body">
            <Link href="/" className="rt-mobile-panel-row" onClick={closeMobileMenu}>
              Home
            </Link>

            <button
              type="button"
              className="rt-mobile-panel-row"
              aria-expanded={mobileRankingsOpen}
              onClick={() => setMobileRankingsOpen((v) => !v)}
            >
              Rankings
              <span className={`rt-mobile-panel-chevron${mobileRankingsOpen ? " rt-mobile-panel-chevron--open" : ""}`} aria-hidden>
                ▾
              </span>
            </button>
            {mobileRankingsOpen && (
              <div className="rt-mobile-panel-sub">
                <a href="/seasonal-rankings" onClick={closeMobileMenu}>Player value rankings</a>
                <a href="/dynasty-rankings" onClick={closeMobileMenu}>Dynasty Consensus</a>
                <a href="/draft-board" onClick={closeMobileMenu}>Rookie Board</a>
              </div>
            )}

            <Link href="/team-rosters" className="rt-mobile-panel-row" onClick={closeMobileMenu}>
              NBA Team Rosters
            </Link>
            <a href="/prediction-arena" className="rt-mobile-panel-row" onClick={closeMobileMenu}>
              Arena
            </a>
            {showBoardEditor && (
              <a href="/admin/rookie-board" className="rt-mobile-panel-row" onClick={closeMobileMenu}>
                Board Editor
              </a>
            )}
            <button
              type="button"
              className="rt-mobile-panel-row"
              onClick={() => handleToggleTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            </button>

            {user && (
              <>
                <a href="/profile" className="rt-mobile-panel-row" onClick={closeMobileMenu}>
                  Profile &amp; Account
                </a>
                <button
                  type="button"
                  className="rt-mobile-panel-row rt-mobile-panel-row--signout"
                  onClick={() => {
                    closeMobileMenu();
                    void signOut();
                  }}
                >
                  Sign Out
                </button>
              </>
            )}
          </div>

          {!user && (
            <div className="rt-mobile-panel-footer">
              <button
                type="button"
                className="rt-mobile-panel-signin"
                onClick={() => {
                  closeMobileMenu();
                  openSignUp();
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                className="rt-mobile-panel-join"
                onClick={() => {
                  closeMobileMenu();
                  openSignUp("/prediction-arena");
                }}
              >
                Join Free →
              </button>
            </div>
          )}
        </div>
      )}

      <RosterApp theme={theme} team={team} players={players} ageRank={ageRank} />
    </div>
  );
}
