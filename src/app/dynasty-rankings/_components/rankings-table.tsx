"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { activeRankForView, normalizePlayerName, playerHeadshotUrl, type DynastyPlayer } from "@/lib/dynasty-rankings";
import { PositionBadge } from "./position-badge";
import { Footer } from "@/components/footer";
import { TEAM_LOGO } from "@/app/team-rosters/_components/roster-data";
import { shortenPlayerName } from "@/lib/shorten-name";

const EXPERT_ORDER: { key: keyof DynastyPlayer["expertRanks"]; label: string; wide?: boolean }[] = [
  { key: "dizzle", label: "DIZZLE" },
  { key: "angle", label: "ANGLE" },
  { key: "mball", label: "MBALL" },
  { key: "hashtag", label: "HASHTAG", wide: true },
  { key: "dynatyze", label: "DYNATYZE", wide: true },
];

export type SortKey =
  | "consensusRank"
  | "player"
  | "team"
  | "position"
  | "age"
  | "avgRank"
  | "tier"
  | "expert:dizzle"
  | "expert:angle"
  | "expert:mball"
  | "expert:hashtag"
  | "expert:dynatyze";

// dynasty-rankings.json uses standard codes matching TEAM_LOGO's keys, except
// New Orleans ("NOR" here vs. "NOP") and Phoenix ("PHO" vs. "PHX") — verified
// empirically against the live data. "FA" (free agent, including undrafted
// 2026 rookies with no NBA team yet) isn't a real team, so it stays as text.
const DYNASTY_TEAM_ALIAS: Record<string, string> = { NOR: "NOP", PHO: "PHX" };
const NON_TEAM_VALUES = new Set(["FA"]);

function TeamCell({ team, size = 32 }: { team: string; size?: number }) {
  const [ok, setOk] = useState(true);
  if (NON_TEAM_VALUES.has(team)) {
    return <span className="dr-team-pill">{team}</span>;
  }
  const abbr = DYNASTY_TEAM_ALIAS[team] ?? team;
  const file = TEAM_LOGO[abbr];
  if (!file || !ok) return <span className="dr-team-pill">{team}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static team wordmark from public/
    <img
      src={`/images/nba%20team%20images/${file}`}
      alt={team}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setOk(false)}
      className="dr-team-logo"
      style={size !== 32 ? { width: size, height: size } : undefined}
    />
  );
}

const TIER_COLORS: Record<number, string> = {
  1: "#F0C040",
  2: "#22c55e",
  3: "#3b82f6",
  4: "#9b5de5",
  5: "#FF6B2B",
  6: "#f72585",
  7: "#00c8e0",
  8: "#64748b",
};

function tierBadgeClass(tier: number) {
  return `dr-tier dr-tier-t${tier}`;
}

function rankColorForTier(tier: number): string {
  return TIER_COLORS[tier] ?? "#ffffff";
}

function playerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}


