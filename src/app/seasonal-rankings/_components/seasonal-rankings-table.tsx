"use client";

import { useMemo, useState } from "react";
import type { SeasonPlayerStats, SeasonPlayerValues } from "@/types/database";
import { SiteNav } from "@/components/site-nav";
import { Footer } from "@/components/footer";

type ValuesBySize = Record<number, Record<string, SeasonPlayerValues>>;
type RankBy = "value" | "minus1v" | "consensus";

const POSITIONS = ["G", "F", "C", "G/F", "F/C"] as const;

// ── per-player merged row for the active league size ──────────────────────────
type Row = {
  s: SeasonPlayerStats;
  v: SeasonPlayerValues | null;
};

function leagueLabel(size: number): string {
  // teams = roster capacity / 15 where it divides cleanly, else show size only.
  const teams = size / 15;
  if (Number.isInteger(teams)) return `${teams}T·${size}`;
  // 144=12×12, 256=16×16, 400=20×20 (the fixed menu)
  const map: Record<number, string> = { 144: "12T·144", 256: "16T·256", 400: "20T·400" };
  return map[size] ?? `${size}`;
}

// Diverging background anchored to a V-score (NOT to raw magnitude). Fixed scale:
// positive → green, 0 → transparent, negative → red. Legible light text on top.
function vBg(v: number | null | undefined, posAnchor: number, negAnchor: number): string {
  if (v == null || !Number.isFinite(v)) return "transparent";
  if (v >= 0) {
    const t = Math.min(v / posAnchor, 1);
    return `rgba(34, 197, 94, ${(t * 0.55).toFixed(3)})`;
  }
  const t = Math.min(-v / negAnchor, 1);
  return `rgba(239, 68, 68, ${(t * 0.55).toFixed(3)})`;
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

function SortArrow({ active }: { active: boolean }) {
  return <span className="sr-sort-arrow">{active ? "↓" : ""}</span>;
}

export function SeasonalRankingsTable(props: {
  players: SeasonPlayerStats[];
  valuesBySize: ValuesBySize;
  leagueSizes: number[];
  canonicalSize: number;
}) {
  const { players, valuesBySize, leagueSizes, canonicalSize } = props;

  const [leagueSize, setLeagueSize] = useState<number>(
    leagueSizes.includes(canonicalSize) ? canonicalSize : leagueSizes[leagueSizes.length - 1],
  );
  const [teamFilter, setTeamFilter] = useState<Set<string>>(new Set());
  const [posFilter, setPosFilter] = useState<Set<string>>(new Set());
  const [perGame, setPerGame] = useState(true);
  const [minGames, setMinGames] = useState(0);
  const [minMins, setMinMins] = useState(0);
  const [rankBy, setRankBy] = useState<RankBy>("value");
  const [search, setSearch] = useState("");

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
      if (minGames > 0 && (s.g ?? 0) < minGames) return false;
      if (minMins > 0 && (s.mpg ?? 0) < minMins) return false;
      if (q && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [merged, teamFilter, posFilter, minGames, minMins, search]);

  const sorted = useMemo<Row[]>(() => {
    const rows = [...filtered];
    if (rankBy === "consensus") {
      // ascending (1 at top); null consensus forced to the bottom.
      rows.sort((a, b) => {
        const ar = a.s.consensus_rank;
        const br = b.s.consensus_rank;
        if (ar == null && br == null) return (b.v?.value ?? -Infinity) - (a.v?.value ?? -Infinity);
        if (ar == null) return 1;
        if (br == null) return -1;
        return ar - br;
      });
    } else {
      const key = rankBy === "value" ? "value" : "minus1v";
      rows.sort((a, b) => (b.v?.[key] ?? -Infinity) - (a.v?.[key] ?? -Infinity));
    }
    return rows;
  }, [filtered, rankBy]);

  const togglePos = (p: string) => {
    const next = new Set(posFilter);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setPosFilter(next);
  };

  const empty = players.length === 0;

  return (
    <div className="sr-shell">
      <SiteNav active="rankings" />

      <div className="sr-controls">
        <div className="sr-controls-inner">
          {/* League size — the ONLY control that changes Value/Minus1V */}
          <div className="sr-group">
            <span className="sr-label">League Size</span>
            <div className="sr-pill-row">
              {leagueSizes.map((size) => (
                <button
                  key={size}
                  type="button"
                  className={`sr-pill ${leagueSize === size ? "sr-pill-on" : ""}`}
                  onClick={() => setLeagueSize(size)}
                  title={`Baseline = top ${size} players`}
                >
                  {leagueLabel(size)}
                </button>
              ))}
            </div>
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

          {/* Rank by */}
          <div className="sr-group">
            <label className="sr-label" htmlFor="sr-rankby">Rank By</label>
            <select
              id="sr-rankby"
              className="sr-select"
              value={rankBy}
              onChange={(e) => setRankBy(e.target.value as RankBy)}
            >
              <option value="value">Value</option>
              <option value="minus1v">Minus1V</option>
              <option value="consensus">Consensus Rank</option>
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

          {/* Min games / minutes (display filters) */}
          <div className="sr-group">
            <label className="sr-label" htmlFor="sr-mingames">Min G</label>
            <input
              id="sr-mingames"
              type="number"
              min={0}
              className="sr-num"
              value={minGames || ""}
              onChange={(e) => setMinGames(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <div className="sr-group">
            <label className="sr-label" htmlFor="sr-minmins">Min MPG</label>
            <input
              id="sr-minmins"
              type="number"
              min={0}
              className="sr-num"
              value={minMins || ""}
              onChange={(e) => setMinMins(Math.max(0, Number(e.target.value) || 0))}
            />
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
          <div className="sr-table-scroll">
            <table className="sr-table">
              <thead>
                <tr>
                  <th className="sr-th sr-num-h">RANK</th>
                  <th className="sr-th sr-th-shot" aria-label="Headshot" />
                  <th className="sr-th sr-th-player sr-sticky-col">PLAYER</th>
                  <th className="sr-th">TEAM</th>
                  <th className="sr-th">POS</th>
                  <th className={`sr-th sr-num-h ${rankBy === "value" ? "sr-th-active" : ""}`}>
                    VALUE<SortArrow active={rankBy === "value"} />
                  </th>
                  <th className={`sr-th sr-num-h ${rankBy === "minus1v" ? "sr-th-active" : ""}`}>
                    MINUS1V<SortArrow active={rankBy === "minus1v"} />
                  </th>
                  <th className="sr-th sr-num-h">P</th>
                  <th className="sr-th sr-num-h">3</th>
                  <th className="sr-th sr-num-h">R</th>
                  <th className="sr-th sr-num-h">A</th>
                  <th className="sr-th sr-num-h">S</th>
                  <th className="sr-th sr-num-h">B</th>
                  <th className="sr-th sr-num-h">FG%</th>
                  <th className="sr-th sr-num-h">FT%</th>
                  <th className="sr-th sr-num-h">TO</th>
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

            <p className="sr-count">
              Showing {sorted.length} of {players.length} players · baseline = top {leagueSize} ({leagueLabel(leagueSize)})
            </p>
          </div>
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
        .sr-num { width: 70px; }
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
        .sr-table-scroll { overflow-x: auto; width: 100%; }
        .sr-table {
          border-collapse: separate; border-spacing: 0; width: 100%;
          min-width: 980px; margin: 0 auto; max-width: 1400px;
        }
        .sr-th {
          background: var(--bg-surface);
          font-family: 'Oswald', sans-serif; font-size: 11px; font-weight: 600;
          letter-spacing: 1px; color: var(--text-secondary); text-transform: uppercase;
          padding: 10px 8px; text-align: left; white-space: nowrap;
          border-bottom: 1px solid var(--border-main);
        }
        .sr-num-h { text-align: right; }
        .sr-th-active { color: var(--edge-orange); }
        .sr-sort-arrow { margin-left: 3px; font-size: 10px; }
        .sr-th-shot { width: 48px; }
        .sr-th-player { min-width: 160px; }

        .sr-tr:hover .sr-td { background: var(--bg-card-hover, rgba(255,255,255,0.03)); }
        .sr-td {
          padding: 7px 8px; font-size: 13px; color: var(--text-primary);
          border-bottom: 1px solid var(--border-main); white-space: nowrap;
          font-family: 'Source Sans 3', sans-serif;
        }
        .sr-num {
          text-align: right; font-family: 'JetBrains Mono', monospace;
          font-variant-numeric: tabular-nums;
        }
        .sr-num-strong { font-weight: 700; }
        .sr-td-player { font-weight: 600; }
        .sr-td-team, .sr-td .sr-td-team { color: var(--text-secondary); font-size: 12px; }

        /* sticky player column on small screens */
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
