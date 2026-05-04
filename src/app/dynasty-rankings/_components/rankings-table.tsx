"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { activeRankForView, type DynastyPlayer } from "@/lib/dynasty-rankings";
import { PositionBadge } from "./position-badge";

const EXPERT_ORDER: { key: keyof DynastyPlayer["expertRanks"]; label: string; wide?: boolean }[] = [
  { key: "matt", label: "MATT" },
  { key: "dizzle", label: "DIZZLE" },
  { key: "angle", label: "ANGLE" },
  { key: "jason", label: "JASON" },
  { key: "hashtag", label: "HASHTAG", wide: true },
  { key: "noah", label: "NOAH" },
];

export type SortKey =
  | "consensusRank"
  | "player"
  | "team"
  | "position"
  | "age"
  | "avgRank"
  | "tier"
  | "expert:matt"
  | "expert:dizzle"
  | "expert:angle"
  | "expert:jason"
  | "expert:hashtag"
  | "expert:noah";

function teamPillClass(team: string) {
  if (team === "2026 Rookie") return "dr-team-pill dr-team-pill-rookie";
  return "dr-team-pill";
}

function tierBadgeClass(tier: number) {
  if (tier === 1) return "dr-tier dr-tier-1";
  if (tier === 2) return "dr-tier dr-tier-2";
  if (tier <= 4) return "dr-tier dr-tier-34";
  if (tier <= 7) return "dr-tier dr-tier-57";
  return "dr-tier dr-tier-810";
}

function rankColorForTier(tier: number): string {
  if (tier === 1) return "#22c55e";
  if (tier === 2) return "#2563EB";
  if (tier <= 4) return "#F0C040";
  if (tier <= 7) return "#FF6B2B";
  return "#9ca3af";
}

function playerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function expertRankValue(p: DynastyPlayer, key: keyof DynastyPlayer["expertRanks"]): number | null {
  const v = p.expertRanks[key];
  if (v === undefined || v === null) return null;
  return v;
}

function expertTintClass(consensusRank: number, expertRank: number | null): string {
  if (expertRank === null) return "";
  const delta = consensusRank - expertRank;
  if (delta >= 10) return "dr-expert-tint-up-strong";
  if (delta >= 5) return "dr-expert-tint-up-subtle";
  if (delta <= -10) return "dr-expert-tint-down-strong";
  if (delta <= -5) return "dr-expert-tint-down-subtle";
  return "";
}

