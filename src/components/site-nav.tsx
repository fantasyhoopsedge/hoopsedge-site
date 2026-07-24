"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import { BRAND_LOGO_HEIGHT } from "@/lib/brand";

const STORAGE_KEY = "fhe-theme";

// ── Tiny avatar with initials fallback ───────────────────────────────────────
function NavAvatar({ src, name, size = 32 }: { src: string | null; name: string; size?: number }) {
  const [imgOk, setImgOk] = useState(true);
  const letters = name.trim().slice(0, 2).toUpperCase();

  if (src && imgOk) {
    return (
      <img
        src={src}
        alt={name}
        onError={() => setImgOk(false)}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          border: "2px solid var(--border-main)",
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "linear-gradient(135deg, var(--blueprint) 0%, var(--edge-orange) 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Oswald', sans-serif",
        fontWeight: 700,
        fontSize: Math.round(size * 0.38),
        color: "#fff",
        flexShrink: 0,
        border: "2px solid var(--border-main)",
      }}
    >
      {letters || "?"}
    </div>
  );
}

// ── User dropdown menu (click-activated) ─────────────────────────────────────
function UserMenu({ user, profile, signOut }: {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  profile: ReturnType<typeof useAuth>["profile"];
  signOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const displayName = profile?.username ?? user.email?.split("@")[0] ?? "User";
  const avatarUrl = profile?.avatar_url ?? null;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <div ref={ref} className="usermenu-wrap">
      <button
        type="button"
        className="usermenu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <NavAvatar src={avatarUrl} name={displayName} size={30} />
        <span className="usermenu-name">{displayName}</span>
        <span className="usermenu-caret" aria-hidden>▾</span>
      </button>

      {open && (
        <div className="usermenu-dropdown" role="menu">
          {/* Identity block */}
          <div className="usermenu-identity">
            <NavAvatar src={avatarUrl} name={displayName} size={36} />
            <div className="usermenu-identity-text">
              <span className="usermenu-identity-name">{displayName}</span>
              <span className="usermenu-identity-email">{user.email}</span>
            </div>
          </div>
          <div className="usermenu-divider" />

          {/* Nav links */}
          <a href="/prediction-arena" className="usermenu-item" role="menuitem" onClick={() => setOpen(false)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
            </svg>
            Predictions
          </a>
          <a href="/profile" className="usermenu-item" role="menuitem" onClick={() => setOpen(false)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2"/>
              <path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            Profile &amp; Account
          </a>

          <div className="usermenu-divider" />

          <button type="button" className="usermenu-item usermenu-item--signout" role="menuitem"
            onClick={() => { setOpen(false); void signOut(); }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <polyline points="16 17 21 12 16 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

export function SiteNav(props: {
  active?: "rankings" | "draft";
  joinFree?: ReactNode;
  /** Compact single-line summary (e.g. dynasty rankings meta), shown left of Join CTA */
  infoStrip?: ReactNode;
  navClassName?: string;
  /**
   * Overrides which logo wordmark variant renders, for callers that wrap
   * this nav in a bar whose background is pinned to a color regardless of
   * the site-wide theme toggle (e.g. the home page's mobile nav sits on an
   * always-black hero). Without this the logo still follows the toggle-driven
   * `theme` state below, which can pick the dark-text wordmark against a
   * pinned-black bar and render it invisible.
   */
  forceTheme?: "dark" | "light";
}) {
  const { active, joinFree, infoStrip, navClassName, forceTheme } = props;
  const { user, profile, openSignUp, signOut, supabase } = useAuth();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const logoTheme = forceTheme ?? theme;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileRankingsOpen, setMobileRankingsOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLLIElement>(null);

  // Full-screen takeover: lock background scroll while it's open, and let
  // Escape close it (outside-click doesn't apply once it covers the viewport).
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", handler);
    };
  }, [mobileMenuOpen]);

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
    setMobileRankingsOpen(false);
  };

  // Show the rookie-board editor link to admins (and always on localhost).
  const [isBoardAdmin, setIsBoardAdmin] = useState(false);
  useEffect(() => {
    if (!user || !supabase) { setIsBoardAdmin(false); return; }
    let cancelled = false;
    // Call rpc as a BOUND member (never detach it — supabase-js's rpc needs
    // `this`), and guard everything so this nav-only check can never crash a
    // page for a signed-in user.
    (async () => {
      try {
        const sb = supabase as unknown as { rpc(fn: string): Promise<{ data: boolean | null }> };
        const { data } = await sb.rpc("is_rb_admin");
        if (!cancelled) setIsBoardAdmin(Boolean(data));
      } catch {
        if (!cancelled) setIsBoardAdmin(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, supabase]);
  const showBoardEditor = process.env.NODE_ENV !== "production" || isBoardAdmin;

  useEffect(() => {
    const root = document.documentElement;
    const stored = localStorage.getItem(STORAGE_KEY);
    const initial = stored === "light" || stored === "dark" ? stored : "dark";
    setTheme(initial);
    root.setAttribute("data-theme", initial);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  const join =
    joinFree ??
    (user ? (
      <UserMenu user={user} profile={profile} signOut={signOut} />
    ) : (
      <a
        href="#"
        className="nav-cta"
        onClick={(e) => {
          e.preventDefault();
          openSignUp("/prediction-arena");
        }}
      >
        Join Free →
      </a>
    ));

  const mobileOppositeLink =
    active === "rankings"
      ? { href: "/draft-board", label: "ROOKIE DRAFT BOARD" }
      : active === "draft"
        ? { href: "/dynasty-rankings", label: "DYNASTY RANKINGS" }
        : null;

  return (
    <nav className={navClassName}>
      <a href="/" style={{ textDecoration: "none" }}>
        <div className="nav-brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- brand SVG lockup, no next/image config needed */}
          <img
            className="nav-brand-full"
            src={logoTheme === "dark" ? "/brand/logo-wordmark-on-dark.svg" : "/brand/logo-wordmark.svg"}
            alt="Fantasy Hoops Edge"
            style={{ height: BRAND_LOGO_HEIGHT, width: "auto" }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element -- brand SVG lockup, no next/image config needed */}
          <img
            className="nav-brand-mobile"
            src="/brand/logo-mark.svg"
            alt="Fantasy Hoops Edge"
            style={{ height: BRAND_LOGO_HEIGHT, width: BRAND_LOGO_HEIGHT }}
          />
        </div>
      </a>
      <ul className="nav-links">
        {mobileOppositeLink ? (
          <li className="nav-mobile-opposite-link">
            <a href={mobileOppositeLink.href}>{mobileOppositeLink.label}</a>
          </li>
        ) : null}
        <li className="nav-rankings nav-dropdown">
          <button
            type="button"
            className="nav-dropdown-trigger"
            aria-haspopup="true"
            style={active === "rankings" || active === "draft" ? { color: "var(--edge-orange)" } : undefined}
          >
            Rankings <span className="nav-caret" aria-hidden>▾</span>
          </button>
          <ul className="nav-dropdown-menu">
            <li><a href="/seasonal-rankings">Player Category Values</a></li>
            <li><a href="/dynasty-rankings">Dynasty Consensus</a></li>
            <li><a href="/draft-board">2026 Rookie Draft</a></li>
          </ul>
        </li>
        <li className="nav-arena">
          <a href="/prediction-arena">Arena</a>
        </li>
        {showBoardEditor && (
          <li className="nav-arena nav-admin-dev">
            <a href="/admin/rookie-board" title="Rookie board editor (admins only)">✎ Board Editor</a>
          </li>
        )}
        {showBoardEditor && (
          <li className="nav-arena nav-admin-dev">
            <a href="/admin/depth-chart" title="Depth Chart Adjuster (admins only)">☰ Depth Chart Adjuster</a>
          </li>
        )}
        <li className="nav-theme">
          <button type="button" className="theme-toggle" onClick={toggleTheme} title="Toggle light/dark theme" aria-label="Toggle theme">
            {theme === "dark" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="2" />
                <path
                  d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M21 14.5A8.5 8.5 0 0112 21a8.5 8.5 0 010-17 8.5 8.5 0 019 10.5z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        </li>
        {infoStrip ? (
          <li className="nav-info-strip-wrap">
            <span className="nav-info-strip-inner">{infoStrip}</span>
          </li>
        ) : null}
        <li className="nav-join">{join}</li>
        <li className="nav-hamburger" ref={mobileMenuRef}>
          <button
            type="button"
            className="nav-hamburger-btn"
            aria-haspopup="true"
            aria-expanded={mobileMenuOpen}
            aria-label="Menu"
            onClick={() => setMobileMenuOpen((v) => !v)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          {mobileMenuOpen && (
            <div className="nav-mobile-panel" role="dialog" aria-modal="true" aria-label="Menu">
              <div className="nav-mobile-panel-header">
                {/* eslint-disable-next-line @next/next/no-img-element -- brand SVG lockup, no next/image config needed */}
                <img
                  src={logoTheme === "dark" ? "/brand/logo-wordmark-on-dark.svg" : "/brand/logo-wordmark.svg"}
                  alt="Fantasy Hoops Edge"
                  style={{ height: 24, width: "auto" }}
                />
                <button
                  type="button"
                  className="nav-mobile-panel-close"
                  aria-label="Close menu"
                  onClick={closeMobileMenu}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <div className="nav-mobile-panel-body">
                <Link href="/" className="nav-mobile-panel-row" onClick={closeMobileMenu}>
                  Home
                </Link>

                <button
                  type="button"
                  className="nav-mobile-panel-row"
                  aria-expanded={mobileRankingsOpen}
                  onClick={() => setMobileRankingsOpen((v) => !v)}
                >
                  Rankings
                  <span className={`nav-mobile-panel-chevron${mobileRankingsOpen ? " nav-mobile-panel-chevron--open" : ""}`} aria-hidden>
                    ▾
                  </span>
                </button>
                {mobileRankingsOpen && (
                  <div className="nav-mobile-panel-sub">
                    <a href="/seasonal-rankings" onClick={closeMobileMenu}>Player Category Values</a>
                    <a href="/dynasty-rankings" onClick={closeMobileMenu}>Dynasty Consensus</a>
                    <a href="/draft-board" onClick={closeMobileMenu}>Rookie Board</a>
                  </div>
                )}

                <Link href="/team-rosters" className="nav-mobile-panel-row" onClick={closeMobileMenu}>
                  NBA Team Rosters
                </Link>
                <a href="/prediction-arena" className="nav-mobile-panel-row" onClick={closeMobileMenu}>
                  Arena
                </a>
                {showBoardEditor && (
                  <a href="/admin/rookie-board" className="nav-mobile-panel-row" onClick={closeMobileMenu}>
                    Board Editor
                  </a>
                )}
                {showBoardEditor && (
                  <a href="/admin/depth-chart" className="nav-mobile-panel-row" onClick={closeMobileMenu}>
                    Depth Chart Adjuster
                  </a>
                )}
                <button type="button" className="nav-mobile-panel-row" onClick={toggleTheme}>
                  {theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                </button>

                {user && (
                  <>
                    <a href="/profile" className="nav-mobile-panel-row" onClick={closeMobileMenu}>
                      Profile &amp; Account
                    </a>
                    <button
                      type="button"
                      className="nav-mobile-panel-row nav-mobile-panel-row--signout"
                      onClick={() => { closeMobileMenu(); void signOut(); }}
                    >
                      Sign Out
                    </button>
                  </>
                )}
              </div>

              {!user && (
                <div className="nav-mobile-panel-footer">
                  <button
                    type="button"
                    className="nav-mobile-panel-signin"
                    onClick={() => { closeMobileMenu(); openSignUp(); }}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    className="nav-mobile-panel-join"
                    onClick={() => { closeMobileMenu(); openSignUp("/prediction-arena"); }}
                  >
                    Join Free →
                  </button>
                </div>
              )}
            </div>
          )}
        </li>
      </ul>
      {/* Balances the hamburger's width on mobile so the centered logo is
          actually centered, not just left-flush after the hamburger —
          same trick team-rosters' topbar uses. */}
      <span className="nav-mobile-spacer" aria-hidden />
      <style>{`
        /* ── Rankings dropdown ───────────────────────────────────────────── */
        .nav-dropdown { position: relative; }
        .nav-dropdown-trigger {
          background: none; border: none; cursor: pointer; padding: 0;
          font-family: 'Oswald', sans-serif; font-weight: 500; font-size: 13px;
          letter-spacing: 2px; text-transform: uppercase; color: var(--text-primary);
          display: inline-flex; align-items: center; gap: 5px; transition: color 0.3s;
        }
        .nav-dropdown-trigger:hover { color: var(--edge-orange); }
        .nav-caret { font-size: 9px; }
        .nav-dropdown::after {
          content: ''; position: absolute; top: 100%; left: 0; right: 0; height: 12px;
        }
        .nav-dropdown-menu {
          position: absolute; top: calc(100% + 12px); left: 0; min-width: 230px;
          list-style: none; margin: 0; padding: 8px;
          background: var(--bg-surface); border: 1px solid var(--border-main);
          border-radius: 12px; box-shadow: var(--shadow-card);
          display: none; flex-direction: column; gap: 2px; z-index: 200;
        }
        .nav-dropdown:hover .nav-dropdown-menu,
        .nav-dropdown:focus-within .nav-dropdown-menu { display: flex; }
        .nav-dropdown-menu a {
          display: block; padding: 11px 14px; border-radius: 8px;
          font-family: 'Oswald', sans-serif; font-weight: 500; font-size: 13px;
          letter-spacing: 1px; text-transform: uppercase; white-space: nowrap;
          color: var(--text-secondary); text-decoration: none; transition: background 0.2s, color 0.2s;
        }
        .nav-dropdown-menu a:hover { background: var(--bg-card-hover); color: var(--text-primary); }
        /* Light mode: the dropdown menu's own background (--bg-surface) is
           light regardless of the top bar's color, so its links need dark
           text — high specificity so it wins over the faded/mobile
           .nav-links a rules. */
        [data-theme="light"] .nav-links li.nav-dropdown .nav-dropdown-menu a,
        [data-theme="light"] .nav-links li.nav-dropdown .nav-dropdown-menu a:hover { color: #0a1230; }
        .nav-arena a { color: var(--text-primary); }
        .nav-arena a:hover { color: var(--edge-orange); }

        /* ── User menu ───────────────────────────────────────────────────── */
        .usermenu-wrap { position: relative; }
        .usermenu-trigger {
          display: inline-flex; align-items: center; gap: 8px;
          background: none; border: 1px solid var(--border-main);
          border-radius: 40px; padding: 3px 12px 3px 4px; cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
        }
        .usermenu-trigger:hover { border-color: var(--blueprint); background: var(--bg-card); }
        .usermenu-name {
          font-family: 'Oswald', sans-serif; font-weight: 500; font-size: 13px;
          letter-spacing: 1px; color: var(--text-primary); max-width: 90px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .usermenu-caret { font-size: 9px; color: var(--text-muted); }

        .usermenu-dropdown {
          position: absolute; top: calc(100% + 10px); right: 0; min-width: 230px;
          background: var(--bg-surface); border: 1px solid var(--border-main);
          border-radius: 14px; box-shadow: var(--shadow-card);
          padding: 8px; z-index: 300; display: flex; flex-direction: column; gap: 2px;
        }
        .usermenu-identity {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px 12px;
        }
        .usermenu-identity-text {
          display: flex; flex-direction: column; gap: 2px; min-width: 0;
        }
        .usermenu-identity-name {
          font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 15px;
          color: var(--text-primary); letter-spacing: 0.5px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .usermenu-identity-email {
          font-size: 11px; color: var(--text-muted);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .usermenu-divider {
          height: 1px; background: var(--border-main); margin: 4px 0;
        }
        .usermenu-item {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px; border-radius: 8px;
          font-family: 'Oswald', sans-serif; font-weight: 500; font-size: 13px;
          letter-spacing: 1px; text-transform: uppercase;
          color: var(--text-secondary); text-decoration: none;
          background: none; border: none; width: 100%; cursor: pointer; text-align: left;
          transition: background 0.15s, color 0.15s;
        }
        .usermenu-item:hover { background: var(--bg-card-hover); color: var(--text-primary); }
        .usermenu-item--signout { color: #ef4444; }

        /* Dev-only rookie board editor link (localhost only) */
        .nav-admin-dev a { color: var(--edge-orange); }
        .nav-admin-dev a:hover { color: var(--edge-orange); opacity: 0.8; }
        .usermenu-item--signout:hover { background: rgba(239,68,68,0.08); color: #ef4444; }

        /* ── Hamburger + full-screen mobile menu (mobile only) ──────────────
           Modernized mobile header: logo + a single ☰ that opens a full-
           screen takeover (modeled on a Dynatyze reference the user shared)
           with big tap-target rows, a collapsible Rankings accordion, and
           Sign in / Join moved out of the top bar and into the panel. */
        .nav-hamburger { position: relative; display: none; }
        .nav-hamburger-btn {
          display: flex; align-items: center; justify-content: center;
          width: 36px; height: 36px; border-radius: 100px;
          background: none; border: 1px solid var(--border-main);
          color: var(--text-primary); cursor: pointer; transition: border-color 0.2s;
        }
        .nav-hamburger-btn:hover { border-color: var(--rt-primary); }
        .nav-mobile-panel {
          position: fixed; inset: 0; z-index: 300;
          background: var(--bg-body);
          display: flex; flex-direction: column;
          overflow-y: auto;
        }
        .nav-mobile-panel-header {
          flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
          padding: 18px 20px;
        }
        .nav-mobile-panel-close {
          display: flex; align-items: center; justify-content: center;
          width: 38px; height: 38px; border-radius: 50%;
          background: none; border: 1px solid var(--border-main);
          color: var(--text-primary); cursor: pointer;
        }
        .nav-mobile-panel-body {
          flex: 1 1 auto; display: flex; flex-direction: column;
          padding: 4px 20px 24px;
        }
        /* Stacked 3 classes deep (.nav-mobile-panel .nav-mobile-panel-body
           .nav-mobile-panel-row) so this reliably beats two sitewide rules
           that would otherwise hijack these <a>/<Link> rows: the base
           ".nav-links a" (1 class + 1 type) AND, in light theme specifically,
           '[data-theme="light"] .nav-links a' (2 classes + 1 type) which sets
           near-white text — invisible on this panel's white light-theme
           background if it wins. */
        .nav-mobile-panel .nav-mobile-panel-body .nav-mobile-panel-row {
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
          width: 100%; padding: 18px 0; border: none; border-bottom: 1px solid var(--border-main);
          background: none; text-align: left; cursor: pointer;
          font-family: var(--rt-font-sans); font-weight: 700; font-size: 19px;
          letter-spacing: normal; text-transform: none;
          color: var(--text-primary); text-decoration: none;
        }
        .nav-mobile-panel .nav-mobile-panel-body .nav-mobile-panel-row--signout { color: #ef4444; }
        .nav-mobile-panel-chevron { font-size: 14px; color: var(--text-muted); transition: transform 0.15s ease; }
        .nav-mobile-panel-chevron--open { transform: rotate(180deg); }
        .nav-mobile-panel-sub {
          display: flex; flex-direction: column;
          padding: 2px 0 14px; border-bottom: 1px solid var(--border-main);
        }
        .nav-mobile-panel .nav-mobile-panel-body .nav-mobile-panel-sub a {
          padding: 12px 0 12px 12px;
          font-family: var(--rt-font-sans); font-weight: 500; font-size: 16px;
          letter-spacing: normal; text-transform: none;
          color: var(--text-secondary); text-decoration: none;
        }
        .nav-mobile-panel-footer {
          flex: 0 0 auto; display: flex; gap: 12px;
          padding: 16px 20px calc(20px + env(safe-area-inset-bottom));
          border-top: 1px solid var(--border-main);
        }
        .nav-mobile-panel-signin, .nav-mobile-panel-join {
          flex: 1; height: 50px; border-radius: 100px;
          font-family: var(--rt-font-sans); font-weight: 700; font-size: 15px;
          cursor: pointer;
        }
        .nav-mobile-panel-signin { background: none; border: 1px solid var(--border-main); color: var(--text-primary); }
        .nav-mobile-panel-join { background: var(--rt-primary); border: none; color: #ffffff; }

        /* ── Mobile/tablet-portrait ──────────────────────────────────────────
           <=1023px (was <=767px): iPad portrait was showing the full inline
           link row here (Rankings dropdown, Arena, Join, etc.) crammed next
           to the brand — the same row that only really fits real desktop
           width. Matches PlatformSidebarNav's own <=1023px breakpoint (this
           IS its mobile fallback on 8+ pages — see platform-sidebar-nav.tsx)
           and team-rosters' AppSidebar-drawer breakpoint, so the hamburger
           pattern is now consistent everywhere it's used, not just on phone. */
        @media (max-width: 1023px) {
          .nav-links > li.nav-theme,
          .nav-links > li.nav-mobile-opposite-link,
          .nav-links > li.nav-rankings,
          .nav-links > li.nav-arena,
          .nav-links > li.nav-join { display: none !important; }
          .nav-hamburger { display: list-item; }
          .nav-links { gap: 10px; }
        }
      `}</style>
    </nav>
  );
}
