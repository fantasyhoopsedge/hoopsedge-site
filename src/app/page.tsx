"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteNav } from "@/components/site-nav";
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
  const [modalOpen, setModalOpen] = useState(false);

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
      <SiteNav
        navClassName="home-nav"
        joinFree={
          <a
            href="#"
            className="nav-cta"
            onClick={(e) => {
              e.preventDefault();
              setModalOpen(true);
            }}
          >
            Join Free
          </a>
        }
      />

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
          <button className="btn-hero" onClick={() => setModalOpen(true)}>
            Get The Edge →
          </button>
          <div className="hero-links">
            <a href="/dynasty-rankings">View Rankings →</a>
            <a href="/draft-board">2026 Draft Board →</a>
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
          <div className="feature-card">
            <div className="feature-icon fi-gold">⚡</div>
            <h3>The Edge AI</h3>
            <p>Ask anything — trade advice, punt strategy, rookie comps. All grounded in 9-cat data and deep-league context. Your 24/7 dynasty advisor.</p>
            <span className="feature-tag tag-soon">Coming Soon</span>
          </div>
          <div className="feature-card">
            <div className="feature-icon fi-green">🎯</div>
            <h3>Predictions Arena</h3>
            <p>Compete against other dynasty managers with player predictions. Build your track record, climb the leaderboard, play for stakes.</p>
            <span className="feature-tag tag-soon">Coming Soon</span>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <h2>Get The <span>Edge</span>.</h2>
        <p className="cta-desc">
          Free dynasty rankings, rookie draft boards, and AI-powered analysis. Built for managers who take dynasty seriously.
        </p>
        <div className="cta-email">
          <button className="btn-cta-orange" onClick={() => setModalOpen(true)}>
            Get The Edge →
          </button>
        </div>
        <p className="cta-note">No spam. Dynasty content only. Unsubscribe anytime.</p>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="footer-brand">
          Fantasy Hoops <span className="accent">Edge</span>
        </div>
        <div className="footer-links">
          <a href="/dynasty-rankings">Rankings</a>
          <a href="/draft-board">Draft Board</a>
        </div>
        <div className="footer-social">
          <a href="#" title="X / Twitter">𝕏</a>
        </div>
      </footer>

      {/* SIGN UP MODAL */}
      <div
        className={`modal-overlay ${modalOpen ? "active" : ""}`}
        onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}
      >
        <div className="modal-box">
          <button className="modal-close" onClick={() => setModalOpen(false)}>✕</button>
          <div className="modal-title">Get The Edge</div>
          <p className="modal-sub">Free dynasty rankings, rookie boards, and AI-powered advice.</p>
          <button className="modal-google">
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Sign up with Google
          </button>
          <div className="modal-divider">
            <div className="modal-divider-line"></div>
            <span>or</span>
            <div className="modal-divider-line"></div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <input type="email" placeholder="Email address" className="modal-input" />
            <input type="password" placeholder="Create password" className="modal-input" />
            <button className="modal-submit">Sign Up Free</button>
          </div>
          <p className="modal-footer">
            Already have an account? <a href="#">Log in</a>
          </p>
        </div>
      </div>
    </>
  );
}
