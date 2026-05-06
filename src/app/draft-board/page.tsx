"use client";
import { useState } from "react";
import { SiteNav } from "@/components/site-nav";

// ============================================================
// DRAFT BOARD DATA — UPDATE THIS ARRAY TO CHANGE THE BOARD
// Ratings pulled from dynasty_board_ratings_master.txt
// Last synced: April 7, 2026
// ============================================================
const DRAFT_BOARD = [
  { rank: 1, pick: "1.01", name: "Cameron Boozer", school: "Duke", pos: "F/C", tier: 1, age: 19, ht: '6\'10"',
    pts: "5★", reb: "5★", ast: "4★", stl: "4★", blk: "4★", fg: "5★", ft: "4★", tpm: "3★", to: "4★",
    verdict: "Safest dynasty pick in the 2026 class. Elite or positive across 7 of 9 categories. The size and feel project across all categories at NBA level. In category leagues, this profile wins championships." },
  { rank: 2, pick: "1.02", name: "Darryn Peterson", school: "Kansas", pos: "G", tier: 1, age: 19, ht: '6\'4"',
    pts: "5★", reb: "3★", ast: "3★", stl: "3★", blk: "3★", fg: "3★", ft: "3★", tpm: "4★", to: "3★",
    verdict: "PTS and 3PT are the category league weapons here. Only 22 games played — but scouts still have him top 3. The concern is availability. High risk, high reward at 1.03." },
  { rank: 3, pick: "1.03", name: "Caleb Wilson", school: "North Carolina", pos: "F", tier: 2, age: 20, ht: '6\'8"',
    pts: "4★", reb: "5★", ast: "3★", stl: "3★", blk: "3★", fg: "4★", ft: "3★", tpm: "2★", to: "3★",
    verdict: "REB elite, PTS and FG% positive. Season ended early — broken thumb. Expected to be cleared for predraft process. 3PT at 25.9% is the one concern. Dynasty gold if healthy." },
  { rank: 4, pick: "1.04", name: "Kingston Flemings", school: "Houston", pos: "G", tier: 2, age: 20, ht: '6\'3"',
    pts: "4★", reb: "1★", ast: "5★", stl: "4★", blk: "3★", fg: "4★", ft: "3★", tpm: "2★", to: "2★",
    verdict: "The most elite playmaking guard in the 2026 class. AST and STL are both elite — that combination at the NBA level is what winning rosters are built around. REB, 3PT and TO are the negatives." },
  { rank: 5, pick: "1.05", name: "AJ Dybantsa", school: "BYU", pos: "G/F", tier: 1, age: 18, ht: '6\'9"',
    pts: "5★", reb: "4★", ast: "4★", stl: "3★", blk: "3★", fg: "4★", ft: "3★", tpm: "3★", to: "2★",
    verdict: "Led the nation in scoring as a freshman — first since Trae Young in 2018. 6'9\" wing who draws fouls in bunches. PTS elite, FG% and REB positive. TO is the dynasty risk to manage." },
  { rank: 6, pick: "1.06", name: "Keaton Wagler", school: "Illinois", pos: "G", tier: 2, age: 20, ht: '6\'5"',
    pts: "5★", reb: "3★", ast: "4★", stl: "3★", blk: "2★", fg: "4★", ft: "4★", tpm: "5★", to: "4★",
    verdict: "A 9-cat dream guard. PTS, 3PM, AST, FG%, FT% all positive or elite. Lacks elite upside in defensive cats but fills 6-7 categories comfortably. Consensus Second Team All-American." },
  { rank: 7, pick: "1.07", name: "Aday Mara", school: "Michigan", pos: "C", tier: 2, age: 20, ht: '7\'3"',
    pts: "3★", reb: "3★", ast: "3★", stl: "3★", blk: "3★", fg: "3★", ft: "3★", tpm: "3★", to: "3★",
    verdict: "Prospect data coming soon." },
  { rank: 8, pick: "1.08", name: "Mikel Brown Jr.", school: "Louisville", pos: "G", tier: 2, age: 21, ht: '6\'5"',
    pts: "5★", reb: "2★", ast: "4★", stl: "3★", blk: "2★", fg: "2★", ft: "4★", tpm: "3★", to: "2★",
    verdict: "PTS elite — peak of 29.2 PPG in his last 5 healthy games. AST and FT% positive. REB, BLK, FG% and TO are the negatives. Lower back injury is the only reason he's not top 5. Predraft medicals are everything." },
  { rank: 9, pick: "1.09", name: "E. Okorie", school: "Stanford", pos: "G", tier: 4, age: 19, ht: '6\'2"',
    pts: "3★", reb: "3★", ast: "3★", stl: "3★", blk: "3★", fg: "3★", ft: "3★", tpm: "3★", to: "3★",
    verdict: "Prospect data coming soon." },
  { rank: 10, pick: "1.10", name: "Allen Graves", school: "SCU", pos: "G/F", tier: 3, age: 21, ht: '6\'5"',
    pts: "3★", reb: "3★", ast: "3★", stl: "3★", blk: "3★", fg: "3★", ft: "3★", tpm: "3★", to: "3★",
    verdict: "Prospect data coming soon." },
  { rank: 11, pick: "1.11", name: "Labaron Philon", school: "Alabama", pos: "G", tier: 2, age: 20, ht: '6\'3"',
    pts: "3★", reb: "3★", ast: "3★", stl: "3★", blk: "3★", fg: "3★", ft: "3★", tpm: "3★", to: "3★",
    verdict: "Prospect data coming soon." },
  { rank: 12, pick: "1.12", name: "Darius Acuff Jr.", school: "Arkansas", pos: "G", tier: 2, age: 20, ht: '6\'1"',
    pts: "5★", reb: "2★", ast: "5★", stl: "3★", blk: "2★", fg: "5★", ft: "4★", tpm: "5★", to: "3★",
    verdict: "SEC Player of the Year, Freshman of the Year, SEC Tournament MVP. Led the SEC in scoring and assists. Three elite categories (PTS, AST, FG%) with 3PM elite too. REB and BLK are the only drags." },
  { rank: 13, pick: "1.13", name: "Yaxel Lendeborg", school: "Michigan", pos: "G/F", tier: 3, age: 24, ht: '6\'7"',
    pts: "3★", reb: "4★", ast: "4★", stl: "4★", blk: "4★", fg: "4★", ft: "4★", tpm: "3★", to: "3★",
    verdict: "Six positives across REB, AST, STL, BLK, FG%, FT%. Elite dynasty profile — contributes across every category without a weakness. Big Ten POY. Consensus All-American. Age at 23 is the only dynasty tradeoff." },
  { rank: 14, pick: "1.14", name: "Hannes Steinbach", school: "Washington", pos: "F/C", tier: 3, age: 21, ht: '7\'1"' },
  { rank: 15, pick: "1.15", name: "Brayden Burries", school: "Arizona", pos: "G", tier: 3, age: 20, ht: '6\'4"',
    pts: "4★", reb: "3★", ast: "3★", stl: "4★", blk: "2★", fg: "4★", ft: "4★", tpm: "3★", to: "5★",
    verdict: "PTS, STL, FG%, FT% all positive — and TO is elite. The cleanest stat sheet in the 1.10s. BLK is the one drag. 3PM needs volume to become a real weapon. A safe, well-rounded pick at 1.11." },
  // === PICKS 13-30: BLURRED / GATED ===
  { rank: 16, pick: "1.16", name: "Dailyn Swain", school: "Texas", pos: "F", tier: 3, age: 20, ht: '6\'8"' },
  { rank: 17, pick: "1.17", name: "Bennett Stirtz", school: "Iowa", pos: "G", tier: 3, age: 22, ht: '6\'5"' },
  { rank: 18, pick: "1.18", name: "Cameron Carr", school: "Baylor", pos: "G", tier: 3, age: 21, ht: '6\'5"' },
  { rank: 19, pick: "1.19", name: "Jayden Quaintance", school: "Kentucky", pos: "C", tier: 3, age: 19, ht: '6\'9"' },
  { rank: 20, pick: "1.20", name: "Morez Johnson Jr.", school: "Michigan", pos: "F/C", tier: 3, age: 20, ht: '6\'9"',
    pts: "3★", reb: "3★", ast: "3★", stl: "3★", blk: "3★", fg: "3★", ft: "3★", tpm: "3★", to: "3★",
    verdict: "Prospect data coming soon." },
  { rank: 21, pick: "1.21", name: "Tyler Tanner", school: "Vanderbilt", pos: "G", tier: 4, age: 21, ht: '6\'4"' },
  { rank: 22, pick: "1.22", name: "Karim Lopez", school: "Maine", pos: "F", tier: 4, age: 20, ht: '6\'11"' },
  { rank: 23, pick: "1.23", name: "Nate Ament", school: "Tennessee", pos: "F", tier: 4, age: 21, ht: '6\'4"' },
  { rank: 24, pick: "1.24", name: "Zuby Ejiofor", school: "SJU", pos: "F/C", tier: 4, age: 20, ht: '6\'10"' },
  { rank: 25, pick: "1.25", name: "M. Thomas", school: "Arkansas", pos: "G", tier: 4, age: 19, ht: '6\'5"',
    pts: "3★", reb: "3★", ast: "3★", stl: "3★", blk: "3★", fg: "3★", ft: "3★", tpm: "3★", to: "3★",
    verdict: "Prospect data coming soon." },
  { rank: 26, pick: "1.26", name: "T. Reed Jr.", school: "UCONN", pos: "C", tier: 4, age: 22, ht: '6\'11"',
    pts: "3★", reb: "3★", ast: "3★", stl: "3★", blk: "3★", fg: "3★", ft: "3★", tpm: "3★", to: "3★",
    verdict: "Prospect data coming soon." },
  { rank: 27, pick: "1.27", name: "Christian Anderson Jr.", school: "Texas Tech", pos: "G", tier: 4, age: 21, ht: '6\'3"' },
  { rank: 28, pick: "1.28", name: "Koa Peat", school: "Arizona", pos: "F", tier: 4, age: 19, ht: '6\'8"' },
  { rank: 29, pick: "1.29", name: "Isaiah Evans", school: "Duke", pos: "G/F", tier: 4, age: 20, ht: '6\'11"' },
  { rank: 30, pick: "1.30", name: "Amari Allen", school: "Alabama", pos: "F", tier: 4, age: 21, ht: '7\'0"' },
];

