"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SeasonPlayerStats, SeasonPlayerValues } from "@/types/database";
import { SiteNav } from "@/components/site-nav";
import { Footer } from "@/components/footer";

type SeasonOption = { key: string; label: string };

type ValuesBySize = Record<number, Record<string, SeasonPlayerValues>>;

// Every column the table can sort by. value/minus1v come from the value set;
// consensus from the stat row; the rest are raw per-game (or totalled) stats.
type SortKey =
  | "value" | "minus1v" | "consensus"
  | "pts" | "fg3m" | "reb" | "ast" | "stl" | "blk" | "fg_pct" | "ft_pct" | "tov";
type SortDir = "asc" | "desc";

const POSITIONS = ["G", "F", "C", "G/F", "F/C"] as const;

// consensus reads best ascending (1 at top); everything else descending (best first).
const defaultDir = (key: SortKey): SortDir => (key === "consensus" ? "asc" : "desc");

// ── per-player merged row for the active league size ──────────────────────────
type Row = {
  s: SeasonPlayerStats;
  v: SeasonPlayerValues | null;
};

// Diverging background anchored to a V-score (NOT raw magnitude). Fixed scale:
// positive → green, 0 → transparent, negative → red. Softened alpha for legibility.
function vBg(v: number | null | undefined, posAnchor: number, negAnchor: number): string {
  if (v == null || !Number.isFinite(v)) return "transparent";
  if (v >= 0) {
    const t = Math.min(v / posAnchor, 1);
    return `rgba(34, 197, 94, ${(t * 0.34).toFixed(3)})`;
  }
  const t = Math.min(-v / negAnchor, 1);
  return `rgba(239, 68, 68, ${(t * 0.34).toFixed(3)})`;
}

const statBg = (v: number | null | undefined) => vBg(v, 2.0, 2.0);
const valueBg = (v: number | null | undefined) => vBg(v, 1.0, 0.6);

// ── number formatting (matches dynasty-rankings precision) ────────────────────
const f1 = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(1));
const fInt = (x: number | null | undefined) => (x == null ? "—" : String(Math.round(x)));
const f3v = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(3));
const fPct = (x: number | null | undefined) =>
  x == null ? "—" : x.toFixed(3).replace(/^0(?=\.)/, ""); // .529

function espnHeadshot(id: string | null): string | null {
  return id ? `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png` : null;
}

function Headshot({ id, name }: { id: string | null; name: string }) {
  const [ok, setOk] = useState(true);
  const url = espnHeadshot(id);
  if (url && ok) {
    return (
      <img
        src={url}
        alt=""
        width={40}
        height={40}
        loading="lazy"
        onError={() => setOk(false)}
        className="sr-headshot-img"
      />
    );
  }
  // Silhouette fallback.
  return (
    <span className="sr-headshot-fallback" aria-hidden>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="8" r="4" fill="currentColor" />
        <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="currentColor" />
      </svg>
    </span>
  );
}

// Sortable numeric header cell.
function SortTh({
  label, sortKey, sort, onSort, strong,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
  strong?: boolean;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className={`sr-th sr-num-h sr-th-sortable ${active ? "sr-th-active" : ""} ${strong ? "sr-th-strong" : ""}`}
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label}
      <span className="sr-sort-arrow">{active ? (sort.dir === "asc" ? "↑" : "↓") : ""}</span>
    </th>
  );
}