// One accent family (rt-primary + its darker shade), not the old blue/orange/
// gold rainbow — tier colors (TIER_COLORS above) are semantic and untouched.
function mobilePositionBadgeStyle(position: string): CSSProperties {
  const normalized = position.toUpperCase();
  let background = "var(--rt-primary)";
  const color = "var(--rt-on-primary)";

  if (normalized === "G/F" || normalized === "F/C") {
    background = "linear-gradient(135deg, var(--rt-primary) 0 50%, var(--rt-primary-active) 50% 100%)";
  }

  return {
    width: 18,
    height: 18,
    borderRadius: 4,
    fontSize: 9,
    fontWeight: 700,
    color,
    background,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 5,
    flexShrink: 0,
    lineHeight: 1,
  };
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
  versionLabel: string;
  sophomoreNames: Set<string>;
  onPlayerClick: (p: DynastyPlayer) => void;
}) {
  const { rows, sortKey, sortDir, onSort, activeExpertKey, rankedByExpertLabel, versionLabel, sophomoreNames, onPlayerClick } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingTimeoutRef = useRef<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(50);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => compare(a, b, sortKey, sortDir, activeExpertKey));
    return out;
  }, [rows, sortKey, sortDir, activeExpertKey]);

  useEffect(() => {
    setVisibleCount(50);
    setIsLoadingMore(false);
  }, [rows]);

  useEffect(() => {
    const updateIsMobile = () => {
      setIsMobile(window.innerWidth <= 767);
    };
    updateIsMobile();
    window.addEventListener("resize", updateIsMobile);
    return () => window.removeEventListener("resize", updateIsMobile);
  }, []);

  const shown = useMemo(() => sorted.slice(0, visibleCount), [sorted, visibleCount]);
  const hasMore = visibleCount < sorted.length;

  useEffect(() => {
    if (!hasMore) return;
    const sentinel = sentinelRef.current;
    const container = scrollRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || isLoadingMore) return;

        setIsLoadingMore(true);
        setVisibleCount((prev) => Math.min(prev + 25, sorted.length));
      },
      {
        threshold: 0.1,
        root: container,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, sorted.length]);

  useEffect(() => {
    if (!isLoadingMore) return;
    if (loadingTimeoutRef.current !== null) {
      window.clearTimeout(loadingTimeoutRef.current);
    }
    loadingTimeoutRef.current = window.setTimeout(() => {
      setIsLoadingMore(false);
      loadingTimeoutRef.current = null;
    }, 250);

    return () => {
      if (loadingTimeoutRef.current !== null) {
        window.clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
    };
  }, [isLoadingMore]);

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
  const mobileExpertMode = isMobile && expertMode;

  const showAvatarColumn = !isMobile;
  const showPosColumn = !isMobile;
  const showAgeColumn = !isMobile;
  const showTierColumn = !isMobile;
  const showVsConsColumn = !isMobile || expertMode;
  const showExpertColumns = !isMobile;

  const consensusAvgSortActive = !activeExpertKey && sortKey === "avgRank";

  const sortHeaderBtn = (key: SortKey, label: ReactNode, sortArrowActive?: boolean) => (
    <button type="button" className="dr-th-btn" onClick={() => onSort(key)}>
      <span>{label}</span>
      <SortArrow active={sortArrowActive ?? sortKey === key} dir={arrowDir} />
    </button>
  );

  const endIdx = shown.length;

  return (
    <>
      <div ref={scrollRef} className="dr-table-scroll">
        <div
          style={{
            fontSize: 11,
            color: "#9a9aaa",
            padding: "4px 0 2px 0",
            maxWidth: 1200,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          <span>{rankedByExpertLabel ? `Ranked by ${rankedByExpertLabel}` : "Ranked by Consensus"}</span>
          <span style={{ marginLeft: 10, opacity: 0.5 }}>{versionLabel}</span>
        </div>
        <table className="dr-table">
          <colgroup>
            <col className="dr-col-cg-rank" style={{ width: 50 }} />
            {showAvatarColumn ? <col className="dr-col-cg-avatar" style={{ width: 44 }} /> : null}
            <col className="dr-col-cg-player" style={{ width: 180 }} />
            <col className="dr-col-cg-team" style={{ width: isMobile ? 30 : 110 }} />
            {showPosColumn ? <col className="dr-col-cg-pos" style={{ width: 55 }} /> : null}
            {showAgeColumn ? <col className="dr-col-cg-age" style={{ width: 60 }} /> : null}
            <col className="dr-col-cg-avg" style={{ width: 90 }} />
            {showTierColumn ? <col className="dr-col-cg-tier" style={{ width: 60 }} /> : null}
            {showVsConsColumn ? <col className="dr-col-cg-vscons" style={{ width: 80 }} /> : null}
            {showExpertColumns
              ? EXPERT_ORDER.map((e) => <col key={e.key} style={{ width: e.wide ? 75 : 65 }} />)
              : null}
          </colgroup>
          <thead className="dr-table-head">
            <tr>
              <th scope="col" className="dr-th dr-th-sort dr-col-rank dr-th-rank-consensus">
                <button type="button" className="dr-th-btn" onClick={() => onSort("consensusRank")}>
                  <span className="dr-th-rank-long">RANK</span>
                  <span className="dr-th-rank-short">#</span>
                </button>
              </th>
              {showAvatarColumn ? <th scope="col" className="dr-th dr-col-avatar dr-desktop-only" aria-label="Avatar" /> : null}
              <th scope="col" className="dr-th dr-th-sort dr-player-col">{sortHeaderBtn("player", "PLAYER")}</th>
              <th scope="col" className="dr-th dr-th-sort dr-col-team dr-th-numeric">
                <button type="button" className="dr-th-btn" onClick={() => onSort("team")}>
                  <span className="dr-th-team-long">TEAM</span>
                  <span className="dr-th-team-short">TM</span>
                  <SortArrow active={sortKey === "team"} dir={arrowDir} />
                </button>
              </th>
              {showPosColumn ? (
                <th scope="col" className="dr-th dr-th-sort dr-col-pos dr-th-numeric">
                  {sortHeaderBtn("position", "POS")}
                </th>
              ) : null}
              {showAgeColumn ? (
                <th scope="col" className="dr-th dr-th-sort dr-col-age dr-th-numeric dr-col-age-responsive dr-desktop-only">
                  {sortHeaderBtn("age", "AGE")}
                </th>
              ) : null}
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
              {showTierColumn ? (
                <th scope="col" className="dr-th dr-th-sort dr-col-tier dr-th-tier-head dr-desktop-only">
                  {sortHeaderBtn("tier", "TIER")}
                </th>
              ) : null}
              {showVsConsColumn ? (
                <th scope="col" className="dr-th dr-col-vscons dr-th-vscons-head">
                  {mobileExpertMode ? "VS" : "VS CONS"}
                </th>
              ) : null}
              {showExpertColumns
                ? EXPERT_ORDER.map(({ key, label, wide }) => {
                    const sk = `expert:${key}` as SortKey;
                    const isActiveSort = sortKey === sk;
                    return (
                      <th
                        key={key}
                        scope="col"
                        className={`dr-th dr-th-sort dr-th-expert dr-th-numeric ${wide ? "dr-col-w-hashtag" : "dr-col-w-expert"} ${activeExpertKey === key ? "dr-th-active-sort" : ""}`.trim()}
                      >
                        <button type="button" className="dr-th-btn" onClick={() => onSort(sk)}>
                          <span>{label}</span>
                          <SortArrow active={isActiveSort} dir={arrowDir} />
                        </button>
                      </th>
                    );
                  })
                : null}
            </tr>
          </thead>
          <tbody>
            {shown.map((p, i) => {
              const activeRank = activeRankForView(p, activeExpertKey);
              const rankStyle = { color: rankColorForTier(p.tier) };
              const isSophomore = !p.isRookie && sophomoreNames.has(normalizePlayerName(p.player));

              return (
                <tr key={`${p.consensusRank}-${p.player}-${i}`} className="dr-tr" onClick={() => onPlayerClick(p)}>
                  <td className="dr-td dr-col-rank">
                    {activeRank !== null ? (
                      <span className="dr-rank-num" style={rankStyle}>
                        {activeRank}
                      </span>
                    ) : (
                      <span className="dr-rank-nr">N/R</span>
                    )}
                  </td>
                  {showAvatarColumn ? (
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
                          overflow: "hidden",
                          position: "relative",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {/* Initials are the base layer (always rendered). Headshot img is layered on top and hides itself on error. */}
                        <span aria-hidden>{playerInitials(p.player)}</span>
                        {(() => {
                          const url = playerHeadshotUrl(p);
                          if (!url) return null;
                          return (
                            <img
                              src={url}
                              alt=""
                              width={44}
                              height={44}
                              style={{
                                position: "absolute",
                                inset: 0,
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                                objectPosition: "center top",
                                display: "block",
                              }}
                              onError={(e) => {
                                // Hide the broken image so the initials show through.
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                              }}
                              loading="lazy"
                            />
                          );
                        })()}
                      </span>
                    </td>
                  ) : null}
                  <td className="dr-td dr-player-col">
                    <div className="dr-player-inner-row">
                      <div className="dr-player-info-stack">
                        <div className="dr-player-name-line">
                          {isMobile ? (
                            <>
                              <span style={mobilePositionBadgeStyle(p.position)}>{p.position}</span>
                              <span title={p.player}>{shortenPlayerName(p.player)}</span>
                              {p.isRookie ? (
                                <span className="dr-rookie-badge" title="2026 Rookie">
                                  R
                                </span>
                              ) : isSophomore ? (
                                <span className="dr-soph-badge" title="Sophomore">
                                  S
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <>
                              {p.player}
                              {p.isRookie ? (
                                <span className="dr-rookie-badge" title="2026 Rookie">
                                  R
                                </span>
                              ) : isSophomore ? (
                                <span className="dr-soph-badge" title="Sophomore">
                                  S
                                </span>
                              ) : null}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="dr-td dr-col-team">
                    <TeamCell team={p.team} size={isMobile ? 20 : 32} />
                  </td>
                  {showPosColumn ? (
                    <td className="dr-td dr-col-pos">{isMobile ? p.position : <PositionBadge position={p.position} />}</td>
                  ) : null}
                  {showAgeColumn ? (
                    <td className="dr-td dr-col-age dr-td-numeric dr-col-age-responsive dr-mono dr-desktop-only">
                      {p.age !== null ? p.age.toFixed(1) : "—"}
                    </td>
                  ) : null}
                  <td className="dr-td dr-col-avg dr-td-numeric dr-mono">{p.avgRank.toFixed(1)}</td>
                  {showTierColumn ? (
                    <td className="dr-td dr-col-tier dr-td-tier-cell dr-desktop-only">
                      <span className={tierBadgeClass(p.tier)}>T{p.tier}</span>
                    </td>
                  ) : null}
                  {showVsConsColumn ? (
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
                  ) : null}
                  {showExpertColumns
                    ? EXPERT_ORDER.map(({ key }) => {
                        const er = expertRankValue(p, key);
                        const tint = expertTintClass(p.consensusRank, er);
                        return (
                          <td
                            key={key}
                            className={`dr-td dr-td-expert dr-mono ${tint}`.trim()}
                          >
                            {er !== null ? er : "—"}
                          </td>
                        );
                      })
                    : null}
                </tr>
              );
            })}
          </tbody>
        </table>

        {isLoadingMore ? (
          <p style={{ fontSize: 11, color: "#9a9aaa", padding: "8px 0 2px 0", textAlign: "center" }}>Loading...</p>
        ) : null}

        {sorted.length > 0 ? (
          <p style={{ fontSize: 11, color: "#9a9aaa", padding: "6px 0 0 0", textAlign: "center" }}>
            Showing {endIdx} of {sorted.length} players
          </p>
        ) : null}

        {hasMore ? <div ref={sentinelRef} style={{ height: 1, width: "100%" }} aria-hidden /> : null}
        {!hasMore && !isLoadingMore ? (
          <>
            <section
              aria-label="About these dynasty rankings"
              style={{ padding: "40px 32px 56px", maxWidth: 860, margin: "0 auto", color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7 }}
            >
              <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--text-secondary)" }}>
                About the FHE Dynasty Consensus Rankings
              </h2>
              <p>
                The Fantasy Hoops Edge dynasty consensus rankings aggregate expert dynasty ranks from five
                sources — Dynatyze, Dizzle Dynasty, Angle Fantasy Basketball, Hashtag Basketball, and
                Moneyballers — into a single consensus list of 446 players, updated each season. The list
                is built specifically for 9-category roto dynasty leagues of 16 or more teams, where
                category balance and long-term asset value matter more than simple points production.
              </p>
              <p style={{ marginTop: 12 }}>
                Rankings are sorted by average expert rank across all five panels. Victor Wembanyama (SAS)
                leads the consensus at #1, followed by Shai Gilgeous-Alexander (OKC) at #2 and Luka
                Doncic (LAL) at #3. Each player row shows individual expert ranks side-by-side so you can
                see where panelists agree and where they diverge — useful for identifying undervalued or
                overvalued assets in trade negotiations.
              </p>
              <p style={{ marginTop: 12 }}>
                For 9-category leagues, dynasty value is driven by multi-category contributors who score
                points, add assists and rebounds, and contribute in peripheral categories like steals,
                blocks, field-goal percentage, and three-pointers made without hurting you in turnovers or
                free-throw percentage. The consensus rank reflects that multi-category lens across all five
                expert panels.
              </p>
            </section>
            <Footer />
          </>
        ) : null}
      </div>
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
