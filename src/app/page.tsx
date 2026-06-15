"use client";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { SiteNav } from "@/components/site-nav";
import { useAuth } from "@/context/AuthContext";
import { DYNASTY_RANKINGS, type DynastyPlayer } from "@/lib/dynasty-rankings";

function tierColor(tier: number): string {
  if (tier === 1) return "var(--dynasty-gold)";
  if (tier === 2) return "var(--green-elite)";
  if (tier === 3) return "var(--blueprint-glow)";
  if (tier === 4) return "#9b5de5";
  if (tier === 5) return "var(--edge-orange)";
  return "#f72585";
}

type DraftBoardPanelRow = Pick<
  DynastyPlayer,
  "consensusRank" | "player" | "team" | "position" | "tier"
>;

const ROOKIE_DRAFT_BOARD_TOP5: DraftBoardPanelRow[] = [
  { consensusRank: 1, player: "Cameron Boozer", team: "Duke", position: "F/C", tier: 1 },
  { consensusRank: 2, player: "Darryn Peterson", team: "Kansas", position: "G", tier: 2 },
  { consensusRank: 3, player: "AJ Dybantsa", team: "BYU", position: "G/F", tier: 2 },
  { consensusRank: 4, player: "Caleb Wilson", team: "North Carolina", position: "F", tier: 2 },
  { consensusRank: 5, player: "Kingston Flemings", team: "Houston", position: "G", tier: 3 },
];

export default function Home() {
  const router = useRouter();
  const { openSignUp } = useAuth();

  const { tickerTop30, panelTop10 } = useMemo(() => {
    const sorted = [...DYNASTY_RANKINGS].sort((a, b) => a.consensusRank - b.consensusRank);
    return {
      tickerTop30: sorted.slice(0, 30),
      panelTop10: [...ROOKIE_DRAFT_BOARD_TOP5, ...sorted.slice(5, 10)],
    };
  }, []);

  const tickerItems = [...tickerTop30, ...tickerTop30];

  return (
    <>
      <SiteNav navClassName="home-nav" />

      {/* HERO */}
      <section className="hero">
        <div className="hero-content">
          <h1>
            Fantasy Hoops Edge.<br />
            <span className="line2">Built Different.</span><br />
            <span className="line3">Built for Dynasty.</span>
          </h1>
          <p className="hero-sub">
            Dynasty rankings, rookie draft boards, and prospect analysis for serious{" "}
            <strong>dynasty managers</strong>.
          </p>
          <button className="btn-hero" onClick={() => openSignUp("/prediction-arena")}>
            Get The Edge →
          </button>
          <div className="hero-links">
            <a href="/dynasty-rankings" style={{
              fontSize: "13px", fontWeight: 700, letterSpacing: "1.5px",
              color: "rgba(255,255,255,0.9)", border: "1px solid rgba(255,255,255,0.28)",
              padding: "10px 20px", borderRadius: "8px",
              textDecoration: "none", whiteSpace: "nowrap",
            }}>View Consensus Dynasty Rankings →</a>
            <a href="/draft-board" style={{
              fontSize: "13px", fontWeight: 700, letterSpacing: "1.5px",
              color: "var(--edge-orange)", border: "1px solid var(--edge-orange)",
              padding: "10px 20px", borderRadius: "8px",
              textDecoration: "none", whiteSpace: "nowrap",
            }}>View Rookie Draft Board →</a>
          </div>
        </div>

        {/* DRAFT BOARD PREVIEW */}
        <div className="hero-visual">
          <div
            className="draft-board-preview"
            onClick={() => router.push("/draft-board")}
            style={{ cursor: "pointer" }}
          >
            <div className="dbp-header">
              <div className="dbp-header-top">2026 NBA Draft</div>
              <h3>Rookie <span>Draft Board</span></h3>
              <div className="dbp-subtext">9-Cat Dynasty Value Rankings</div>
            </div>
            <div className="dbp-list">
              {panelTop10.map((p) => (
                <div className="dbp-row" key={p.consensusRank}>
                  <div className="dbp-rank" style={{ color: tierColor(p.tier) }}>{p.consensusRank}</div>
                  <div className="dbp-info">
                    <div className="dbp-name">{p.player}</div>
                    <div className="dbp-meta">
                      <span className="dbp-school">{p.team}</span>
                      <span className="dbp-pos">{p.position}</span>
                    </div>
                  </div>
                  <div
                    className="dbp-tier"
                    style={{ color: tierColor(p.tier), borderColor: `${tierColor(p.tier)}60` }}
                  >
                    TIER {p.tier}
                  </div>
                </div>
              ))}
            </div>
            <div className="dbp-footer">
              <a href="/draft-board" onClick={(e) => e.stopPropagation()}>View Full Board (Top 100) →</a>
            </div>
          </div>
        </div>
      </section>

      {/* TICKER */}
      <div className="ticker-bar">
        <div className="ticker-track">
          {tickerItems.map((p, i) => (
            <span key={i} style={{ display: "contents" }}>
              <div className="ticker-item">
                <span className="ticker-rank">#{p.consensusRank}</span>
                <span className="ticker-label">{p.player}</span>
              </div>
              <div className="ticker-divider"></div>
            </span>
          ))}
        </div>
      </div>

      {/* FEATURES */}
      <section style={{ padding: "100px 60px" }}>
        <div className="features-grid">
          <a className="feature-card feature-card-link" href="/dynasty-rankings">
            <div className="feature-icon fi-blue">📊</div>
            <h3>Dynasty Rankings</h3>
            <p>Live 9-cat dynasty rankings updated nightly from real box-score data. Filter by position, category strength, and league depth.</p>
          </a>
          <a className="feature-card feature-card-link" href="/draft-board">
            <div className="feature-icon fi-orange">🏀</div>
            <h3>Rookie Draft Board</h3>
            <p>Top 12 dynasty rookie board free for all. Full top 100 board with category ratings and stat translations for subscribers.</p>
          </a>
          <a className="feature-card feature-card-link" href="/prediction-arena">
            <div className="feature-icon fi-green">🎯</div>
            <h3>Prediction Arena</h3>
            <p>Play the Draft Night Challenge — four fast mini-games on the 2026 NBA Draft. Lock your picks, climb the leaderboard, and grab your &ldquo;Called It&rdquo; card.</p>
            <span className="feature-tag tag-live">Live Now</span>
          </a>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <h2>Get The <span>Edge</span>.</h2>
        <p className="cta-desc">
          Free dynasty rankings, rookie draft boards, and AI-powered analysis. Built for managers who take dynasty seriously.
        </p>
        <div className="cta-email">
          <button className="btn-cta-orange" onClick={() => openSignUp("/prediction-arena")}>
            Get The Edge →
          </button>
        </div>
        <p className="cta-note">No spam. Dynasty content only. Unsubscribe anytime.</p>
      </section>

    </>
  );
}