export function SeasonalRankingsTable(props: {
  players: SeasonPlayerStats[];
  valuesBySize: ValuesBySize;
  leagueSizes: number[];
  canonicalSize: number;
  seasons: SeasonOption[];
  activeSeason: string;
}) {
  const { players, valuesBySize, leagueSizes, canonicalSize, seasons, activeSeason } = props;
  const router = useRouter();

  // Season switch reloads the page with a new dataset (server refetch); a tiny
  // pending flag dims the table while the new data streams in.
  const [seasonPending, setSeasonPending] = useState(false);
  const onSeasonChange = (key: string) => {
    if (key === activeSeason) return;
    setSeasonPending(true);
    router.push(`/seasonal-rankings?d=${encodeURIComponent(key)}`);
  };

  const [leagueSize, setLeagueSize] = useState<number>(
    leagueSizes.includes(canonicalSize) ? canonicalSize : leagueSizes[leagueSizes.length - 1],
  );
  const [teamFilter, setTeamFilter] = useState<Set<string>>(new Set());
  const [posFilter, setPosFilter] = useState<Set<string>>(new Set());
  const [perGame, setPerGame] = useState(true);
  const [minGames, setMinGames] = useState(0); // 0 = any; else strictly greater than
  const [minMins, setMinMins] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "value", dir: "desc" });
  const [search, setSearch] = useState("");

  // Freeze the header pane + controls: size the scroll box to the remaining
  // viewport so the thead sticks at its top. The control bar height varies as it
  // wraps, so measure it (plus the fixed nav) and feed it in as an offset.
  const controlsRef = useRef<HTMLDivElement>(null);
  const [topOffset, setTopOffset] = useState(64);
  useEffect(() => {
    const el = controlsRef.current;
    if (!el) return;
    const compute = () => {
      const navH = window.matchMedia("(max-width: 767px)").matches ? 52 : 64;
      setTopOffset(navH + el.offsetHeight);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    window.addEventListener("resize", compute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", compute);
    };
  }, []);

  const teams = useMemo(() => {
    const set = new Set<string>();
    for (const p of players) if (p.team) set.add(p.team);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [players]);

  // Merge stats with the value set for the ACTIVE league size (the only control
  // that changes Value/Minus1V, because it changes the baseline pool).
  const merged = useMemo<Row[]>(() => {
    const vmap = valuesBySize[leagueSize] ?? {};
    return players.map((s) => ({ s, v: vmap[s.player_id] ?? null }));
  }, [players, valuesBySize, leagueSize]);

  const filtered = useMemo<Row[]>(() => {
    const q = search.trim().toLowerCase();
    return merged.filter(({ s }) => {
      if (teamFilter.size > 0 && !(s.team && teamFilter.has(s.team))) return false;
      if (posFilter.size > 0 && !(s.position && posFilter.has(s.position))) return false;
      if (minGames > 0 && (s.g ?? 0) <= minGames) return false;
      if (minMins > 0 && (s.mpg ?? 0) <= minMins) return false;
      if (q && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [merged, teamFilter, posFilter, minGames, minMins, search]);

  // Pull the value a row sorts by for the active key. Counting stats follow the
  // per-game/totals display toggle so the ordering matches what's on screen.
  const sortValue = (row: Row, key: SortKey): number | null => {
    const { s, v } = row;
    switch (key) {
      case "value": return v?.value ?? null;
      case "minus1v": return v?.minus1v ?? null;
      case "consensus": return s.consensus_rank ?? null;
      case "fg_pct": return s.fg_pct ?? null;
      case "ft_pct": return s.ft_pct ?? null;
      default: {
        const base = s[key] as number | null | undefined;
        if (base == null) return null;
        return perGame ? base : base * (s.g ?? 0);
      }
    }
  };

  const sorted = useMemo<Row[]>(() => {
    const rows = [...filtered];
    const { key, dir } = sort;
    rows.sort((a, b) => {
      const av = sortValue(a, key);
      const bv = sortValue(b, key);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls always to the bottom
      if (bv == null) return -1;
      return dir === "asc" ? av - bv : bv - av;
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, perGame]);

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: defaultDir(key) }));

  const togglePos = (p: string) => {
    const next = new Set(posFilter);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setPosFilter(next);
  };

  const empty = players.length === 0;
  const sizesAsc = useMemo(() => [...leagueSizes].sort((a, b) => a - b), [leagueSizes]);

  return (
    <div className="sr-shell">
      <SiteNav active="rankings" />

      <div className="sr-controls" ref={controlsRef}>
        <div className="sr-controls-inner">
          {/* Season — reloads the page with a different dataset */}
          <div className="sr-group">
            <label className="sr-label" htmlFor="sr-season">Season</label>
            <select
              id="sr-season"
              className="sr-select"
              value={activeSeason}
              onChange={(e) => onSeasonChange(e.target.value)}
            >
              {seasons.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* Player pool — the ONLY control that changes Value/Minus1V */}
          <div className="sr-group">
            <label className="sr-label" htmlFor="sr-pool">Player Pool</label>
            <select
              id="sr-pool"
              className="sr-select"
              value={leagueSize}
              onChange={(e) => setLeagueSize(Number(e.target.value))}
              title="Baseline = top-N players by value"
            >
              {sizesAsc.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>

          {/* Position multi-select */}
          <div className="sr-group">
            <span className="sr-label">Position</span>
            <div className="sr-pill-row">
              <button
                type="button"
                className={`sr-pill ${posFilter.size === 0 ? "sr-pill-on" : ""}`}
                onClick={() => setPosFilter(new Set())}
              >
                ALL
              </button>
              {POSITIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`sr-pill ${posFilter.has(p) ? "sr-pill-on" : ""}`}
                  onClick={() => togglePos(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Per-game / Totals (display only) */}
          <div className="sr-group">
            <span className="sr-label">Mode</span>
            <div className="sr-pill-row">
              <button
                type="button"
                className={`sr-pill ${perGame ? "sr-pill-on" : ""}`}
                onClick={() => setPerGame(true)}
              >
                Per Game
              </button>
              <button
                type="button"
                className={`sr-pill ${!perGame ? "sr-pill-on" : ""}`}
                onClick={() => setPerGame(false)}
              >
                Totals
              </button>
            </div>
          </div>

          {/* Rank by (mirrors header-click sorting) */}
          <div className="sr-group">
            <label className="sr-label" htmlFor="sr-rankby">Rank By</label>
            <select
              id="sr-rankby"
              className="sr-select"
              value={["value", "minus1v", "consensus"].includes(sort.key) ? sort.key : ""}
              onChange={(e) => {
                const k = e.target.value as SortKey;
                setSort({ key: k, dir: defaultDir(k) });
              }}
            >
              <option value="value">Value</option>
              <option value="minus1v">Minus1V</option>
              <option value="consensus">Consensus Rank</option>
              {!["value", "minus1v", "consensus"].includes(sort.key) && (
                <option value="" disabled>Column…</option>
              )}
            </select>
          </div>

          {/* Team */}
          <div className="sr-group">
            <label className="sr-label" htmlFor="sr-team">Team</label>
            <select
              id="sr-team"
              className="sr-select"
              value={teamFilter.size === 1 ? [...teamFilter][0] : ""}
              onChange={(e) => setTeamFilter(e.target.value ? new Set([e.target.value]) : new Set())}
            >
              <option value="">All Teams</option>
              {teams.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Min games (display filter) */}
          <div className="sr-group">
            <label className="sr-label" htmlFor="sr-mingames">Min Games</label>
            <select
              id="sr-mingames"
              className="sr-select"
              value={minGames}
              onChange={(e) => setMinGames(Number(e.target.value))}
            >
              <option value={0}>Any</option>
              <option value={5}>GP &gt; 5</option>
              <option value={10}>GP &gt; 10</option>
            </select>
          </div>

          {/* Min minutes (display filter) */}
          <div className="sr-group">
            <label className="sr-label" htmlFor="sr-minmins">Min Minutes</label>
            <select
              id="sr-minmins"
              className="sr-select"
              value={minMins}
              onChange={(e) => setMinMins(Number(e.target.value))}
            >
              <option value={0}>Any</option>
              <option value={5}>MIN &gt; 5</option>
              <option value={10}>MIN &gt; 10</option>
            </select>
          </div>

          {/* Search */}
          <div className="sr-group sr-group-search">
            <label className="sr-label" htmlFor="sr-search">Search</label>
            <input
              id="sr-search"
              type="search"
              className="sr-search"
              placeholder="Player name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
      </div>

      <div className="sr-main">
        {empty ? (
          <p className="sr-empty">
            Seasonal values not loaded yet. Apply the migration and run
            {" "}<code>npm run seasonal:build</code>.
          </p>
        ) : (
          <div
            className={`sr-table-scroll ${seasonPending ? "sr-pending" : ""}`}
            style={{ maxHeight: `calc(100vh - ${topOffset}px)` }}
          >
            <table className="sr-table">
              <thead>
                <tr>
                  <th className="sr-th sr-num-h">RANK</th>
                  <th className="sr-th sr-th-shot" aria-label="Headshot" />
                  <th className="sr-th sr-th-player sr-sticky-col">PLAYER</th>
                  <th className="sr-th">TEAM</th>
                  <th className="sr-th">POS</th>
                  <SortTh label="VALUE" sortKey="value" sort={sort} onSort={onSort} strong />
                  <SortTh label="MINUS1V" sortKey="minus1v" sort={sort} onSort={onSort} />
                  <SortTh label="PTS" sortKey="pts" sort={sort} onSort={onSort} />
                  <SortTh label="3PM" sortKey="fg3m" sort={sort} onSort={onSort} />
                  <SortTh label="REB" sortKey="reb" sort={sort} onSort={onSort} />
                  <SortTh label="AST" sortKey="ast" sort={sort} onSort={onSort} />
                  <SortTh label="STL" sortKey="stl" sort={sort} onSort={onSort} />
                  <SortTh label="BLK" sortKey="blk" sort={sort} onSort={onSort} />
                  <SortTh label="FG%" sortKey="fg_pct" sort={sort} onSort={onSort} />
                  <SortTh label="FT%" sortKey="ft_pct" sort={sort} onSort={onSort} />
                  <SortTh label="TO" sortKey="tov" sort={sort} onSort={onSort} />
                </tr>
              </thead>
              <tbody>
                {sorted.map(({ s, v }, i) => {
                  const g = s.g ?? 0;
                  const tot = (perGameVal: number | null | undefined) =>
                    perGameVal == null ? null : perGameVal * g;
                  const cP = perGame ? f1(s.pts) : fInt(tot(s.pts));
                  const c3 = perGame ? f1(s.fg3m) : fInt(tot(s.fg3m));
                  const cR = perGame ? f1(s.reb) : fInt(tot(s.reb));
                  const cA = perGame ? f1(s.ast) : fInt(tot(s.ast));
                  const cS = perGame ? f1(s.stl) : fInt(tot(s.stl));
                  const cB = perGame ? f1(s.blk) : fInt(tot(s.blk));
                  const cTo = perGame ? f1(s.tov) : fInt(tot(s.tov));

                  return (
                    <tr key={s.player_id} className="sr-tr">
                      <td className="sr-td sr-num">{i + 1}</td>
                      <td className="sr-td sr-td-shot">
                        <Headshot id={s.headshot_id} name={s.name} />
                      </td>
                      <td className="sr-td sr-td-player sr-sticky-col">{s.name}</td>
                      <td className="sr-td sr-td-team">{s.team ?? "—"}</td>
                      <td className="sr-td">{s.position ?? "—"}</td>
                      <td className="sr-td sr-num sr-num-strong" style={{ background: valueBg(v?.value) }}>
                        {f3v(v?.value)}
                      </td>
                      <td className="sr-td sr-num" style={{ background: valueBg(v?.minus1v) }}>
                        {f3v(v?.minus1v)}
                      </td>
                      <td className="sr-td sr-num" style={{ background: statBg(v?.v_pts) }}>{cP}</td>
                      <td className="sr-td sr-num" style={{ background: statBg(v?.v_fg3) }}>{c3}</td>
                      <td className="sr-td sr-num" style={{ background: statBg(v?.v_reb) }}>{cR}</td>
                      <td className="sr-td sr-num" style={{ background: statBg(v?.v_ast) }}>{cA}</td>
                      <td className="sr-td sr-num" style={{ background: statBg(v?.v_stl) }}>{cS}</td>
                      <td className="sr-td sr-num" style={{ background: statBg(v?.v_blk) }}>{cB}</td>
                      <td className="sr-td sr-num" style={{ background: statBg(v?.v_fg) }}>{fPct(s.fg_pct)}</td>
                      <td className="sr-td sr-num" style={{ background: statBg(v?.v_ft) }}>{fPct(s.ft_pct)}</td>
                      <td className="sr-td sr-num" style={{ background: statBg(v?.v_to) }}>{cTo}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!empty && (
          <p className="sr-count">
            Showing {sorted.length} of {players.length} players · baseline = top {leagueSize} players
          </p>
        )}
      </div>

      <Footer />

      <style>{`
        /* The global <nav> is position:fixed and does not consume layout flow,
           so the shell offsets its height (64px desktop / 52px mobile). */
        .sr-shell { min-height: 100vh; display: flex; flex-direction: column; padding-top: 64px; }
        .sr-controls {
          position: sticky; top: 64px; z-index: 50;
          background: var(--bg-surface); border-bottom: 1px solid var(--border-main);
        }
        .sr-controls-inner {
          display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end;
          padding: 12px 20px; max-width: 1400px; margin: 0 auto;
        }
        .sr-group { display: flex; flex-direction: column; gap: 6px; }
        .sr-group-search { flex: 1 1 160px; min-width: 140px; }
        .sr-label {
          font-family: 'Oswald', sans-serif; font-size: 10px; font-weight: 600;
          letter-spacing: 1.5px; text-transform: uppercase; color: var(--text-muted);
        }
        .sr-pill-row { display: flex; gap: 4px; flex-wrap: wrap; }
        .sr-pill {
          font-family: 'Oswald', sans-serif; font-size: 12px; font-weight: 500;
          letter-spacing: 0.5px; padding: 6px 10px; border-radius: 7px; cursor: pointer;
          background: var(--bg-card, #1a1a1a); color: var(--text-secondary);
          border: 1px solid var(--border-main); transition: all 0.15s; white-space: nowrap;
        }
        .sr-pill:hover { color: var(--text-primary); border-color: var(--blueprint); }
        .sr-pill-on {
          background: var(--blueprint); color: #fff; border-color: var(--blueprint);
        }
        .sr-select, .sr-num, .sr-search {
          font-family: 'Source Sans 3', sans-serif; font-size: 13px;
          padding: 7px 10px; border-radius: 7px;
          background: var(--bg-card, #1a1a1a); color: var(--text-primary);
          border: 1px solid var(--border-main); height: 34px;
        }
        .sr-select:focus, .sr-num:focus, .sr-search:focus {
          outline: none; border-color: var(--blueprint);
        }
        .sr-search { width: 100%; }

        .sr-main { flex: 1; }
        .sr-empty {
          text-align: center; color: var(--text-secondary); padding: 60px 20px;
          font-family: 'Source Sans 3', sans-serif;
        }
        .sr-empty code {
          font-family: 'JetBrains Mono', monospace; font-size: 12px;
          background: var(--bg-card, #1a1a1a); padding: 2px 6px; border-radius: 4px;
        }
        /* Inner scroll box → both the thead (top:0) and the player column (left:0)
           freeze like Excel panes against this container's scrollport. */
        .sr-table-scroll { overflow: auto; width: 100%; }
        .sr-pending { opacity: 0.45; transition: opacity 0.15s; pointer-events: none; }
        .sr-table {
          border-collapse: separate; border-spacing: 0; width: 100%;
          min-width: 980px; margin: 0 auto; max-width: 1400px;
        }
        .sr-th {
          position: sticky; top: 0; z-index: 10;
          background: var(--bg-surface);
          font-family: 'Oswald', sans-serif; font-size: 11px; font-weight: 600;
          letter-spacing: 1px; color: var(--text-secondary); text-transform: uppercase;
          padding: 10px 8px; text-align: left; white-space: nowrap;
          border-bottom: 1px solid var(--border-main);
          box-shadow: inset 0 -1px 0 var(--border-main);
        }
        .sr-num-h { text-align: center; }
        .sr-th-sortable { cursor: pointer; user-select: none; }
        .sr-th-sortable:hover { color: var(--text-primary); }
        .sr-th-strong { color: var(--text-primary); }
        .sr-th-active { color: var(--edge-orange); }
        .sr-sort-arrow { margin-left: 3px; font-size: 10px; }
        .sr-th-shot { width: 48px; }
        .sr-th-player { min-width: 160px; }
        /* the frozen corner cell (PLAYER header) needs to win on both axes */
        .sr-th.sr-sticky-col { left: 0; z-index: 20; }

        .sr-tr:hover .sr-td { background: var(--bg-card-hover, rgba(255,255,255,0.03)); }
        .sr-td {
          padding: 7px 8px; font-size: 13px; color: var(--text-primary);
          border-bottom: 1px solid var(--border-main); white-space: nowrap;
          font-family: 'Source Sans 3', sans-serif;
        }
        .sr-num {
          text-align: center; font-family: 'JetBrains Mono', monospace;
          font-variant-numeric: tabular-nums;
        }
        .sr-num-strong { font-weight: 700; }
        .sr-td-player { font-weight: 600; }
        .sr-td-team, .sr-td .sr-td-team { color: var(--text-secondary); font-size: 12px; }

        /* sticky player column */
        .sr-sticky-col { position: sticky; left: 0; z-index: 5; background: var(--bg-surface); }
        .sr-tr:hover .sr-sticky-col { background: var(--bg-card-hover, #1c1c1c); }

        .sr-headshot-img {
          width: 40px; height: 40px; border-radius: 50%; object-fit: cover;
          object-position: center top; background: var(--bg-card, #1a1a1a);
          display: block;
        }
        .sr-headshot-fallback {
          width: 40px; height: 40px; border-radius: 50%;
          display: inline-flex; align-items: center; justify-content: center;
          background: var(--bg-card, #1a1a1a); color: var(--text-muted);
        }
        .sr-count {
          text-align: center; font-size: 11px; color: var(--text-muted);
          padding: 10px 0 24px; font-family: 'Source Sans 3', sans-serif;
        }

        @media (max-width: 767px) {
          .sr-shell { padding-top: 52px; }
          .sr-controls { top: 52px; }
          .sr-controls-inner { gap: 10px; padding: 10px 12px; }
          .sr-th-shot, .sr-td-shot { display: none; }
        }
      `}</style>
    </div>
  );
}
