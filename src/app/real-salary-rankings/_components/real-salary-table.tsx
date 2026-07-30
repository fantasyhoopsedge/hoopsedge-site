"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PlatformSidebarNav } from "@/components/platform-sidebar-nav";
import { Footer } from "@/components/footer";
import { TEAM_LOGO } from "@/app/team-rosters/_components/roster-data";
import { NBA_TEAM_ABBRS } from "@/lib/nba-teams";
import { initials, money, fullMoney } from "@/app/team-rosters/_components/roster-helpers";
import { playerHeadshotUrl } from "@/lib/dynasty-rankings";
import {
  WEIGHT_PRESETS, ARCHETYPE_LABELS, ARCHETYPE_BLURB,
  computeMarketValue, rankBy,
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

type SortKey = "valueRank" | "surplusRank" | "consensusRank" | "delta" | "salary" | "expectedCapHit" | "surplusValue";
type SortDir = "asc" | "desc";

const ARCHETYPES: Archetype[] = ["balanced", "contending", "rebuilding", "tanking"];
const POSITIONS = ["G", "F", "C"] as const;
const CLASS_DEFS: { id: ClassId; label: string }[] = [
  { id: "rook", label: "Rookies" },
  { id: "soph", label: "Sophomores" },
  { id: "vet", label: "Veterans" },
];
const CONTRACT_DEFS: ContractBucket[] = ["Rookie Scale", "Standard", "Other"];

function PlayerHeadshot({ row }: { row: DisplayRow }) {
  const url = playerHeadshotUrl({ player: row.name, isRookie: row.classId === "rook" });
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={row.name}
        onError={() => setBroken(true)}
        style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--border-main)", flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      style={{
        width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "linear-gradient(135deg, var(--blueprint) 0%, var(--edge-orange) 100%)",
        color: "#fff", fontWeight: 700, fontSize: 13,
      }}
    >
      {initials(row.name)}
    </div>
  );
}

function DeltaCell({ delta }: { delta: number | null }) {
  if (delta == null) return <span style={{ color: "var(--text-secondary)" }}>—</span>;
  if (delta === 0) return <span style={{ color: "var(--text-secondary)" }}>0</span>;
  const up = delta > 0;
  return (
    <span style={{ color: up ? "#3ddc84" : "#ff6b6b", fontWeight: 600 }}>
      {up ? "▲" : "▼"} {Math.abs(delta)}
    </span>
  );
}

const defaultDir = (key: SortKey): SortDir => (key === "valueRank" || key === "surplusRank" || key === "consensusRank" ? "asc" : "desc");

const HEADER_STYLE = {
  padding: "12px 18px", fontWeight: 700, fontSize: 14, textTransform: "uppercase" as const,
  letterSpacing: "0.04em", whiteSpace: "nowrap" as const, textAlign: "center" as const,
};

// Rank / Consensus / Δ are short numeric columns — the generous 18px
// horizontal padding meant for wider text columns just spreads them apart
// with no benefit, so they get a tighter pad to sit close together.
const COMPACT_STYLE = { padding: "12px 10px" };

