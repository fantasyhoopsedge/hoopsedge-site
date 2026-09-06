"use client";
import { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { DYNASTY_RANKINGS } from "@/lib/dynasty-rankings";
import { HomeNav } from "@/components/home/home-nav";
import { LaunchGateway } from "@/components/home/launch-gateway";
import { Button } from "@/components/home/button";
import { Badge } from "@/components/home/badge";
import { Card } from "@/components/home/card";
import { PlayerRow } from "@/components/home/player-row";
import { SearchPill } from "@/components/home/search-pill";

// Rounded for marketing copy — the live consensus board fluctuates in the
// low 400s as data refreshes, and "Top 450" is the number used across the
// feature copy and The Deep Edge landing page.
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
      {/* The two-door launch gateway, drawn OVER this page on desktop/tablet
          (phones never render it). Deliberately a sibling overlay rather than a
          route of its own: every word of the marketing page below stays in
          `/`'s HTML for crawlers, and the canonical URL never moves. See the
          component's header for the full reasoning. */}
      <LaunchGateway />

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

        {/* THE DEEP EDGE — deliberately NOT a sixth cell in the grid above.
            Everything in that grid is free and live; this is neither, so it
            sits apart with the accent border rather than reading as a peer.
            It is also the main way back for anyone the launch gateway or the
            waitlist confirmation dropped onto this page. */}
        <a href="/the-deep-edge" style={{ textDecoration: "none", display: "block", marginTop: 24 }}>
          <Card variant="product-dark" hover padding={32} style={{ border: "1px solid var(--rt-primary)" }}>
            <div className="home-deep-edge-row">
              <div>
                <Badge tone="dark" style={{ background: "rgba(250,70,22,0.16)", color: "var(--rt-primary)" }}>
                  Launching soon
                </Badge>
                <h3
                  style={{
                    fontFamily: "var(--rt-font-sans)",
                    fontSize: 22,
                    fontWeight: 600,
                    color: "var(--rt-on-dark)",
                    margin: "16px 0 8px",
                  }}
                >
                  The Deep Edge
                </h3>
                <p
                  style={{
                    fontFamily: "var(--rt-font-sans)",
                    fontSize: 15,
                    lineHeight: 1.5,
                    color: "var(--rt-on-dark-soft)",
                    margin: 0,
                    maxWidth: 620,
                  }}
                >
                  Connect your league and every ranking, trade tool and projection will re-score to your actual scoring
                  format, roster settings and category weights.
                </p>
              </div>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  flex: "0 0 auto",
                  height: 48,
                  padding: "0 24px",
                  borderRadius: 100,
                  background: "var(--rt-primary)",
                  color: "var(--rt-on-primary)",
                  fontFamily: "var(--rt-font-sans)",
                  fontSize: 15,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                Explore The Deep Edge
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              </span>
            </div>
          </Card>
        </a>
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
