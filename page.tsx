"use client";
import { useState, useEffect } from "react";

const TICKER_PLAYERS = [
  { rank: 1, name: "Nikola Jokic" }, { rank: 2, name: "Luka Doncic" },
  { rank: 3, name: "Victor Wembanyama" }, { rank: 4, name: "Anthony Davis" },
  { rank: 5, name: "Anthony Edwards" }, { rank: 6, name: "Giannis Antetokounmpo" },
  { rank: 7, name: "Shai Gilgeous-Alexander" }, { rank: 8, name: "Chet Holmgren" },
  { rank: 9, name: "Tyrese Haliburton" }, { rank: 10, name: "Jayson Tatum" },
  { rank: 11, name: "Kevin Durant" }, { rank: 12, name: "LaMelo Ball" },
  { rank: 13, name: "Scottie Barnes" }, { rank: 14, name: "Domantas Sabonis" },
  { rank: 15, name: "Evan Mobley" }, { rank: 16, name: "Donovan Mitchell" },
  { rank: 17, name: "De'Aaron Fox" }, { rank: 18, name: "Alperen Sengun" },
  { rank: 19, name: "Paolo Banchero" }, { rank: 20, name: "Trae Young" },
  { rank: 21, name: "Jalen Brunson" }, { rank: 22, name: "Karl-Anthony Towns" },
  { rank: 23, name: "Devin Booker" }, { rank: 24, name: "Jaren Jackson Jr." },
  { rank: 25, name: "Joel Embiid" }, { rank: 26, name: "Cade Cunningham" },
  { rank: 27, name: "Ja Morant" }, { rank: 28, name: "Kawhi Leonard" },
  { rank: 29, name: "Damian Lillard" }, { rank: 30, name: "Jalen Williams" },
];

const DRAFT_BOARD = [
  { rank: 1, name: "Cameron Boozer", school: "DUK", pos: "F/C", tier: "elite" },
  { rank: 2, name: "AJ Dybantsa", school: "BYU", pos: "W", tier: "elite" },
  { rank: 3, name: "Darryn Peterson", school: "KAN", pos: "G", tier: "elite" },
  { rank: 4, name: "Caleb Wilson", school: "UNC", pos: "W", tier: "positive" },
  { rank: 5, name: "Kingston Flemings", school: "HOU", pos: "G", tier: "positive" },
];

export default function Home() {
  const [modalOpen, setModalOpen] = useState(false);
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    const saved = localStorage.getItem("fhe-theme");
    if (saved) {
      setTheme(saved);
      document.documentElement.setAttribute("data-theme", saved);
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("fhe-theme", next);
  };

  const tickerItems = [...TICKER_PLAYERS, ...TICKER_PLAYERS.slice(0, 15)];

  return (
    <>
      {/* NAV */}
      <nav>
        <div className="nav-brand">
          Fantasy Hoops <span className="accent">Edge</span>
        </div>
        <ul className="nav-links">
          <li><a href="#">Rankings</a></li>
          <li><a href="#">Draft Board</a></li>
          <li><a href="#">Prospect Lab</a></li>
          <li><a href="#">Predictions</a></li>
          <li>
            <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
          </li>
          <li>
            <a href="#" className="nav-cta" onClick={(e) => { e.preventDefault(); setModalOpen(true); }}>
              Join Free
            </a>
          </li>
        </ul>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="hero-content">
          <div className="hero-badge">
            <span className="dot"></span>
            2026 Dynasty Rankings Live
          </div>
          <h1>
            Dynasty Edge.<br />
            <span className="line2">Built for Category Leagues.</span><br />
            <span className="line3">Built for Deep Leagues.</span>
          </h1>
          <p className="hero-sub">
            Dynasty rankings, rookie draft boards, and prospect analysis for serious{" "}
            <strong>dynasty managers</strong>.
          </p>
          <button className="btn-hero" onClick={() => setModalOpen(true)}>
            Get The Edge →
          </button>
          <div className="hero-note">Free dynasty rankings and rookie boards.</div>
          <div className="hero-links">
            <a href="#">View Rankings →</a>
            <a href="#">2026 Draft Board →</a>
          </div>
        </div>

        {/* DRAFT BOARD PREVIEW */}
        <div className="hero-visual">
          <div className="draft-board-preview">
            <div className="dbp-header">
              <div className="dbp-header-top">2026 NBA Draft</div>
              <h3>Rookie <span>Draft Board</span></h3>
              <div className="dbp-subtext">9-Cat Dynasty Value Rankings</div>
            </div>
            <div className="dbp-list">
              {DRAFT_BOARD.map((p) => (
                <div className="dbp-row" key={p.rank}>
                  <div className="dbp-rank">{p.rank}</div>
                  <div className="dbp-info">
                    <div className="dbp-name">{p.name}</div>
                    <div className="dbp-meta">
                      <span className="dbp-school">{p.school}</span>
                      <span className="dbp-pos">{p.pos}</span>
                    </div>
                  </div>
                  <div className={`dbp-tier tier-${p.tier}`}>
                    {p.tier === "elite" ? "TIER 1" : "TIER 2"}
                  </div>
                </div>
              ))}
            </div>
            <div className="dbp-footer">
              <a href="#">View Full Board (Top 100) →</a>
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
                <span className="ticker-rank">#{p.rank}</span>
                <span className="ticker-label">{p.name}</span>
              </div>
              <div className="ticker-divider"></div>
            </span>
          ))}
        </div>
      </div>

      {/* FEATURES */}
      <section style={{ padding: "100px 60px" }}>
        <div className="section-label">What You Get</div>
        <h2 className="section-title">Built Different.<br />Built for Dynasty.</h2>
        <p className="section-desc">
          AI-powered advice. Predictions Arena where you can test your fantasy knowledge against other players.
        </p>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon fi-blue">📊</div>
            <h3>Dynasty Rankings</h3>
            <p>Live 9-cat dynasty rankings updated nightly from real box-score data. Filter by position, category strength, and league depth.</p>
            <span className="feature-tag tag-live">Updated Nightly</span>
          </div>
          <div className="feature-card">
            <div className="feature-icon fi-orange">🏀</div>
            <h3>Rookie Draft Board</h3>
            <p>Top 12 dynasty rookie board free for all. Full top 100 board with category ratings and stat translations for subscribers.</p>
            <span className="feature-tag tag-new">Top 12 Free</span>
          </div>
          <div className="feature-card">
            <div className="feature-icon fi-gold">⚡</div>
            <h3>The Edge AI</h3>
            <p>Ask anything — trade advice, punt strategy, rookie comps. All grounded in 9-cat data and deep-league context. Your 24/7 dynasty advisor.</p>
            <span className="feature-tag tag-new">AI-Powered</span>
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
          <a href="#">Rankings</a>
          <a href="#">Draft Board</a>
          <a href="#">Prospect Lab</a>
          <a href="#">Predictions</a>
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
