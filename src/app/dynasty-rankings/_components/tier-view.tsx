"use client";

import { useMemo } from "react";
import type { DynastyPlayer } from "@/lib/dynasty-rankings";

function posClass(pos: string) {
  switch (pos) {
    case "PG":
      return "dr-pos dr-pos-pg";
    case "SG":
      return "dr-pos dr-pos-sg";
    case "SF":
      return "dr-pos dr-pos-sf";
    case "PF":
      return "dr-pos dr-pos-pf";
    case "C":
      return "dr-pos dr-pos-c";
    default:
      return "dr-pos dr-pos-default";
  }
}

function teamPillClass(team: string) {
  if (team === "2026 Rookie") return "dr-team-pill dr-team-pill-rookie";
  return "dr-team-pill";
}

function tierRangeLabel(players: DynastyPlayer[]): string {
  if (players.length === 0) return "";
  const ranks = players.map((p) => p.consensusRank);
  const min = Math.min(...ranks);
  const max = Math.max(...ranks);
  if (min === max) return `Rank ${min}`;
  return `Ranks ${min}–${max}`;
}

export function TierView(props: {
  rows: DynastyPlayer[];
  collapsed: Record<number, boolean>;
  toggleTier: (tier: number) => void;
}) {
  const { rows, collapsed, toggleTier } = props;

  const byTier = useMemo(() => {
    const map = new Map<number, DynastyPlayer[]>();
    for (let t = 1; t <= 10; t++) map.set(t, []);
    for (const p of rows) {
      const list = map.get(p.tier);
      if (list) list.push(p);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.consensusRank - b.consensusRank);
    }
    return map;
  }, [rows]);

  return (
    <div className="dr-tier-view">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((tier) => {
        const tierPlayers = byTier.get(tier) ?? [];
        if (tierPlayers.length === 0) return null;
        const isCollapsed = Boolean(collapsed[tier]);
        return (
          <section key={tier} className="dr-tier-section">
            <header className="dr-tier-head">
              <button
                type="button"
                className="dr-tier-toggle"
                onClick={() => toggleTier(tier)}
                aria-expanded={!isCollapsed}
              >
                <svg
                  className={`dr-tier-chevron ${isCollapsed ? "dr-tier-chevron-collapsed" : ""}`}
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M6 9l6 6 6-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="dr-tier-title">TIER {tier}</span>
              </button>
              <p className="dr-tier-sub">{tierRangeLabel(tierPlayers)}</p>
            </header>
            {!isCollapsed && (
              <div className="dr-tier-grid">
                {tierPlayers.map((p) => (
                  <article key={`${p.consensusRank}-${p.player}`} className="dr-tier-card">
                    <div className="dr-tier-card-rank">{p.consensusRank}</div>
                    <div className="dr-tier-card-body">
                      <div className="dr-tier-card-name">{p.player}</div>
                      <div className="dr-player-meta">
                        <span className={teamPillClass(p.team)}>{p.team}</span>
                        <span className={posClass(p.position)}>{p.position}</span>
                      </div>
                      <div className="dr-tier-card-age">
                        {p.age !== null ? `Age ${p.age.toFixed(1)}` : "Age —"}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
