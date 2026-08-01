"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import { BRAND_LOGO_HEIGHT } from "@/lib/brand";

// "profile" doesn't match any NAV_ITEMS key by design — the account/settings
// page isn't one of the main content sections, so nothing in the rail should
// highlight while it's active.
export type AppSidebarActiveKey = "cat-values" | "dynasty" | "real-salary" | "rookie-board" | "rosters" | "arena" | "ai-assistant" | "profile" | "board-editor" | "depth-chart" | "dynasty-board-editor";

type NavItem = {
  key: AppSidebarActiveKey;
  label: string;
  href: string | null;
  icon: ReactNode;
};

const NAV_ITEMS: NavItem[] = [
  {
    key: "cat-values",
    label: "Player Cat Values",
    href: "/seasonal-rankings",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h12" />
      </svg>
    ),
  },
  {
    key: "dynasty",
    label: "Dynasty Consensus",
    href: "/dynasty-rankings",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" /><path d="M7 14l3-3 3 3 5-5" />
      </svg>
    ),
  },
  {
    key: "real-salary",
    label: "Real Salary Rankings",
    href: "/real-salary-rankings",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" /><path d="M12 7v10" /><path d="M9 9.5c0-1.4 1.3-2.5 3-2.5s3 1.1 3 2.5-1.3 2-3 2-3 .8-3 2.5 1.3 2.5 3 2.5 3-1.1 3-2.5" />
      </svg>
    ),
  },
  {
    key: "rookie-board",
    label: "Rookie board",
    href: "/draft-board",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 2 7l10 5 10-5-10-5Z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    key: "rosters",
    label: "NBA Team Rosters",
    href: "/team-rosters",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    key: "arena",
    label: "Prediction Arena",
    href: "/prediction-arena",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" />
      </svg>
    ),
  },
  {
    key: "ai-assistant",
    label: "Edge AI Assistant",
    href: null, // coming soon — not wired up yet
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 3h5v5" /><path d="M21 3l-7 7" /><path d="M8 21H3v-5" /><path d="M3 21l7-7" />
      </svg>
    ),
  },
];

// Localhost/admin-only authoring tools, shown below the main nav. Depth Chart
// supersedes the old role-context "Tier Pass" editor (which never had its own
// sidebar entry) — the tier/injury/minutes judgment calls that used to live in
// role-context now happen here instead, so only this tool gets a link.
const ADMIN_TOOL_LINKS: Array<{ key: AppSidebarActiveKey; href: string; label: string; title: string; icon: ReactNode }> = [
  {
    key: "board-editor",
    href: "/admin/rookie-board",
    label: "Board Editor",
    title: "Rookie board editor (admins only)",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      </svg>
    ),
  },
  {
    key: "depth-chart",
    href: "/admin/depth-chart",
    label: "Depth Chart Adjuster",
    title: "Depth Chart Adjuster (admins only)",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19V10" /><path d="M12 19V5" /><path d="M20 19v-7" />
      </svg>
    ),
  },
  {
    key: "dynasty-board-editor",
    href: "/admin/dynasty-board",
    label: "Dynasty Board",
    title: "Dynasty Board editor (admins only)",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" />
        <path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" />
      </svg>
    ),
  },
];

function SidebarAvatar({ src, name, size = 32 }: { src: string | null; name: string; size?: number }) {
  const [imgOk, setImgOk] = useState(true);
  const letters = name.trim().slice(0, 2).toUpperCase();

  if (src && imgOk) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- small avatar, no next/image config needed here
      <img
        src={src}
        alt=""
        onError={() => setImgOk(false)}
        style={{
          width: size,
          height: size,
          minWidth: size,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <span
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: 999,
        background: "var(--rt-surface-strong)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.38),
        fontWeight: 600,
        color: "var(--rt-ink)",
        flexShrink: 0,
      }}
    >
      {letters || "?"}
    </span>
  );
}

