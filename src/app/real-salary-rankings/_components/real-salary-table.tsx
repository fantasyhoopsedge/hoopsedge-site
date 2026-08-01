"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { PlatformSidebarNav } from "@/components/platform-sidebar-nav";
import { Footer } from "@/components/footer";
import { TEAM_LOGO, type Player } from "@/app/team-rosters/_components/roster-data";
import { NBA_TEAM_ABBRS } from "@/lib/nba-teams";
import { initials, money, fullMoney } from "@/app/team-rosters/_components/roster-helpers";
import { playerHeadshotUrl, normalizePlayerName } from "@/lib/dynasty-rankings";
import { shortenPlayerName } from "@/lib/shorten-name";
import { PlayerQuickViewModal } from "@/app/team-rosters/_components/player-quickview-modal";
import { SalaryContractCard } from "@/app/team-rosters/_components/salary-contract-card";
import {
  WEIGHT_PRESETS, ARCHETYPE_LABELS, ARCHETYPE_BLURB,
  computeMarketValue, rankBy, deriveValueVerdict,
  type Archetype, type RealSalaryFactors,
} from "@/lib/value/real-salary-model";

export type ClassId = "rook" | "soph" | "vet";
export type ContractBucket = "Rookie Scale" | "Standard" | "Other";

// Raw per-player inputs from the server — the three z-scored factors
// (consensus, production, salary/cheapness) plus display identity and the
// filter/display-only fields (class, contract, future salary years).
// Everything derived (expectedCapHit/surplusValue/ranks) is computed
// client-side per the selected archetype via
// src/lib/value/real-salary-model.ts, so switching lenses is instant with
// no round trip.
export type RealSalaryInputRow = {
  playerId: string;
  name: string;
  team: string | null;
  position: string | null;
  headshotId: string | null;
  consensusZ: number;
  productionZ: number;
  salaryZ: number;
  salary: number;
  salarySource: string;
  confidenceTier: string | null;
  consensusRank: number | null;
  classId: ClassId;
  contractBucket: ContractBucket;
  /** Fractional years, computed fresh from nba_roster.dob on every request —
   *  see page.tsx's ageFromDob. Null when dob is missing/unparseable. */
  age: number | null;
  /** 2027-28 / 2028-29 / 2029-30. nba_roster caps at 4 tracked years, so
   *  there's no 2030-31 field at all yet — see
   *  docs/real-salary-dynasty-rankings-brief.md's known gap. */
  salaryYr2: number | null;
  salaryYr3: number | null;
  salaryYr4: number | null;
};

// Re-exported for backward-compat callers; page.tsx imports this name.
export type RealSalaryRow = RealSalaryInputRow;

type DisplayRow = RealSalaryInputRow & {
  valueRank: number;
  surplusRank: number;
  surplusValue: number;
  expectedCapHit: number;
  delta: number | null;
};

type SortKey = "valueRank" | "surplusRank" | "consensusRank" | "delta" | "salary" | "expectedCapHit" | "surplusValue" | "age";
type SortDir = "asc" | "desc";

const ARCHETYPES: Archetype[] = ["balanced", "contending", "rebuilding"];
const POSITIONS = ["G", "F", "C"] as const;
const CLASS_DEFS: { id: ClassId; label: string }[] = [
  { id: "rook", label: "ROOKIES" },
  { id: "soph", label: "SOPHOMORES" },
  { id: "vet", label: "VETERANS" },
];
const CONTRACT_DEFS: ContractBucket[] = ["Rookie Scale", "Standard", "Other"];

// Salary Range — single-select contiguous buckets on the current-season
// (2026-27) cap hit, same interaction model as dynasty-rankings' Range pills
// (RankRangeKey in controls-bar.tsx: click one bucket at a time, ALL clears
// it). Bounds are inclusive on the top edge only, so $10M lands in the first
// bucket and $20M in the second, with no overlap/gap between buckets.
type SalaryRangeKey = "under10" | "10-20" | "20-30" | "30-40" | "40plus" | "all";
const SALARY_RANGE_DEFS: { key: SalaryRangeKey; label: string; min: number; max: number }[] = [
  { key: "under10", label: "$10M OR UNDER", min: -Infinity, max: 10_000_000 },
  { key: "10-20", label: "$10M–$20M", min: 10_000_000, max: 20_000_000 },
  { key: "20-30", label: "$20M–$30M", min: 20_000_000, max: 30_000_000 },
  { key: "30-40", label: "$30M–$40M", min: 30_000_000, max: 40_000_000 },
  { key: "40plus", label: "$40M+", min: 40_000_000, max: Infinity },
];
function inSalaryRange(salary: number, key: SalaryRangeKey): boolean {
  if (key === "all") return true;
  const def = SALARY_RANGE_DEFS.find((d) => d.key === key);
  if (!def) return true;
  return salary > def.min && salary <= def.max;
}

