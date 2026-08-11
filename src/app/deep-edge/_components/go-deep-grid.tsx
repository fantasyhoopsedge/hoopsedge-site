"use client";

import Link from "next/link";
import { IconChat, IconDollar, IconGear, IconLineChart, IconSliders, IconTarget, IconTrophy } from "./icons";

const CARDS: { index: string; title: string; description: string; href: string | null; icon: React.ReactNode }[] = [
  { index: "01", title: "Customise league settings", description: "Review what we imported and fine-tune scoring, roster and games caps.", href: "/deep-edge/home/settings", icon: <IconGear /> },
  { index: "02", title: "Category Edge", description: "Your best 7 vs every team's best 7, category by category.", href: "/deep-edge/home/category-edge", icon: <IconTarget /> },
  { index: "03", title: "Trade Edge", description: "Category-fit trade targets scored against your own roster.", href: null, icon: <IconSliders /> },
  { index: "04", title: "Waiver Edge", description: "The best available free agents, ranked for your league's format.", href: null, icon: <IconSliders /> },
  { index: "05", title: "Power Rankings", description: "Every team in your league, ranked by your league's scoring format.", href: "/deep-edge/home/rankings", icon: <IconTrophy /> },
  { index: "06", title: "Real Salary Rankings", description: "Cap-aware value rankings for salary leagues.", href: null, icon: <IconDollar /> },
  { index: "07", title: "Custom Projections", description: "Tune the projection model to your own assumptions.", href: null, icon: <IconLineChart /> },
  { index: "08", title: "AI Edge Assistant", description: "Ask questions about your league in plain English.", href: null, icon: <IconChat /> },
  { index: "09", title: "Custom Agent Alerts", description: "Get pinged when something in your league needs attention.", href: null, icon: <IconGear /> },
];

/** The 9-card "Go deep" grid — full opacity and clickable once a league is
 *  connected; dimmed and non-interactive before one is. Only Settings,
 *  Category Edge and Power Rankings are built out past the card this round.
 *  `leagueId` carries the currently-selected league through to each tool
 *  page via `?league=`, so with more than one saved league this grid always
 *  opens the one the user is actually looking at on Home, not just
 *  whichever the tool page would otherwise default to. */
export function GoDeepGrid({ unlocked, leagueId }: { unlocked: boolean; leagueId?: string }) {
  return (
    <div style={{ position: "relative" }}>
      {!unlocked && (
        <div
          style={{
            position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", zIndex: 1,
            padding: "6px 14px", borderRadius: 100, background: "var(--rt-surface-strong)",
            border: "1px solid var(--rt-hairline)", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
          }}
        >
          🔒 Add a league to unlock
        </div>
      )}
      <div
        style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16,
          opacity: unlocked ? 1 : 0.45, pointerEvents: unlocked ? "auto" : "none", marginTop: unlocked ? 0 : 20,
        }}
      >
        {CARDS.map((card) => {
          const clickable = unlocked && card.href;
          const body = (
            <div
              style={{
                height: "100%", padding: 20, borderRadius: 20, border: "1px solid var(--rt-hairline)",
                background: "var(--rt-canvas)", cursor: clickable ? "pointer" : "default",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div
                  style={{
                    width: 40, height: 40, borderRadius: "50%", background: "var(--rt-surface-soft)",
                    display: "flex", alignItems: "center", justifyContent: "center", color: "var(--rt-ink)",
                  }}
                >
                  {card.icon}
                </div>
                <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 11, color: "var(--rt-muted)" }}>{card.index}</span>
              </div>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 6px" }}>{card.title}</h3>
              <p style={{ fontSize: 12.5, color: "var(--rt-muted)", lineHeight: 1.4, margin: 0 }}>{card.description}</p>
            </div>
          );
          const href = leagueId ? `${card.href}?league=${encodeURIComponent(leagueId)}` : card.href;
          return clickable ? (
            <Link key={card.index} href={href!} style={{ textDecoration: "none", color: "inherit" }}>
              {body}
            </Link>
          ) : (
            <div key={card.index}>{body}</div>
          );
        })}
      </div>
    </div>
  );
}
