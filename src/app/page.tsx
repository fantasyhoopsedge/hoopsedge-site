"use client";
import { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { DYNASTY_RANKINGS } from "@/lib/dynasty-rankings";
import { HomeNav } from "@/components/home/home-nav";
import { Button } from "@/components/home/button";
import { Badge } from "@/components/home/badge";
import { Card } from "@/components/home/card";
import { PlayerRow } from "@/components/home/player-row";
import { SearchPill } from "@/components/home/search-pill";

// Rounded for marketing copy — the live consensus board fluctuates in the
// low 400s as data refreshes; the Pricing section already promises "Top 450".
const RANKED_PLAYER_COUNT = 450;

const FEATURES = [
  {
    tag: "Dynasty rankings",
    title: "Expert consensus",
    body: "Partnered with the best industry experts to produce a consensus ranking — so you know where the average is, with no bias.",
    href: "/dynasty-rankings",
    wide: false,
  },
  {
    tag: "Rookie board",
    title: "Draft with conviction",
    body: "A rookie draft board with statistical ratings — know who, what, and where to draft them.",
    href: "/draft-board",
    wide: false,
  },
  {
    tag: "Player value rankings",
    title: "See them early",
    body: "Track your favourite players' category fantasy value — standard 9-cat, 8-cat and Minus 1 value. Stay ahead of the game.",
    href: "/seasonal-rankings",
    wide: false,
  },
  {
    tag: "NBA team rosters",
    title: "Know every player",
    body: "All 30 NBA rosters with real NBA salary and contract data — track risers and fallers and see exactly who you're trading for.",
    href: "/team-rosters",
    wide: false,
  },
  {
    tag: "Real salary rankings",
    title: "Built for cap leagues",
    body: "Dynasty consensus adjusted for cap efficiency — cheap, productive contracts move up, expensive ones settle back down. Made for real-salary leagues.",
    href: "/real-salary-rankings",
    wide: true,
  },
];

const PRICING_TIERS = [
  {
    name: "Standard",
    price: "Free",
    cap: "/forever",
    featured: false,
    features: [
      "Top 450 consensus dynasty rankings",
      "Player category value / ranking",
      "Rookie draft board",
      "NBA team rosters",
    ],
  },
  {
    name: "Edge",
    price: "$8",
    cap: "/month",
    featured: true,
    features: ["Fantasy projections", "Create your own dynasty rankings", "AI Edge assistant", "League sync"],
  },
];

function CheckIcon({ dark }: { dark: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={dark ? "var(--rt-on-dark)" : "var(--rt-primary)"}
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: "0 0 16px", marginTop: 3 }}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default function Home() {
  const { openSignUp } = useAuth();

  const { heroRows, previewRows } = useMemo(() => {
    const sorted = [...DYNASTY_RANKINGS].sort((a, b) => a.consensusRank - b.consensusRank);
    return { heroRows: sorted.slice(0, 4), previewRows: sorted.slice(0, 6) };
  }, []);

  return (
    // Marketing site is a fixed light-canvas/dark-hero brand rotation (see design
    // handoff), not the app's toggleable dark-mode default — pin it here so
    // --rt-* tokens resolve to their light-theme values regardless of the
    // visitor's site-wide theme preference.
    <div data-theme="light" style={{ background: "var(--rt-canvas)" }}>
      {/* HERO — dark, floating dashboard cards */}
      <section style={{ background: "var(--rt-surface-dark)", overflow: "hidden" }}>
        <HomeNav />
        <div className="home-hero-grid">
          <div>
            <Badge tone="dark" style={{ marginBottom: 24 }}>
              Dynasty intelligence
            </Badge>
            <h1
              style={{
                fontFamily: "var(--rt-font-sans)",
                fontWeight: 400,
                fontSize: 56,
                lineHeight: 1,
                letterSpacing: "-1.4px",
                color: "var(--rt-on-dark)",
                margin: "0 0 20px",
                maxWidth: 520,
              }}
            >
              Win your dynasty league before tip-off.
            </h1>
            <p
              style={{
                fontFamily: "var(--rt-font-sans)",
                fontSize: 18,
                lineHeight: 1.5,
                color: "var(--rt-on-dark-soft)",
                margin: "0 0 32px",
                maxWidth: 460,
              }}
            >
              Tiered dynasty rankings, rookie draft board, standard player category values,
              fantasy projections, AI fantasy advice and player trend analysis - kept current
              all season, and built for managers who play to win.
            </p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <Button size="lg" onClick={() => openSignUp("/prediction-arena")}>
                Start your edge
              </Button>
              <Button variant="outline-on-dark" size="lg" href="/dynasty-rankings">
                See the rankings
              </Button>
            </div>
          </div>

          <div className="home-hero-visual" style={{ position: "relative", minHeight: 380 }}>
            <Card variant="product-dark" padding={24} style={{ position: "relative", zIndex: 2, transform: "rotate(-1.5deg)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontFamily: "var(--rt-font-sans)", fontWeight: 600, fontSize: 15, color: "var(--rt-on-dark)" }}>
                  Top {RANKED_PLAYER_COUNT} · Dynasty
                </span>
                <Badge tone="dark">Avg. Rank</Badge>
              </div>
              <div>
                {heroRows.map((p) => (
                  <PlayerRow
                    key={p.consensusRank}
                    rank={p.consensusRank}
                    name={p.player}
                    team={p.team}
                    position={p.position}
                    tier={p.tier}
                    avgRank={p.avgRank}
                    isRookie={p.isRookie}
                    dark
                  />
                ))}
              </div>
            </Card>
            <Card
              variant="product-dark"
              padding={20}
              style={{
                position: "absolute",
                right: -18,
                bottom: -28,
                width: 210,
                zIndex: 3,
                transform: "rotate(3deg)",
                boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
              }}
            >
              <span style={{ fontFamily: "var(--rt-font-sans)", fontSize: 12, color: "var(--rt-on-dark-soft)" }}>
                Consensus dynasty board
              </span>
              <div
                style={{
                  fontFamily: "var(--rt-font-mono)",
                  fontSize: 34,
                  color: "var(--rt-on-dark)",
                  letterSpacing: "-1px",
                  margin: "4px 0 2px",
                }}
              >
                {RANKED_PLAYER_COUNT}
              </div>
              <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 15, color: "var(--rt-up)" }}>
                players ranked monthly
              </span>
            </Card>
          </div>
        </div>
      </section>

      {/* FEATURES — white band */}
      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "96px 24px 48px" }}>
        <h2
          style={{
            fontFamily: "var(--rt-font-sans)",
            fontWeight: 400,
            fontSize: 40,
            lineHeight: 1.1,
            letterSpacing: "-0.8px",
            color: "var(--rt-ink)",
            margin: "0 0 12px",
            maxWidth: 640,
          }}
        >
          Everything a dynasty manager needs in one place.
        </h2>
        <p style={{ fontFamily: "var(--rt-font-sans)", fontSize: 18, color: "var(--rt-body)", margin: "0 0 48px", maxWidth: 520 }}>
          The tools we wished existed when we were grinding our own leagues.
        </p>
        <div className="home-features-grid">
          {FEATURES.map((f) => (
            <a
              key={f.tag}
              href={f.href}
              style={{ textDecoration: "none", display: "block", gridColumn: f.wide ? "1 / -1" : undefined }}
            >
              <Card variant="feature" hover style={{ height: "100%" }}>
                <Badge tone="brand">{f.tag}</Badge>
                <h3
                  style={{
                    fontFamily: "var(--rt-font-sans)",
                    fontSize: 18,
                    fontWeight: 600,
                    color: "var(--rt-ink)",
                    margin: "16px 0 8px",
                  }}
                >
                  {f.title}
                </h3>
                <p style={{ fontFamily: "var(--rt-font-sans)", fontSize: 15, lineHeight: 1.5, color: "var(--rt-body)", margin: 0 }}>
                  {f.body}
                </p>
              </Card>
            </a>
          ))}
        </div>
      </section>

      {/* RANKINGS PREVIEW — soft band */}
      <section style={{ background: "var(--rt-surface-soft)" }}>
        <div className="home-rankings-grid">
          <div>
            <Badge>Consensus dynasty rankings</Badge>
            <h2
              style={{
                fontFamily: "var(--rt-font-sans)",
                fontWeight: 400,
                fontSize: 32,
                lineHeight: 1.13,
                letterSpacing: "-0.4px",
                color: "var(--rt-ink)",
                margin: "18px 0 14px",
              }}
            >
              Player value, tracked like a market.
            </h2>
            <p style={{ fontFamily: "var(--rt-font-sans)", fontSize: 17, lineHeight: 1.5, color: "var(--rt-body)", margin: "0 0 28px" }}>
              Your favourite dynasty analyst rankings are combined into a consensus, tracking a
              player&apos;s market value over time. Track risers and fallers in dynasty with an edge.
            </p>
            <Button href="/dynasty-rankings">Browse all {RANKED_PLAYER_COUNT}</Button>
          </div>
          <Card variant="product-light" padding={24}>
            <SearchPill />
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
              <Badge>Avg. Rank</Badge>
            </div>
            {previewRows.map((p) => (
              <PlayerRow
                key={p.consensusRank}
                rank={p.consensusRank}
                name={p.player}
                team={p.team}
                position={p.position}
                tier={p.tier}
                avgRank={p.avgRank}
                isRookie={p.isRookie}
              />
            ))}
          </Card>
        </div>
      </section>

      {/* PRICING */}
      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "96px 24px" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <h2
            style={{
              fontFamily: "var(--rt-font-sans)",
              fontWeight: 400,
              fontSize: 40,
              lineHeight: 1.1,
              letterSpacing: "-0.8px",
              color: "var(--rt-ink)",
              margin: "0 0 12px",
            }}
          >
            Pick your edge.
          </h2>
          <p style={{ fontFamily: "var(--rt-font-sans)", fontSize: 18, color: "var(--rt-body)", margin: 0 }}>
            Start free. Upgrade when your league gets serious.
          </p>
        </div>
        <div className="home-pricing-grid">
          {PRICING_TIERS.map((t) => {
            const dark = t.featured;
            return (
              <Card key={t.name} variant={dark ? "product-dark" : "feature"} padding={32}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                  <span style={{ fontFamily: "var(--rt-font-sans)", fontSize: 18, fontWeight: 600, color: dark ? "var(--rt-on-dark)" : "var(--rt-ink)" }}>
                    {t.name}
                  </span>
                  {dark ? <Badge tone="dark">Most popular</Badge> : null}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 24 }}>
                  <span
                    style={{
                      fontFamily: "var(--rt-font-mono)",
                      fontSize: 44,
                      letterSpacing: "-1.5px",
                      color: dark ? "var(--rt-on-dark)" : "var(--rt-ink)",
                    }}
                  >
                    {t.price}
                  </span>
                  <span style={{ fontFamily: "var(--rt-font-sans)", fontSize: 15, color: dark ? "var(--rt-on-dark-soft)" : "var(--rt-muted)" }}>
                    {t.cap}
                  </span>
                </div>
                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 28px", display: "flex", flexDirection: "column", gap: 12 }}>
                  {t.features.map((f) => (
                    <li
                      key={f}
                      style={{
                        display: "flex",
                        gap: 10,
                        fontFamily: "var(--rt-font-sans)",
                        fontSize: 15,
                        lineHeight: 1.4,
                        color: dark ? "var(--rt-on-dark)" : "var(--rt-body)",
                      }}
                    >
                      <CheckIcon dark={dark} />
                      {f}
                    </li>
                  ))}
                </ul>
                {t.price === "Free" ? (
                  <Button
                    variant={dark ? "primary" : "secondary-light"}
                    style={{ width: "100%" }}
                    onClick={() => openSignUp()}
                  >
                    Get started
                  </Button>
                ) : (
                  <Button variant={dark ? "primary" : "secondary-light"} style={{ width: "100%" }} disabled>
                    Coming soon
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      {/* CTA band — dark, closes the page above the shared site footer */}
      <section style={{ background: "var(--rt-surface-dark)" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "96px 24px", textAlign: "center" }}>
          <h2
            style={{
              fontFamily: "var(--rt-font-sans)",
              fontWeight: 400,
              fontSize: 40,
              lineHeight: 1.1,
              letterSpacing: "-0.8px",
              color: "var(--rt-on-dark)",
              margin: "0 0 16px",
            }}
          >
            Take control of your dynasty.
          </h2>
          <p style={{ fontFamily: "var(--rt-font-sans)", fontSize: 18, color: "var(--rt-on-dark-soft)", margin: "0 0 32px" }}>
            Join the managers raising the standard of play in their leagues.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <Button size="lg" onClick={() => openSignUp("/prediction-arena")}>
              Start your edge
            </Button>
            <Button variant="outline-on-dark" size="lg" href="/contact">
              Contact us
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
