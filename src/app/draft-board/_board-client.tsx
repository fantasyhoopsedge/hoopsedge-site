"use client";
import { useState, useEffect, Fragment } from "react";
import { PlatformSidebarNav } from "@/components/platform-sidebar-nav";
import { TEAM_LOGO } from "@/app/team-rosters/_components/roster-data";
import {
  CATS, CAT_LABELS, tierInfo, normalizeName,
  type BoardPlayer, type BoardTier, type RookieBoard, type MovementInfo, type MovementMap,
} from "@/lib/rookie-board";

// ============================================================
// DRAFT BOARD DATA now lives in src/data/rookie-board.json and is edited
// through the local authoring tool at /admin/rookie-board. This component
// only renders it — to change the board, use the tool (or edit the JSON).
// ============================================================
// (board data removed — see src/data/rookie-board.json)

// Exact birth dates (Proballers / Wikipedia) → live age computed at view time so
// the board never goes stale. Prospects without a DOB yet fall back to the master
// CSV age advanced from its snapshot date — still dynamic, accurate to ~weeks.
const BIRTH_DATES: Record<string, string> = {
  "Cameron Boozer": "2007-07-18",
  "Darryn Peterson": "2007-01-17",
  "AJ Dybantsa": "2007-01-29",
  "Caleb Wilson": "2006-07-18",
};
const AGE_SNAPSHOT_MS = new Date("2026-01-22T00:00:00Z").getTime();
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Current age in decimal years — from DOB when known, else the snapshot age
 * advanced to today. Returns null when no age data exists. */
function liveAge(dob: string | undefined, fallbackStaticAge: number | null, nowMs: number): number | null {
  if (dob) return (nowMs - new Date(dob).getTime()) / MS_PER_YEAR;
  if (fallbackStaticAge != null) return fallbackStaticAge + (nowMs - AGE_SNAPSHOT_MS) / MS_PER_YEAR;
  return null;
}

function starStyle(star: string): { color: string; fontWeight: number } {
  const count = parseInt(star);
  if (count === 5) return { color: "var(--green-elite)",  fontWeight: 700 };
  if (count === 4) return { color: "#15803d",             fontWeight: 400 };
  if (count === 3) return { color: "var(--dynasty-gold)", fontWeight: 400 };
  if (count === 2) return { color: "var(--text-muted)",    fontWeight: 400 };
  return                  { color: "var(--red-severe)",   fontWeight: 700 };
}



function toKebabName(name: string): string {
  return name.toLowerCase().replace(/[.,]/g, "").replace(/['\s]+/g, "-").replace(/-+/g, "-");
}

function getInitials(name: string): string {
  const parts = name.split(" ");
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function ProspectHeadshot({ name, size = 48 }: { name: string; size?: number }) {
  const kebabName = toKebabName(name);
  const initials = getInitials(name);
  const circleStyle: React.CSSProperties = { width: size, height: size, borderRadius: "50%", flexShrink: 0 };
  return (
    <div style={{ position: "relative", ...circleStyle }}>
      <img
        src={`/images/prospects/${kebabName}.jpg`}
        alt={name}
        width={size}
        height={size}
        style={{ ...circleStyle, objectFit: "cover", display: "block" }}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
          const fallback = (e.currentTarget as HTMLImageElement).nextElementSibling as HTMLElement;
          if (fallback) fallback.style.display = "flex";
        }}
      />
      <div style={{
        ...circleStyle,
        background: "#2563EB", color: "white",
        display: "none", alignItems: "center", justifyContent: "center",
        fontSize: Math.round(size * 0.27) + "px", fontWeight: 700,
        fontFamily: "'Oswald', sans-serif",
        position: "absolute", top: 0, left: 0,
      }}>{initials}</div>
    </div>
  );
}

// This board's nbaTeam field uses standard codes matching TEAM_LOGO's keys,
// except Phoenix ("PHO" here vs. "PHX" in TEAM_LOGO) — verified empirically
// against the live rookie-board.json data (28 distinct codes, 27 match).
const ROOKIE_TEAM_ALIAS: Record<string, string> = { PHO: "PHX" };

function RowTeamLogo({ team }: { team: string | null | undefined }) {
  const [ok, setOk] = useState(true);
  if (!team) return null;
  const abbr = ROOKIE_TEAM_ALIAS[team] ?? team;
  const file = TEAM_LOGO[abbr];
  if (!file || !ok) return <span className="db-team-logo-fallback">{team}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static team wordmark from public/
    <img
      src={`/images/nba%20team%20images/${file}`}
      alt={team}
      width={24}
      height={24}
      loading="lazy"
      onError={() => setOk(false)}
      className="db-team-logo"
    />
  );
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
        <span className="db-pos-badge-split-l db-pos-badge-split-l-orange">F</span>
        <span className="db-pos-badge-split-r db-pos-badge-split-r-gold">C</span>
      </span>
    );
  }
  return <span className="db-pos-badge db-pos-badge-g">{pos}</span>;
}

