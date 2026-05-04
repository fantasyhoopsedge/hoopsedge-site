"use client";

import { useMemo } from "react";
import { activeRankForView, type DynastyPlayer } from "@/lib/dynasty-rankings";
import { PositionBadge } from "./position-badge";

function teamPillClass(team: string) {
  if (team === "2026 Rookie") return "dr-team-pill dr-team-pill-rookie";
  return "dr-team-pill";
}

function tierRangeLabel(players: DynastyPlayer[], activeExpertKey: string): string {
  if (players.length === 0) return "";
  const ranks = players
    .map((p) => activeRankForView(p, activeExpertKey))
    .filter((r): r is number => r !== null);
  if (ranks.length === 0) return "";
  const min = Math.min(...ranks);
  const max = Math.max(...ranks);
  if (min === max) return `Rank ${min}`;
  return `Ranks ${min}–${max}`;
}

function compareTierPlayers(a: DynastyPlayer, b: DynastyPlayer, activeExpertKey: string): number {
  if (!activeExpertKey) return a.consensusRank - b.consensusRank;
  const av = a.expertRanks[activeExpertKey as keyof DynastyPlayer["expertRanks"]];
  const bv = b.expertRanks[activeExpertKey as keyof DynastyPlayer["expertRanks"]];
  const aVal = av ?? 99999;
  const bVal = bv ?? 99999;
  if (aVal !== bVal) return aVal - bVal;
  return a.consensusRank - b.consensusRank;
}

export function TierView(props: {
  rows: DynastyPlayer[];
  collapsed: Record<number, boolean>;
  toggleTier: (tier: number) => void;
  activeExpertKey: string;
}) {
  const { rows, collapsed, toggleTier, activeExpertKey } = props;

  const byTier = useMemo(() => {
    const map = new Map<number, DynastyPlayer[]>();
    for (let t = 1; t <= 10; t++) map.set(t, []);
    for (const p of rows) {
      const list = map.get(p.tier);
      if (list) list.push(p);
    }
    for (const list of map.values()) {
      list.sort((a, b) => compareTierPlayers(a, b, activeExpertKey));
    }
    return map;
  }, [rows, activeExpertKey]);

  return (
    <div className="dr-tier-view">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((tier) => {
        const tierPlayers = byTier.get(tier) ?? [];
        if (tierPlayers.length === 0) return null;
        const isCollapsed = Boolean(collapsed[tier]);
        const n = tierPlayers.length;
        const rangePart = tierRangeLabel(tierPlayers, activeExpertKey);
        const headerLine = `TIER ${tier} · ${rangePart} · ${n} player${n === 1 ? "" : "s"}`;
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
                <span className="dr-tier-title">{headerLine}</span>
              </button>
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
                        <PositionBadge position={p.position} />
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
