import type { Metadata } from "next";
import Link from "next/link";
import { PlatformSidebarNav } from "@/components/platform-sidebar-nav";
import { FOUNDING_DISCOUNT_PCT, FOUNDING_PRICE_USD, SEASON_PASS_USD } from "@/lib/deep-edge/waitlist";

/**
 * Public announcement/landing page for The Deep Edge — genuinely indexable
 * and signed-out-visible, unlike `/deep-edge` itself which stays behind
 * `src/lib/deep-edge/guard.ts`'s admin gate until the real entitlement ships.
 * Mirrors `/prediction-arena`'s pattern: a first-class, nav-linked page that
 * anyone can land on. This page carries no auth branching of its own (same
 * content for every visitor) — the gate lives entirely on `/deep-edge`'s side.
 *
 * Both CTAs point at `/deep-edge/launching-soon` rather than `/deep-edge`,
 * because `/deep-edge` branches on the admin allowlist and would drop an
 * admin straight into the tool. Pre-launch, every click-through from this
 * page should land on the founding-price offer, whoever is clicking.
 *
 * Card copy/order is kept in sync with the real "Go deep" grid
 * (`src/app/deep-edge/_components/go-deep-grid.tsx`). The three "coming soon"
 * cards that used to sit alongside these (Custom Projections, AI Edge
 * Assistant, Custom Agent Alerts) were removed 2026-09-06 — there is no
 * intent to build them yet, and advertising unbuilt tools on the page that
 * sells a season pass is a promise this product can't keep.
 */
export const metadata: Metadata = {
  title: "The Deep Edge · Fantasy Hoops Edge",
  description:
    "Connect your Fantrax league and get every FHE ranking, trade tool and projection tuned to your league's real scoring and roster settings. Founding season pass now open.",
};

const BUILT_CARDS: { title: string; description: string }[] = [
  { title: "Power Rankings", description: "Every team in your league, ranked by your league's scoring format." },
  { title: "Roster Edge", description: "Your full roster, real per-game stats, salary and dynasty context in one table." },
  { title: "Category Edge", description: "Your best 7 vs every team's best 7, category by category." },
  { title: "Trade Edge", description: "Simulate a trade and see the real before/after — standing, category impact, asset value." },
  { title: "Waiver Edge", description: "The best available free agents, ranked for your league's format." },
  { title: "League Rankings", description: "Every player, free agent and pick — custom, dynasty, real-salary and redraft rankings side by side." },
];

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div
      style={{
        height: "100%",
        padding: 20,
        borderRadius: 20,
        border: "1px solid var(--rt-hairline)",
        background: "var(--rt-canvas)",
      }}
    >
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 6px", color: "var(--rt-ink)" }}>{title}</h3>
      <p style={{ fontSize: 12.5, color: "var(--rt-muted)", lineHeight: 1.4, margin: 0 }}>{description}</p>
    </div>
  );
}