// Compact rank-movement chip: ▲n up (green), ▼n down (red), NEW (blueprint),
// – no change (muted). Renders nothing only when there's no prior version to
// compare against (m is null/undefined), so every row stays uniform otherwise.
function MovementChip({ m }: { m: MovementInfo | null | undefined }) {
  if (!m) return null;
  if (m.isNew) return <span className="db-mv db-mv-new" title="New on the board this version">NEW</span>;
  const delta = m.delta ?? 0;
  if (delta === 0) return <span className="db-mv db-mv-same" title="No change since the previous version">–</span>;
  const up = delta > 0;
  return (
    <span
      className={"db-mv " + (up ? "db-mv-up" : "db-mv-down")}
      title={`${up ? "Up" : "Down"} ${Math.abs(delta)} since the previous version (was #${m.from})`}
    >
      {up ? "▲" : "▼"}{Math.abs(delta)}
    </span>
  );
}

// ── Prospect Detail Panel (desktop: docked to the right of the board) ──
function ProspectDetailPanel({ player, onClose, age, tiers, movement }: { player: BoardPlayer | null; onClose: () => void; age?: number; tiers: BoardTier[]; movement?: MovementInfo }) {
  useEffect(() => {
    if (!player) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [player, onClose]);

  if (!player) {
    return (
      <div className="db-detail-empty">
        Select a prospect to view full ratings and dynasty verdict.
      </div>
    );
  }

  const { color: tierColor } = tierInfo(player.tier, tiers);
  const heroLogo = player.nbaTeam ? TEAM_LOGO[ROOKIE_TEAM_ALIAS[player.nbaTeam] ?? player.nbaTeam] : undefined;

  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-main)",
        borderRadius: 16,
        width: "100%",
        maxHeight: "calc(100vh - 120px)",
        overflowY: "auto",
        position: "relative",
        boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
        animation: "fadeUp 0.22s ease-out",
      }}>
        {/* Close button — sits on top of the hero */}
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 14, right: 14, zIndex: 10,
            background: "color-mix(in srgb, var(--text-primary) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--text-primary) 15%, transparent)",
            color: "var(--text-primary)", borderRadius: "50%",
            width: 30, height: 30, cursor: "pointer",
            fontFamily: "'JetBrains Mono', monospace", fontSize: 13,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >✕</button>

        {/* Hero — background is var(--bg-nav), which flips to white in light
            mode, so every text/overlay color in here must be theme-aware too
            (previously hardcoded white/rgba-white, invisible on the light-mode
            white hero). */}
        <div style={{
          background: "var(--bg-nav)", position: "relative",
          overflow: "hidden", padding: "26px 26px 22px",
          borderRadius: "16px 16px 0 0",
          borderBottom: "1px solid var(--border-main)",
        }}>
          {/* Subtle corner glow, replaces the old clipped watermark text */}
          <div aria-hidden style={{
            position: "absolute", right: -40, top: -40,
            width: 140, height: 140, borderRadius: "50%",
            background: "radial-gradient(circle, color-mix(in srgb, var(--text-primary) 7%, transparent), transparent 70%)",
            pointerEvents: "none",
          }} />

          {/* NBA team logo watermark — same faded corner-flourish treatment as
              the team-rosters single-player hero (roster-app.tsx). */}
          {heroLogo && (
            // eslint-disable-next-line @next/next/no-img-element -- static team wordmark from public/, sized as a background flourish
            <img
              src={`/images/nba%20team%20images/${heroLogo}`}
              alt=""
              width={150}
              height={150}
              style={{ position: "absolute", top: -20, right: -14, width: 150, height: 150, objectFit: "contain", opacity: 0.14, pointerEvents: "none", userSelect: "none" }}
            />
          )}

          {/* Breadcrumb */}
          <div style={{
            fontFamily: "'Oswald', sans-serif", fontSize: 9,
            letterSpacing: 1.5, textTransform: "uppercase",
            color: "var(--text-muted)", marginBottom: 18,
            position: "relative", whiteSpace: "nowrap",
          }}>
            2026 ROOKIE BOARD · PICK {player.pick}
          </div>

          {/* Identity */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, position: "relative" }}>
            {/* Headshot with rank badge */}
            <div style={{ position: "relative", flexShrink: 0 }}>
              <ProspectHeadshot name={player.name} size={60} />
              <div style={{
                position: "absolute", bottom: -4, right: -4,
                background: tierColor, color: "#0b0e14",
                fontFamily: "'Oswald', sans-serif", fontWeight: 800,
                fontSize: 12, lineHeight: 1,
                width: 22, height: 22, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                border: "2px solid var(--blueprint)",
              }}>{player.rank}</div>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: "'Oswald', sans-serif", fontWeight: 700,
                fontSize: 19, textTransform: "uppercase",
                letterSpacing: 0.3, color: "var(--text-primary)", lineHeight: 1.18,
                marginBottom: 8, wordBreak: "break-word",
              }}>
                {player.name}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                {positionBadge(player.pos)}
                {player.ht && (
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10, color: "var(--text-muted)",
                  }}>{player.ht}</span>
                )}
                {age != null && (
                  <span style={{
                    fontFamily: "'Oswald', sans-serif", fontWeight: 700,
                    fontSize: 12.5, letterSpacing: 0.5, color: "var(--dynasty-gold)",
                  }}>{age.toFixed(1)} YRS</span>
                )}
              </div>
              {movement && (
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  <MovementChip m={movement} />
                  <span style={{
                    fontFamily: "'Oswald', sans-serif", fontSize: 10.5,
                    letterSpacing: 1, textTransform: "uppercase", color: "var(--text-secondary)",
                  }}>
                    {movement.isNew
                      ? "New this version"
                      : (movement.delta ?? 0) === 0
                        ? "No change since last update"
                        : `${(movement.delta ?? 0) > 0 ? "Up" : "Down"} ${Math.abs(movement.delta ?? 0)} from #${movement.from} since last update`}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: "24px 28px 28px" }}>

          {/* Category Ratings */}
          <div style={{
            fontFamily: "'Oswald', sans-serif", fontSize: 11,
            letterSpacing: 3, textTransform: "uppercase",
            color: "var(--edge-orange)", marginBottom: 14,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{ flex: 1, height: 1, background: "var(--border-main)" }} />
            Category Ratings
            <div style={{ flex: 1, height: 1, background: "var(--border-main)" }} />
          </div>
          <div style={{
            background: "var(--bg-card)", border: "1px solid var(--border-main)",
            borderRadius: 10, padding: "16px 12px", marginBottom: 20,
            display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 6,
          }}>
            {CATS.map((cat) => {
              const val = (player as unknown as Record<string, string>)[cat];
              if (!val) return null;
              const style = starStyle(val);
              return (
                <div key={cat} style={{ textAlign: "center" }}>
                  <div style={{
                    fontFamily: "'Oswald', sans-serif", fontSize: 11,
                    fontWeight: 600, letterSpacing: 1,
                    color: "var(--text-muted)", marginBottom: 5,
                  }}>{CAT_LABELS[cat]}</div>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12, ...style,
                  }}>{val}</div>
                  <div style={{
                    height: 3, borderRadius: 2,
                    background: style.color,
                    marginTop: 5, opacity: 0.6,
                  }} />
                </div>
              );
            })}
          </div>

          {/* Dynasty Verdict */}
          <div style={{
            fontFamily: "'Oswald', sans-serif", fontSize: 11,
            letterSpacing: 3, textTransform: "uppercase",
            color: "var(--edge-orange)", marginBottom: 14,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{ flex: 1, height: 1, background: "var(--border-main)" }} />
            Dynasty Verdict
            <div style={{ flex: 1, height: 1, background: "var(--border-main)" }} />
          </div>
          <div style={{
            background: "var(--bg-card)", border: "1px solid var(--border-main)",
            borderRadius: 10, padding: "16px 20px", marginBottom: 20,
          }}>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, margin: 0 }}>
              {player.verdict}
            </p>
          </div>

        </div>
      </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────
