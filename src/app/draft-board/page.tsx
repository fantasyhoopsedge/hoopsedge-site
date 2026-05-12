"use client";
import { useState, Fragment } from "react";
import { SiteNav } from "@/components/site-nav";

// ============================================================
// DRAFT BOARD DATA — UPDATE THIS ARRAY TO CHANGE THE BOARD
// Ratings pulled from dynasty_board_ratings_master.txt
// Last synced: April 7, 2026
// ============================================================
const DRAFT_BOARD = [
  { rank: 1, pick: "1.01", name: "Cameron Boozer", school: "Duke", pos: "F/C", tier: 1, age: 19, ht: '6\'10"',
    pts: "5★", reb: "5★", ast: "4★", stl: "4★", blk: "3★", fg: "5★", ft: "3★", tpm: "4★", to: "3★",
    verdict: "Safest dynasty pick in the 2026 class. Elite PTS, REB and FG% — three category anchors. An elite interior scorer and shooter whose strength and rebounding are the foundation of the profile. The youngest prospect in the draft with unbelievable dominance and feel. In category leagues, this profile wins championships." },
  { rank: 2, pick: "1.02", name: "Darryn Peterson", school: "Kansas", pos: "G", tier: 2, age: 19, ht: '6\'4"',
    pts: "5★", reb: "3★", ast: "2★", stl: "5★", blk: "3★", fg: "2★", ft: "4★", tpm: "5★", to: "2★",
    verdict: "Elite PTS on high volume, elite 3PM and elite STL — three category pillars that combine scoring, shooting and defensive impact. One of the best perimeter defensive profiles in the class. High-volume below-average FG% is the one drag that needs to improve. Dynasty risk goes beyond availability — the shot diet is the NBA translation question." },
  { rank: 3, pick: "1.03", name: "AJ Dybantsa", school: "BYU", pos: "G/F", tier: 2, age: 18, ht: '6\'9"',
    pts: "5★", reb: "4★", ast: "3★", stl: "3★", blk: "2★", fg: "4★", ft: "3★", tpm: "2★", to: "1★",
    verdict: "Led the nation in scoring as a freshman. First freshman since Trae Young in 2018 to lead the country in PPG. Elite PTS on high volume — a primary advantage creator whose scoring juice is the real thing. Draws fouls at high volume. Dynasty runway is enormous at 19." },
  { rank: 4, pick: "1.04", name: "Caleb Wilson", school: "North Carolina", pos: "F", tier: 2, age: 20, ht: '6\'8"',
    pts: "4★", reb: "5★", ast: "3★", stl: "5★", blk: "4★", fg: "5★", ft: "2★", tpm: "1★", to: "3★",
    verdict: "Elite REB, elite STL and elite FG% on volume — three category anchors. One of the best defenders in the class, with the feel and instincts already NBA-ready. Draws fouls at the highest rate in the class — the scoring will come. Season ended early with a broken thumb — cleared for the predraft process." },
  { rank: 5, pick: "1.05", name: "Kingston Flemings", school: "Houston", pos: "G", tier: 3, age: 20, ht: '6\'3"',
    pts: "3★", reb: "1★", ast: "5★", stl: "5★", blk: "2★", fg: "3★", ft: "4★", tpm: "4★", to: "4★",
    verdict: "One of my guys. The most elite playmaking guard in the 2026 class. Elite AST and elite STL — two-way impact built into the profile. A 2.91 AST/TO ratio puts him among the most efficient playmakers in the draft. The defensive potential on top of this makes him genuinely special." },
  { rank: 6, pick: "1.06", name: "Keaton Wagler", school: "Illinois", pos: "G", tier: 3, age: 20, ht: '6\'5"',
    pts: "3★", reb: "3★", ast: "4★", stl: "2★", blk: "2★", fg: "2★", ft: "4★", tpm: "5★", to: "4★",
    verdict: "Elite 3PM — the standout category anchor. An exceptional shooter and processor who thrives in movement. The dynasty case is built on shooting creation." },
  { rank: 7, pick: "1.07", name: "Aday Mara", school: "Michigan", pos: "C", tier: 3, age: 20, ht: '7\'3"',
    pts: "3★", reb: "4★", ast: "3★", stl: "1★", blk: "5★", fg: "5★", ft: "1★", tpm: "1★", to: "3★",
    verdict: "One of my guys. Elite BLK and elite FG% — two genuine category anchors. The most elite shot-blocker in the entire 2026 class by a distance. A true needle-mover at center — the interior presence and rim protection profile is rare at this age." },
  { rank: 8, pick: "1.08", name: "Mikel Brown Jr.", school: "Louisville", pos: "G", tier: 3, age: 21, ht: '6\'5"',
    pts: "4★", reb: "2★", ast: "4★", stl: "4★", blk: "1★", fg: "2★", ft: "4★", tpm: "4★", to: "1★",
    verdict: "A spectacular live-dribble passer and versatile creator with an improved burst and first step — dribble, pass, shoot at an elite level when healthy. Draws fouls at high volume. Lower back injury is the only reason he's not top 5. Predraft medicals are everything." },
  { rank: 9, pick: "1.09", name: "Ebuka Okorie", school: "Stanford", pos: "G", tier: 4, age: 19, ht: '6\'2"',
    pts: "5★", reb: "2★", ast: "3★", stl: "4★", blk: "2★", fg: "2★", ft: "4★", tpm: "4★", to: "4★",
    verdict: "One of my guys. Elite PTS on high volume — gets to the basket more than any guard in the class. Absolutely electric with the best first step in the draft — pure scoring gravity that translates regardless of system. Draws fouls at high volume — the strongest indicator the scoring translates to NBA level." },
  { rank: 10, pick: "1.10", name: "Labaron Philon", school: "Alabama", pos: "G", tier: 4, age: 20, ht: '6\'3"',
    pts: "5★", reb: "2★", ast: "4★", stl: "3★", blk: "1★", fg: "3★", ft: "3★", tpm: "5★", to: "3★",
    verdict: "Elite PTS on high volume and elite 3PM — one of the most underrated scoring profiles in the class. A shifty primary creator with elite rim pressure and trustworthy defensive upside — breaks down defences off the dribble as well as anyone in this class. The dynasty value is higher than the rank suggests." },
  { rank: 11, pick: "1.11", name: "Hannes Steinbach", school: "Washington", pos: "F/C", tier: 4, age: 21, ht: '7\'1"',
    pts: "3★", reb: "5★", ast: "3★", stl: "3★", blk: "4★", fg: "5★", ft: "3★", tpm: "1★", to: "2★",
    verdict: "Elite REB and elite FG% on volume — two genuine category anchors. Best rebounder in the class minute-for-minute. A strong, physical frontcourt presence who brings interior balance and positional strength that complements more rangy lineups." },
  { rank: 12, pick: "1.12", name: "Dailyn Swain", school: "Texas", pos: "F", tier: 4, age: 20, ht: '6\'8"',
    pts: "3★", reb: "4★", ast: "3★", stl: "5★", blk: "2★", fg: "4★", ft: "4★", tpm: "3★", to: "2★",
    verdict: "Elite STL — a class-leading defensive rate. A lengthy wing who brings essential creation against tough, athletic defences — the size and secondary playmaking are the dynasty calling cards. SEC Newcomer of the Year. At 20 years old the dynasty runway is real." },
  // === PICKS 13-30: BLURRED / GATED ===
  { rank: 13, pick: "1.13", name: "Darius Acuff Jr.", school: "Arkansas", pos: "G", tier: 4, age: 20, ht: '6\'1"',
    pts: "5★", reb: "2★", ast: "5★", stl: "1★", blk: "2★", fg: "3★", ft: "4★", tpm: "5★", to: "3★",
    verdict: "Elite PTS, elite AST and elite 3PM on high volume — three category pillars. A 2.97 AST/TO ratio — the most efficient high-volume playmaker in the class. One of the deepest multi-cat elite profiles in the class." },
  { rank: 14, pick: "1.14", name: "Yaxel Lendeborg", school: "Michigan", pos: "G/F", tier: 4, age: 24, ht: '6\'7"',
    pts: "3★", reb: "3★", ast: "3★", stl: "3★", blk: "4★", fg: "3★", ft: "4★", tpm: "5★", to: "4★",
    verdict: "Elite 3PM — a rare shooting profile for a forward of his size. A sizable wing who excels in transition with high-level shooting and passing — a genuine multi-tool forward. Age 23.3 is the dynasty runway concern — the production is real, the timeline is short." },
  { rank: 15, pick: "1.15", name: "Allen Graves", school: "SCU", pos: "G/F", tier: 4, age: 21, ht: '6\'5"',
    pts: "3★", reb: "4★", ast: "3★", stl: "5★", blk: "4★", fg: "3★", ft: "3★", tpm: "4★", to: "4★",
    verdict: "Elite STL — the most elite steal rate in the class. A chaos creator with phenomenal feel — exceptional on the offensive glass with the size and physicality to impact every possession. Historic multi-cat defensive production for a wing. SOS caveat: Santa Clara is not a P6 programme." },
  { rank: 16, pick: "1.16", name: "Cameron Carr", school: "Baylor", pos: "G", tier: 5, age: 21, ht: '6\'5"',
    pts: "3★", reb: "3★", ast: "3★", stl: "2★", blk: "4★", fg: "3★", ft: "4★", tpm: "5★", to: "3★",
    verdict: "Elite 3PM — a class-leading shooting volume profile. An athletic movement shooter who is also an exceptional shot-blocker for a wing — a rare combination of spacing and defensive versatility. NBA translation thesis is built on shooting and shot-blocking." },
  { rank: 17, pick: "1.17", name: "Brayden Burries", school: "Arizona", pos: "G", tier: 5, age: 20, ht: '6\'4"',
    pts: "3★", reb: "3★", ast: "3★", stl: "5★", blk: "1★", fg: "3★", ft: "4★", tpm: "5★", to: "4★",
    verdict: "Elite STL and elite 3PM — two category pillars that punch above the consensus ranking. A reliable, dependable guard — the ideal third option who brings depth and ball-handling stability to any backcourt. Consistent multi-contributor floor." },
  { rank: 18, pick: "1.18", name: "Bennett Stirtz", school: "Iowa", pos: "G", tier: 5, age: 22, ht: '6\'5"',
    pts: "3★", reb: "2★", ast: "4★", stl: "3★", blk: "1★", fg: "3★", ft: "4★", tpm: "4★", to: "3★",
    verdict: "A crafty creator with pull-up shooting and real scoring juice off the dribble — alleviates pressure from primary initiators in a way that doesn't always show in the stat line. Age 22 compresses the dynasty runway but the category floor is real." },
  { rank: 19, pick: "1.19", name: "Christian Anderson", school: "Texas Tech", pos: "G", tier: 5, age: 21, ht: '6\'3"',
    pts: "3★", reb: "2★", ast: "5★", stl: "4★", blk: "1★", fg: "3★", ft: "4★", tpm: "5★", to: "1★",
    verdict: "Elite AST and elite 3PM — two category pillars. The most prolific assist creator in the class and arguably its best shooter — elite pull-up ability and pick-and-roll craft that few guards in this draft can match. Specialist profile." },
  { rank: 20, pick: "1.20", name: "Morez Johnson Jr.", school: "Michigan", pos: "F/C", tier: 5, age: 20, ht: '6\'9"',
    pts: "3★", reb: "4★", ast: "2★", stl: "2★", blk: "4★", fg: "5★", ft: "3★", tpm: "1★", to: "3★",
    verdict: "Elite FG% at 62.3% — a genuine category anchor. An explosive athlete with high-level rim protection and interior defence — one of the premier frontcourt defensive prospects in this range. Minutes-suppressed at Michigan. The buy-low case is real." },
  { rank: 21, pick: "1.21", name: "Jayden Quaintance", school: "Kentucky", pos: "C", tier: 6, age: 19, ht: '6\'9"',
    pts: "2★", reb: "4★", ast: "2★", stl: "3★", blk: "5★", fg: "3★", ft: "1★", tpm: "2★", to: "3★",
    verdict: "Elite BLK — a genuine category anchor from scouting context. Special flashes throughout — a slasher, play finisher and secondary passer with massive defensive potential. Only 4 games played due to injury — ratings from scouting, not season stats. The upside is elite. The data isn't there yet." },
  { rank: 22, pick: "1.22", name: "Tyler Tanner", school: "Vanderbilt", pos: "G", tier: 6, age: 21, ht: '6\'4"',
    pts: "4★", reb: "2★", ast: "4★", stl: "5★", blk: "2★", fg: "3★", ft: "4★", tpm: "5★", to: "4★",
    verdict: "Elite STL and elite 3PM — two category pillars. A special off-ball player with a high feel for the game and genuine defensive tenacity — impactful on both ends despite the 6'0\" frame. An 85.3% FT% rate and a 2.71 AST/TO ratio that punch well above his billing. The frame is the central NBA translation question." },
  { rank: 23, pick: "1.23", name: "Nate Ament", school: "Tennessee", pos: "F", tier: 6, age: 21, ht: '6\'4"',
    pts: "3★", reb: "3★", ast: "3★", stl: "3★", blk: "3★", fg: "2★", ft: "3★", tpm: "2★", to: "2★",
    verdict: "A gigantic wing with undeniable shotmaking off movement — the strength and physicality to impose himself have improved significantly. Draws fouls at high volume — the scoring has room to grow if the shot diet evolves at NBA level. A development play." },
  { rank: 24, pick: "1.24", name: "Zuby Ejiofor", school: "SJU", pos: "F/C", tier: 6, age: 20, ht: '6\'10"',
    pts: "3★", reb: "4★", ast: "3★", stl: "4★", blk: "5★", fg: "4★", ft: "2★", tpm: "1★", to: "3★",
    verdict: "Elite BLK — a genuine category anchor. A versatile big who brings utility as a handler and passer — has shown constant improvement at every level. Draws fouls at high volume. Dynasty buy on the rim protection." },
  { rank: 25, pick: "1.25", name: "Karim Lopez", school: "Maine", pos: "F", tier: 6, age: 20, ht: '6\'11"',
    pts: "2★", reb: "3★", ast: "3★", stl: "3★", blk: "3★", fg: "3★", ft: "2★", tpm: "2★", to: "2★",
    verdict: "NBL Next Stars pathway — same programme that produced LaMelo Ball, Josh Giddey and Alex Sarr. A developmental wing with improved shooting and solid ball skills — the physical strength and athleticism for a versatile two-way role are already visible. 6'9\" with 7'1\" wingspan. Youngest wing in the class at 19.0. Pure ceiling bet." },
  { rank: 26, pick: "1.26", name: "Taris Reed Jr.", school: "UCONN", pos: "C", tier: 6, age: 22, ht: '6\'11"',
    pts: "3★", reb: "5★", ast: "3★", stl: "3★", blk: "5★", fg: "5★", ft: "1★", tpm: "1★", to: "3★",
    verdict: "Elite REB, elite BLK and elite FG% at 60.7% — three genuine category anchors. A traditional center who imposes a physical edge and brings size and strength that impacts every possession. NCAA Tournament East Region MOP: 19.5 PPG and 13.2 RPG over 6 games. Age 22.6 compresses the runway." },
  { rank: 27, pick: "1.27", name: "Isaiah Evans", school: "Duke", pos: "G/F", tier: 6, age: 20, ht: '6\'11"',
    pts: "3★", reb: "2★", ast: "2★", stl: "2★", blk: "3★", fg: "2★", ft: "4★", tpm: "4★", to: "4★",
    verdict: "A tough, physical movement shooter whose grit and competitiveness stand out on tape — shoots more threes per minute than anyone in the class. The dynasty floor rises and falls with three-point shooting." },
  { rank: 28, pick: "1.28", name: "Meleek Thomas", school: "Arkansas", pos: "G", tier: 6, age: 19, ht: '6\'5"',
    pts: "3★", reb: "2★", ast: "3★", stl: "5★", blk: "1★", fg: "2★", ft: "4★", tpm: "5★", to: "4★",
    verdict: "Elite STL and elite 3PM — two category pillars. An excellent complementary player with a unique shotmaking touch — outstanding off-ball defence, movement skills and an innate ability to jump passing lanes. A low-noise, high-value profile." },
  { rank: 29, pick: "1.29", name: "Koa Peat", school: "Arizona", pos: "F", tier: 6, age: 19, ht: '6\'8"',
    pts: "3★", reb: "3★", ast: "3★", stl: "1★", blk: "3★", fg: "4★", ft: "1★", tpm: "1★", to: "3★",
    verdict: "A physical presence with real strength and rebounding — shows flashes of mid-range touch and the ability to impact games through interior physicality. A physicality-and-scoring development play." },
  { rank: 30, pick: "1.30", name: "Amari Allen", school: "Alabama", pos: "F", tier: 6, age: 21, ht: '7\'0"',
    pts: "2★", reb: "4★", ast: "3★", stl: "3★", blk: "3★", fg: "3★", ft: "3★", tpm: "2★", to: "4★",
    verdict: "A physical wing with genuine dribble-pass-shoot upside and the athletic tools to grow into a modern rotation player. A physically capable forward whose offensive development is the dynasty timeline question." },
];