// dynasty-rankings.json/TEAM_LOGO's keys (src/lib/nba-teams.ts). "FA" (free
// agent) isn't a real team, so it stays as text — same convention as
// dynasty-rankings' rankings-table.tsx TeamCell.
const NON_TEAM_VALUES = new Set(["FA"]);

/** Team logo cell — byte-identical pattern to dynasty-rankings' TeamCell so
 *  the two pages render team identity the same way (including the size prop
 *  used to shrink the logo on mobile). */
function TeamCell({ team, size = 32 }: { team: string | null; size?: number }) {
  const [ok, setOk] = useState(true);
  const t = team ?? "FA";
  if (NON_TEAM_VALUES.has(t)) {
    return <span className="dr-team-pill">{t}</span>;
  }
  const file = TEAM_LOGO[t];
  if (!file || !ok) return <span className="dr-team-pill">{t}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static team wordmark from public/
    <img
      src={`/images/nba%20team%20images/${file}`}
      alt={t}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setOk(false)}
      className="dr-team-logo"
      style={size !== 32 ? { width: size, height: size } : undefined}
    />
  );
}

// One accent family (rt-primary + its darker shade) inline position badge
// for the mobile player cell — identical to dynasty-rankings'
// mobilePositionBadgeStyle (rankings-table.tsx), reimplemented locally for
// the same reason PositionBadge above is: real-salary's position string
// isn't typed as the narrower DynastyPosition union.
function mobilePositionBadgeStyle(position: string | null): CSSProperties {
  const normalized = (position ?? "").toUpperCase();
  let background = "var(--rt-primary)";
  const color = "var(--rt-on-primary)";
  if (normalized === "G/F" || normalized === "F/C") {
    background = "linear-gradient(135deg, var(--rt-primary) 0 50%, var(--rt-primary-active) 50% 100%)";
  }
  return {
    width: 18, height: 18, borderRadius: 4, fontSize: 9, fontWeight: 700,
    color, background, display: "inline-flex", alignItems: "center", justifyContent: "center",
    marginRight: 5, flexShrink: 0, lineHeight: 1,
  };
}

/** Position badge — same visual classes as dynasty-rankings' PositionBadge,
 *  reimplemented locally so this file isn't coupled to DynastyPosition's
 *  narrower type (real-salary's position comes from live stats, not the
 *  bundled rankings JSON). Falls back to plain text for anything unexpected. */
function PositionBadge({ position }: { position: string | null }) {
  if (!position) return <span className="dr-vs-cons-muted">—</span>;
  if (position === "G/F") {
    return (
      <span className="dr-pos-split dr-pos-split-gf" aria-label="G/F">
        <span className="dr-pos-split-l">G</span>
        <span className="dr-pos-split-r">F</span>
      </span>
    );
  }
  if (position === "F/C") {
    return (
      <span className="dr-pos-split dr-pos-split-fc" aria-label="F/C">
        <span className="dr-pos-split-l">F</span>
        <span className="dr-pos-split-r">C</span>
      </span>
    );
  }
  if (position === "G" || position === "F" || position === "C") {
    const cls = position === "G" ? "dr-pos dr-pos-g" : position === "F" ? "dr-pos dr-pos-f" : "dr-pos dr-pos-c-single";
    return <span className={cls}>{position}</span>;
  }
  return <span>{position}</span>;
}

/** Avatar column — same initials-base + layered-headshot pattern as
 *  dynasty-rankings' dr-player-avatar, but sourced through
 *  playerHeadshotUrl's rookie-aware branch (prospect photo for incoming
 *  rookies, NBA CDN otherwise) since real-salary's rookie class is much
 *  larger than dynasty's per-page mix. */
function PlayerAvatar({ row }: { row: DisplayRow }) {
  const url = playerHeadshotUrl({ player: row.name, isRookie: row.classId === "rook" });
  return (
    <span className="dr-player-avatar" style={{ overflow: "hidden", position: "relative" }}>
      <span aria-hidden>{initials(row.name)}</span>
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", display: "block" }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          loading="lazy"
        />
      )}
    </span>
  );
}

// Same 2-tier green/red background-tint classes dynasty-rankings' expert
// columns use (dr-expert-tint-*, see rankings-table.tsx's expertTintClass) —
// reused here so the "at a glance" heat-map cue reads identically across
// both pages, just keyed off dollar amounts instead of rank deltas.
function salaryTintClass(amount: number | null): string {
  if (amount == null) return "";
  // Cheap cap hit = green (good value in a cap-constrained league), expensive = red.
  if (amount < 10_000_000) return "dr-expert-tint-up-strong";
  if (amount < 20_000_000) return "dr-expert-tint-up-subtle";
  if (amount >= 35_000_000) return "dr-expert-tint-down-strong";
  if (amount >= 20_000_000) return "dr-expert-tint-down-subtle";
  return "";
}

