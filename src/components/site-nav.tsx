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
  const { user, openSignUp } = useAuth();
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
      <a href="/prediction-arena" className="nav-cta">
        My Arena
      </a>
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
        <li>
          <a href="/dynasty-rankings" style={active === "rankings" ? { color: "var(--edge-orange)" } : { color: "#ffffff" }}>
            <span className="nav-dynasty-rankings-full">CONSENSUS DYNASTY RANKINGS</span>
            <span className="nav-dynasty-rankings-short">DYNASTY RANKINGS</span>
          </a>
        </li>
        <li>
          <a href="/draft-board" style={active === "draft" ? { color: "var(--edge-orange)" } : { color: "#ffffff" }}>
            ROOKIE DRAFT BOARD
          </a>
        </li>
        <li>
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
        <li>{join}</li>
      </ul>
    </nav>
  );
}
