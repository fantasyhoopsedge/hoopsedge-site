"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SeasonPlayerStats, SeasonPlayerValues } from "@/types/database";
import { SiteNav } from "@/components/site-nav";
import { Footer } from "@/components/footer";

type SeasonOption = { key: string; label: string };

type ValuesBySize = Record<number, Record<string, SeasonPlayerValues>>;

// Every column the table can sort by. value/minus1v/fg_v/ft_v come from the
// active value set; consensus from the stat row; the rest are raw stats.
type SortKey =
  | "value" | "minus1v" | "consensus" | "age" | "g" | "mpg"
  | "pts" | "fg3m" | "reb" | "ast" | "stl" | "blk" | "fg_pct" | "ft_pct" | "tov"
  | "fg_v" | "ft_v";
type SortDir = "asc" | "desc";

// The active (per-game OR totals) value set for one player: the 9 category
// V-scores plus the two summary scores, already mode-resolved.
type ActiveV = {
  value: number | null; minus1v: number | null;
  pts: number | null; fg3: number | null; reb: number | null; ast: number | null;
  stl: number | null; blk: number | null; fg: number | null; ft: number | null; to: number | null;
};

// Per Game uses the base columns; Totals uses the *_tot columns (falling back to
// per-game if a totals value is missing, e.g. before the totals rebuild ran).
function pickV(v: SeasonPlayerValues | null, perGame: boolean): ActiveV | null {
  if (!v) return null;
  if (perGame) {
    return {
      value: v.value, minus1v: v.minus1v,
      pts: v.v_pts, fg3: v.v_fg3, reb: v.v_reb, ast: v.v_ast,
      stl: v.v_stl, blk: v.v_blk, fg: v.v_fg, ft: v.v_ft, to: v.v_to,
    };
  }
  const t = (tot: number | null, pg: number | null) => (tot == null ? pg : tot);
  return {
    value: t(v.value_tot, v.value), minus1v: t(v.minus1v_tot, v.minus1v),
    pts: t(v.v_pts_tot, v.v_pts), fg3: t(v.v_fg3_tot, v.v_fg3), reb: t(v.v_reb_tot, v.v_reb),
    ast: t(v.v_ast_tot, v.v_ast), stl: t(v.v_stl_tot, v.v_stl), blk: t(v.v_blk_tot, v.v_blk),
    fg: t(v.v_fg_tot, v.v_fg), ft: t(v.v_ft_tot, v.v_ft), to: t(v.v_to_tot, v.v_to),
  };
}

// The 9 category V-scores mapped to the stat cell they color, in canonical order.
// Minus1V drops a player's WORST category (the argmin of these), so we surface it.
const CAT_CELLS: [string, keyof ActiveV][] = [
  ["pts", "pts"], ["fg3m", "fg3"], ["reb", "reb"], ["ast", "ast"],
  ["stl", "stl"], ["blk", "blk"], ["fg_pct", "fg"], ["ft_pct", "ft"], ["tov", "to"],
];

/** Which stat cell is dropped from Minus1V = the player's lowest of the 9 V-scores. */
function droppedCat(av: ActiveV | null): string | null {
  if (!av) return null;
  let best: string | null = null;
  let bestV = Infinity;
  for (const [cell, f] of CAT_CELLS) {
    const val = av[f];
    if (val == null || !Number.isFinite(val)) continue;
    if (val < bestV) {
      bestV = val;
      best = cell;
    }
  }
  return best;
}

const POSITIONS = ["G", "F", "C", "G/F", "F/C"] as const;

// consensus reads best ascending (1 at top); everything else descending (best first).
const defaultDir = (key: SortKey): SortDir => (key === "consensus" ? "asc" : "desc");