function surplusTintClass(amount: number): string {
  if (amount >= 20_000_000) return "dr-expert-tint-up-strong";
  if (amount >= 5_000_000) return "dr-expert-tint-up-subtle";
  if (amount <= -20_000_000) return "dr-expert-tint-down-strong";
  if (amount <= -5_000_000) return "dr-expert-tint-down-subtle";
  return "";
}

function DeltaCell({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="dr-vs-cons-muted">—</span>;
  if (delta === 0) return <span className="dr-vs-cons-cell dr-vs-cons-same">0</span>;
  const up = delta > 0;
  return (
    <span className={`dr-vs-cons-cell ${up ? "dr-vs-cons-up" : "dr-vs-cons-down"}`}>
      {up ? "↑" : "↓"}{Math.abs(delta)}
    </span>
  );
}

const defaultDir = (key: SortKey): SortDir => (key === "valueRank" || key === "surplusRank" || key === "consensusRank" || key === "age" ? "asc" : "desc");

function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="dr-sort-icon" aria-hidden />;
  return (
    <span className="dr-sort-icon dr-sort-icon-active" aria-hidden>
      {dir === "asc" ? "↑" : "↓"}
    </span>
  );
}

function Th({ label, k, title, sortKey, sortDir, onSort, className }: {
  label: string; k: SortKey; title?: string;
  sortKey: SortKey; sortDir: SortDir; onSort: (key: SortKey) => void; className?: string;
}) {
  const active = sortKey === k;
  return (
    <th
      scope="col"
      title={title}
      className={`dr-th dr-th-sort dr-th-numeric ${active ? "dr-th-active-sort" : ""} ${className ?? ""}`.trim()}
    >
      <button type="button" className="dr-th-btn" onClick={() => onSort(k)}>
        <span>{label}</span>
        <SortArrow active={active} dir={sortDir} />
      </button>
    </th>
  );
}

function PlainTh({ children, className }: { children: ReactNode; className?: string }) {
  return <th scope="col" className={`dr-th ${className ?? ""}`.trim()}>{children}</th>;
}

