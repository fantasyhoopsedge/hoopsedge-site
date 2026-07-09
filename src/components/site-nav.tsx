"use client";

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
}) {
  const { active, joinFree, infoStrip, navClassName } = props;
  const { user, profile, openSignUp, signOut, supabase } = useAuth();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) setMobileMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [mobileMenuOpen]);

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
            src="/brand/logo-wordmark-on-dark.svg"
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
            <div className="nav-mobile-panel" role="menu">
              <a href="/seasonal-rankings" className="nav-mobile-panel-item" onClick={() => setMobileMenuOpen(false)}>
                Player Category Values
              </a>
              <a href="/dynasty-rankings" className="nav-mobile-panel-item" onClick={() => setMobileMenuOpen(false)}>
                Dynasty Consensus
              </a>
              <a href="/draft-board" className="nav-mobile-panel-item" onClick={() => setMobileMenuOpen(false)}>
                2026 Rookie Draft
              </a>
              <a href="/prediction-arena" className="nav-mobile-panel-item" onClick={() => setMobileMenuOpen(false)}>
                Arena
              </a>
              {showBoardEditor && (
                <a href="/admin/rookie-board" className="nav-mobile-panel-item" onClick={() => setMobileMenuOpen(false)}>
                  ✎ Board Editor
                </a>
              )}
              <div className="nav-mobile-panel-divider" />
              <button
                type="button"
                className="nav-mobile-panel-item nav-mobile-panel-theme"
                onClick={() => {
                  toggleTheme();
                  setMobileMenuOpen(false);
                }}
              >
                {theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              </button>
            </div>
          )}
        </li>
      </ul>
      <style>{`
        /* ── Rankings dropdown ───────────────────────────────────────────── */
        .nav-dropdown { position: relative; }
        .nav-dropdown-trigger {
          background: none; border: none; cursor: pointer; padding: 0;
          font-family: 'Oswald', sans-serif; font-weight: 500; font-size: 13px;
          letter-spacing: 2px; text-transform: uppercase; color: #ffffff;
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
        /* Light mode: render dropdown links in the navy used by the nav bar.
           High specificity so it wins over the faded/mobile .nav-links a rules. */
        [data-theme="light"] .nav-links li.nav-dropdown .nav-dropdown-menu a,
        [data-theme="light"] .nav-links li.nav-dropdown .nav-dropdown-menu a:hover { color: #0a1230; }
        .nav-arena a { color: #ffffff; }
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

        /* ── Hamburger + mobile dropdown panel (mobile only) ────────────────
           Modernized mobile header: logo, one CTA pill, and a single ☰ that
           collapses Rankings/Arena/Board-Editor/Theme into one panel, instead
           of cramming those in as separate inline nav items. */
        .nav-hamburger { position: relative; display: none; }
        .nav-hamburger-btn {
          display: flex; align-items: center; justify-content: center;
          width: 36px; height: 36px; border-radius: 100px;
          background: none; border: 1px solid var(--border-main);
          color: var(--text-primary); cursor: pointer; transition: border-color 0.2s;
        }
        .nav-hamburger-btn:hover { border-color: var(--rt-primary); }
        .nav-mobile-panel {
          position: absolute; top: calc(100% + 12px); right: 0; min-width: 220px;
          background: var(--bg-surface); border: 1px solid var(--border-main);
          border-radius: 14px; box-shadow: var(--shadow-card);
          padding: 8px; display: flex; flex-direction: column; gap: 2px; z-index: 250;
        }
        .nav-mobile-panel-item {
          display: block; width: 100%; text-align: left;
          padding: 11px 14px; border-radius: 8px;
          font-family: var(--rt-font-sans); font-weight: 500; font-size: 14px;
          color: var(--text-secondary); text-decoration: none;
          background: none; border: none; cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }
        .nav-mobile-panel-item:hover { background: var(--bg-card-hover); color: var(--text-primary); }
        .nav-mobile-panel-divider { height: 1px; background: var(--border-main); margin: 4px 0; }
        .nav-mobile-panel-theme { color: var(--rt-primary); }

        /* ── Mobile ──────────────────────────────────────────────────────── */
        @media (max-width: 767px) {
          .nav-links > li.nav-theme,
          .nav-links > li.nav-mobile-opposite-link,
          .nav-links > li.nav-rankings,
          .nav-links > li.nav-arena { display: none !important; }
          .nav-hamburger { display: list-item; }
          .nav-links { gap: 10px; }
          /* On mobile, just show avatar circle, hide name text */
          .usermenu-name, .usermenu-caret { display: none; }
          .usermenu-trigger { padding: 3px 3px; border-color: transparent; }
          .usermenu-dropdown { right: 0; min-width: 200px; }
        }
      `}</style>
    </nav>
  );
}