const CATS = ["pts", "reb", "ast", "stl", "blk", "fg", "ft", "tpm", "to"] as const;
const CAT_LABELS: Record<string, string> = {
  pts: "PTS", reb: "REB", ast: "AST", stl: "STL", blk: "BLK", fg: "FG%", ft: "FT%", tpm: "3PM", to: "TO"
};

function starStyle(star: string): { color: string; fontWeight: number } {
  if (star === "5★") return { color: "#15803d",             fontWeight: 700 };
  if (star === "4★") return { color: "var(--green-elite)",  fontWeight: 700 };
  if (star === "3★") return { color: "var(--dynasty-gold)", fontWeight: 400 };
  if (star === "2★") return { color: "white",               fontWeight: 400 };
  return                    { color: "var(--red-severe)",   fontWeight: 700 };
}

function tierRankColor(tier: number): string {
  if (tier === 1) return "var(--green-elite)";
  if (tier === 2) return "var(--blueprint-glow)";
  if (tier <= 4) return "var(--dynasty-gold)";
  return "#ffffff";
}

function tierLabel(tier: number) {
  if (tier === 1) return { text: "TIER 1", cls: "tier-elite" };
  if (tier === 2) return { text: "TIER 2", cls: "tier-positive" };
  if (tier === 3) return { text: "TIER 3", cls: "tier-three" };
  if (tier === 4) return { text: "TIER 4", cls: "tier-four" };
  if (tier === 5) return { text: "TIER 5", cls: "tier-five" };
  return { text: "TIER 6", cls: "tier-six" };
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
          Ranked by long-term 9-cat dynasty value. Top 12 free — full board for subscribers.
        </p>
      </div>

      <div className="db-board-wrap" style={{ padding: "40px 60px 100px", maxWidth: "900px", width: "100%", margin: "0 auto" }}>
        {DRAFT_BOARD.map((p, i) => {
          const isLocked = p.rank > 12;
          const isExpanded = expanded === p.rank;
          const tier = tierLabel(p.tier);
          const hasCard = !!(p as unknown as Record<string, string>).verdict;
          const prev = i > 0 ? DRAFT_BOARD[i - 1] : null;
          const showDivider = i === 0 || (!!prev && p.tier !== prev.tier);
          const dividerColor = tierRankColor(p.tier);

          return (
            <Fragment key={p.rank}>
              {showDivider && (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "7px 16px",
                  margin: p.tier === 1 ? "0 0 6px" : "20px 0 6px",
                  background: "rgba(255,255,255,0.03)",
                  borderLeft: `3px solid ${dividerColor}`,
                  borderRadius: "0 6px 6px 0",
                }}>
                  <span style={{
                    fontFamily: "'Oswald', sans-serif",
                    fontSize: "11px",
                    fontWeight: 600,
                    letterSpacing: "4px",
                    textTransform: "uppercase",
                    color: dividerColor,
                  }}>Tier {p.tier}</span>
                </div>
              )}
            <div style={{ position: "relative" }}>
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
                  fontSize: "28px", color: tierRankColor(p.tier),
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
                            fontSize: "13px",
                            ...starStyle(val),
                          }}>{val}</div>
                          <div style={{
                            height: "3px", borderRadius: "2px",
                            background: starStyle(val).color,
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
            </Fragment>
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
