"use client";

import { useEffect, useMemo, useState } from "react";
import { DYNASTY_RANKINGS, activeRankForView, type DynastyPlayer } from "@/lib/dynasty-rankings";
import { PlatformSidebarNav } from "@/components/platform-sidebar-nav";
import { ControlsBar, type RankRangeKey } from "./_components/controls-bar";
import { RankingsTable, type SortKey } from "./_components/rankings-table";
import { TierView } from "./_components/tier-view";

// ── Version registry ─────────────────────────────────────────────────────────
// To add a new version:
//   1. Run: node scripts/snapshot-rankings.js --version 1.1 --date "July 2026" ...
//   2. Set isCurrent: false on the previous entry
//   3. Add the new entry below with isCurrent: true
// Version numbering: 1.0 → 1.1 → ... → 1.99 → 2.0
export type VersionMeta = {
  id: string;
  label: string;
  date: string;
  isCurrent: boolean;
  expertDates: Record<string, string>;
};

const VERSIONS: VersionMeta[] = [
  {
    id: "1.0",
    label: "v1.0",
    date: "June 2026",
    isCurrent: true,
    expertDates: {
      dizzle:   "April 2026",
      mball:    "April 2026",
      angle:    "May 2026",
      dynatyze: "June 2026",
      hashtag:  "June 2026",
    },
  },
];

const CURRENT_VERSION = VERSIONS.find((v) => v.isCurrent) ?? VERSIONS[VERSIONS.length - 1];

const EXPERT_NAMES: Record<string, string> = {
  dizzle:   "Dizzle",
  angle:    "Angle",
  mball:    "MBall",
  hashtag:  "Hashtag",
  dynatyze: "Dynatyze",
};

type VersionRanking = {
  player: string;
  consensusRank: number;
  avgRank: number;
  tier: number;
  expertRanks: Record<string, number | null>;
};

type VersionSnapshot = {
  version: string;
  expertDates: Record<string, string>;
  rankings: VersionRanking[];
};

function normalizeSearch(s: string) {
  return s.trim().toLowerCase();
}

function isProspect(p: DynastyPlayer) {
  return p.isRookie;
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
  const [selectedVersionId, setSelectedVersionId] = useState(CURRENT_VERSION.id);
  const [versionSnapshot, setVersionSnapshot] = useState<VersionSnapshot | null>(null);

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
  const [isMobileNav, setIsMobileNav] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => {
      const mobile = mq.matches;
      setIsMobileNav(mobile);
      if (mobile) setViewMode("table");
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Load historical snapshot when a past version is selected
  useEffect(() => {
    if (selectedVersionId === CURRENT_VERSION.id) {
      setVersionSnapshot(null);
      return;
    }
    fetch(`/data/versions/v${selectedVersionId}.json`)
      .then((r) => r.json())
      .then((snap: VersionSnapshot) => setVersionSnapshot(snap))
      .catch(() => setVersionSnapshot(null));
  }, [selectedVersionId]);

  // Overlay historical ranks on current player metadata when viewing a past version
  const displayData = useMemo<DynastyPlayer[]>(() => {
    if (!versionSnapshot) return DYNASTY_RANKINGS;
    const rankMap = new Map<string, VersionRanking>();
    for (const r of versionSnapshot.rankings) rankMap.set(r.player, r);
    return DYNASTY_RANKINGS
      .map((p) => {
        const hist = rankMap.get(p.player);
        if (!hist) return null;
        return { ...p, consensusRank: hist.consensusRank, expertRanks: hist.expertRanks, avgRank: hist.avgRank, tier: hist.tier };
      })
      .filter((p): p is DynastyPlayer => p !== null)
      .sort((a, b) => a.consensusRank - b.consensusRank);
  }, [versionSnapshot]);

  const selectedVersion = VERSIONS.find((v) => v.id === selectedVersionId) ?? CURRENT_VERSION;

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
    for (const p of DYNASTY_RANKINGS) set.add(p.team);
    return Array.from(set);
  }, []);

  const filtered = useMemo(() => {
    let rows: DynastyPlayer[] = displayData;
    const q = normalizeSearch(search);

    if (rankRange === "rookies2026") {
      rows = rows.filter((p) => p.isRookie);
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
  }, [displayData, selectedPositions, teamFilter, search, rankRange, tierFilter, expertSortKey]);

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

  const empty = displayData.length === 0;
  const noFilterResults = !empty && filtered.length === 0;

  // Build the expert label with date from the selected version
  const expertDate = expertSortKey ? (selectedVersion.expertDates[expertSortKey] ?? "") : "";
  const rankedByExpertLabel = expertSortKey
    ? `${EXPERT_NAMES[expertSortKey] ?? expertSortKey.toUpperCase()}${expertDate ? ` (${expertDate})` : ""}`
    : null;

  const versionLabel = `${selectedVersion.label} · ${selectedVersion.date}`;

  return (
    <div className="dr-rankings-shell">
      <PlatformSidebarNav active="dynasty" />

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
              versions={VERSIONS}
              selectedVersionId={selectedVersionId}
              setSelectedVersionId={setSelectedVersionId}
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
            style={{ width: "100%" }}
          >
            {viewMode === "table" || isMobileNav ? (
              <RankingsTable
                rows={filtered}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                activeExpertKey={expertSortKey}
                rankedByExpertLabel={rankedByExpertLabel}
                versionLabel={versionLabel}
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