function Th({ label, k, title, sortKey, sortDir, onSort, compact }: {
  label: string; k: SortKey; title?: string;
  sortKey: SortKey; sortDir: SortDir; onSort: (key: SortKey) => void; compact?: boolean;
}) {
  const active = sortKey === k;
  return (
    <th
      onClick={() => onSort(k)}
      title={title}
      style={{
        ...HEADER_STYLE, ...(compact ? COMPACT_STYLE : null),
        cursor: "pointer", userSelect: "none", color: active ? "var(--text-primary)" : "var(--text-secondary)",
      }}
    >
      {label}{active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );
}

function PlainTh({ children, compact }: { children: ReactNode; compact?: boolean }) {
  return <th style={{ ...HEADER_STYLE, ...(compact ? COMPACT_STYLE : null), color: "var(--text-secondary)" }}>{children}</th>;
}

/** Toggle a value in a Set immutably. */
function toggled<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function FilterPill({ active, onClick, children, title }: {
  active: boolean; onClick: () => void; children: ReactNode; title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      className={`rsr-pill${active ? " active" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Multi-select team dropdown — a checkbox popover, closes on outside click. */
function TeamDropdown({ selected, onToggle, onClear }: {
  selected: Set<string>; onToggle: (team: string) => void; onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const label = selected.size === 0 ? "All Teams" : selected.size === 1 ? [...selected][0] : `${selected.size} teams`;

  return (
    <div className="rsr-team-dd" ref={ref}>
      <button type="button" className={`rsr-team-dd-btn${selected.size > 0 ? " active" : ""}`} onClick={() => setOpen((o) => !o)}>
        {label} <span className="rsr-team-dd-caret">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="rsr-team-dd-panel">
          {selected.size > 0 && (
            <button type="button" className="rsr-team-dd-clear" onClick={onClear}>Clear teams</button>
          )}
          <div className="rsr-team-dd-grid">
            {NBA_TEAM_ABBRS.map((t) => (
              <label key={t} className="rsr-team-dd-option">
                <input type="checkbox" checked={selected.has(t)} onChange={() => onToggle(t)} />
                {t}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function RealSalaryTable({ rows }: { rows: RealSalaryInputRow[] }) {
  const [archetype, setArchetype] = useState<Archetype>("balanced");
  const [sortKey, setSortKey] = useState<SortKey>("valueRank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [teamFilter, setTeamFilter] = useState<Set<string>>(new Set());
  const [classFilter, setClassFilter] = useState<Set<ClassId>>(new Set());
  const [contractFilter, setContractFilter] = useState<Set<ContractBucket>>(new Set());
  const [posFilter, setPosFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const activeFilterCount = teamFilter.size + classFilter.size + contractFilter.size + posFilter.size + (search.trim() ? 1 : 0);
  function clearFilters() {
    setTeamFilter(new Set());
    setClassFilter(new Set());
    setContractFilter(new Set());
    setPosFilter(new Set());
    setSearch("");
  }

  const factors: RealSalaryFactors[] = useMemo(
    () => rows.map((r) => ({
      playerId: r.playerId, consensusZ: r.consensusZ,
      productionZ: r.productionZ, salaryZ: r.salaryZ, salary: r.salary,
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
      if (teamFilter.size > 0 && !(r.team && teamFilter.has(r.team))) return false;
      if (classFilter.size > 0 && !classFilter.has(r.classId)) return false;
      if (contractFilter.size > 0 && !contractFilter.has(r.contractBucket)) return false;
      if (posFilter.size > 0 && !(r.position && [...posFilter].some((p) => r.position!.includes(p)))) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [display, teamFilter, classFilter, contractFilter, posFilter, search]);

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

  return (
    <div className="rsr-shell">
      <PlatformSidebarNav active="real-salary" />

      <div className="rsr-content">
        <div className="rsr-header">
          <h1>Real Salary Rankings</h1>
          <div className="rsr-archetypes" role="tablist" aria-label="Manager timeline">
            {ARCHETYPES.map((a) => (
              <button
                key={a}
                type="button"
                role="tab"
                aria-selected={archetype === a}
                className={`rsr-archetype-btn${archetype === a ? " active" : ""}`}
                onClick={() => setArchetype(a)}
                title={ARCHETYPE_BLURB[a]}
              >
                {ARCHETYPE_LABELS[a]}
              </button>
            ))}
          </div>
          <p className="rsr-archetype-blurb">{ARCHETYPE_BLURB[archetype]}</p>
        </div>

        <div className="rsr-filters">
          <div className="rsr-filter-group">
            <span className="rsr-filter-label">Search</span>
            <input
              type="text"
              className="rsr-search-input"
              placeholder="Player name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="rsr-filter-group">
            <span className="rsr-filter-label">Team</span>
            <TeamDropdown
              selected={teamFilter}
              onToggle={(t) => setTeamFilter((s) => toggled(s, t))}
              onClear={() => setTeamFilter(new Set())}
            />
          </div>
          <div className="rsr-filter-group">
            <span className="rsr-filter-label">Class</span>
            {CLASS_DEFS.map((c) => (
              <FilterPill key={c.id} active={classFilter.has(c.id)} onClick={() => setClassFilter((s) => toggled(s, c.id))}>
                {c.label}
              </FilterPill>
            ))}
          </div>
          <div className="rsr-filter-group">
            <span className="rsr-filter-label">Contract</span>
            {CONTRACT_DEFS.map((c) => (
              <FilterPill key={c} active={contractFilter.has(c)} onClick={() => setContractFilter((s) => toggled(s, c))}>
                {c}
              </FilterPill>
            ))}
          </div>
          <div className="rsr-filter-group">
            <span className="rsr-filter-label">Position</span>
            {POSITIONS.map((p) => (
              <FilterPill key={p} active={posFilter.has(p)} onClick={() => setPosFilter((s) => toggled(s, p))}>
                {p}
              </FilterPill>
            ))}
          </div>
          {activeFilterCount > 0 && (
            <button type="button" className="rsr-clear-btn" onClick={clearFilters}>
              Clear filters ({activeFilterCount})
            </button>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="rsr-empty">No data yet — run <code>npm run realsalary:build</code> after applying the latest migration.</div>
        ) : sorted.length === 0 ? (
          <div className="rsr-empty">No players match the current filters. <button type="button" className="rsr-clear-link" onClick={clearFilters}>Clear filters</button></div>
        ) : (
        <div className="rsr-table-wrap">
          <table className="rsr-table">
            <thead>
              <tr>
                <Th label="Rank" k="valueRank" title="Dynasty consensus rank, nudged up/down by the cap-Efficiency adjuster — a variation on consensus, not a replacement for it" sortKey={sortKey} sortDir={sortDir} onSort={onSort} compact />
                <Th label="Consensus" k="consensusRank" title="Dynasty consensus rank (unadjusted)" sortKey={sortKey} sortDir={sortDir} onSort={onSort} compact />
                <Th label="Δ" k="delta" title="Consensus rank minus Salary Rank — positive means cap Efficiency nudged him UP from his consensus slot (a bargain), negative means nudged DOWN (priced at/above production)" sortKey={sortKey} sortDir={sortDir} onSort={onSort} compact />
                <PlainTh>Player</PlainTh>
                <Th label="Salary" k="salary" title="Actual current-season (2026-27) cap hit" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <Th label="Surplus" k="surplusValue" title="Market Salary (the real NBA salary sitting at his Salary Rank position, quantile-mapped from real contracts) minus actual Salary" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <PlainTh>2027-28</PlainTh>
                <PlainTh>2028-29</PlainTh>
                <PlainTh>2029-30</PlainTh>
                <PlainTh>2030-31</PlainTh>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.playerId} className="rsr-row">
                  <td style={{ padding: "12px 10px", fontWeight: 700 }}>{r.valueRank}</td>
                  <td style={{ padding: "12px 10px" }}>{r.consensusRank ?? "—"}</td>
                  <td style={{ padding: "12px 10px" }}><DeltaCell delta={r.delta} /></td>
                  <td style={{ padding: "12px 18px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <PlayerHeadshot row={r} />
                      <div>
                        <div style={{ fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap" }}>{r.name}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                          {r.team && TEAM_LOGO[r.team] && (
                            // eslint-disable-next-line @next/next/no-img-element -- static team wordmark from public/
                            <img src={`/images/nba%20team%20images/${TEAM_LOGO[r.team]}`} alt={r.team} style={{ width: 14, height: 14 }} />
                          )}
                          {r.team ?? "FA"} · {r.position ?? "—"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "12px 18px", whiteSpace: "nowrap" }} title={fullMoney(r.salary)}>{money(r.salary)}</td>
                  <td
                    style={{
                      padding: "12px 18px", fontWeight: 700, whiteSpace: "nowrap",
                      color: r.surplusValue >= 0 ? "#3ddc84" : "#ff6b6b",
                    }}
                    title={fullMoney(r.surplusValue)}
                  >
                    {r.surplusValue >= 0 ? "+" : "-"}{money(Math.abs(r.surplusValue))}
                  </td>
                  <td style={{ padding: "12px 18px", color: "var(--text-secondary)", whiteSpace: "nowrap" }} title={r.salaryYr2 != null ? fullMoney(r.salaryYr2) : undefined}>
                    {r.salaryYr2 != null ? money(r.salaryYr2) : "—"}
                  </td>
                  <td style={{ padding: "12px 18px", color: "var(--text-secondary)", whiteSpace: "nowrap" }} title={r.salaryYr3 != null ? fullMoney(r.salaryYr3) : undefined}>
                    {r.salaryYr3 != null ? money(r.salaryYr3) : "—"}
                  </td>
                  <td style={{ padding: "12px 18px", color: "var(--text-secondary)", whiteSpace: "nowrap" }} title={r.salaryYr4 != null ? fullMoney(r.salaryYr4) : undefined}>
                    {r.salaryYr4 != null ? money(r.salaryYr4) : "—"}
                  </td>
                  <td style={{ padding: "12px 18px", color: "var(--text-secondary)" }} title="Not yet tracked — nba_roster only carries 4 salary years">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}

        <p className="rsr-description">
          A variation on dynasty consensus, not a replacement for it — Salary
          Rank blends dynasty consensus (dominant) with cap Efficiency, itself
          weighted toward cheap salary over current production (a cheap,
          locked-in contract is a real asset even before a young
          player&apos;s box score catches up). Market Salary (driving
          Surplus) is the REAL salary that sits at that same rank position in
          the league&apos;s actual pay — whoever ranks #1 is priced at what
          the real highest-paid player earns, #2 at the real 2nd-highest, and
          so on, which is why the spread looks like real NBA contracts
          instead of a flatter derived scale. Surplus is Market Salary minus
          actual Salary. You can&apos;t stack max-salary max-production stars
          on one roster without breaching the cap, so Efficiency rewards
          finding cheap contracts to pair with star power — a negative
          surplus on an elite player doesn&apos;t mean avoid him, it means
          his salary already tracks his value, normal for a fairly priced
          star.
        </p>
      </div>

      <Footer />

      <style>{`
        .rsr-shell { min-height: 100vh; display: flex; flex-direction: column; padding-left: 236px; background: var(--bg-body); }
        .rsr-content { flex: 1; padding: 28px 32px; }
        .rsr-header h1 { font-family: 'Oswald', sans-serif; font-size: 28px; color: var(--text-primary); margin: 0 0 16px; }
        .rsr-archetypes { display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
        .rsr-archetype-btn {
          padding: 8px 16px; border-radius: 999px; border: 1px solid var(--border-main);
          background: var(--bg-card); color: var(--text-secondary); font-weight: 600; font-size: 13px;
          cursor: pointer; transition: all 0.15s ease;
        }
        .rsr-archetype-btn:hover { border-color: var(--blueprint-glow); color: var(--text-primary); }
        .rsr-archetype-btn.active { background: var(--edge-orange); border-color: var(--edge-orange); color: #fff; }
        .rsr-archetype-blurb { font-size: 13px; font-style: italic; margin: 0 0 20px; color: var(--text-secondary); }

        .rsr-filters {
          display: flex; flex-wrap: wrap; align-items: center; gap: 16px 24px;
          padding: 16px; margin-bottom: 20px;
          border: 1px solid var(--border-main); border-radius: 10px; background: var(--bg-surface);
        }
        .rsr-filter-group { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .rsr-filter-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-secondary); margin-right: 4px; }
        .rsr-search-input {
          padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border-main);
          background: var(--bg-card); color: var(--text-primary); font-size: 13px; min-width: 180px;
        }
        .rsr-search-input:focus { outline: none; border-color: var(--blueprint-glow); }
        .rsr-pill {
          padding: 5px 12px; border-radius: 999px; border: 1px solid var(--border-main);
          background: var(--bg-card); color: var(--text-secondary); font-weight: 600; font-size: 12px;
          cursor: pointer; transition: all 0.15s ease; white-space: nowrap;
        }
        .rsr-pill:hover { border-color: var(--blueprint-glow); color: var(--text-primary); }
        .rsr-pill.active { background: var(--blueprint); border-color: var(--blueprint); color: #fff; }
        .rsr-clear-btn {
          padding: 5px 12px; border-radius: 999px; border: 1px solid var(--edge-orange);
          background: transparent; color: var(--edge-orange); font-weight: 600; font-size: 12px; cursor: pointer; white-space: nowrap;
        }
        .rsr-clear-btn:hover { background: var(--edge-orange); color: #fff; }
        .rsr-clear-link { background: none; border: none; color: var(--blueprint-glow); cursor: pointer; text-decoration: underline; font-size: inherit; padding: 0; }

        .rsr-team-dd { position: relative; }
        .rsr-team-dd-btn {
          padding: 5px 12px; border-radius: 999px; border: 1px solid var(--border-main);
          background: var(--bg-card); color: var(--text-secondary); font-weight: 600; font-size: 12px;
          cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px;
        }
        .rsr-team-dd-btn:hover { border-color: var(--blueprint-glow); color: var(--text-primary); }
        .rsr-team-dd-btn.active { background: var(--blueprint); border-color: var(--blueprint); color: #fff; }
        .rsr-team-dd-caret { font-size: 9px; }
        .rsr-team-dd-panel {
          position: absolute; top: calc(100% + 6px); left: 0; z-index: 20;
          width: 280px; padding: 12px; border-radius: 10px;
          border: 1px solid var(--border-main); background: var(--bg-card);
          box-shadow: 0 8px 24px rgba(0,0,0,0.35);
        }
        .rsr-team-dd-clear { margin-bottom: 8px; background: none; border: none; color: var(--edge-orange); cursor: pointer; font-size: 12px; font-weight: 600; padding: 0; }
        .rsr-team-dd-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 10px; }
        .rsr-team-dd-option { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); cursor: pointer; white-space: nowrap; }
        .rsr-team-dd-option input { cursor: pointer; }

        .rsr-description { max-width: 760px; color: var(--text-secondary); font-size: 14px; line-height: 1.5; margin: 20px 0 0; }
        .rsr-empty { padding: 40px; text-align: center; color: var(--text-secondary); border: 1px dashed var(--border-main); border-radius: 10px; }
        .rsr-empty code { background: var(--bg-card); padding: 2px 6px; border-radius: 4px; }

        .rsr-table-wrap {
          overflow: auto; max-height: calc(100vh - 120px);
          border: 1px solid var(--border-main); border-radius: 10px; background: var(--bg-surface);
        }
        .rsr-table { border-collapse: collapse; font-size: 15px; }
        .rsr-table thead th {
          position: sticky; top: 0; z-index: 2;
          background: var(--bg-surface); box-shadow: 0 1px 0 0 var(--border-main);
        }
        .rsr-row { border-bottom: 1px solid var(--border-main); }
        .rsr-row:hover { background: color-mix(in srgb, var(--blueprint) 6%, transparent); }
        .rsr-row:last-child { border-bottom: none; }

        @media (max-width: 1023px) {
          .rsr-shell { padding-left: 0; padding-top: 52px; }
          .rsr-content { padding: 16px; }
          .rsr-table-wrap { max-height: calc(100vh - 200px); }
        }
      `}</style>
    </div>
  );
}