const CATS = ["pts", "reb", "ast", "stl", "blk", "fg", "ft", "tpm", "to"] as const;
const CAT_LABELS: Record<string, string> = {
  pts: "PTS", reb: "REB", ast: "AST", stl: "STL", blk: "BLK", fg: "FG%", ft: "FT%", tpm: "3PM", to: "TO"
};

function starColor(star: string) {
  if (star === "5★") return "var(--green-elite)";
  if (star === "4★") return "var(--blueprint-glow)";
  if (star === "3★") return "var(--dynasty-gold)";
  if (star === "2★") return "var(--edge-orange)";
  return "var(--red-severe)";
}

function tierLabel(tier: number) {
  if (tier === 1) return { text: "TIER 1", cls: "tier-elite" };
  if (tier === 2) return { text: "TIER 2", cls: "tier-positive" };
  if (tier === 3) return { text: "TIER 3", cls: "tier-three" };
  return { text: "TIER 4", cls: "tier-four" };
}

function positionBadge(pos: string) {
  if (pos === "G") return <span className="db-pos-badge db-pos-badge-g">G</span>;
  if (pos === "F") return <span className="db-pos-badge db-pos-badge-f">F</span>;
  if (pos === "C") return <span className="db-pos-badge db-pos-badge-c">C</span>;
  if (pos === "G/F") {
    return (
      <span className="db-pos-badge db-pos-badge-split">
        <span className="db-pos-badge-split-l">G</span>
        <span className="db-pos-badge-split-r">F</span>
      </span>
    );
  }
  if (pos === "F/C") {
    return (
      <span className="db-pos-badge db-pos-badge-split">
        <span className="db-pos-badge-split-l">F</span>
        <span className="db-pos-badge-split-r db-pos-badge-split-r-gold">C</span>
      </span>
    );
  }
  return <span className="db-pos-badge db-pos-badge-g">{pos}</span>;
}

