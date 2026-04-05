"use client";
import { useState } from "react";

// ============================================================
// DRAFT BOARD DATA — UPDATE THIS ARRAY TO CHANGE THE BOARD
// Move, add, or remove players here. UI updates automatically.
// Category ratings: 5★ elite, 4★ positive, 3★ neutral, 2★ negative, 1★ severe
// ============================================================
const DRAFT_BOARD = [
  {
    rank: 1, pick: "1.01", name: "Cameron Boozer", school: "DUK", pos: "W/F", tier: 1, age: 19, ht: '6\'10"',
    pts: "3★", reb: "4★", ast: "3★", stl: "3★", blk: "4★", fg: "5★", ft: "4★", tpm: "3★", to: "3★",
    verdict: "Elite FG% floor with multi-category upside. The safest prospect in the class — a 9-cat cornerstone who contributes everywhere without hurting you."
  },
  {
    rank: 2, pick: "1.02", name: "AJ Dybantsa", school: "BYU", pos: "W/F", tier: 1, age: 18, ht: '6\'9"',
    pts: "5★", reb: "3★", ast: "3★", stl: "3★", blk: "2★", fg: "3★", ft: "4★", tpm: "4★", to: "3★",
    verdict: "Volume scorer with elite 3PM upside. Ceiling is the highest in the class but comes with FG% variance. Dynasty managers who need points and threes should target aggressively."
  },
  {
    rank: 3, pick: "1.03", name: "Darryn Peterson", school: "KAN", pos: "G/W", tier: 1, age: 19, ht: '6\'4"',
    pts: "4★", reb: "3★", ast: "4★", stl: "4★", blk: "2★", fg: "4★", ft: "4★", tpm: "3★", to: "3★",
    verdict: "Complete guard profile with elite steal upside. Positive in four categories with no glaring weakness. The kind of guard who anchors your build for a decade."
  },
  {
    rank: 4, pick: "1.04", name: "Caleb Wilson", school: "UNC", pos: "W/F", tier: 2, age: 20, ht: '6\'8"',
    pts: "4★", reb: "3★", ast: "4★", stl: "3★", blk: "2★", fg: "4★", ft: "4★", tpm: "3★", to: "3★",
    verdict: "Versatile wing with strong efficiency metrics. Contributes across the board without dominating any single category — the ultimate roster glue piece in deep leagues."
  },
  {
    rank: 5, pick: "1.05", name: "Kingston Flemings", school: "HOU", pos: "G", tier: 2, age: 20, ht: '6\'3"',
    pts: "4★", reb: "2★", ast: "4★", stl: "4★", blk: "2★", fg: "3★", ft: "4★", tpm: "4★", to: "3★",
    verdict: "Elite steal and assist combo guard. The 3PM volume is real and the FT% is bankable. A three-category winner at the guard position."
  },
  {
    rank: 6, pick: "1.06", name: "Keaton Wagler", school: "ILL", pos: "G", tier: 2, age: 20, ht: '6\'5"',
    pts: "4★", reb: "3★", ast: "3★", stl: "3★", blk: "2★", fg: "4★", ft: "5★", tpm: "4★", to: "4★",
    verdict: "Elite FT% with strong 3PM and efficiency. Low turnover profile makes him a safe floor play. Won't lose you categories — the kind of guard you build around in 9-cat."
  },
  {
    rank: 7, pick: "1.07", name: "Mikel Brown Jr.", school: "LOU", pos: "G", tier: 2, age: 21, ht: '6\'5"',
    pts: "4★", reb: "2★", ast: "4★", stl: "4★", blk: "2★", fg: "3★", ft: "4★", tpm: "3★", to: "3★",
    verdict: "Assist-first guard with elite steal upside and positional size. The defensive stats translate immediately at the NBA level. A category specialist who anchors your steals and assists."
  },
  {
    rank: 8, pick: "1.08", name: "Darius Acuff Jr.", school: "ARK", pos: "G", tier: 2, age: 20, ht: '6\'1"',
    pts: "4★", reb: "2★", ast: "5★", stl: "3★", blk: "2★", fg: "3★", ft: "4★", tpm: "3★", to: "2★",
    verdict: "Elite assist upside with a high usage rate. The turnover risk is real but the playmaking ceiling is the best in this class. High risk, high reward dynasty asset."
  },
  {
    rank: 9, pick: "1.09", name: "Aday Mara", school: "MCH", pos: "C", tier: 2, age: 20, ht: '7\'3"',
    pts: "3★", reb: "4★", ast: "3★", stl: "2★", blk: "4★", fg: "4★", ft: "3★", tpm: "2★", to: "3★",
    verdict: "Size and skill combo with passing ability rare for a 7-footer. The block and rebound upside paired with solid FG% makes him a category contributor at center."
  },
  {
    rank: 10, pick: "1.10", name: "Labaron Philon Jr.", school: "ALA", pos: "G", tier: 2, age: 20, ht: '6\'3"',
    pts: "4★", reb: "2★", ast: "4★", stl: "3★", blk: "2★", fg: "3★", ft: "3★", tpm: "3★", to: "3★",
    verdict: "Balanced guard profile with scoring and playmaking. No elite category but no weakness either. A solid floor play in the late first round of dynasty drafts."
  },
  {
    rank: 11, pick: "1.11", name: "Brayden Burries", school: "ARZ", pos: "G/W", tier: 3, age: 20, ht: '6\'4"',
    pts: "3★", reb: "3★", ast: "3★", stl: "4★", blk: "2★", fg: "3★", ft: "3★", tpm: "3★", to: "3★",
    verdict: "Defensive-first guard with steal upside. The offensive game is still developing but the steal production translates immediately. A category specialist worth rostering in deep formats."
  },
  {
    rank: 12, pick: "1.12", name: "Yaxel Lendeborg", school: "MCH", pos: "W/F", tier: 3, age: 24, ht: '6\'7"',
    pts: "3★", reb: "4★", ast: "3★", stl: "3★", blk: "3★", fg: "4★", ft: "3★", tpm: "3★", to: "3★",
    verdict: "Efficient two-way wing with solid rebounding and FG%. The age is a concern for dynasty runway, but the well-rounded profile and defensive versatility give him a safe floor in 9-cat."
  },
  // === PICKS 13-30: BLURRED / GATED ===
  { rank: 13, pick: "1.13", name: "Bennett Stirtz", school: "IOWA", pos: "G", tier: 3, age: 22, ht: '6\'5"' },
  { rank: 14, pick: "1.14", name: "Allen Graves", school: "SCU", pos: "W/F", tier: 3, age: 21, ht: '6\'5"' },
  { rank: 15, pick: "1.15", name: "Cameron Carr", school: "BAY", pos: "G/W", tier: 3, age: 21, ht: '6\'5"' },
  { rank: 16, pick: "1.16", name: "Hannes Steinbach", school: "WSH", pos: "F/C", tier: 3, age: 21, ht: '7\'1"' },
  { rank: 17, pick: "1.17", name: "Jayden Quaintance", school: "KEN", pos: "C", tier: 3, age: 19, ht: '6\'9"' },
  { rank: 18, pick: "1.18", name: "Dailyn Swain", school: "TEX", pos: "W/F", tier: 3, age: 20, ht: '6\'8"' },
  { rank: 19, pick: "1.19", name: "Morez Johnson Jr.", school: "MCH", pos: "F/C", tier: 3, age: 20, ht: '6\'9"' },
  { rank: 20, pick: "1.20", name: "Braylon Mullins", school: "UCONN", pos: "G/W", tier: 3, age: 20, ht: '6\'5"' },
  { rank: 21, pick: "1.21", name: "Tyler Tanner", school: "VAND", pos: "G", tier: 4, age: 21, ht: '6\'4"' },
  { rank: 22, pick: "1.22", name: "Patrick Ngongba", school: "DUK", pos: "C", tier: 4, age: 20, ht: '6\'11"' },
  { rank: 23, pick: "1.23", name: "Ebuka Okorie", school: "STAN", pos: "G", tier: 4, age: 19, ht: '6\'2"' },
  { rank: 24, pick: "1.24", name: "Thomas Haugh", school: "FLA", pos: "C", tier: 4, age: 21, ht: '7\'0"' },
  { rank: 25, pick: "1.25", name: "Nate Ament", school: "TEN", pos: "G", tier: 4, age: 21, ht: '6\'4"' },
  { rank: 26, pick: "1.26", name: "Zuby Ejiofor", school: "SJU", pos: "F/C", tier: 4, age: 20, ht: '6\'10"' },
  { rank: 27, pick: "1.27", name: "Meleek Thomas", school: "ARK", pos: "G", tier: 4, age: 19, ht: '6\'5"' },
  { rank: 28, pick: "1.28", name: "Tarris Reed Jr.", school: "UCONN", pos: "C", tier: 4, age: 22, ht: '6\'11"' },
  { rank: 29, pick: "1.29", name: "Christian Anderson Jr.", school: "TTU", pos: "G", tier: 4, age: 21, ht: '6\'3"' },
  { rank: 30, pick: "1.30", name: "Koa Peat", school: "ARZ", pos: "W/F", tier: 4, age: 19, ht: '6\'8"' },
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

export default function DraftBoard() {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);

  const toggle = (rank: number) => {
    if (rank > 12) return;
    setExpanded(expanded === rank ? null : rank);
  };

  return (
    <>
      {/* NAV */}
      <nav>
        <a href="/" style={{ textDecoration: "none" }}>
          <div className="nav-brand">Fantasy Hoops <span className="accent">Edge</span></div>
        </a>
        <ul className="nav-links">
          <li><a href="#">Rankings</a></li>
          <li><a href="/draft-board" style={{ color: "var(--edge-orange)" }}>Draft Board</a></li>
          <li><a href="#">Prospect Lab</a></li>
          <li><a href="#">Predictions</a></li>
          <li><a href="#" className="nav-cta" onClick={(e) => { e.preventDefault(); setShowModal(true); }}>Join Free</a></li>
        </ul>
      </nav>

      {/* HEADER */}
      <div style={{
        background: "var(--blueprint)",
        padding: "120px 60px 60px",
        position: "relative",
        overflow: "hidden"
      }}>
        <div style={{
          position: "absolute", right: "-40px", top: "-20px",
          fontFamily: "'Oswald', sans-serif", fontSize: "200px", fontWeight: 800,
          color: "rgba(255,255,255,0.04)", letterSpacing: "10px"
        }}>DRAFT</div>
        <div style={{
          fontFamily: "'Oswald', sans-serif", fontSize: "11px",
          letterSpacing: "3px", textTransform: "uppercase",
          color: "rgba(255,255,255,0.55)", marginBottom: "8px"
        }}>2026 NBA Draft · 9-Cat Dynasty</div>
        <h1 style={{
          fontFamily: "'Oswald', sans-serif", fontWeight: 800,
          fontSize: "48px", textTransform: "uppercase",
          color: "white", letterSpacing: "1px", marginBottom: "8px"
        }}>Rookie <span style={{ color: "var(--dynasty-gold)" }}>Draft Board</span></h1>
        <p style={{
          fontSize: "16px", color: "rgba(255,255,255,0.6)",
          maxWidth: "500px", lineHeight: 1.6
        }}>
          Ranked by long-term 9-cat dynasty value. Top 12 free — full board for subscribers. Updated weekly during the off-season.
        </p>
      </div>

      {/* BOARD */}
      <div style={{ padding: "40px 60px 100px", maxWidth: "900px" }}>
        {DRAFT_BOARD.map((p) => {
          const isLocked = p.rank > 12;
          const isExpanded = expanded === p.rank;
          const tier = tierLabel(p.tier);
          const hasCard = !!(p as Record<string, unknown>).verdict;

          return (
            <div key={p.rank} style={{ position: "relative" }}>
              {/* ROW */}
              <div
                onClick={() => isLocked ? setShowModal(true) : hasCard ? toggle(p.rank) : null}
                style={{
                  display: "flex", alignItems: "center", gap: "16px",
                  padding: "16px 20px",
                  background: isExpanded ? "var(--bg-card-hover)" : "var(--bg-card)",
                  border: "1px solid var(--border-main)",
                  borderRadius: isExpanded ? "12px 12px 0 0" : "12px",
                  marginBottom: isExpanded ? "0" : "8px",
                  cursor: isLocked || hasCard ? "pointer" : "default",
                  transition: "all 0.3s",
                  filter: isLocked ? "blur(4px)" : "none",
                  userSelect: isLocked ? "none" : "auto",
                  opacity: isLocked ? 0.5 : 1,
                }}
              >
                <div style={{
                  fontFamily: "'Oswald', sans-serif", fontWeight: 700,
                  fontSize: "28px", color: "var(--blueprint-glow)",
                  minWidth: "44px", textAlign: "center"
                }}>{p.rank}</div>

                <div style={{ flex: 1 }}>
                  <div style={{
                    fontFamily: "'Oswald', sans-serif", fontWeight: 600,
                    fontSize: "17px", textTransform: "uppercase",
                    letterSpacing: "0.5px", color: "var(--text-primary)"
                  }}>{p.name}</div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "3px" }}>
                    <span className="dbp-school">{p.school}</span>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{p.pos}</span>
                    {p.ht && <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>· {p.ht}</span>}
                  </div>
                </div>

                <div style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: "12px",
                  fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.5px"
                }}>PICK {p.pick}</div>

                <div className={`dbp-tier ${tier.cls}`}>{tier.text}</div>

                {!isLocked && hasCard && (
                  <div style={{
                    fontSize: "14px", color: "var(--text-muted)",
                    transition: "transform 0.3s",
                    transform: isExpanded ? "rotate(180deg)" : "rotate(0)"
                  }}>▼</div>
                )}
              </div>

              {/* EXPANDED CARD */}
              {isExpanded && !isLocked && hasCard && (
                <div style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-main)",
                  borderTop: "none",
                  borderRadius: "0 0 12px 12px",
                  padding: "24px 20px",
                  marginBottom: "8px",
                  animation: "fadeUp 0.3s ease-out"
                }}>
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

        {/* UNLOCK CTA */}
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

      {/* FOOTER */}
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

      {/* SIGN UP MODAL */}
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
    </>
  );
}
