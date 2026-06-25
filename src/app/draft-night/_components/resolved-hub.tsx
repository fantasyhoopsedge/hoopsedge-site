"use client";

import type { DnMiniGame, DnPrediction, DnLeaderboardRow, DnMiniLeaderboardRow } from "@/types/database";
import { combinedScore, calledItBonus } from "@/lib/draftNight/grader";
import { MINI_META } from "./meta";

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

type PlaceKey = "gold" | "silver" | "bronze";

function placeBadge(rank: number, isTied: boolean): { key: PlaceKey; label: string } | null {
  const eq = isTied ? "Eq " : "";
  if (rank === 1) return { key: "gold",   label: `${eq}1st 🥇` };
  if (rank === 2) return { key: "silver", label: `${eq}2nd 🥈` };
  if (rank === 3) return { key: "bronze", label: `${eq}3rd 🥉` };
  return null;
}

function lbMedal(rank: number): string | number {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return rank;
}

export function ResolvedHub({
  minis,
  predictions,
  leaderboard,
  miniLeaderboard,
  userId,
  displayName,
  onViewResults,
}: {
  minis: DnMiniGame[];
  predictions: Record<string, DnPrediction>;
  leaderboard: DnLeaderboardRow[];
  miniLeaderboard: DnMiniLeaderboardRow[];
  userId: string;
  displayName: string;
  onViewResults: () => void;
}) {
  const sorted = [...minis].sort((a, b) => a.sort - b.sort);

  const miniScores = sorted.map((m) => {
    const pred = predictions[m.id];
    const miniRank = miniLeaderboard.find(
      (r) => r.mini_game_id === m.id && r.user_id === userId,
    ) ?? null;
    return {
      mini: m,
      score: pred?.score ?? null,
      calledIt: pred?.called_it === true,
      played: pred != null,
      miniRank,
    };
  });

  const calledItCards = miniScores.filter((s) => s.calledIt).length;
  const bonus = calledItBonus(calledItCards);
  const combined = combinedScore(miniScores.map((s) => s.score ?? 0), calledItCards);

  const me = leaderboard.find((r) => r.user_id === userId) ?? null;
  const totalPlayers = leaderboard.length;
  const overallTied = me
    ? leaderboard.filter((r) => r.rank === me.rank).length > 1
    : false;
  const overallBadge = me ? placeBadge(me.rank, overallTied) : null;

  const cardUrl = `/draft-night/card/${userId}`;

  return (
    <div className="dn-results">
      <span className="dn-eyebrow">RESULTS ARE IN · 2026 NBA DRAFT</span>
      <h1 className="dn-h1">
        {displayName}&apos;s{" "}
        <span style={{ color: "var(--edge-orange)" }}>Draft Night</span>
      </h1>

      {/* ── Overall score hero ── */}
      <div className="dn-score-hero">
        <div>
          <div style={{
            fontFamily: "'Oswald', sans-serif", fontSize: 11, fontWeight: 600,
            letterSpacing: 2, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4,
          }}>
            Draft Night Score
          </div>
          <span className="dn-score-big">{combined.toLocaleString()}</span>
        </div>
        <div className="dn-score-side">
          {overallBadge ? (
            <span className={`dn-place-badge dn-place-${overallBadge.key}`} style={{ fontSize: 15, padding: "6px 14px" }}>
              {overallBadge.label}
            </span>
          ) : me ? (
            <span className="dn-score-rank">RANK #{me.rank}</span>
          ) : (
            <span className="dn-score-rank">Unranked</span>
          )}
          {me && totalPlayers > 0 && (
            <span style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
              #{me.rank} of {totalPlayers} players
            </span>
          )}
        </div>
      </div>

      {/* ── 2-column grid: mini cards left, leaderboard right ── */}
      <div className="dn-results-grid">

        {/* Left column */}
        <div className="dn-results-left">
          <h2 className="dn-section-h">Your games</h2>

          {miniScores.map(({ mini, score, calledIt, played, miniRank }) => {
            const meta = MINI_META[mini.key];
            const isTied = (miniRank?.tied_at_rank ?? 1) > 1;
            const badge = miniRank ? placeBadge(miniRank.rank, isTied) : null;
            return (
              <div
                key={mini.id}
                className="dn-mini-rc"
                style={{ borderLeftColor: meta.accent }}
              >
                <div className="dn-mini-rc-header">
                  <span className="dn-break-icon" aria-hidden>{meta.icon}</span>
                  <span className="dn-mini-rc-title">{meta.title}</span>
                  <div className="dn-mini-rc-badges">
                    {calledIt && <span className="dn-called-it-badge">CALLED IT</span>}
                    {badge && (
                      <span className={`dn-place-badge dn-place-${badge.key}`}>
                        {badge.label}
                      </span>
                    )}
                  </div>
                </div>
                {played ? (
                  <>
                    <div className="dn-mini-rc-score">
                      You scored{" "}
                      <strong style={{ color: (score ?? 0) < 0 ? "var(--red-severe)" : undefined }}>
                        {score != null ? (score > 0 ? `+${score}` : score) : "—"}
                      </strong>
                      {" / "}{meta.ceiling}
                    </div>
                    {miniRank && (
                      <div className="dn-mini-rc-rank">
                        Ranked{" "}
                        <strong>
                          {isTied ? "Eq" : ""}{ordinal(miniRank.rank)}
                        </strong>
                        {" / "}{miniRank.total_players} players
                      </div>
                    )}
                  </>
                ) : (
                  <div className="dn-mini-rc-score" style={{ color: "var(--text-muted)" }}>
                    Not played
                  </div>
                )}
              </div>
            );
          })}

          {bonus > 0 && (
            <p className="dn-ci-bonus" style={{ marginTop: 4, marginBottom: 0 }}>
              ⭐ {calledItCards} Called It cards · +{bonus} bonus included in score
            </p>
          )}

          <div className="dn-card-actions" style={{ marginTop: 20 }}>
            <button type="button" className="dn-lock-btn" onClick={onViewResults}>
              View Full Results →
            </button>
            {calledItCards > 0 && (
              <a className="dn-share-btn" href={cardUrl}>
                Called It Card →
              </a>
            )}
          </div>
        </div>

        {/* Right column — leaderboard */}
        <div className="dn-results-right">
          <h2 className="dn-section-h">Leaderboard</h2>
          <ol className="dn-leaderboard">
            {leaderboard.slice(0, 20).map((row) => (
              <li
                className={`dn-lb-row${row.user_id === userId ? " dn-lb-me" : ""}`}
                key={row.user_id}
              >
                <span className="dn-lb-rank">{lbMedal(row.rank)}</span>
                <span className="dn-lb-name">{row.username ?? "Analyst"}</span>
                <span className="dn-lb-score">{row.score.toLocaleString()}</span>
              </li>
            ))}
            {leaderboard.length === 0 && (
              <li className="dn-lb-empty">Scores posting soon…</li>
            )}
          </ol>
        </div>

      </div>
    </div>
  );
}