/** Toggle a value in a Set immutably. */
function toggled<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function RealSalaryTable({ rows }: { rows: RealSalaryInputRow[] }) {
  const [archetype, setArchetype] = useState<Archetype>("balanced");
  const [sortKey, setSortKey] = useState<SortKey>("valueRank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Row-click player detail — same fetch-team-roster-then-match-by-name
  // pattern dynasty-rankings/page.tsx already uses for its own quick view
  // (2026-07-31): /api/team-rosters/[team] already returns everything
  // PlayerQuickViewModal + SalaryContractCard need, so no new data source.
  // valueRank/consensusRank/delta come from the REAL-SALARY row (not the
  // fetched Player, which has no notion of salary rank) — captured at click
  // time so the "Salary rank vs consensus" stat survives the async fetch.
  const [quickView, setQuickView] = useState<{
    open: boolean; loading: boolean; error: string | null; player: Player | null;
    name: string; valueRank: number; consensusRank: number | null; delta: number | null; surplusValue: number;
  }>({ open: false, loading: false, error: null, player: null, name: "", valueRank: 0, consensusRank: null, delta: null, surplusValue: 0 });
  const openPlayerQuickView = async (r: DisplayRow) => {
    const base = { name: r.name, valueRank: r.valueRank, consensusRank: r.consensusRank, delta: r.delta, surplusValue: r.surplusValue };
    if (!r.team || NON_TEAM_VALUES.has(r.team)) {
      setQuickView({ open: true, loading: false, error: "No current NBA team on record for this player.", player: null, ...base });
      return;
    }
    const team = r.team;
    setQuickView({ open: true, loading: true, error: null, player: null, ...base });
    try {
      const res = await fetch(`/api/team-rosters/${team}`);
      if (!res.ok) throw new Error("failed");
      const roster: Player[] = await res.json();
      const target = normalizePlayerName(r.name);
      const match = roster.find((p) => normalizePlayerName(p.name) === target);
      if (!match) {
        setQuickView({ open: true, loading: false, error: "Couldn't find this player's team-rosters data.", player: null, ...base });
        return;
      }
      setQuickView({ open: true, loading: false, error: null, player: match, ...base });
    } catch {
      setQuickView({ open: true, loading: false, error: "Couldn't load this player right now.", player: null, ...base });
    }
  };
  const closeQuickView = () => setQuickView({ open: false, loading: false, error: null, player: null, name: "", valueRank: 0, consensusRank: null, delta: null, surplusValue: 0 });

  // Team/Contract/Salary Range are single-select native dropdowns, grouped
  // together in row 2. Class/Position/Contract are multi-select pill groups
  // (same split dynasty-rankings' ControlsBar uses between Team and
  // Range/Position) — Contract moved back to multi-select (Ash, 2026-07-31:
  // "handy to have the ability to select more than 1 contract type"), having
  // briefly been a single-select dropdown alongside Team/Salary Range.
  const [teamFilter, setTeamFilter] = useState("");
  const [classFilter, setClassFilter] = useState<Set<ClassId>>(new Set());
  const [contractFilter, setContractFilter] = useState<Set<ContractBucket>>(new Set());
  const [posFilter, setPosFilter] = useState<Set<string>>(new Set());
  const [salaryRange, setSalaryRange] = useState<SalaryRangeKey>("all");
  const [search, setSearch] = useState("");

  // Mobile filter overlay + isMobile/isLandscape detection — byte-identical
  // pattern to dynasty-rankings' page.tsx/rankings-table.tsx, so the two
  // pages behave the same at every breakpoint.
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    const updateIsMobile = () => setIsMobile(window.innerWidth <= 767);
    updateIsMobile();
    window.addEventListener("resize", updateIsMobile);
    return () => window.removeEventListener("resize", updateIsMobile);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-height: 480px) and (orientation: landscape)");
    const sync = () => setIsLandscape(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Future-year columns explicitly drop on mobile portrait, restore on
  // mobile landscape — same room-constrained rule dynasty-rankings uses for
  // its Tier/Vs-Cons/expert columns (showTierColumn/showVsConsColumn in
  // rankings-table.tsx).
  const isMobilePortrait = isMobile && !isLandscape;
  const showAvatarColumn = !isMobile;
  const showPosColumn = !isMobile;
  // Team logo dropped entirely on mobile portrait — too squishy at the
  // available column width even as a small icon (Ash, 2026-07-31). Landscape
  // (and everything wider) keeps its own dedicated Team column, unchanged.
  const showTeamColumn = !isMobilePortrait;
  const showAgeColumn = !isMobile || isLandscape;
  const showConsColumn = !isMobile || isLandscape;
  const showFutureYearColumns = !isMobile || isLandscape;

  const teamOptions = useMemo(() => [...NBA_TEAM_ABBRS].sort((a, b) => a.localeCompare(b)), []);

  const factors: RealSalaryFactors[] = useMemo(
    () => rows.map((r) => ({
      playerId: r.playerId, consensusZ: r.consensusZ,
      productionZ: r.productionZ, salaryZ: r.salaryZ, salary: r.salary,
      isRookieScale: r.contractBucket === "Rookie Scale",
    })),
    [rows],
  );

  const display: DisplayRow[] = useMemo(() => {
    const computed = computeMarketValue(factors, WEIGHT_PRESETS[archetype]);
    const computedById = new Map(computed.map((c) => [c.playerId, c]));
    const surplusRankById = rankBy(computed, (c) => c.surplusValue);
    // Rank = order by expectedCapHit ("Market Salary") directly — it's
    // already the consensus-dominant blend, so Rank and Market Salary are
    // the same number, not two divergent formulas.
    const valueRankById = rankBy(computed, (c) => c.expectedCapHit);
    return rows.map((r) => {
      const c = computedById.get(r.playerId)!;
      const valueRank = valueRankById.get(r.playerId)!;
      return {
        ...r,
        valueRank,
        surplusRank: surplusRankById.get(r.playerId)!,
        surplusValue: c.surplusValue,
        expectedCapHit: c.expectedCapHit,
        // How far cap Efficiency moved him from his pure consensus slot.
        // Positive = nudged UP (a cap-efficient bargain); negative = nudged
        // DOWN (priced at/above his production). See
        // docs/real-salary-dynasty-rankings-brief.md.
        delta: r.consensusRank != null ? r.consensusRank - valueRank : null,
      };
    });
  }, [rows, factors, archetype]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return display.filter((r) => {
      if (teamFilter && r.team !== teamFilter) return false;
      if (classFilter.size > 0 && !classFilter.has(r.classId)) return false;
      if (contractFilter.size > 0 && !contractFilter.has(r.contractBucket)) return false;
      if (posFilter.size > 0 && !(r.position && [...posFilter].some((p) => r.position!.includes(p)))) return false;
      if (!inSalaryRange(r.salary, salaryRange)) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [display, teamFilter, classFilter, contractFilter, posFilter, salaryRange, search]);

  const sorted = useMemo(() => {
    const withNulls = (v: number | null) => (v == null ? (sortDir === "asc" ? Infinity : -Infinity) : v);
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = withNulls(a[sortKey] as number | null);
      const bv = withNulls(b[sortKey] as number | null);
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(defaultDir(key));
    }
  }

  const empty = rows.length === 0;
  const noFilterResults = !empty && sorted.length === 0;

  const activeFilterCount =
    (teamFilter ? 1 : 0) +
    (classFilter.size > 0 ? 1 : 0) +
    (contractFilter.size > 0 ? 1 : 0) +
    (posFilter.size > 0 ? 1 : 0) +
    (salaryRange !== "all" ? 1 : 0) +
    (search.trim() ? 1 : 0);

  return (
    <div className="dr-rankings-shell">
      <PlatformSidebarNav active="real-salary" />

      <div className="dr-rankings-measured-top">
        <div className="dr-page-gutter dr-page-heading rsr-page-heading">
          <h1>Real Salary Rankings</h1>
        </div>
        <div className="dr-page-gutter rsr-archetype-gutter">
          <div className="rsr-archetypes" role="tablist" aria-label="Manager timeline">
            {ARCHETYPES.map((a) => (
              <button
                key={a}
                type="button"
                role="tab"
                aria-selected={archetype === a}
                className={`dr-pill ${archetype === a ? "dr-pill-active" : ""}`}
                onClick={() => setArchetype(a)}
                title={ARCHETYPE_BLURB[a]}
              >
                {ARCHETYPE_LABELS[a]}
              </button>
            ))}
          </div>
          <p className="rsr-archetype-blurb">{ARCHETYPE_BLURB[archetype]}</p>
        </div>

        <div className="dr-sticky-controls">
          <div className="dr-page-gutter">
            {/* Mobile only: same compact toggle dynasty-rankings uses — opens
                the filters as a full-screen overlay instead of letting the
                pill/select rows wrap awkwardly inline. Desktop is unaffected
                (hidden via CSS). */}
            <button
              type="button"
              className="dr-mobile-filter-toggle"
              onClick={() => setMobileFiltersOpen((v) => !v)}
              aria-expanded={mobileFiltersOpen}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="6" x2="20" y2="6" /><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
                <line x1="4" y1="12" x2="20" y2="12" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
                <line x1="4" y1="18" x2="20" y2="18" /><circle cx="11" cy="18" r="2" fill="currentColor" stroke="none" />
              </svg>
              Filters
              {activeFilterCount > 0 && <span className="dr-mobile-filter-count">{activeFilterCount}</span>}
              <span className="dr-mobile-filter-caret">{mobileFiltersOpen ? "▲" : "▼"}</span>
            </button>
            {mobileFiltersOpen && <div className="dr-mobile-backdrop" onClick={() => setMobileFiltersOpen(false)} />}

            <div className={`dr-controls-wrap ${mobileFiltersOpen ? "dr-controls-wrap-open" : ""}`}>
              <div className="dr-mobile-panel-header">
                <span>Filters</span>
                <button type="button" className="dr-mobile-panel-done" onClick={() => setMobileFiltersOpen(false)}>
                  Done
                </button>
              </div>
              <div className="dr-controls-inner">
              <div className="dr-controls-row dr-controls-row-1">
                <div className="dr-pills-desktop-layout">
                  <div className="dr-filter-group">
                    <span className="dr-filter-label">Class</span>
                    <div className="dr-pill-row">
                      <button type="button" className={`dr-pill ${classFilter.size === 0 ? "dr-pill-active" : ""}`} onClick={() => setClassFilter(new Set())}>ALL</button>
                      {CLASS_DEFS.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className={`dr-pill ${classFilter.has(c.id) ? `dr-pill-active ${c.id === "rook" ? "dr-pill-active-rookies" : c.id === "soph" ? "dr-pill-active-sophomores" : ""}` : ""}`}
                          onClick={() => setClassFilter((s) => toggled(s, c.id))}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="dr-filter-group">
                    <span className="dr-filter-label">Position</span>
                    <div className="dr-pill-row">
                      <button type="button" className={`dr-pill ${posFilter.size === 0 ? "dr-pill-active" : ""}`} onClick={() => setPosFilter(new Set())}>ALL</button>
                      {POSITIONS.map((p) => (
                        <button key={p} type="button" className={`dr-pill ${posFilter.has(p) ? "dr-pill-active" : ""}`} onClick={() => setPosFilter((s) => toggled(s, p))}>
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="dr-filter-group">
                    <span className="dr-filter-label">Contract</span>
                    <div className="dr-pill-row">
                      <button type="button" className={`dr-pill ${contractFilter.size === 0 ? "dr-pill-active" : ""}`} onClick={() => setContractFilter(new Set())}>ALL</button>
                      {CONTRACT_DEFS.map((c) => (
                        <button key={c} type="button" className={`dr-pill ${contractFilter.has(c) ? "dr-pill-active" : ""}`} onClick={() => setContractFilter((s) => toggled(s, c))}>
                          {c.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                </div>
              </div>

              <div className="dr-controls-row dr-controls-row-2">
                <div className="dr-controls-row-2-fields">
                  <div className="dr-filter-group dr-field-team">
                    <label className="dr-filter-label" htmlFor="rsr-team">Team</label>
                    <select id="rsr-team" className="dr-select" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
                      <option value="">All Teams</option>
                      {teamOptions.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  <div className="dr-filter-group dr-field-salary-range">
                    <label className="dr-filter-label" htmlFor="rsr-salary-range">Salary Range</label>
                    <select id="rsr-salary-range" className="dr-select" value={salaryRange} onChange={(e) => setSalaryRange(e.target.value as SalaryRangeKey)}>
                      <option value="all">All Salaries</option>
                      {SALARY_RANGE_DEFS.map((d) => (
                        <option key={d.key} value={d.key}>{d.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="dr-filter-group dr-search-wrap dr-field-search">
                    <label className="dr-filter-label" htmlFor="rsr-search">Search</label>
                    <div className="dr-input-icon-wrap">
                      <span className="dr-input-prefix" aria-hidden>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </span>
                      <input
                        id="rsr-search"
                        type="search"
                        className="dr-input dr-input-search"
                        placeholder="Player name…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                  </div>
                </div>
              </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="dr-rankings-main">
        {empty ? (
          <p className="dr-empty">No data yet — run <code>npm run realsalary:build</code> after applying the latest migration.</p>
        ) : noFilterResults ? (
          <p className="dr-empty">No players match these filters.</p>
        ) : (
          <div className="dr-table-view-wrap" style={{ width: "100%" }}>
            <div className="dr-table-scroll">
              <div style={{ fontSize: 11, color: "#9a9aaa", padding: "4px 0 2px 0", maxWidth: 1200, marginLeft: "auto", marginRight: "auto" }}>
                <span>Ranked by Salary Rank</span>
                <span style={{ marginLeft: 10, opacity: 0.5 }}>{ARCHETYPE_LABELS[archetype]}</span>
              </div>
              <table className="dr-table rsr-table">
                <colgroup>
                  <col style={{ width: isMobilePortrait ? 26 : 50 }} />
                  {showAvatarColumn ? <col style={{ width: 44 }} /> : null}
                  <col style={{ width: isMobilePortrait ? 165 : isMobile ? 150 : 170 }} />
                  {showTeamColumn ? <col style={{ width: isMobile ? 40 : 110 }} /> : null}
                  {showPosColumn ? <col style={{ width: 55 }} /> : null}
                  {showAgeColumn ? <col style={{ width: 60 }} /> : null}
                  {showConsColumn ? <col style={{ width: 80 }} /> : null}
                  <col style={{ width: isMobilePortrait ? 32 : isMobile ? 56 : 120 }} />
                  <col style={{ width: isMobilePortrait ? 56 : 90 }} />
                  <col style={{ width: isMobilePortrait ? 62 : 100 }} />
                  {showFutureYearColumns ? <col style={{ width: 85 }} /> : null}
                  {showFutureYearColumns ? <col style={{ width: 85 }} /> : null}
                  {showFutureYearColumns ? <col style={{ width: 85 }} /> : null}
                  {showFutureYearColumns ? <col style={{ width: 85 }} /> : null}
                </colgroup>
                <thead className="dr-table-head">
                  <tr>
                    <Th label={isMobilePortrait ? "#" : "RANK"} k="valueRank" title="Dynasty consensus rank, nudged up/down by the cap-Efficiency adjuster — a variation on consensus, not a replacement for it" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="dr-col-rank" />
                    {showAvatarColumn ? <PlainTh className="dr-col-avatar" >&nbsp;</PlainTh> : null}
                    <PlainTh className="dr-player-col">PLAYER</PlainTh>
                    {showTeamColumn ? <PlainTh className="dr-col-team">TEAM</PlainTh> : null}
                    {showPosColumn ? <PlainTh className="dr-col-pos">POS</PlainTh> : null}
                    {showAgeColumn ? <Th label="AGE" k="age" title="Current age, computed live from date of birth" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="dr-col-age" /> : null}
                    {showConsColumn ? <Th label="CONS" k="consensusRank" title="Dynasty consensus rank (unadjusted)" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="rsr-col-center" /> : null}
                    <Th label={isMobile ? "VS" : "VS CONSENSUS"} k="delta" title="Consensus rank minus Salary Rank — positive means cap Efficiency nudged him UP from his consensus slot (a bargain), negative means nudged DOWN (priced at/above production)" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="rsr-col-center" />
                    <Th label="SALARY" k="salary" title="Actual current-season (2026-27) cap hit" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="rsr-col-center" />
                    <Th label="SURPLUS" k="surplusValue" title="Market Salary (the real NBA salary sitting at his Salary Rank position, quantile-mapped from real contracts) minus actual Salary" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="rsr-col-center" />
                    {showFutureYearColumns ? <PlainTh className="rsr-col-center">2027-28</PlainTh> : null}
                    {showFutureYearColumns ? <PlainTh className="rsr-col-center">2028-29</PlainTh> : null}
                    {showFutureYearColumns ? <PlainTh className="rsr-col-center">2029-30</PlainTh> : null}
                    {showFutureYearColumns ? <PlainTh className="rsr-col-center">2030-31</PlainTh> : null}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.playerId} className="dr-tr" onClick={() => openPlayerQuickView(r)}>
                      <td className="dr-td dr-col-rank">
                        <div className="dr-rank-cell">
                          <span className="dr-rank-num dr-rank-num-tier-def">{r.valueRank}</span>
                        </div>
                      </td>
                      {showAvatarColumn ? (
                        <td className="dr-td dr-col-avatar">
                          <PlayerAvatar row={r} />
                        </td>
                      ) : null}
                      <td className="dr-td dr-player-col">
                        <div className="dr-player-name-line">
                          {isMobile ? (
                            <>
                              <span style={mobilePositionBadgeStyle(r.position)}>{r.position ?? "—"}</span>
                              <span title={r.name}>{shortenPlayerName(r.name)}</span>
                            </>
                          ) : (
                            r.name
                          )}
                          {r.classId === "rook" ? (
                            <span className="dr-rookie-badge" title="Incoming rookie">R</span>
                          ) : r.classId === "soph" ? (
                            <span className="dr-soph-badge" title="Sophomore">S</span>
                          ) : null}
                        </div>
                      </td>
                      {showTeamColumn ? (
                        <td className="dr-td dr-col-team">
                          <TeamCell team={r.team} size={isMobile ? 20 : 32} />
                        </td>
                      ) : null}
                      {showPosColumn ? (
                        <td className="dr-td dr-col-pos">
                          <PositionBadge position={r.position} />
                        </td>
                      ) : null}
                      {showAgeColumn ? (
                        <td className="dr-td dr-col-age dr-mono">{r.age != null ? r.age.toFixed(1) : "—"}</td>
                      ) : null}
                      {showConsColumn ? (
                        <td className="dr-td dr-mono rsr-col-center">{r.consensusRank ?? "—"}</td>
                      ) : null}
                      <td className="dr-td rsr-col-center"><DeltaCell delta={r.delta} /></td>
                      <td className={`dr-td dr-mono rsr-col-center ${salaryTintClass(r.salary)}`.trim()} title={fullMoney(r.salary)}>{money(r.salary)}</td>
                      <td
                        className={`dr-td dr-mono rsr-col-center ${surplusTintClass(r.surplusValue)}`.trim()}
                        style={{ fontWeight: 700, color: r.surplusValue >= 0 ? "var(--green-elite)" : "var(--red-severe)" }}
                        title={fullMoney(r.surplusValue)}
                      >
                        {r.surplusValue >= 0 ? "+" : "-"}{money(Math.abs(r.surplusValue))}
                      </td>
                      {showFutureYearColumns ? (
                        <td className={`dr-td dr-mono rsr-col-center dr-vs-cons-muted ${salaryTintClass(r.salaryYr2)}`.trim()} title={r.salaryYr2 != null ? fullMoney(r.salaryYr2) : undefined}>
                          {r.salaryYr2 != null ? money(r.salaryYr2) : "—"}
                        </td>
                      ) : null}
                      {showFutureYearColumns ? (
                        <td className={`dr-td dr-mono rsr-col-center dr-vs-cons-muted ${salaryTintClass(r.salaryYr3)}`.trim()} title={r.salaryYr3 != null ? fullMoney(r.salaryYr3) : undefined}>
                          {r.salaryYr3 != null ? money(r.salaryYr3) : "—"}
                        </td>
                      ) : null}
                      {showFutureYearColumns ? (
                        <td className={`dr-td dr-mono rsr-col-center dr-vs-cons-muted ${salaryTintClass(r.salaryYr4)}`.trim()} title={r.salaryYr4 != null ? fullMoney(r.salaryYr4) : undefined}>
                          {r.salaryYr4 != null ? money(r.salaryYr4) : "—"}
                        </td>
                      ) : null}
                      {showFutureYearColumns ? (
                        <td className="dr-td dr-mono rsr-col-center dr-vs-cons-muted" title="Not yet tracked — nba_roster only carries 4 salary years">—</td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>

              <p style={{ fontSize: 11, color: "#9a9aaa", padding: "6px 0 0 0", textAlign: "center" }}>
                Showing {sorted.length} of {display.length} players
              </p>

              <section
                aria-label="About Real Salary Rankings"
                style={{ padding: "40px 32px 56px", maxWidth: 860, margin: "0 auto", color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7 }}
              >
                <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--text-secondary)" }}>
                  About Real Salary Rankings
                </h2>
                <p>
                  A variation on dynasty consensus, not a replacement for it — Salary
                  Rank blends dynasty consensus (dominant) with cap Efficiency, itself
                  weighted toward cheap salary over current production (a cheap,
                  locked-in contract is a real asset even before a young
                  player&apos;s box score catches up). Market Salary (driving
                  Surplus) is the REAL salary that sits at that same rank position in
                  the league&apos;s actual pay — whoever ranks #1 is priced at what
                  the real highest-paid player earns, #2 at the real 2nd-highest, and
                  so on, which is why the spread looks like real NBA contracts
                  instead of a flatter derived scale.
                </p>
                <p style={{ marginTop: 12 }}>
                  Surplus is Market Salary minus actual Salary. You can&apos;t stack
                  max-salary max-production stars on one roster without breaching the
                  cap, so Efficiency rewards finding cheap contracts to pair with star
                  power — a negative surplus on an elite player doesn&apos;t mean
                  avoid him, it means his salary already tracks his value, normal for
                  a fairly priced star.
                </p>
              </section>
              <Footer />
            </div>
          </div>
        )}
      </div>

      {quickView.open ? (
        <PlayerQuickViewModal
          player={quickView.player}
          loading={quickView.loading}
          error={quickView.error}
          onClose={closeQuickView}
          isMobile={isMobile}
          fullScreenOnMobile
          thirdStat={{
            value: "#" + quickView.valueRank,
            dir: quickView.delta == null || quickView.delta === 0 ? "flat" : quickView.delta > 0 ? "up" : "down",
            delta: quickView.delta != null ? Math.abs(quickView.delta) : null,
            labelCompact: "Salary",
            labelFull: "Salary rank vs consensus",
          }}
          extraContent={quickView.player ? <SalaryContractCard player={quickView.player} compact={isMobile} /> : undefined}
          show9CatProfile={false}
          headerNote={quickView.player ? (() => {
            const verdict = deriveValueVerdict(quickView.name, quickView.surplusValue, quickView.delta, quickView.valueRank);
            const color = verdict.tone === "positive" ? "var(--green-elite)" : verdict.tone === "negative" ? "var(--red-severe)" : "var(--dynasty-gold)";
            return <span style={{ fontSize: 13, fontWeight: 700, color }}>{verdict.text}</span>;
          })() : null}
        />
      ) : null}

      <style>{`
        .rsr-archetype-gutter { padding-bottom: 14px; }
        .rsr-archetypes { display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
        .rsr-archetype-blurb { font-size: 13px; font-style: italic; margin: 0; color: var(--text-secondary); }

        .rsr-col-center { text-align: center; }

        .dr-empty { padding: 40px; text-align: center; color: var(--text-secondary); }
        .dr-empty code { background: var(--bg-card); padding: 2px 6px; border-radius: 4px; }

        /* Mobile portrait only (landscape already has its own compact rules
           in globals.css, keyed on height not width — excluding orientation
           here keeps the two from fighting) — portrait dropped to 5 columns,
           so there's headroom to size UP for legibility instead of down. */
        @media (max-width: 767px) and (orientation: portrait) {
          .rsr-table th, .rsr-table td { font-size: 14px; }
          .rsr-table td { padding: 10px 6px; }
          .rsr-table .dr-player-name-line { font-size: 15px; }
          .rsr-table tbody tr.dr-tr { height: 60px; }

          /* "Real Salary Rankings" was competing with the sitewide logo for
             attention (Ash, 2026-07-31) — scoped to THIS page's heading only
             (dr-page-heading is shared with dynasty-rankings, untouched there). */
          .rsr-page-heading h1 { font-size: 18px; }
          .rsr-page-heading { padding-top: 12px; padding-bottom: 8px; }

          /* Archetype tabs (Balanced/Contending/Rebuilding) — smaller footprint
             so all three sit comfortably without wrapping awkwardly. */
          .rsr-archetypes .dr-pill { padding: 5px 10px; font-size: 10px; }
        }
      `}</style>
    </div>
  );
}