export default function DraftBoard() {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);

  const toggle = (rank: number) => {
    if (rank > 12) return;
    setExpanded(expanded === rank ? null : rank);
  };

  return (
    <div className="draft-board-shell">
      <SiteNav
        active="draft"
        joinFree={
          <a
            href="#"
            className="nav-cta"
            onClick={(e) => {
              e.preventDefault();
              setShowModal(true);
            }}
          >
            Join Free
          </a>
        }
      />

      <div className="db-hero">
        <div className="db-hero-bg-mark">DRAFT</div>
        <div className="db-hero-mobile-line">
          <span className="db-hero-mobile-main">ROOKIE DRAFT BOARD</span>
          <span className="db-hero-mobile-dot"> · </span>
          <span className="db-hero-mobile-meta">2026 NBA Draft · 9-Cat Dynasty</span>
        </div>
        <div className="db-hero-kicker">2026 NBA Draft · 9-Cat Dynasty</div>
        <h1 className="db-hero-title">Rookie <span>Draft Board</span></h1>
        <p className="db-hero-subtitle">
          Ranked by long-term 9-cat dynasty value. Top 12 free — full board for subscribers. Updated weekly during the off-season.
        </p>
      </div>

      <div className="db-board-wrap" style={{ padding: "40px 60px 100px", maxWidth: "900px", width: "100%", margin: "0 auto" }}>
        {DRAFT_BOARD.map((p) => {
          const isLocked = p.rank > 12;
          const isExpanded = expanded === p.rank;
          const tier = tierLabel(p.tier);
          const hasCard = !!(p as unknown as Record<string, string>).verdict;

          return (
            <div key={p.rank} style={{ position: "relative" }}>
              <div
                onClick={() => isLocked ? setShowModal(true) : hasCard ? toggle(p.rank) : null}
                className={`db-row ${isExpanded ? "db-row-expanded" : "db-row-collapsed"}`}
                style={{
                  background: isExpanded ? "var(--bg-card-hover)" : "var(--bg-card)",
                  cursor: isLocked || hasCard ? "pointer" : "default",
                  filter: isLocked ? "blur(4px)" : "none",
                  userSelect: isLocked ? "none" : "auto",
                  opacity: isLocked ? 0.5 : 1,
                }}
              >
                <div style={{
                  fontFamily: "'Oswald', sans-serif", fontWeight: 700,
                  fontSize: "28px", color: "var(--blueprint)",
                  minWidth: "44px", textAlign: "center"
                }}>{p.rank}</div>
                <div className="db-player-main">
                  <div className="db-player-name">{p.name}</div>
                  <div className="db-player-meta">
                    {positionBadge(p.pos)}
                    <span className="dbp-school">{p.school}</span>
                    {p.ht && <span className="db-player-meta-text db-player-meta-height">· {p.ht}</span>}
                  </div>
                </div>
                <div className="db-pick-tier">
                  <div className={`dbp-tier ${tier.cls}`}>
                    <span className="db-tier-full">{tier.text}</span>
                    <span className="db-tier-compact">T{p.tier}</span>
                  </div>
                </div>
                {!isLocked && hasCard && (
                  <div className="db-expand-arrow" style={{
                    transform: isExpanded ? "rotate(180deg)" : "rotate(0)"
                  }}>▼</div>
                )}
              </div>

              {isExpanded && !isLocked && hasCard && (
                <div className="db-expanded-panel" style={{ animation: "fadeUp 0.3s ease-out" }}>
                  <div style={{
                    fontFamily: "'Oswald', sans-serif", fontSize: "11px",
                    letterSpacing: "3px", textTransform: "uppercase",
                    color: "var(--edge-orange)", marginBottom: "16px"
                  }}>Category Ratings</div>
                  <div style={{
                    display: "grid", gridTemplateColumns: "repeat(9, 1fr)",
                    gap: "8px", marginBottom: "24px"
                  }}>
                    {CATS.map((cat) => {
                      const val = (p as unknown as Record<string, string>)[cat];
                      if (!val) return null;
                      return (
                        <div key={cat} style={{ textAlign: "center" }}>
                          <div style={{
                            fontFamily: "'Oswald', sans-serif", fontSize: "12px",
                            fontWeight: 600, letterSpacing: "1px",
                            color: "var(--text-muted)", marginBottom: "6px"
                          }}>{CAT_LABELS[cat]}</div>
                          <div style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: "13px", fontWeight: 700,
                            color: starColor(val),
                          }}>{val}</div>
                          <div style={{
                            height: "3px", borderRadius: "2px",
                            background: starColor(val),
                            marginTop: "6px", opacity: 0.6
                          }}></div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{
                    fontFamily: "'Oswald', sans-serif", fontSize: "11px",
                    letterSpacing: "3px", textTransform: "uppercase",
                    color: "var(--edge-orange)", marginBottom: "10px"
                  }}>Dynasty Verdict</div>
                  <p style={{
                    fontSize: "14px", color: "var(--text-secondary)",
                    lineHeight: 1.65
                  }}>{(p as unknown as Record<string, string>).verdict}</p>
                </div>
              )}
            </div>
          );
        })}

        <div style={{
          textAlign: "center", padding: "48px 24px",
          background: "var(--bg-card)",
          border: "1px solid var(--border-main)",
          borderRadius: "16px", marginTop: "16px"
        }}>
          <div style={{
            fontFamily: "'Oswald', sans-serif", fontWeight: 700,
            fontSize: "24px", textTransform: "uppercase",
            color: "var(--text-primary)", marginBottom: "8px"
          }}>Unlock the Full Board</div>
          <p style={{
            fontSize: "14px", color: "var(--text-secondary)",
            marginBottom: "24px"
          }}>Sign up free to see picks 13–30 with full category ratings and dynasty verdicts.</p>
          <button className="btn-hero" onClick={() => setShowModal(true)}>
            Get The Edge →
          </button>
        </div>
      </div>

      <footer>
        <div className="footer-brand">Fantasy Hoops <span className="accent">Edge</span></div>
        <div className="footer-links">
          <a href="/">Home</a>
          <a href="/draft-board">Draft Board</a>
          <a href="#">Prospect Lab</a>
          <a href="#">Predictions</a>
        </div>
        <div className="footer-social">
          <a href="#" title="X / Twitter">𝕏</a>
        </div>
      </footer>

      <div
        className={`modal-overlay ${showModal ? "active" : ""}`}
        onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
      >
        <div className="modal-box">
          <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
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
    </div>
  );
}