export default function TheDeepEdgeLandingPage() {
  return (
    <main style={{ display: "flex", minHeight: "100vh", background: "var(--rt-canvas)", color: "var(--rt-ink)" }}>
      <PlatformSidebarNav active="deep-edge-landing" />

      <div style={{ flex: 1, padding: "56px 24px 96px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: "100%", maxWidth: 920, textAlign: "center" }}>
          <span
            style={{
              display: "inline-block", padding: "6px 16px", borderRadius: 100,
              background: "var(--rt-surface-soft)", border: "1px solid var(--rt-hairline)",
              fontFamily: "var(--rt-font-mono)", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
              color: "var(--rt-muted)", textTransform: "uppercase", marginBottom: 24,
            }}
          >
            Introducing The Deep Edge
          </span>

          <h1 style={{ fontSize: "clamp(36px, 5.5vw, 58px)", fontWeight: 700, lineHeight: 1.08, margin: 0 }}>
            Go deep on your dynasty.
          </h1>
          <p style={{ marginTop: 18, fontSize: 17, color: "var(--rt-body)", maxWidth: 620, marginLeft: "auto", marginRight: "auto" }}>
            Connect your real Fantrax league and every FHE ranking, trade tool and projection re-scores itself
            to your league&apos;s actual scoring format, roster settings and category weights — not a generic
            9-cat board.
          </p>

          <div style={{ display: "flex", gap: 14, marginTop: 34, justifyContent: "center", flexWrap: "wrap" }}>
            <Link
              href="/deep-edge/launching-soon"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center", height: 46, padding: "0 26px",
                borderRadius: 100, background: "var(--rt-primary)", color: "#fff", fontWeight: 700, fontSize: 15,
                textDecoration: "none",
              }}
            >
              Open The Deep Edge
            </Link>
            <a
              href="mailto:fantasybballai@gmail.com?subject=The%20Deep%20Edge%20early%20access"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center", height: 46, padding: "0 26px",
                borderRadius: 100, background: "transparent", color: "var(--rt-ink)", fontWeight: 700, fontSize: 15,
                border: "1px solid var(--rt-hairline)", textDecoration: "none",
              }}
            >
              Ask about early access
            </a>
          </div>
          <p style={{ marginTop: 16, color: "var(--rt-muted)", fontSize: 12.5 }}>
            Opening soon — register now and the founding discount is locked to your account.
          </p>
        </div>

        {/*
          Forced-dark band. `color` MUST be set explicitly here: --rt-surface-dark-elevated
          is dark in BOTH themes, but --rt-ink follows the theme, so inheriting it painted
          near-black text (#0c0d0e) on a near-black panel (#17181b) in light mode — about
          1.05:1 contrast, i.e. invisible. Any forced-dark surface on a theme-following page
          has to pair with --rt-on-dark / --rt-on-dark-soft, the way home/card.tsx's
          "product-dark" variant already does.
        */}
        <div
          style={{
            width: "100%", maxWidth: 920, marginTop: 56, padding: 28, borderRadius: 24,
            background: "var(--rt-surface-dark-elevated)", border: "1px solid var(--rt-primary)",
            color: "var(--rt-on-dark)",
            display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between",
          }}
        >
          <div style={{ maxWidth: 600 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px", color: "var(--rt-on-dark)" }}>
              US${SEASON_PASS_USD} for the season
            </h2>
            <p style={{ color: "var(--rt-on-dark-soft)", fontSize: 14.5, lineHeight: 1.55, margin: 0 }}>
              A season pass, not a subscription — one payment covers you through to the end of the season.
              Register while the founding price is open and {FOUNDING_DISCOUNT_PCT}% comes off your first
              one, bringing it to <strong style={{ color: "var(--rt-on-dark)", fontWeight: 700 }}>US${FOUNDING_PRICE_USD}</strong>.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12 }}>
            <span
              style={{
                display: "inline-block", padding: "6px 16px", borderRadius: 100,
                background: "rgba(250,70,22,0.16)", color: "var(--rt-primary)",
                fontFamily: "var(--rt-font-mono)", fontSize: 11.5, fontWeight: 700, letterSpacing: "0.04em",
                whiteSpace: "nowrap",
              }}
            >
              {FOUNDING_DISCOUNT_PCT}% OFF · LIMITED TIME
            </span>
            <Link
              href="/deep-edge/launching-soon"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center", height: 44, padding: "0 22px",
                borderRadius: 100, background: "var(--rt-primary)", color: "#fff", fontWeight: 700, fontSize: 14.5,
                textDecoration: "none", whiteSpace: "nowrap",
              }}
            >
              Claim {FOUNDING_DISCOUNT_PCT}% off
            </Link>
          </div>
        </div>

        <div style={{ width: "100%", maxWidth: 920, marginTop: 56 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px", textAlign: "left" }}>What&apos;s inside</h2>
          <p style={{ color: "var(--rt-muted)", fontSize: 13.5, margin: "0 0 22px", textAlign: "left" }}>
            Six tools, ready at launch.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
            {BUILT_CARDS.map((card) => (
              <FeatureCard key={card.title} {...card} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