// Ages are sourced from the master CSV (fhe_2026_prospects_master) via the
// server page wrapper and matched by name; falls back to the board's own value.
export function DraftBoardClient({ board, ageByName, movement = {} }: { board: RookieBoard; ageByName: Record<string, number>; movement?: MovementMap }) {
  const DRAFT_BOARD = board.players;
  const tiers = board.tiers;
  const movementFor = (name: string): MovementInfo | undefined => movement[normalizeName(name)];
  const [selectedPlayer, setSelectedPlayer] = useState<BoardPlayer | null>(null);
  // Mobile only: which row's star ratings are expanded inline. Desktop docks the detail panel to the right.
  const [expandedRank, setExpandedRank] = useState<number | null>(null);
  // Live ages, computed once at view time (lazy init keeps it pure + current).
  const [liveAges] = useState<Record<string, number>>(() => {
    const now = Date.now();
    const out: Record<string, number> = {};
    for (const p of DRAFT_BOARD) {
      const a = liveAge(p.birthdate ?? BIRTH_DATES[p.name], ageByName[p.name] ?? p.age, now);
      if (a != null) out[p.name] = a;
    }
    return out;
  });

  return (
    <div className="draft-board-shell">
      <PlatformSidebarNav active="rookie-board" />

      <div className="db-board-wrap" style={{ padding: "80px 60px 100px", maxWidth: "1280px", width: "100%", margin: "0 auto" }}>
      {/* Published-version header — the live board's name + version */}
      <div className="db-version-banner">
        <div className="db-vb-left">
          <span className="db-vb-eyebrow">2026 Rookie Board · Published</span>
          <span className="db-vb-title">{board.label}</span>
        </div>
        <div className="db-vb-right">
          <span className="db-vb-chip">v{board.version}</span>
          {board.updatedAt && <span className="db-vb-date">Updated {board.updatedAt}</span>}
        </div>
      </div>
      <div className="db-layout">
      <div className="db-list-col">
        {DRAFT_BOARD.map((p, i) => {
          const { color: tierColor, label: tierLabel } = tierInfo(p.tier, tiers);
          const prev = i > 0 ? DRAFT_BOARD[i - 1] : null;
          const showDivider = i === 0 || (!!prev && p.tier !== prev.tier);

          return (
            <Fragment key={p.rank}>
              {showDivider && (
                <div style={{
                  display: "flex", alignItems: "center", gap: "12px",
                  margin: p.tier === 1 ? "0 0 8px" : "28px 0 8px",
                }}>
                  <div style={{ flex: 1, height: "1px", background: `${tierColor}40` }} />
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "10px", fontWeight: 700,
                    letterSpacing: "2px", color: tierColor, whiteSpace: "nowrap",
                  }}>// {tierLabel}</span>
                </div>
              )}

              <div
                onClick={() => {
                  // Below the desktop side-panel breakpoint: expand the star ratings inline.
                  if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
                    setExpandedRank((prev) => (prev === p.rank ? null : p.rank));
                  } else {
                    setSelectedPlayer(p);
                  }
                }}
                className="db-row db-row-collapsed"
                style={{ backgroundColor: "var(--rt-surface-strong)", cursor: "pointer" }}
              >
                <div style={{
                  fontFamily: "'Oswald', sans-serif", fontWeight: 700,
                  fontSize: "28px", color: tierColor,
                  minWidth: "44px", textAlign: "center",
                }}>{p.rank}</div>
                <ProspectHeadshot name={p.name} />
                <div className="db-player-main">
                  <div className="db-player-name-row">
                    <MovementChip m={movementFor(p.name)} />
                    <span className="db-player-name">{p.name}</span>
                  </div>
                  <div className="db-player-meta">
                    {positionBadge(p.pos)}
                    <RowTeamLogo team={p.nbaTeam} />
                    {p.ht && <span className="db-player-meta-text db-player-meta-height">· {p.ht}</span>}
                  </div>
                </div>
                {liveAges[p.name] != null && (
                  <div className="db-age" title="Age today">
                    <span className="db-age-num">{liveAges[p.name].toFixed(1)}</span>
                    <span className="db-age-cap">AGE</span>
                  </div>
                )}
                <div
                  className="db-expand-arrow"
                  style={{ transform: expandedRank === p.rank ? "rotate(0deg)" : "rotate(-90deg)", opacity: 0.4 }}
                >▼</div>
              </div>

              {expandedRank === p.rank && (
                <div className="db-mobile-stars">
                  <div className="db-ms-row">
                    {CATS.map((cat) => {
                      const val = (p as unknown as Record<string, string>)[cat];
                      if (!val) return null;
                      const st = starStyle(val);
                      return (
                        <div className="db-ms-cell" key={cat}>
                          <span className="db-ms-label">{CAT_LABELS[cat]}</span>
                          <span className="db-ms-val" style={{ color: st.color, fontWeight: st.fontWeight }}>{val}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="db-ms-verdict">{p.verdict}</p>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      {/* Prospect detail panel — desktop only, docked to the right */}
      <div className="db-detail-col">
        <div className="db-detail-sticky">
          <ProspectDetailPanel player={selectedPlayer} onClose={() => setSelectedPlayer(null)} age={selectedPlayer ? liveAges[selectedPlayer.name] : undefined} tiers={tiers} movement={selectedPlayer ? movementFor(selectedPlayer.name) : undefined} />
        </div>
      </div>
      </div>
      </div>

      <style>{`
        /* Published-version banner */
        .db-version-banner {
          display: flex; align-items: center; justify-content: space-between;
          gap: 16px; flex-wrap: wrap;
          background: var(--bg-card); border: 1px solid var(--border-main);
          border-radius: 14px; padding: 16px 22px; margin-bottom: 28px;
        }
        .db-vb-left { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
        /* Weight/family matches the sidebar's active-item highlight (app-sidebar.tsx). */
        .db-vb-eyebrow {
          font-family: var(--rt-font-sans); font-weight: 600; font-size: 10px;
          letter-spacing: 2.5px; text-transform: uppercase; color: var(--rt-primary);
        }
        /* Was hardcoded white (fine on the old always-dark-card banner) — now
           theme-aware so it stays legible once the light-mode grey fill is gone. */
        .db-vb-title {
          font-family: var(--rt-font-sans); font-weight: 700; font-size: 23px;
          text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-primary); line-height: 1.1;
        }
        .db-vb-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
        .db-vb-chip {
          font-family: var(--rt-font-sans); font-weight: 700; font-size: 14px;
          letter-spacing: 1px; color: var(--rt-on-primary); background: var(--rt-primary);
          padding: 5px 12px; border-radius: 8px; white-space: nowrap;
        }
        .db-vb-date {
          font-family: var(--rt-font-sans); font-size: 11px;
          color: var(--text-muted); white-space: nowrap;
        }
        @media (max-width: 767px) {
          .db-version-banner { padding: 13px 16px; margin-bottom: 18px; }
          .db-vb-title { font-size: 18px; }
          .db-vb-date { display: none; }
        }

        .db-layout { display: block; }
        .db-list-col { width: 100%; }
        .db-detail-col { display: none; }

        @media (min-width: 1024px) {
          .db-layout {
            display: flex;
            align-items: flex-start;
            gap: 28px;
          }
          .db-list-col {
            flex: 1 1 auto;
            max-width: 660px;
          }
          .db-detail-col {
            display: block;
            flex: 1 1 480px;
            max-width: 500px;
            position: sticky;
            top: 96px;
            align-self: flex-start;
          }
        }
        .db-detail-empty {
          background: var(--bg-card);
          border: 1px solid var(--border-main);
          border-radius: 16px;
          padding: 40px 24px;
          text-align: center;
          color: var(--text-muted);
          font-size: 13px;
          line-height: 1.6;
        }

        .db-mobile-stars { display: none; }
        @media (max-width: 1023px) {
          .db-mobile-stars {
            display: flex;
            flex-direction: column;
            gap: 12px;
            background: var(--bg-card);
            border: 1px solid var(--border-main);
            border-top: none;
            border-radius: 0 0 12px 12px;
            margin: -8px 0 10px;
            padding: 12px 12px 16px;
          }
          .db-ms-row {
            display: grid;
            grid-template-columns: repeat(9, 1fr);
            gap: 0;
          }
        }
        .db-ms-cell { display: flex; flex-direction: column; align-items: center; gap: 3px; }
        .db-ms-label { font-family: var(--rt-font-sans); font-size: 12px; font-weight: 700; letter-spacing: 0.2px; text-transform: uppercase; color: var(--text-secondary); }
        .db-ms-val { font-family: var(--rt-font-mono); font-size: 16px; }
        .db-ms-verdict {
          font-size: 12px; line-height: 1.55; color: var(--text-secondary);
          margin: 0; padding-top: 4px;
          border-top: 1px solid var(--border-main);
        }

        /* Live age badge — gold in dark mode (unchanged); light mode uses the
           rt-primary orange instead (see [data-theme="light"] override below). */
        .db-age {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          min-width: 52px; flex-shrink: 0; margin-left: 8px;
          padding: 4px 8px; border-radius: 10px;
          background: rgba(240, 192, 64, 0.10); border: 1px solid rgba(240, 192, 64, 0.22);
        }
        .db-age-num {
          font-family: var(--rt-font-mono); font-weight: 800; font-size: 22px; line-height: 1;
          color: var(--dynasty-gold); font-variant-numeric: tabular-nums;
        }
        .db-age-cap {
          font-family: var(--rt-font-sans); font-weight: 600; font-size: 9px;
          letter-spacing: 2px; color: var(--text-muted); margin-top: 3px;
        }
        [data-theme="light"] .db-age {
          background: rgba(250, 70, 22, 0.10); border-color: rgba(250, 70, 22, 0.22);
        }
        [data-theme="light"] .db-age-num { color: var(--rt-primary); }
        @media (max-width: 767px) {
          .db-age { min-width: 44px; padding: 3px 6px; margin-left: 6px; }
          .db-age-num { font-size: 18px; }
          .db-age-cap { font-size: 8px; letter-spacing: 1.5px; }
        }

        /* Team logo replacing the plain nbaTeam-code text (see RowTeamLogo). */
        .db-team-logo { width: 24px; height: 24px; object-fit: contain; flex-shrink: 0; }
        .db-team-logo-fallback { font-family: var(--rt-font-sans); font-size: 12px; color: var(--text-secondary); }
      `}</style>
    </div>
  );
}