function compare(
  a: DynastyPlayer,
  b: DynastyPlayer,
  sortKey: SortKey,
  dir: 1 | -1,
  activeExpertKey: string,
): number {
  const mul = dir;
  const rankValue = (p: DynastyPlayer) => {
    if (!activeExpertKey) return p.consensusRank;
    const v = activeRankForView(p, activeExpertKey);
    return v === null ? 999999 : v;
  };

  if (sortKey === "consensusRank") {
    return (rankValue(a) - rankValue(b)) * mul;
  }
  if (sortKey === "player") return a.player.localeCompare(b.player) * mul;
  if (sortKey === "team") return a.team.localeCompare(b.team) * mul;
  if (sortKey === "position") return a.position.localeCompare(b.position) * mul;
  if (sortKey === "avgRank") return (a.avgRank - b.avgRank) * mul;
  if (sortKey === "tier") return (a.tier - b.tier) * mul;
  if (sortKey === "age") {
    if (a.age === null && b.age === null) return 0;
    if (a.age === null) return 1 * mul;
    if (b.age === null) return -1 * mul;
    return ((a.age as number) - (b.age as number)) * mul;
  }
  if (sortKey.startsWith("expert:")) {
    const k = sortKey.replace("expert:", "") as keyof DynastyPlayer["expertRanks"];
    const av = expertRankValue(a, k);
    const bv = expertRankValue(b, k);
    const aNr = av === null;
    const bNr = bv === null;
    if (aNr && bNr) return (a.consensusRank - b.consensusRank) * mul;
    if (aNr) return 1;
    if (bNr) return -1;
    if (av !== bv) return ((av as number) - (bv as number)) * mul;
    return (a.consensusRank - b.consensusRank) * mul;
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
  sortKey: SortKey;
  sortDir: 1 | -1;
  onSort: (key: SortKey) => void;
  activeExpertKey: string;
  rankedByExpertLabel: string | null;
  maxVisible: number;
}) {
  const { rows, sortKey, sortDir, onSort, activeExpertKey, rankedByExpertLabel, maxVisible } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(maxVisible);

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => compare(a, b, sortKey, sortDir, activeExpertKey));
    return out;
  }, [rows, sortKey, sortDir, activeExpertKey]);

  useEffect(() => {
    setVisibleCount(maxVisible);
  }, [rows, maxVisible, activeExpertKey, sortKey, sortDir]);

  const shown = useMemo(() => sorted.slice(0, visibleCount), [sorted, visibleCount]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = 0;
    });
    return () => cancelAnimationFrame(id);
  }, [rows, activeExpertKey, sortKey, sortDir]);

  const arrowDir: "asc" | "desc" = sortDir === 1 ? "asc" : "desc";
  const expertMode = Boolean(activeExpertKey);

  const consensusAvgSortActive = !activeExpertKey && sortKey === "avgRank";

  const sortHeaderBtn = (key: SortKey, label: ReactNode, sortArrowActive?: boolean) => (
    <button type="button" className="dr-th-btn" onClick={() => onSort(key)}>
      <span>{label}</span>
      <SortArrow active={sortArrowActive ?? sortKey === key} dir={arrowDir} />
    </button>
  );

  const hasMore = visibleCount < sorted.length;
  const startIdx = sorted.length === 0 ? 0 : 1;
  const endIdx = shown.length;

  return (
    <>
      <div ref={scrollRef} className="dr-table-scroll">
        <div
          style={{
            fontSize: 11,
            color: "#9a9aaa",
            padding: "4px 0 2px 0",
          }}
        >
          {rankedByExpertLabel ? `Ranked by ${rankedByExpertLabel}` : "Ranked by Consensus"}
        </div>
        <table className="dr-table">
          <colgroup>
            <col className="dr-col-cg-rank" style={{ width: 50 }} />
            <col className="dr-col-cg-avatar dr-colgroup-hide-mobile" style={{ width: 44 }} />
            <col className="dr-col-cg-player" style={{ width: 180 }} />
            <col className="dr-col-cg-team dr-colgroup-hide-mobile" style={{ width: 110 }} />
            <col className="dr-col-cg-pos dr-colgroup-hide-mobile" style={{ width: 55 }} />
            <col className="dr-col-cg-age dr-colgroup-hide-mobile" style={{ width: 60 }} />
            <col className="dr-col-cg-avg" style={{ width: 90 }} />
            <col className="dr-col-cg-tier dr-colgroup-hide-mobile" style={{ width: 60 }} />
            <col className="dr-col-cg-vscons" style={{ width: 80 }} />
            {EXPERT_ORDER.map((e) => (
              <col
                key={e.key}
                className={
                  activeExpertKey && e.key === activeExpertKey
                    ? "dr-col-cg-expert-selected"
                    : "dr-colgroup-hide-mobile"
                }
                style={{ width: e.wide ? 75 : 65 }}
              />
            ))}
          </colgroup>
          <thead className="dr-table-head">
            <tr>
              <th scope="col" className="dr-th dr-th-sort dr-col-rank dr-th-rank-consensus">
                <button type="button" className="dr-th-btn" onClick={() => onSort("consensusRank")}>
                  <span>RANK</span>
                </button>
              </th>
              <th scope="col" className="dr-th dr-col-avatar dr-desktop-only" aria-label="Avatar" />
              <th scope="col" className="dr-th dr-th-sort dr-player-col">{sortHeaderBtn("player", "PLAYER")}</th>
              <th scope="col" className="dr-th dr-th-sort dr-col-team dr-th-numeric dr-desktop-only">
                {sortHeaderBtn("team", "TEAM")}
              </th>
              <th scope="col" className="dr-th dr-th-sort dr-col-pos dr-th-numeric dr-desktop-only">
                {sortHeaderBtn("position", "POS")}
              </th>
              <th scope="col" className="dr-th dr-th-sort dr-col-age dr-th-numeric dr-col-age-responsive dr-desktop-only">
                {sortHeaderBtn("age", "AGE")}
              </th>
              <th
                scope="col"
                className={`dr-th dr-th-sort dr-col-avg dr-th-numeric ${consensusAvgSortActive ? "dr-th-active-sort" : ""}`.trim()}
              >
                <button type="button" className="dr-th-btn" onClick={() => onSort("avgRank")}>
                  <span className="dr-th-avg-long">AVG RANK</span>
                  <span className="dr-th-avg-short">AVG</span>
                  <SortArrow active={consensusAvgSortActive} dir={arrowDir} />
                </button>
              </th>
              <th scope="col" className="dr-th dr-th-sort dr-col-tier dr-th-tier-head dr-desktop-only">{sortHeaderBtn("tier", "TIER")}</th>
              <th scope="col" className="dr-th dr-col-vscons dr-th-vscons-head">
                VS CONS
              </th>
              {EXPERT_ORDER.map(({ key, label, wide }) => {
                const sk = `expert:${key}` as SortKey;
                const isActiveSort = sortKey === sk;
                const expertColumnSelected = activeExpertKey === key;
                const hideExpertOnMobile = !activeExpertKey || activeExpertKey !== key;
                return (
                  <th
                    key={key}
                    scope="col"
                    className={`dr-th dr-th-sort dr-th-expert dr-th-numeric ${wide ? "dr-col-w-hashtag" : "dr-col-w-expert"} ${expertColumnSelected ? "dr-expert-mobile-visible" : ""} ${hideExpertOnMobile ? "dr-desktop-only" : ""} ${expertColumnSelected ? "dr-th-active-sort" : ""}`.trim()}
                  >
                    <button type="button" className="dr-th-btn" onClick={() => onSort(sk)}>
                      <span>{label}</span>
                      <SortArrow active={isActiveSort} dir={arrowDir} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((p, i) => {
              const activeRank = activeRankForView(p, activeExpertKey);
              const rankStyle = { color: rankColorForTier(p.tier) };

              return (
                <tr key={`${p.consensusRank}-${p.player}-${i}`} className="dr-tr">
                  <td className="dr-td dr-col-rank">
                    {activeRank !== null ? (
                      <span className="dr-rank-num" style={rankStyle}>
                        {activeRank}
                      </span>
                    ) : (
                      <span className="dr-rank-nr">N/R</span>
                    )}
                  </td>
                  <td className="dr-td dr-col-avatar dr-desktop-only">
                    <span
                      className="dr-player-avatar"
                      style={{
                        width: 44,
                        height: 44,
                        minWidth: 44,
                        color: "#ffffff",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {playerInitials(p.player)}
                    </span>
                  </td>
                  <td className="dr-td dr-player-col">
                    <div className="dr-player-inner-row">
                      <div className="dr-player-info-stack">
                        <div className="dr-player-name-line">{p.player}</div>
                      </div>
                    </div>
                  </td>
                  <td className="dr-td dr-col-team dr-desktop-only">
                    <span className={teamPillClass(p.team)}>{p.team}</span>
                  </td>
                  <td className="dr-td dr-col-pos dr-desktop-only">
                    <PositionBadge position={p.position} />
                  </td>
                  <td className="dr-td dr-col-age dr-td-numeric dr-col-age-responsive dr-mono dr-desktop-only">
                    {p.age !== null ? p.age.toFixed(1) : "—"}
                  </td>
                  <td className="dr-td dr-col-avg dr-td-numeric dr-mono">{p.avgRank.toFixed(1)}</td>
                  <td className="dr-td dr-col-tier dr-td-tier-cell dr-desktop-only">
                    <span className={tierBadgeClass(p.tier)}>T{p.tier}</span>
                  </td>
                  <td className="dr-td dr-col-vscons">
                    {expertMode ? (
                      <VsConsCell
                        consensusRank={p.consensusRank}
                        expertRank={expertRankValue(p, activeExpertKey as keyof DynastyPlayer["expertRanks"])}
                      />
                    ) : (
                      <span className="dr-vs-cons-muted">—</span>
                    )}
                  </td>
                  {EXPERT_ORDER.map(({ key }) => {
                    const er = expertRankValue(p, key);
                    const tint = expertTintClass(p.consensusRank, er);
                    const hideExpertOnMobile = !activeExpertKey || activeExpertKey !== key;
                    return (
                      <td
                        key={key}
                        className={`dr-td dr-td-expert dr-mono ${activeExpertKey === key ? "dr-expert-mobile-visible" : ""} ${hideExpertOnMobile ? "dr-desktop-only" : ""} ${tint}`.trim()}
                      >
                        {er !== null ? er : "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sorted.length > 0 ? (
        <div className="dr-pagination">
          <p className="dr-pagination-label">
            Showing {startIdx}–{endIdx} of {sorted.length}
          </p>
          {hasMore ? (
            <button
              type="button"
              className="dr-show-more"
              onClick={() => setVisibleCount((n) => Math.min(n + maxVisible, sorted.length))}
            >
              Show more
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function VsConsCell({ consensusRank, expertRank }: { consensusRank: number; expertRank: number | null }) {
  if (expertRank === null) {
    return <span className="dr-vs-cons-muted">—</span>;
  }
  if (expertRank === consensusRank) {
    return (
      <span className="dr-vs-cons-cell dr-vs-cons-same" title="Same as consensus">
        —
      </span>
    );
  }
  if (expertRank < consensusRank) {
    const n = consensusRank - expertRank;
    return (
      <span className="dr-vs-cons-cell dr-vs-cons-up" title={`${n} spots higher than consensus`}>
        ↑{n}
      </span>
    );
  }
  const n = expertRank - consensusRank;
  return (
    <span className="dr-vs-cons-cell dr-vs-cons-down" title={`${n} spots lower than consensus`}>
      ↓{n}
    </span>
  );
}
