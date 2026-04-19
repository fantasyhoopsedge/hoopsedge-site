"use client";

import { useMemo, useState } from "react";
import { DYNASTY_RANKINGS, type DynastyPlayer } from "@/lib/dynasty-rankings";
import { ControlsBar } from "./_components/controls-bar";
import { RankingsTable, type SortKey } from "./_components/rankings-table";
import { TierView } from "./_components/tier-view";

const UPDATED_LABEL = "April 2026";

function normalizeSearch(s: string) {
  return s.trim().toLowerCase();
}

export default function DynastyRankingsPage() {
  const data = DYNASTY_RANKINGS;

  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set());
  const [teamFilter, setTeamFilter] = useState("");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "tiers">("table");
  const [expertBreakdown, setExpertBreakdown] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("consensusRank");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [tierCollapsed, setTierCollapsed] = useState<Record<number, boolean>>({});

  const teams = useMemo(() => {
    const set = new Set<string>();
    for (const p of data) set.add(p.team);
    return Array.from(set);
  }, [data]);

  const filtered = useMemo(() => {
    let rows: DynastyPlayer[] = data;
    const q = normalizeSearch(search);

    if (selectedPositions.size > 0) {
      rows = rows.filter((p) => selectedPositions.has(p.position));
    }
    if (teamFilter) {
      rows = rows.filter((p) => p.team === teamFilter);
    }
    if (q) {
      rows = rows.filter((p) => p.player.toLowerCase().includes(q));
    }
    return rows;
  }, [data, selectedPositions, teamFilter, search]);

  const onSort = (key: SortKey) => {
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

  return (
    <>
      <nav>
        <a href="/" style={{ textDecoration: "none" }}>
          <div className="nav-brand">
            Fantasy Hoops <span className="accent">Edge</span>
          </div>
        </a>
        <ul className="nav-links">
          <li>
            <a href="/dynasty-rankings" style={{ color: "var(--edge-orange)" }}>
              Rankings
            </a>
          </li>
          <li>
            <a href="/draft-board">Draft Board</a>
          </li>
          <li>
            <a href="#">Prospect Lab</a>
          </li>
          <li>
            <a href="#">Predictions</a>
          </li>
          <li>
            <a href="#" className="nav-cta">
              Join Free
            </a>
          </li>
        </ul>
      </nav>

      <div className="dr-rankings-hero">
        <div className="dr-rankings-hero-deco" aria-hidden>
          EDGE
        </div>
        <div
          style={{
            fontFamily: "'Oswald', sans-serif",
            fontSize: "11px",
            letterSpacing: "3px",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.55)",
            marginBottom: "8px",
          }}
        >
          9-Cat Dynasty · Deep League Context
        </div>
        <h1
          style={{
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 800,
            fontSize: "48px",
            textTransform: "uppercase",
            color: "white",
            letterSpacing: "1px",
            marginBottom: "8px",
          }}
        >
          Dynasty <span style={{ color: "var(--dynasty-gold)" }}>Rankings</span>
        </h1>
        <p
          style={{
            fontSize: "16px",
            color: "rgba(255,255,255,0.6)",
            maxWidth: "520px",
            lineHeight: 1.6,
          }}
        >
          9-Cat Consensus · 6 Expert Sources · Updated {UPDATED_LABEL}
        </p>
        <div className="dr-hero-badges">
          <span className="dr-experts-pill">6 EXPERTS</span>
        </div>
      </div>

      <div className="dr-sticky-controls">
        <div className="dr-page-gutter">
          <ControlsBar
            teams={teams}
            selectedPositions={selectedPositions}
            setSelectedPositions={setSelectedPositions}
            teamFilter={teamFilter}
            setTeamFilter={setTeamFilter}
            search={search}
            setSearch={setSearch}
            viewMode={viewMode}
            setViewMode={setViewMode}
            expertBreakdown={expertBreakdown}
            setExpertBreakdown={setExpertBreakdown}
          />
        </div>
      </div>

      <div className="dr-rankings-main">
        {empty ? (
          <p className="dr-empty">Rankings loading — check back soon.</p>
        ) : noFilterResults ? (
          <p className="dr-empty">No players match these filters.</p>
        ) : viewMode === "table" ? (
          <RankingsTable
            rows={filtered}
            expertBreakdown={expertBreakdown}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
          />
        ) : (
          <TierView rows={filtered} collapsed={tierCollapsed} toggleTier={toggleTier} />
        )}
      </div>

      <footer>
        <div>
          <div className="footer-brand">
            Fantasy Hoops <span className="accent">Edge</span>
          </div>
          <p className="dr-footer-tagline">
            Dynasty Edge. Built for Category Leagues. Built for Deep Leagues.
          </p>
        </div>
        <div className="footer-links">
          <a href="/">Home</a>
          <a href="/dynasty-rankings">Rankings</a>
          <a href="/draft-board">Draft Board</a>
          <a href="#">Prospect Lab</a>
        </div>
        <div className="footer-social">
          <a href="#" title="X / Twitter">
            𝕏
          </a>
        </div>
      </footer>
    </>
  );
}
