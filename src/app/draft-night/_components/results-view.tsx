"use client";

import { useState } from "react";
import type { DnMiniGame, DnLeaderboardRow, DnPrediction } from "@/types/database";
import { combinedScore } from "@/lib/draftNight/grader";
import { MINI_META } from "./meta";

export function ResultsView({
  minis,
  predictions,
  leaderboard,
  userId,
  displayName,
}: {
  minis: DnMiniGame[];
  /** keyed by mini_game_id */
  predictions: Record<string, DnPrediction>;
  leaderboard: DnLeaderboardRow[];
  userId: string | null;
  displayName: string;
}) {
  const [copied, setCopied] = useState(false);

  const miniScores = minis.map((m) => {
    const pred = predictions[m.id];
    return { mini: m, score: pred?.score ?? null };
  });
  const combined = combinedScore(miniScores.map((s) => s.score ?? 0));

  const me = leaderboard.find((r) => r.user_id === userId) ?? null;
  const pct = me ? Math.round(me.percentile * 100) : null;

  const cardUrl = userId ? `/draft-night/card/${userId}` : null;
  const share = async () => {
    if (!cardUrl) return;
    const full = `${window.location.origin}${cardUrl}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "My FHE Draft Night Score", url: full });
      } else {
        await navigator.clipboard.writeText(full);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // user cancelled share — no-op
    }
  };

  return (
    <div className="dn-results">
      <span className="dn-eyebrow">RESULTS ARE IN</span>
      <h1 className="dn-h1">
        {displayName}&apos;s <span style={{ color: "var(--edge-orange)" }}>Draft Night Score</span>
      </h1>

      <div className="dn-score-hero">
        <span className="dn-score-big">{combined.toLocaleString()}</span>
        <div className="dn-score-side">
          {me ? (
            <>
              <span className="dn-score-rank">RANK #{me.rank}</span>
              {pct !== null ? <span className="dn-score-pct">Top {Math.max(1, 100 - pct)}%</span> : null}
            </>
          ) : (
            <span className="dn-score-rank">Unranked</span>
          )}
        </div>
      </div>

      {cardUrl ? (
        <div className="dn-card-actions">
          <a className="dn-lock-btn" href={cardUrl} target="_blank" rel="noreferrer">
            View &quot;Called It&quot; card
          </a>
          <button type="button" className="dn-share-btn" onClick={() => void share()}>
            {copied ? "Link copied ✓" : "Share"}
          </button>
        </div>
      ) : null}

      <h2 className="dn-section-h">Per-game breakdown</h2>
      <div className="dn-breakdown">
        {miniScores.map(({ mini, score }) => {
          const meta = MINI_META[mini.key];
          const played = predictions[mini.id] != null;
          return (
            <div className="dn-break-row" key={mini.id} style={{ borderLeft: `3px solid ${meta.accent}` }}>
              <span className="dn-break-icon" aria-hidden>{meta.icon}</span>
              <span className="dn-break-id">
                <span className="dn-break-title">{meta.title}</span>
                <span className="dn-break-sub">{played ? `ceiling ${meta.ceiling}` : "not played"}</span>
              </span>
              <span
                className="dn-break-score"
                style={{ color: score != null && score < 0 ? "var(--red-severe)" : "var(--text-primary)" }}
              >
                {score != null ? (score > 0 ? `+${score}` : score) : "—"}
              </span>
            </div>
          );
        })}
      </div>

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
        {leaderboard.length === 0 ? <li className="dn-lb-empty">Scores posting soon…</li> : null}
      </ol>
    </div>
  );
}
