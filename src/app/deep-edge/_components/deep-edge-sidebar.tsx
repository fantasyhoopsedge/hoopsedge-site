"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { readFantraxSession } from "../_lib/fantrax-session";
import { IconBell, IconChat, IconHome, IconLineChart, IconList } from "./icons";

/**
 * Deep Edge's own sidebar — distinct from both AppSidebar (the main site
 * rail) and admin/fantrax/_shell.tsx's FantraxShell. Matches the design's
 * Home/My leagues/Rankings/Edge assistant/Alerts nav + connected-platforms
 * list + Return to main site footer.
 */
export function DeepEdgeSidebar({ hasLeague }: { hasLeague: boolean }) {
  const pathname = usePathname();
  const fantraxConnected = readFantraxSession().connected;

  // "My leagues"/"Edge assistant"/"Alerts" have no dedicated screen in this
  // round — they route to Home like Home itself, but only the item whose
  // label matches the current section highlights (never more than one).
  const NAV = [
    { label: "Home", href: "/deep-edge/home", icon: <IconHome size={18} />, activeWhen: pathname === "/deep-edge/home" },
    { label: "My leagues", href: "/deep-edge/home", icon: <IconList size={18} />, activeWhen: false },
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
