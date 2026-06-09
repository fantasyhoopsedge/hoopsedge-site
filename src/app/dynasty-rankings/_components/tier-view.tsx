"use client";

import { useMemo, useState } from "react";
import { activeRankForView, playerHeadshotUrl, type DynastyPlayer } from "@/lib/dynasty-rankings";
import { PositionBadge } from "./position-badge";

function teamPillClass(team: string) {
  if (team === "2026 Rookie") return "dr-team-pill dr-team-pill-rookie";
  return "dr-team-pill";
}

const TIER_META: Record<number, { colorClass: string; name: string }> = {
  1: { colorClass: "dr-tc-1", name: "Fantasy-Altering Juggernauts" },
  2: { colorClass: "dr-tc-2", name: "Dynasty Cornerstones" },
  3: { colorClass: "dr-tc-3", name: "Proven Contributors" },
  4: { colorClass: "dr-tc-4", name: "Depth Tilters" },
  5: { colorClass: "dr-tc-5", name: "Developmental Assets" },
  6: { colorClass: "dr-tc-6", name: "Speculative Holds" },
  7: { colorClass: "dr-tc-7", name: "Deep League Filler" },
  8: { colorClass: "dr-tc-8", name: "Lottery Tickets" },
};

function HeadshotImg({ player }: { player: DynastyPlayer }) {
  const [hidden, setHidden] = useState(false);
  const url = playerHeadshotUrl(player);
  if (!url || hidden) return null;
  return (
    <img
      src={url}
      alt=""
      aria-hidden
      className="dr-tier-card-headshot"
      onError={() => setHidden(true)}
    />
  );
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
    for (let t = 1; t <= 8; t++) map.set(t, []);
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
      {[1, 2, 3, 4, 5, 6, 7, 8].map((tier) => {
        const tierPlayers = byTier.get(tier) ?? [];
        if (tierPlayers.length === 0) return null;
        const isCollapsed = Boolean(collapsed[tier]);
        const n = tierPlayers.length;
        const rangePart = tierRangeLabel(tierPlayers, activeExpertKey);
        const { colorClass, name: tierName } = TIER_META[tier];
        const headerLine = `TIER ${tier} · ${tierName} · ${rangePart} · ${n} player${n === 1 ? "" : "s"}`;
        return (
          <section key={tier} className={`dr-tier-section ${colorClass}`}>
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
                    <HeadshotImg player={p} />
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
