"use client";

import { useMemo } from "react";

const POSITION_OPTIONS = ["G", "F", "C", "G/F", "F/C"] as const;

export type RankRangeKey =
  | "top100"
  | "101-200"
  | "201-300"
  | "301-450"
  | "all"
  | "rookies2026";

type ViewMode = "table" | "tiers";

const RANGE_OPTIONS: { key: RankRangeKey; label: string }[] = [
  { key: "top100", label: "Top 100" },
  { key: "101-200", label: "101–200" },
  { key: "201-300", label: "201–300" },
  { key: "301-450", label: "301–450" },
  { key: "all", label: "All" },
];

const EXPERT_OPTIONS = [
  { key: "", label: "All Experts" },
  { key: "matt", label: "Matt" },
  { key: "dizzle", label: "Dizzle" },
  { key: "angle", label: "Angle" },
  { key: "mball", label: "MBall" },
  { key: "hashtag", label: "Hashtag" },
  { key: "noah", label: "Noah" },
] as const;

export function ControlsBar(props: {
  teams: string[];
  rankRange: RankRangeKey;
  setRankRange: (v: RankRangeKey) => void;
  selectedPositions: Set<string>;
  setSelectedPositions: (next: Set<string>) => void;
  tierFilter: number;
  setTierFilter: (v: number) => void;
  expertSortKey: string;
  setExpertSortKey: (v: string) => void;
  teamFilter: string;
  setTeamFilter: (v: string) => void;
  search: string;
  setSearch: (v: string) => void;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
}) {
  const {
    teams,
    rankRange,
    setRankRange,
    selectedPositions,
    setSelectedPositions,
    tierFilter,
    setTierFilter,
    expertSortKey,
    setExpertSortKey,
    teamFilter,
    setTeamFilter,
    search,
    setSearch,
    viewMode,
    setViewMode,
  } = props;

  const teamOptions = useMemo(() => teams.slice().sort((a, b) => a.localeCompare(b)), [teams]);

  const togglePosition = (pos: string) => {
    const next = new Set(selectedPositions);
    if (next.has(pos)) next.delete(pos);
    else next.add(pos);
    setSelectedPositions(next);
  };

  const clearPositions = () => setSelectedPositions(new Set());

  return (
    <div className="dr-controls-inner">
      <div className="dr-controls-row dr-controls-row-1">
        <div className="dr-pills-desktop-layout">
        <div className="dr-filter-group dr-range-wrap">
          <span className="dr-filter-label">Range</span>
          <div className="dr-pill-row">
            {RANGE_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={`dr-pill ${rankRange === key ? "dr-pill-active" : ""}`}
                onClick={() => setRankRange(key)}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={`dr-pill ${rankRange === "rookies2026" ? "dr-pill-active dr-pill-active-rookies" : ""}`}
              onClick={() => setRankRange("rookies2026")}
            >
              2026 ROOKIES
            </button>
          </div>
        </div>

        <div className="dr-filter-group dr-pos-wrap">
          <span className="dr-filter-label">Position</span>
          <div className="dr-pill-row">
            <button
              type="button"
              className={`dr-pill ${selectedPositions.size === 0 ? "dr-pill-active" : ""}`}
              onClick={clearPositions}
            >
              ALL
            </button>
            {POSITION_OPTIONS.map((pos) => (
              <button
                key={pos}
                type="button"
                className={`dr-pill ${selectedPositions.has(pos) ? "dr-pill-active" : ""}`}
                onClick={() => togglePosition(pos)}
              >
                {pos}
              </button>
            ))}
          </div>
        </div>
        </div>
      </div>

      <div className="dr-controls-row dr-controls-row-2">
        <div className="dr-controls-row-2-fields">
          <div className="dr-filter-group dr-field-tier">
            <label className="dr-filter-label" htmlFor="dr-tier">
              Tier
            </label>
            <select
              id="dr-tier"
              className="dr-select"
              value={tierFilter === 0 ? "" : String(tierFilter)}
              onChange={(e) => setTierFilter(e.target.value === "" ? 0 : Number(e.target.value))}
            >
              <option value="">All Tiers</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((t) => (
                <option key={t} value={t}>
                  Tier {t}
                </option>
              ))}
            </select>
          </div>

        <div className="dr-filter-group dr-field-expert">
          <label className="dr-filter-label" htmlFor="dr-expert-sort">
            Expert
          </label>
          <select
            id="dr-expert-sort"
            className="dr-select"
            value={expertSortKey}
            onChange={(e) => setExpertSortKey(e.target.value)}
          >
            {EXPERT_OPTIONS.map(({ key, label }) => (
              <option key={key || "all"} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="dr-filter-group dr-field-team">
          <label className="dr-filter-label" htmlFor="dr-team">
            Team
          </label>
          <select
            id="dr-team"
            className="dr-select"
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
          >
            <option value="">All Teams</option>
            {teamOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="dr-filter-group dr-search-wrap dr-field-search">
          <label className="dr-filter-label" htmlFor="dr-search">
            Search
          </label>
          <div className="dr-input-icon-wrap">
            <span className="dr-input-prefix" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4-4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <input
              id="dr-search"
              type="search"
              className="dr-input dr-input-search"
              placeholder="Player name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        <div className="dr-filter-group dr-view-row">
          <span className="dr-filter-label">View</span>
          <div className="dr-view-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className={`dr-icon-toggle ${viewMode === "table" ? "dr-icon-toggle-on" : ""}`}
              onClick={() => setViewMode("table")}
              title="Table view"
              aria-pressed={viewMode === "table"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span>Table</span>
            </button>
            <button
              type="button"
              className={`dr-icon-toggle dr-view-tier-toggle ${viewMode === "tiers" ? "dr-icon-toggle-on" : ""}`}
              onClick={() => setViewMode("tiers")}
              title="Tier view"
              aria-pressed={viewMode === "tiers"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M4 16h16v3H4v-3zM7 9h10v4H7V9zM10 3h4v4h-4V3z" fill="currentColor" />
              </svg>
              <span>Tiers</span>
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
