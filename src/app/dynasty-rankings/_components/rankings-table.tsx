"use client";

import { useMemo, type ReactNode } from "react";
import type { DynastyPlayer } from "@/lib/dynasty-rankings";
import { TrendIcon } from "./trend-icon";

const EXPERT_ORDER = [
  { key: "matt" as const, label: "Matt" },
  { key: "dizzle" as const, label: "Dizzle" },
  { key: "angle" as const, label: "Angle" },
  { key: "jason" as const, label: "Jason" },
  { key: "hashtag" as const, label: "Hashtag" },
  { key: "noah" as const, label: "Noah" },
];

export type SortKey =
  | "consensusRank"
  | "player"
  | "age"
  | "avgRank"
  | "rankedByCount"
  | "trend"
  | "tier"
  | "expert:matt"
  | "expert:dizzle"
  | "expert:angle"
  | "expert:jason"
  | "expert:hashtag"
  | "expert:noah";

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

function tierClass(tier: number) {
  if (tier === 1) return "dr-tier dr-tier-1";
  if (tier === 2) return "dr-tier dr-tier-2";
  if (tier <= 4) return "dr-tier dr-tier-34";
  if (tier <= 7) return "dr-tier dr-tier-57";
  return "dr-tier dr-tier-810";
}

function teamPillClass(team: string) {
  if (team === "2026 Rookie") return "dr-team-pill dr-team-pill-rookie";
  return "dr-team-pill";
}

function trendOrder(t: string): number {
  if (t === "up") return 0;
  if (t === "flat") return 1;
  return 2;
}

function expertRankValue(p: DynastyPlayer, key: keyof DynastyPlayer["expertRanks"]): number {
  const v = p.expertRanks[key];
  if (v === undefined || v === null) return 9999;
  return v;
}

function compare(
  a: DynastyPlayer,
  b: DynastyPlayer,
  sortKey: SortKey,
  dir: 1 | -1,
): number {
  const mul = dir;
  if (sortKey === "consensusRank") return (a.consensusRank - b.consensusRank) * mul;
  if (sortKey === "player") return a.player.localeCompare(b.player) * mul;
  if (sortKey === "avgRank") return (a.avgRank - b.avgRank) * mul;
  if (sortKey === "rankedByCount") return (a.rankedByCount - b.rankedByCount) * mul;
  if (sortKey === "tier") return (a.tier - b.tier) * mul;
  if (sortKey === "trend") return (trendOrder(a.trend) - trendOrder(b.trend)) * mul;
  if (sortKey === "age") {
    if (a.age === null && b.age === null) return 0;
    if (a.age === null) return 1;
    if (b.age === null) return -1;
    return ((a.age as number) - (b.age as number)) * mul;
  }
  if (sortKey.startsWith("expert:")) {
    const k = sortKey.replace("expert:", "") as keyof DynastyPlayer["expertRanks"];
    return (expertRankValue(a, k) - expertRankValue(b, k)) * mul;
  }
  return 0;
}

function SortArrow({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <span className="dr-sort-icon" aria-hidden />;
  return (
    <span className="dr-sort-icon dr-sort-icon-active" aria-hidden>
      {dir === "asc" ? "↑" : "↓"}
    </span>
  );
}

export function RankingsTable(props: {
  rows: DynastyPlayer[];
  expertBreakdown: boolean;
  sortKey: SortKey;
  sortDir: 1 | -1;
  onSort: (key: SortKey) => void;
}) {
  const { rows, expertBreakdown, sortKey, sortDir, onSort } = props;

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => compare(a, b, sortKey, sortDir));
    return out;
  }, [rows, sortKey, sortDir]);

  const arrowDir: "asc" | "desc" = sortDir === 1 ? "asc" : "desc";

  const sortBtn = (key: SortKey, label: ReactNode) => (
    <button type="button" className="dr-th-btn" onClick={() => onSort(key)}>
      <span>{label}</span>
      <SortArrow active={sortKey === key} dir={arrowDir} />
    </button>
  );

  return (
    <div className="dr-table-scroll">
      <table className="dr-table">
        <thead>
          <tr>
            <th scope="col" className="dr-th dr-th-sort dr-col-rank">
              {sortBtn("consensusRank", "Rank")}
            </th>
            <th scope="col" className="dr-th dr-th-sort dr-player-col">
              <button type="button" className="dr-th-btn" onClick={() => onSort("player")}>
                <span className="dr-only-lg">Player</span>
                <span className="dr-only-sm">Rank / Player</span>
                <SortArrow active={sortKey === "player"} dir={arrowDir} />
              </button>
            </th>
            <th scope="col" className="dr-th dr-th-sort">
              {sortBtn("age", "Age")}
            </th>
            <th scope="col" className="dr-th dr-th-sort">
              {sortBtn("avgRank", "Avg Rank")}
            </th>
            <th scope="col" className="dr-th dr-th-sort">
              {sortBtn("rankedByCount", "Experts")}
            </th>
            <th scope="col" className="dr-th dr-th-sort">
              {sortBtn("trend", "Trend")}
            </th>
            <th scope="col" className="dr-th dr-th-sort">
              {sortBtn("tier", "Tier")}
            </th>
            {expertBreakdown &&
              EXPERT_ORDER.map(({ key, label }) => (
                <th key={key} scope="col" className="dr-th dr-th-sort dr-th-expert">
                  {sortBtn(`expert:${key}` as SortKey, label)}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => {
            const mutedExperts = p.rankedByCount < 6;
            return (
              <tr key={`${p.consensusRank}-${p.player}-${i}`} className="dr-tr">
                <td className="dr-td dr-col-rank">
                  <span className="dr-rank-num">{p.consensusRank}</span>
                </td>
                <td className="dr-td dr-player-col dr-sticky-merged">
                  <div className="dr-player-inner">
                    <span className="dr-rank-inline">{p.consensusRank}</span>
                    <div>
                      <div className="dr-player-name">{p.player}</div>
                      <div className="dr-player-meta">
                        <span className={teamPillClass(p.team)}>{p.team}</span>
                        <span className={posClass(p.position)}>{p.position}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td className="dr-td dr-mono">{p.age !== null ? p.age.toFixed(1) : "—"}</td>
                <td className="dr-td dr-mono">{p.avgRank.toFixed(1)}</td>
                <td className={`dr-td dr-mono ${mutedExperts ? "dr-muted-count" : ""}`}>
                  {p.rankedByCount}/6
                </td>
                <td className="dr-td">
                  <TrendIcon trend={p.trend} />
                </td>
                <td className="dr-td">
                  <span className={tierClass(p.tier)}>T{p.tier}</span>
                </td>
                {expertBreakdown &&
                  EXPERT_ORDER.map(({ key }) => {
                    const v = p.expertRanks[key];
                    return (
                      <td key={key} className="dr-td dr-td-expert dr-mono">
                        {v !== undefined && v !== null ? v : "—"}
                      </td>
                    );
                  })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