export function AppSidebar({
  active,
  theme,
  onToggleTheme,
}: {
  active: AppSidebarActiveKey;
  theme: "light" | "dark";
  onToggleTheme: (next: "light" | "dark") => void;
}) {
  const { user, profile, openSignUp, signOut, supabase } = useAuth();
  const displayName = profile?.username ?? user?.email?.split("@")[0] ?? "Guest";

  // Show the rookie-board editor link to admins (and always on localhost) —
  // same check as site-nav.tsx's UserMenu / team-rosters-shell.tsx's mobile
  // menu, so this sidebar (the desktop nav on every rebranded page) has the
  // same admin-tool visibility those already have.
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
    <aside
      style={{
        width: 236,
        flex: "0 0 236px",
        height: "100%",
        borderRight: "1px solid var(--rt-hairline)",
        padding: "20px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <div style={{ padding: "8px 10px 22px" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- brand SVG lockup, no next/image config needed */}
          <img
            src={theme === "dark" ? "/brand/logo-wordmark-on-dark.svg" : "/brand/logo-wordmark.svg"}
            alt="Fantasy Hoops Edge"
            style={{ height: BRAND_LOGO_HEIGHT, width: "auto" }}
          />
        </Link>
      </div>

      {NAV_ITEMS.map((item) => {
        const isActive = item.key === active;
        const row = (
          <div
            className={item.href ? "rt-hover-surface" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 12px",
              borderRadius: 10,
              background: isActive ? "var(--rt-surface-strong)" : "transparent",
              color: isActive ? "var(--rt-primary)" : "var(--rt-body)",
              fontSize: 14,
              fontWeight: isActive ? 600 : 500,
              cursor: item.href ? "pointer" : "default",
            }}
          >
            {item.icon}
            <span style={{ whiteSpace: "nowrap" }}>{item.label}</span>
            {!item.href ? (
              <span
                style={{
                  marginLeft: "auto",
                  padding: "2px 7px",
                  borderRadius: 999,
                  background: "var(--rt-surface-strong)",
                  color: "var(--rt-muted)",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                Soon
              </span>
            ) : null}
          </div>
        );
        return item.href ? (
          <Link key={item.key} href={item.href} style={{ textDecoration: "none" }}>
            {row}
          </Link>
        ) : (
          <div key={item.key}>{row}</div>
        );
      })}

      {showBoardEditor && ADMIN_TOOL_LINKS.map((link) => {
        const isActive = link.key === active;
        return (
          <Link key={link.key} href={link.href} style={{ textDecoration: "none" }} title={link.title}>
            <div
              className="rt-hover-surface"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 10,
                background: isActive ? "var(--rt-surface-strong)" : "transparent",
                color: "var(--rt-primary)",
                fontSize: 14,
                fontWeight: isActive ? 600 : 500,
                cursor: "pointer",
              }}
            >
              {link.icon}
              <span style={{ whiteSpace: "nowrap" }}>{link.label}</span>
            </div>
          </Link>
        );
      })}

      <div style={{ marginTop: "auto", padding: "8px 6px 0" }}>
        <a
          href="https://x.com/FantasyHoopEdge"
          target="_blank"
          rel="noopener noreferrer"
          className="rt-hover-surface"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 12px",
            marginBottom: 6,
            borderRadius: 10,
            color: "var(--rt-body)",
            fontSize: 14,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          <span style={{ fontSize: 15, width: 18, textAlign: "center", lineHeight: 1 }} aria-hidden>𝕏</span>
          <span style={{ whiteSpace: "nowrap" }}>Follow on X</span>
        </a>
        <div style={{ display: "flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
          <button
            type="button"
            onClick={() => onToggleTheme("light")}
            style={{
              flex: 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              height: 32,
              border: "none",
              cursor: "pointer",
              borderRadius: 999,
              background: theme === "light" ? "var(--rt-raised)" : "transparent",
              color: theme === "light" ? "var(--rt-ink)" : "var(--rt-muted)",
              fontFamily: "var(--rt-font-sans)",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" />
              <path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" />
              <path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
            </svg>
            Light
          </button>
          <button
            type="button"
            onClick={() => onToggleTheme("dark")}
            style={{
              flex: 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              height: 32,
              border: "none",
              cursor: "pointer",
              borderRadius: 999,
              background: theme === "dark" ? "var(--rt-raised)" : "transparent",
              color: theme === "dark" ? "var(--rt-ink)" : "var(--rt-muted)",
              fontFamily: "var(--rt-font-sans)",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
            Dark
          </button>
        </div>
      </div>

      <div
        style={{
          borderTop: "1px solid var(--rt-hairline-soft)",
          marginTop: 12,
          paddingTop: 10,
          paddingLeft: 6,
          paddingRight: 6,
          paddingBottom: 6,
        }}
      >
        {user ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Link
              href="/profile"
              className="rt-hover-surface"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "6px 6px",
                borderRadius: 10,
                textDecoration: "none",
                flex: 1,
                minWidth: 0,
              }}
            >
              <SidebarAvatar src={profile?.avatar_url ?? null} name={displayName} size={32} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--rt-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {displayName}
                </div>
                <div style={{ fontSize: 11, color: "var(--rt-muted)" }}>View profile</div>
              </div>
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              aria-label="Sign out"
              title="Sign out"
              className="rt-hover-surface"
              style={{
                flex: "0 0 auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                border: "none",
                background: "none",
                borderRadius: 10,
                color: "var(--rt-muted)",
                cursor: "pointer",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => openSignUp()}
            style={{
              width: "100%",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              height: 38,
              border: "none",
              cursor: "pointer",
              borderRadius: 10,
              background: "var(--rt-primary)",
              color: "var(--rt-on-primary)",
              fontFamily: "var(--rt-font-sans)",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            Sign up / Log in
          </button>
        )}
      </div>
    </aside>
  );
}
