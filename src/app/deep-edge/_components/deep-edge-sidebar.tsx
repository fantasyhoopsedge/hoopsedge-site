"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { readFantraxSession } from "../_lib/fantrax-session";
import { useSavedLeagues } from "../_lib/use-saved-leagues";
import { IconBell, IconChat, IconChevronDown, IconHome, IconLineChart, IconList } from "./icons";

/**
 * Deep Edge's own sidebar — distinct from both AppSidebar (the main site
 * rail) and admin/fantrax/_shell.tsx's FantraxShell. Matches the design's
 * Home/My leagues/Rankings/Edge assistant/Alerts nav + connected-platforms
 * list + Return to main site footer.
 *
 * Only the active league renders under "My leagues" — with 15+ leagues
 * connected, listing every one permanently was the actual bug report, not a
 * design choice. Clicking that row opens a floating dropdown of every saved
 * league to switch to; whichever matches the current page's `?league=` id
 * (falling back to the first) is what's shown/highlighted, and picking
 * another carries you to the SAME tool page for that league rather than
 * bouncing back to Home. Safe to call useSearchParams() unwrapped here —
 * every caller of HubShell (the only place this renders) already sits
 * inside a <Suspense> boundary.
 */
export function DeepEdgeSidebar({ hasLeague }: { hasLeague: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fantraxConnected = readFantraxSession().connected;
  const { leagues } = useSavedLeagues();
  const activeLeagueId = searchParams.get("league") ?? leagues[0]?.leagueId ?? null;
  const activeLeague = leagues.find((l) => l.leagueId === activeLeagueId) ?? null;

  const [leagueMenuOpen, setLeagueMenuOpen] = useState(false);
  const leagueMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (leagueMenuRef.current && !leagueMenuRef.current.contains(e.target as Node)) setLeagueMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  // "Edge assistant"/"Alerts" have no dedicated screen in this round — they
  // route to Home like Home itself, but only the item whose label matches
  // the current section highlights (never more than one).
  const NAV = [
    { label: "Home", href: "/deep-edge/home", icon: <IconHome size={18} />, activeWhen: pathname === "/deep-edge/home" },
    { label: "My leagues", href: "/deep-edge/home", icon: <IconList size={18} />, activeWhen: false },
  ];
  const NAV2 = [
    { label: "Rankings", href: hasLeague ? "/deep-edge/home/rankings" : "/deep-edge/home", icon: <IconLineChart size={18} />, activeWhen: pathname === "/deep-edge/home/rankings" },
    { label: "Edge assistant", href: "/deep-edge/home", icon: <IconChat size={18} />, activeWhen: false },
    { label: "Alerts", href: "/deep-edge/home", icon: <IconBell size={18} />, activeWhen: false },
  ];

  return (
    <aside
      style={{
        width: 236, flexShrink: 0, height: "100%", display: "flex", flexDirection: "column",
        borderRight: "1px solid var(--rt-hairline)", padding: "20px 16px", background: "var(--rt-canvas)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px", marginBottom: 24 }}>
        <span
          style={{
            width: 24, height: 24, borderRadius: 7, background: "var(--rt-primary)", color: "#fff",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--rt-font-mono)", fontWeight: 700, fontSize: 12,
          }}
        >
          F
        </span>
        <span style={{ fontWeight: 700, fontSize: 13.5 }}>
          THE DEEP <span style={{ color: "var(--rt-primary)" }}>EDGE</span>
        </span>
      </div>

      {/* A bare <nav> collides with globals.css's sitewide `nav { position: fixed }`
          rule (built for SiteNav) — a <div role="navigation"> sidesteps it entirely
          rather than fighting specificity. */}
      <div role="navigation" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV.map((item) => {
          const active = item.activeWhen;
          return (
            <Link
              key={item.label}
              href={item.href}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 10,
                fontSize: 13.5, fontWeight: active ? 700 : 500, textDecoration: "none",
                color: active ? "var(--rt-ink)" : "var(--rt-body)",
                background: active ? "var(--rt-surface-soft)" : "transparent",
              }}
            >
              {item.icon} {item.label}
            </Link>
          );
        })}

        {activeLeague && (
          <div ref={leagueMenuRef} style={{ position: "relative", padding: "0 0 0 24px" }}>
            <button
              type="button"
              onClick={() => setLeagueMenuOpen((v) => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 10px", borderRadius: 10,
                border: "none", fontSize: 13, fontWeight: 700, textAlign: "left", cursor: "pointer",
                color: "var(--rt-ink)", background: leagueMenuOpen ? "var(--rt-surface-soft)" : "transparent",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--rt-primary)", flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeLeague.leagueName}</span>
              <span style={{ flexShrink: 0, color: "var(--rt-muted)", transform: leagueMenuOpen ? "rotate(180deg)" : "none" }}>
                <IconChevronDown size={14} />
              </span>
            </button>

            {leagueMenuOpen && leagues.length > 1 && (
              <div
                style={{
                  position: "absolute", top: "100%", left: 10, right: 10, marginTop: 4, zIndex: 30,
                  maxHeight: 320, overflowY: "auto", background: "var(--rt-canvas)", border: "1px solid var(--rt-hairline)",
                  borderRadius: 12, boxShadow: "0 12px 28px rgba(0,0,0,0.16)", padding: 4,
                }}
              >
                {leagues.map((l) => {
                  const active = l.leagueId === activeLeagueId;
                  return (
                    <Link
                      key={l.leagueId}
                      href={`${pathname}?league=${encodeURIComponent(l.leagueId)}`}
                      onClick={() => setLeagueMenuOpen(false)}
                      style={{
                        display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 8,
                        fontSize: 13, fontWeight: active ? 700 : 500, textDecoration: "none",
                        color: active ? "var(--rt-ink)" : "var(--rt-body)",
                        background: active ? "var(--rt-surface-soft)" : "transparent",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--rt-primary)", flexShrink: 0 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{l.leagueName}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {NAV2.map((item) => {
          const active = item.activeWhen;
          return (
            <Link
              key={item.label}
              href={item.href}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 10,
                fontSize: 13.5, fontWeight: active ? 700 : 500, textDecoration: "none",
                color: active ? "var(--rt-ink)" : "var(--rt-body)",
                background: active ? "var(--rt-surface-soft)" : "transparent",
              }}
            >
              {item.icon} {item.label}
            </Link>
          );
        })}
      </div>

      <div style={{ marginTop: 28, fontFamily: "var(--rt-font-mono)", fontSize: 10.5, letterSpacing: "0.06em", color: "var(--rt-muted)", padding: "0 10px" }}>
        CONNECTED
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
        <span
          style={{
            width: 22, height: 22, borderRadius: 6, background: "#0c0d0e", color: "#fff",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--rt-font-mono)", fontWeight: 700, fontSize: 10,
          }}
        >
          Fx
        </span>
        <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>Fantrax</span>
        <span
          style={{
            width: 7, height: 7, borderRadius: "50%",
            background: fantraxConnected ? "var(--rt-up)" : "var(--rt-hairline)",
          }}
        />
      </div>
      <Link
        href="/deep-edge/providers"
        style={{ padding: "8px 10px", fontSize: 12.5, fontWeight: 600, color: "var(--rt-primary)", textDecoration: "none" }}
      >
        + Connect more
      </Link>

      <div style={{ flex: 1 }} />

      <Link
        href="/"
        style={{ padding: "10px", fontSize: 12.5, color: "var(--rt-muted)", textDecoration: "none", borderTop: "1px solid var(--rt-hairline)" }}
      >
        → Return to main site
      </Link>
    </aside>
  );
}
