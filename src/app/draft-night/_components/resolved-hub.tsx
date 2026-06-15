"use client";

import type { DnMiniGame, DnPrediction, DnLeaderboardRow } from "@/types/database";
import { combinedScore, calledItBonus } from "@/lib/draftNight/grader";
import { MINI_META } from "./meta";

export function ResolvedHub({
  minis,
  predictions,
  leaderboard,
  userId,
  displayName,
  onViewResults,
}: {
  minis: DnMiniGame[];
  predictions: Record<string, DnPrediction>;
  leaderboard: DnLeaderboardRow[];
  userId: string;
  displayName: string;
  onViewResults: () => void;
}) {
  const sorted = [...minis].sort((a, b) => a.sort - b.sort);

  const miniScores = sorted.map((m) => ({
    mini: m,
    score: predictions[m.id]?.score ?? null,
    calledIt: predictions[m.id]?.called_it === true,
    played: predictions[m.id] != null,
  }));

  const calledItCards = miniScores.filter((s) => s.calledIt).length;
  const bonus = calledItBonus(calledItCards);
  const combined = combinedScore(miniScores.map((s) => s.score ?? 0), calledItCards);

  const me = leaderboard.find((r) => r.user_id === userId) ?? null;
  const pct = me ? Math.round(me.percentile * 100) : null;
  const topPct = pct !== null ? Math.max(1, 100 - pct) : null;
  const cardUrl = `/draft-night/card/${userId}`;

  return (
    <div className="dn-results">
      <span className="dn-eyebrow">RESULTS ARE IN · 2026 NBA DRAFT</span>
      <h1 className="dn-h1">
        {displayName}&apos;s{" "}
        <span style={{ color: "var(--edge-orange)" }}>Draft Night</span>
      </h1>

      {/* Score hero */}
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
        {me ? (
          <div className="dn-score-side">
            <span className="dn-score-rank">RANK #{me.rank}</span>
            {topPct !== null && <span className="dn-score-pct">Top {topPct}%</span>}
          </div>
        ) : (
          <div className="dn-score-side">
            <span className="dn-score-rank">Unranked</span>
          </div>
        )}
      </div>

      {/* Called It badges */}
      {calledItCards > 0 && (
        <div className="dn-ci-grid" style={{ marginBottom: bonus > 0 ? 10 : 20 }}>
          {miniScores.filter((s) => s.calledIt).map(({ mini }) => {
            const meta = MINI_META[mini.key];
            return (
              <div key={mini.id} className="dn-ci-card" style={{ borderLeftColor: meta.accent }}>
                <span className="dn-ci-icon" aria-hidden>{meta.icon}</span>
                <span className="dn-ci-body">
                  <span className="dn-ci-name">{meta.title}</span>
                  <span className="dn-ci-sub">Perfect ✓</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {bonus > 0 && (
        <p className="dn-ci-bonus" style={{ marginBottom: 20 }}>
          ⭐ {calledItCards} Called It cards · +{bonus} bonus included in score
        </p>
      )}

      {/* Actions */}
      <div className="dn-card-actions">
        <button type="button" className="dn-lock-btn" onClick={onViewResults}>
          View Results →
        </button>
        {calledItCards > 0 && (
          <a className="dn-share-btn" href={cardUrl}>
            Called It Card →
          </a>
        )}
      </div>

      {/* Per-game score summary — each row is itself a "View Results" for that game */}
      <h2 className="dn-section-h">Your games</h2>
      <div className="dn-breakdown" style={{ marginBottom: 32 }}>
        {miniScores.map(({ mini, score, calledIt, played }) => {
          const meta = MINI_META[mini.key];
          return (
            <button
              type="button"
              key={mini.id}
              className="dn-break-row dn-break-row--btn"
              style={{ borderLeft: `3px solid ${meta.accent}` }}
              onClick={onViewResults}
              aria-label={`View results for ${meta.title}`}
            >
              <span className="dn-break-icon" aria-hidden>{meta.icon}</span>
              <span className="dn-break-id">
                <span className="dn-break-title">{meta.title}</span>
                <span className="dn-break-sub">{played ? `ceiling ${meta.ceiling}` : "not played"}</span>
              </span>
              {calledIt && <span className="dn-called-it-badge">CALLED IT</span>}
              <span
                className="dn-break-score"
                style={{ color: score != null && score < 0 ? "var(--red-severe)" : "var(--text-primary)" }}
              >
                {score != null ? (score > 0 ? `+${score}` : score) : "—"}
              </span>
              <span className="dn-scard-status" style={{ color: "var(--edge-orange)", fontSize: 16 }}>›</span>
            </button>
          );
        })}
        {bonus > 0 && (
          <div className="dn-bonus-row">
            <span className="dn-break-icon" aria-hidden>⭐</span>
            <span className="dn-break-id">
              <span className="dn-break-title">Called It Bonus</span>
              <span className="dn-break-sub">{calledItCards} perfect games</span>
            </span>
            <span className="dn-bonus-score">+{bonus}</span>
          </div>
        )}
      </div>

      {/* Leaderboard */}
      <h2 className="dn-section-h">Leaderboard</h2>
      <ol className="dn-leaderboard">
        {leaderboard.slice(0, 25).map((row) => (
          <li
            className={`dn-lb-row${row.user_id === userId ? " dn-lb-me" : ""}`}
            key={row.user_id}
          >
            <span className="dn-lb-rank">{row.rank}</span>
            <span className="dn-lb-name">{row.username ?? "Analyst"}</span>
            <span className="dn-lb-score">{row.score.toLocaleString()}</span>
          </li>
        ))}
        {leaderboard.length === 0 && (
          <li className="dn-lb-empty">Scores posting soon…</li>
        )}
      </ol>
    </div>
  );
}
