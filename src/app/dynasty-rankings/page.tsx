"use client";

import { useMemo, useState } from "react";
import { DYNASTY_RANKINGS, activeRankForView, type DynastyPlayer } from "@/lib/dynasty-rankings";
import { SiteNav } from "@/components/site-nav";
import { ControlsBar, type RankRangeKey } from "./_components/controls-bar";
import { RankingsTable, type SortKey } from "./_components/rankings-table";
import { TierView } from "./_components/tier-view";

const MAX_TABLE_ROWS = 50;

const EXPERT_NAMES: Record<string, string> = {
  matt: "MATT",
  dizzle: "DIZZLE",
  angle: "ANGLE",
  jason: "JASON",
  hashtag: "HASHTAG",
  noah: "NOAH",
};

const EXPERT_DATES: Record<string, string> = {
  matt: "Feb 2026",
  dizzle: "Apr 2026",
  angle: "May 2026",
  jason: "Dec 2025",
  hashtag: "2025-26",
  noah: "Jan 2026",
};

function normalizeSearch(s: string) {
  return s.trim().toLowerCase();
}

function isProspect(p: DynastyPlayer) {
  return p.team === "2026 Rookie";
}

function rankInRange(p: DynastyPlayer, range: RankRangeKey, expertKey: string): boolean {
  if (range === "all" || range === "rookies2026") return true;
  const r = expertKey ? activeRankForView(p, expertKey) : p.consensusRank;
  if (r === null) return false;
  if (range === "top100") return r >= 1 && r <= 100;
  if (range === "101-200") return r >= 101 && r <= 200;
  if (range === "201-300") return r >= 201 && r <= 300;
  if (range === "301-450") return r >= 301 && r <= 450;
  return true;
}

export default function DynastyRankingsPage() {
  const data = DYNASTY_RANKINGS;

  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set());
  const [teamFilter, setTeamFilter] = useState("");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "tiers">("table");
  const [rankRange, setRankRange] = useState<RankRangeKey>("all");
  const [tierFilter, setTierFilter] = useState(0);
  const [expertSortKey, setExpertSortKey] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("avgRank");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [tierCollapsed, setTierCollapsed] = useState<Record<number, boolean>>({});

  const syncExpertSortKeyFromControls = (v: string) => {
    setExpertSortKey(v);
    if (v) {
      setSortKey(`expert:${v}` as SortKey);
    } else {
      setSortKey("avgRank");
    }
    setSortDir(1);
  };

  const teams = useMemo(() => {
    const set = new Set<string>();
    for (const p of data) set.add(p.team);
    return Array.from(set);
  }, [data]);

  const totalProspectsAll = useMemo(() => data.filter(isProspect).length, [data]);

  const filtered = useMemo(() => {
    let rows: DynastyPlayer[] = data;
    const q = normalizeSearch(search);

    if (rankRange === "rookies2026") {
      rows = rows.filter((p) => p.team === "2026 Rookie");
    } else {
      rows = rows.filter((p) => rankInRange(p, rankRange, expertSortKey));
    }

    if (selectedPositions.size > 0) {
      rows = rows.filter((p) => selectedPositions.has(p.position));
    }
    if (tierFilter > 0) {
      rows = rows.filter((p) => p.tier === tierFilter);
    }
    if (teamFilter) {
      rows = rows.filter((p) => p.team === teamFilter);
    }
    if (q) {
      rows = rows.filter((p) => p.player.toLowerCase().includes(q));
    }
    return rows;
  }, [data, selectedPositions, teamFilter, search, rankRange, tierFilter, expertSortKey]);

  const prospectCountInFilter = useMemo(() => filtered.filter(isProspect).length, [filtered]);

  const onSort = (key: SortKey) => {
    if (key === "avgRank" || key === "consensusRank") {
      if (expertSortKey) {
        setExpertSortKey("");
        setSortKey("avgRank");
        setSortDir(1);
        return;
      }
      if (sortKey === "avgRank") {
        setSortDir((d) => (d === 1 ? -1 : 1));
      } else {
        setSortKey("avgRank");
        setSortDir(1);
      }
      return;
    }
    if (key.startsWith("expert:")) {
      const id = key.replace("expert:", "");
      if (expertSortKey !== id) {
        setExpertSortKey(id);
        setSortKey(`expert:${id}` as SortKey);
        setSortDir(1);
        return;
      }
      if (sortKey === key) {
        setSortDir((d) => (d === 1 ? -1 : 1));
      } else {
        setSortKey(key);
        setSortDir(1);
      }
      return;
    }
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  };

  const toggleTier = (tier: number) => {
    setTierCollapsed((prev) => ({ ...prev, [tier]: !prev[tier] }));
  };

  const empty = data.length === 0;
  const noFilterResults = !empty && filtered.length === 0;

  const infoStrip = expertSortKey ? (
    <>
      {EXPERT_NAMES[expertSortKey] ?? expertSortKey.toUpperCase()} · {filtered.length} Players · {prospectCountInFilter} Prospects ·
      Updated {EXPERT_DATES[expertSortKey] ?? ""}
    </>
  ) : (
    <>CONSENSUS · {data.length} Players · 6 Experts · {totalProspectsAll} Prospects</>
  );

  return (
    <div className="dr-rankings-shell">
      <SiteNav active="rankings" infoStrip={infoStrip} />

      <div className="dr-rankings-measured-top">
        <div className="dr-sticky-controls">
          <div className="dr-page-gutter">
            <ControlsBar
              teams={teams}
              rankRange={rankRange}
              setRankRange={setRankRange}
              selectedPositions={selectedPositions}
              setSelectedPositions={setSelectedPositions}
              tierFilter={tierFilter}
              setTierFilter={setTierFilter}
              expertSortKey={expertSortKey}
              setExpertSortKey={syncExpertSortKeyFromControls}
              teamFilter={teamFilter}
              setTeamFilter={setTeamFilter}
              search={search}
              setSearch={setSearch}
              viewMode={viewMode}
              setViewMode={setViewMode}
            />
          </div>
        </div>
      </div>

      <div className="dr-rankings-main">
        {empty ? (
          <p className="dr-empty">Rankings loading — check back soon.</p>
        ) : noFilterResults ? (
          <p className="dr-empty">No players match these filters.</p>
        ) : (
          <div
            className="dr-table-view-wrap"
            style={{ maxWidth: 1200, marginLeft: "auto", marginRight: "auto", width: "100%" }}
          >
            {viewMode === "table" ? (
              <RankingsTable
                rows={filtered}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                activeExpertKey={expertSortKey}
                rankedByExpertLabel={expertSortKey ? EXPERT_NAMES[expertSortKey] ?? expertSortKey.toUpperCase() : null}
                maxVisible={MAX_TABLE_ROWS}
              />
            ) : (
              <div className="dr-tier-view-scroll">
                <TierView
                  rows={filtered}
                  collapsed={tierCollapsed}
                  toggleTier={toggleTier}
                  activeExpertKey={expertSortKey}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
