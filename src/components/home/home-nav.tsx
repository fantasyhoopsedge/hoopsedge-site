"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { BRAND_LOGO_HEIGHT } from "@/lib/brand";
import { SiteNav } from "@/components/site-nav";
import { Button } from "./button";

const LINKS = [
  { label: "Consensus rankings", href: "/dynasty-rankings" },
  { label: "Rookie board", href: "/draft-board" },
  { label: "Team rosters", href: "/team-rosters" },
  { label: "Player value", href: "/seasonal-rankings" },
  { label: "Arena", href: "/prediction-arena" },
];

export function HomeNav() {
  const { openSignUp } = useAuth();

  return (
    <>
    {/* Desktop: this page's own custom header. Mobile (<=767px) swaps to
        the same SiteNav hamburger + full-screen menu every other content
        page uses, instead of the old behavior of the nav links just
        vanishing with no mobile menu at all. data-theme="dark" locally
        overrides the homepage's forced-light marketing wrapper (see
        page.tsx) so this menu renders dark like every other page's,
        instead of inheriting the homepage's always-light styling. */}
    <div className="home-nav-mobile" data-theme="dark">
      <SiteNav />
    </div>
    <header
      className="home-nav-desktop"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        background: "var(--rt-surface-dark)",
      }}
    >
      <div
        style={{
          margin: "0 auto",
          maxWidth: 1200,
          height: 64,
          display: "flex",
          alignItems: "center",
          gap: 32,
          padding: "0 24px",
        }}
      >
        <Link href="/" style={{ display: "inline-flex", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- brand SVG lockup, no next/image config needed */}
          <img src="/brand/logo-wordmark-on-dark.svg" alt="Fantasy Hoops Edge" style={{ height: BRAND_LOGO_HEIGHT, width: "auto" }} />
        </Link>
        <div
          role="navigation"
          aria-label="Primary"
          className="home-nav-links"
          style={{ gap: 24, marginLeft: 8 }}
        >
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              style={{
                fontFamily: "var(--rt-font-sans)",
                fontSize: 14,
                fontWeight: 500,
                color: "var(--rt-on-dark)",
                textDecoration: "none",
                opacity: 0.9,
              }}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          <button
            type="button"
            className="home-nav-signin"
            onClick={() => openSignUp()}
            style={{
              fontFamily: "var(--rt-font-sans)",
              fontSize: 14,
              fontWeight: 500,
              color: "var(--rt-on-dark)",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            Sign in
          </button>
          <Button size="sm" onClick={() => openSignUp()}>
            Sign up
          </Button>
        </div>
      </div>
    </header>
    </>
  );
}