// ── per-player merged row for the active league size ──────────────────────────
type Row = {
  s: SeasonPlayerStats;
  v: SeasonPlayerValues | null;
  rank: number; // 1-based rank in the FULL set by the active sort (retained under filters)
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
const fAge = (x: number | null | undefined) => (x == null ? "—" : String(Math.floor(x))); // whole years
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
  ageByRank: Record<number, number>;
}) {
  const { players, valuesBySize, leagueSizes, canonicalSize, seasons, activeSeason, ageByRank } = props;
  const router = useRouter();

  // Consensus ages are a snapshot at the latest season (2026 = 2025-26); shift
  // back one year per prior season so the displayed age is dynamic to the dataset.
  const seasonNum = parseInt(activeSeason, 10) || 2026;
  const ageOf = (s: SeasonPlayerStats): number | null => {
    if (s.consensus_rank == null) return null;
    const base = ageByRank[s.consensus_rank];
    if (base == null) return null;
    return base - (2026 - seasonNum);
  };

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
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [tickedOnly, setTickedOnly] = useState(false);

  const toggleCheck = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
  const merged = useMemo(() => {
    const vmap = valuesBySize[leagueSize] ?? {};
    return players.map((s) => ({ s, v: vmap[s.player_id] ?? null }));
  }, [players, valuesBySize, leagueSize]);

  // Pull the value a row sorts by for the active key. value/minus1v/fg_v/ft_v
  // follow the Per Game vs Totals toggle (different value sets); counting stats
  // follow it via totalling, so ordering matches what's on screen.
  const sortValue = (s: SeasonPlayerStats, av: ActiveV | null, key: SortKey): number | null => {
    switch (key) {
      case "value": return av?.value ?? null;
      case "minus1v": return av?.minus1v ?? null;
      case "fg_v": return av?.fg ?? null;
      case "ft_v": return av?.ft ?? null;
      case "consensus": return s.consensus_rank ?? null;
      case "age": return ageOf(s);
      case "g": return s.g ?? null; // a count — never totalled
      case "fg_pct": return s.fg_pct ?? null;
      case "ft_pct": return s.ft_pct ?? null;
      default: {
        const base = s[key] as number | null | undefined;
        if (base == null) return null;
        return perGame ? base : base * (s.g ?? 0);
      }
    }
  };

  // Rank the WHOLE set by the active sort first, stamp a 1-based rank on each
  // row, THEN filter — so the left-hand rank is retained under any filter. (Item 2.)
  const rankedAll = useMemo<Row[]>(() => {
    const { key, dir } = sort;
    const rows = merged.map(({ s, v }) => ({ s, v, av: pickV(v, perGame) }));
    rows.sort((a, b) => {
      const av = sortValue(a.s, a.av, key);
      const bv = sortValue(b.s, b.av, key);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls always to the bottom
      if (bv == null) return -1;
      return dir === "asc" ? av - bv : bv - av;
    });
    return rows.map(({ s, v }, i) => ({ s, v, rank: i + 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merged, sort, perGame]);

  const visible = useMemo<Row[]>(() => {
    const q = search.trim().toLowerCase();
    return rankedAll.filter(({ s }) => {
      if (tickedOnly && !checked.has(s.player_id)) return false;
      if (teamFilter.size > 0 && !(s.team && teamFilter.has(s.team))) return false;
      if (posFilter.size > 0 && !(s.position && posFilter.has(s.position))) return false;
      if (minGames > 0 && (s.g ?? 0) <= minGames) return false;
      if (minMins > 0 && (s.mpg ?? 0) <= minMins) return false;
      if (q && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rankedAll, tickedOnly, checked, teamFilter, posFilter, minGames, minMins, search]);

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

          {/* Ticked-player filter */}
          <div className="sr-group">
            <span className="sr-label">My List</span>
            <div className="sr-pill-row">
              <button
                type="button"
                className={`sr-pill ${tickedOnly ? "sr-pill-on" : ""}`}
                onClick={() => setTickedOnly((v) => !v)}
                disabled={checked.size === 0}
              >
                Ticked Only ({checked.size})
              </button>
              {checked.size > 0 && (
                <button
                  type="button"
                  className="sr-pill"
                  onClick={() => { setChecked(new Set()); setTickedOnly(false); }}
                >
                  Clear
                </button>
              )}
            </div>
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
                  <th className="sr-th sr-th-pick" aria-label="Tick" />
                  <th className="sr-th sr-num-h">RANK</th>
                  <th className="sr-th sr-th-shot" aria-label="Headshot" />
                  <th className="sr-th sr-th-player sr-sticky-col">PLAYER</th>
                  <th className="sr-th sr-w">TEAM</th>
                  <th className="sr-th sr-w">POS</th>
                  <SortTh label="AGE" sortKey="age" sort={sort} onSort={onSort} />
                  <SortTh label="GP" sortKey="g" sort={sort} onSort={onSort} />
                  <SortTh label="MIN" sortKey="mpg" sort={sort} onSort={onSort} />
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
                  <SortTh label="FG%V" sortKey="fg_v" sort={sort} onSort={onSort} />
                  <SortTh label="FT%V" sortKey="ft_v" sort={sort} onSort={onSort} />
                </tr>
              </thead>
              <tbody>
                {visible.map(({ s, v, rank }) => {
                  const g = s.g ?? 0;
                  const tot = (perGameVal: number | null | undefined) =>
                    perGameVal == null ? null : perGameVal * g;
                  const cGP = s.g == null ? "—" : String(s.g);
                  const cMin = perGame ? f1(s.mpg) : fInt(tot(s.mpg));
                  const cP = perGame ? f1(s.pts) : fInt(tot(s.pts));
                  const c3 = perGame ? f1(s.fg3m) : fInt(tot(s.fg3m));
                  const cR = perGame ? f1(s.reb) : fInt(tot(s.reb));
                  const cA = perGame ? f1(s.ast) : fInt(tot(s.ast));
                  const cS = perGame ? f1(s.stl) : fInt(tot(s.stl));
                  const cB = perGame ? f1(s.blk) : fInt(tot(s.blk));
                  const cTo = perGame ? f1(s.tov) : fInt(tot(s.tov));

                  // Mode-resolved value set drives the summary/value cells + heatmap.
                  const av = pickV(v, perGame);
                  // When ranked by Minus1V, ring the one category that's dropped.
                  const dropped = sort.key === "minus1v" ? droppedCat(av) : null;
                  const drop = (cell: string) => (dropped === cell ? " sr-dropped" : "");
                  // Bold the actively-sorted column's cells (and only that column).
                  const bold = (key: SortKey) => (sort.key === key ? " sr-sorted" : "");

                  return (
                    <tr key={s.player_id} className="sr-tr">
                      <td className="sr-td sr-td-pick">
                        <input
                          type="checkbox"
                          checked={checked.has(s.player_id)}
                          onChange={() => toggleCheck(s.player_id)}
                          aria-label={`Tick ${s.name}`}
                        />
                      </td>
                      <td className="sr-td sr-num">{rank}</td>
                      <td className="sr-td sr-td-shot">
                        <Headshot id={s.headshot_id} name={s.name} />
                      </td>
                      <td className="sr-td sr-td-player sr-sticky-col">{s.name}</td>
                      <td className={`sr-td sr-td-team sr-w`}>{s.team ?? "—"}</td>
                      <td className="sr-td sr-w">{s.position ?? "—"}</td>
                      <td className={`sr-td sr-num${bold("age")}`}>{fAge(ageOf(s))}</td>
                      <td className={`sr-td sr-num${bold("g")}`}>{cGP}</td>
                      <td className={`sr-td sr-num${bold("mpg")}`}>{cMin}</td>
                      <td className={`sr-td sr-num${bold("value")}`} style={{ background: valueBg(av?.value) }}>
                        {f3v(av?.value)}
                      </td>
                      <td className={`sr-td sr-num${bold("minus1v")}`} style={{ background: valueBg(av?.minus1v) }}>
                        {f3v(av?.minus1v)}
                      </td>
                      <td className={`sr-td sr-num${drop("pts")}${bold("pts")}`} style={{ background: statBg(av?.pts) }}>{cP}</td>
                      <td className={`sr-td sr-num${drop("fg3m")}${bold("fg3m")}`} style={{ background: statBg(av?.fg3) }}>{c3}</td>
                      <td className={`sr-td sr-num${drop("reb")}${bold("reb")}`} style={{ background: statBg(av?.reb) }}>{cR}</td>
                      <td className={`sr-td sr-num${drop("ast")}${bold("ast")}`} style={{ background: statBg(av?.ast) }}>{cA}</td>
                      <td className={`sr-td sr-num${drop("stl")}${bold("stl")}`} style={{ background: statBg(av?.stl) }}>{cS}</td>
                      <td className={`sr-td sr-num${drop("blk")}${bold("blk")}`} style={{ background: statBg(av?.blk) }}>{cB}</td>
                      <td className={`sr-td sr-num${drop("fg_pct")}${bold("fg_pct")}`} style={{ background: statBg(av?.fg) }}>{fPct(s.fg_pct)}</td>
                      <td className={`sr-td sr-num${drop("ft_pct")}${bold("ft_pct")}`} style={{ background: statBg(av?.ft) }}>{fPct(s.ft_pct)}</td>
                      <td className={`sr-td sr-num${drop("tov")}${bold("tov")}`} style={{ background: statBg(av?.to) }}>{cTo}</td>
                      <td className={`sr-td sr-num${bold("fg_v")}`} style={{ background: statBg(av?.fg) }}>{f3v(av?.fg)}</td>
                      <td className={`sr-td sr-num${bold("ft_v")}`} style={{ background: statBg(av?.ft) }}>{f3v(av?.ft)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!empty && (
          <p className="sr-count">
            Showing {visible.length} of {players.length} players · baseline = top {leagueSize} players · {perGame ? "per-game" : "totals"} values
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
          font-family: 'VT323', monospace; font-size: 10px; font-weight: 600;
          letter-spacing: 1.5px; text-transform: uppercase; color: var(--text-muted);
        }
        .sr-pill-row { display: flex; gap: 4px; flex-wrap: wrap; }
        .sr-pill {
          font-family: 'VT323', monospace; font-size: 12px; font-weight: 500;
          letter-spacing: 0.5px; padding: 6px 10px; border-radius: 7px; cursor: pointer;
          background: var(--bg-card, #1a1a1a); color: var(--text-secondary);
          border: 1px solid var(--border-main); transition: all 0.15s; white-space: nowrap;
        }
        .sr-pill:hover { color: var(--text-primary); border-color: var(--blueprint); }
        .sr-pill-on {
          background: var(--blueprint); color: #fff; border-color: var(--blueprint);
        }
        /* Form controls only — NOT the table's numeric cells (which reuse the
           .sr-num class); keep these selectors off .sr-num to avoid painting a
           --bg-card background onto RANK/AGE/GP/MIN. */
        .sr-select, .sr-search {
          font-family: 'VT323', monospace; font-size: 13px;
          padding: 7px 10px; border-radius: 7px;
          background: var(--bg-card, #1a1a1a); color: var(--text-primary);
          border: 1px solid var(--border-main); height: 34px;
        }
        .sr-select:focus, .sr-search:focus {
          outline: none; border-color: var(--blueprint);
        }
        .sr-search { width: 100%; }

        .sr-main { flex: 1; }
        .sr-empty {
          text-align: center; color: var(--text-secondary); padding: 60px 20px;
          font-family: 'VT323', monospace;
        }
        .sr-empty code {
          font-family: 'VT323', monospace; font-size: 12px;
          background: var(--bg-card, #1a1a1a); padding: 2px 6px; border-radius: 4px;
        }
        /* Inner scroll box → both the thead (top:0) and the player column (left:0)
           freeze like Excel panes against this container's scrollport. */
        .sr-table-scroll { overflow: auto; width: 100%; }
        .sr-pending { opacity: 0.45; transition: opacity 0.15s; pointer-events: none; }
        .sr-table {
          border-collapse: separate; border-spacing: 0; width: 100%;
          min-width: 1640px; margin: 0 auto; max-width: 1840px;
        }
        .sr-th {
          position: sticky; top: 0; z-index: 10;
          background: var(--bg-body);
          font-family: 'VT323', monospace; font-size: 15px; font-weight: 400;
          letter-spacing: 0; color: var(--text-secondary); text-transform: uppercase;
          padding: 7px 4px; text-align: center; white-space: nowrap;
          border-bottom: 1px solid var(--border-main);
        }
        /* Number/value columns AND team/pos share one fixed width (header + cells),
           sized so the widest header (MINUS1V) shows in full. */
        .sr-num-h, .sr-num, .sr-w { width: 70px; min-width: 70px; max-width: 70px; }
        .sr-th-sortable { cursor: pointer; user-select: none; }
        .sr-th-sortable:hover { color: var(--text-primary); }
        .sr-th-strong { color: var(--text-primary); }
        .sr-th-active { color: var(--edge-orange); font-weight: 700; }
        .sr-sort-arrow { margin-left: 2px; font-size: 10px; }
        /* leading tick-box column — fixed + aligned far left, before RANK */
        .sr-th-pick, .sr-td-pick { width: 30px; min-width: 30px; max-width: 30px; padding: 0 0 0 10px; }
        .sr-td-pick input { width: 13px; height: 13px; accent-color: var(--edge-orange); cursor: pointer; display: block; margin: 0 auto; }
        .sr-th-shot { width: 40px; }
        /* PLAYER wide enough to keep every name on one line */
        .sr-th-player { width: 210px; min-width: 210px; max-width: 210px; }
        /* the frozen corner cell (PLAYER header) needs to win on both axes */
        .sr-th.sr-sticky-col { left: 0; z-index: 20; background: var(--bg-body); }

        .sr-tr:hover .sr-td { background: var(--bg-card-hover, rgba(255,255,255,0.03)); }
        .sr-td {
          padding: 5px 5px; font-size: 15px; color: var(--text-primary);
          border-bottom: 1px solid var(--border-main); white-space: nowrap;
          font-family: 'VT323', monospace; text-align: center; line-height: 1.05;
        }
        /* Number/value columns: same font, smaller than the name/text columns. */
        .sr-num {
          text-align: center; font-size: 15px; padding: 5px 4px;
          font-variant-numeric: tabular-nums;
        }
        /* Bold only the actively-sorted column's cells. */
        .sr-sorted { font-weight: 700; color: var(--text-primary); }
        /* Minus1V "punt" view: ring the dropped category in FHE orange. */
        .sr-dropped {
          box-shadow: inset 0 0 0 2px var(--edge-orange);
          border-radius: 4px; color: var(--edge-orange); font-weight: 700;
        }
        .sr-td-player { font-weight: 400; }
        .sr-td-team, .sr-td .sr-td-team { color: var(--text-secondary); }

        /* sticky player column — same base background as the data cells (which
           show the page body), so no column has a different shade in either theme */
        .sr-sticky-col { position: sticky; left: 0; z-index: 5; background: var(--bg-body); }
        .sr-tr:hover .sr-sticky-col { background: var(--bg-card-hover, #1c1c1c); }

        .sr-headshot-img {
          width: 34px; height: 34px; border-radius: 50%; object-fit: cover;
          object-position: center top; background: var(--bg-card, #1a1a1a);
          display: block;
        }
        .sr-headshot-fallback {
          width: 34px; height: 34px; border-radius: 50%;
          display: inline-flex; align-items: center; justify-content: center;
          background: var(--bg-card, #1a1a1a); color: var(--text-muted);
        }
        .sr-count {
          text-align: center; font-size: 11px; color: var(--text-muted);
          padding: 10px 0 24px; font-family: 'VT323', monospace;
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
