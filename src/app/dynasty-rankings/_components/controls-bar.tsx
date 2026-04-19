"use client";

import { useMemo } from "react";

const POSITIONS = ["PG", "SG", "SF", "PF", "C"] as const;

type ViewMode = "table" | "tiers";

export function ControlsBar(props: {
  teams: string[];
  selectedPositions: Set<string>;
  setSelectedPositions: (next: Set<string>) => void;
  teamFilter: string;
  setTeamFilter: (v: string) => void;
  search: string;
  setSearch: (v: string) => void;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  expertBreakdown: boolean;
  setExpertBreakdown: (v: boolean) => void;
}) {
  const {
    teams,
    selectedPositions,
    setSelectedPositions,
    teamFilter,
    setTeamFilter,
    search,
    setSearch,
    viewMode,
    setViewMode,
    expertBreakdown,
    setExpertBreakdown,
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
      <div className="dr-controls-row">
        <div className="dr-filter-group">
          <span className="dr-filter-label">Position</span>
          <div className="dr-pill-row">
            <button
              type="button"
              className={`dr-pill ${selectedPositions.size === 0 ? "dr-pill-active" : ""}`}
              onClick={clearPositions}
            >
              All
            </button>
            {POSITIONS.map((pos) => (
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

        <div className="dr-filter-group dr-team-search">
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

        <div className="dr-filter-group dr-grow">
          <label className="dr-filter-label" htmlFor="dr-search">
            Search
          </label>
          <input
            id="dr-search"
            type="search"
            className="dr-input"
            placeholder="Player name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="dr-controls-row dr-controls-row-actions">
        <div className="dr-view-toggle" role="group" aria-label="View mode">
          <button
            type="button"
            className={`dr-icon-toggle ${viewMode === "table" ? "dr-icon-toggle-on" : ""}`}
            onClick={() => setViewMode("table")}
            title="Table view"
            aria-pressed={viewMode === "table"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M4 6h16M4 12h16M4 18h10"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <span>Table</span>
          </button>
          <button
            type="button"
            className={`dr-icon-toggle ${viewMode === "tiers" ? "dr-icon-toggle-on" : ""}`}
            onClick={() => setViewMode("tiers")}
            title="Tier view"
            aria-pressed={viewMode === "tiers"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M4 16h16v3H4v-3zM7 9h10v4H7V9zM10 3h4v4h-4V3z"
                fill="currentColor"
              />
            </svg>
            <span>Tiers</span>
          </button>
        </div>

        <label className="dr-checkbox">
          <input
            type="checkbox"
            checked={expertBreakdown}
            onChange={(e) => setExpertBreakdown(e.target.checked)}
          />
          <span>Show expert breakdown</span>
        </label>
      </div>
    </div>
  );
}
