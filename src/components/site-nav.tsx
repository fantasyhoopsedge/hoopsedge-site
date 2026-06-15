"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";

const STORAGE_KEY = "fhe-theme";

export function SiteNav(props: {
  active?: "rankings" | "draft";
  joinFree?: ReactNode;
  /** Compact single-line summary (e.g. dynasty rankings meta), shown left of Join CTA */
  infoStrip?: ReactNode;
  navClassName?: string;
}) {
  const { active, joinFree, infoStrip, navClassName } = props;
  const { user, openSignUp, signOut } = useAuth();
  const [theme, setTheme] = useState<"dark" | "light">("dark");

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
      <span style={{ display: "inline-flex", alignItems: "center", gap: "14px" }}>
        <button
          type="button"
          onClick={() => void signOut()}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: "13px",
            letterSpacing: "2px",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
          }}
        >
          Sign Out
        </button>
        <a href="/prediction-arena" className="nav-cta">
          My Arena
        </a>
      </span>
    ) : (
      <a
        href="#"
        className="nav-cta"
        onClick={(e) => {
          e.preventDefault();
          openSignUp("/prediction-arena");
        }}
      >
        Join Free
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
          <span className="nav-brand-full">
            Fantasy Hoops <span className="accent">Edge</span>
          </span>
          <span className="nav-brand-mobile">FHE</span>
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
            <li><a href="/dynasty-rankings">Dynasty Consensus</a></li>
            <li><a href="/draft-board">2026 Rookie Draft</a></li>
          </ul>
        </li>
        <li className="nav-arena">
          <a href="/prediction-arena">Predictions Arena</a>
        </li>
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
      </ul>
      <style>{`
        .nav-dropdown { position: relative; }
        .nav-dropdown-trigger {
          background: none; border: none; cursor: pointer; padding: 0;
          font-family: 'Oswald', sans-serif; font-weight: 500; font-size: 13px;
          letter-spacing: 2px; text-transform: uppercase; color: #ffffff;
          display: inline-flex; align-items: center; gap: 5px; transition: color 0.3s;
        }
        .nav-dropdown-trigger:hover { color: var(--edge-orange); }
        .nav-caret { font-size: 9px; }
        /* invisible hover bridge so the menu stays open crossing the gap */
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
        .nav-arena a { color: #ffffff; }
        .nav-arena a:hover { color: var(--edge-orange); }

        /* Mobile: show Rankings + Predictions Arena on every page; the Rankings
           dropdown already covers both ranking pages, so drop the redundant
           opposite-link and the theme toggle to keep the bar uncluttered. */
        @media (max-width: 767px) {
          .nav-links > li.nav-theme,
          .nav-links > li.nav-mobile-opposite-link { display: none !important; }
          .nav-links > li.nav-rankings,
          .nav-links > li.nav-arena { display: list-item !important; }
          .nav-links { gap: 12px; }
          .nav-dropdown-trigger, .nav-arena a { font-size: 12px; letter-spacing: 1px; }
          .nav-dropdown-menu { min-width: 190px; }
        }
      `}</style>
    </nav>
  );
}
