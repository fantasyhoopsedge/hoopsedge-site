"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SeasonPlayerStats, SeasonPlayerValues } from "@/types/database";
import { PlatformSidebarNav } from "@/components/platform-sidebar-nav";
import { Footer } from "@/components/footer";
import { TEAM_LOGO } from "@/app/team-rosters/_components/roster-data";
import { shortenPlayerName } from "@/lib/shorten-name";
import { prospectHeadshotUrl, nbaHeadshotUrl } from "@/lib/dynasty-rankings";
import { initials } from "@/app/team-rosters/_components/roster-helpers";

type SeasonOption = { key: string; label: string };

type ValuesBySize = Record<number, Record<string, SeasonPlayerValues>>;

// Every column the table can sort by. value/minus1v/fg_v/ft_v come from the
// active value set; consensus from the stat row; the rest are raw stats.
type SortKey =
  | "value" | "minus1v" | "consensus" | "age" | "g" | "mpg" | "usg"
  | "pts" | "fg3m" | "reb" | "ast" | "stl" | "blk" | "fga" | "fg_pct" | "fta" | "ft_pct" | "tov"
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

// Filter on the three base positions; each matches any slot containing it, so
// G → {G, G/F}, F → {F, G/F, F/C}, C → {C, F/C}.
const POSITIONS = ["G", "F", "C"] as const;

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

// USG/FGA/FTA aren't part of the 9-cat value engine (compute-values.ts only
// scores the 9 roto categories), so there's no backend V-score to color them
// by. Approximate the same "diverging off a standardized score" treatment
// with a z-score computed client-side against this dataset's own player pool
// (population mean/σ, ALL players — not just the visible/filtered rows, same
// "stable baseline regardless of filters" idea the real CatV baseline uses),
// then feed it through the same statBg() every 9-cat cell uses.
function meanStd(values: number[]): { mu: number; sigma: number } {
  if (values.length === 0) return { mu: 0, sigma: 0 };
  const mu = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mu) ** 2, 0) / values.length;
  return { mu, sigma: Math.sqrt(variance) };
}
function zOf(raw: number | null | undefined, ms: { mu: number; sigma: number }): number | null {
  if (raw == null || !Number.isFinite(raw) || ms.sigma === 0) return null;
  return (raw - ms.mu) / ms.sigma;
}

// ── number formatting (matches dynasty-rankings precision) ────────────────────
const f1 = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(1));
const fInt = (x: number | null | undefined) => (x == null ? "—" : String(Math.round(x)));
const fAge = (x: number | null | undefined) => (x == null ? "—" : String(Math.floor(x))); // whole years
const fVal = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(2)); // Value/Minus1V/FG%V/FT%V
const fPct = (x: number | null | undefined) =>
  x == null ? "—" : x.toFixed(3).replace(/^0(?=\.)/, ""); // .529

function espnHeadshot(id: string | null): string | null {
  return id ? `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png` : null;
}

// prospectHeadshotUrl() slugifies the name AS GIVEN — it doesn't strip or add
// a jr/sr/ii/iii/iv suffix the way normalizePlayerName() does. The Summer
// League feed's PLAYER_NAME sometimes drops a suffix the seeded prospect art
// filename carries (e.g. API "Morez Johnson" vs. file morez-johnson-jr.jpg),
// so try the bare name plus each common suffix appended as separate fallback
// stages rather than a single guess.
const NAME_SUFFIXES = ["", " Jr.", " Sr.", " II", " III", " IV"];
function prospectHeadshotCandidates(name: string): string[] {
  return NAME_SUFFIXES.map((suffix) => prospectHeadshotUrl(`${name}${suffix}`));
}

function Headshot({ id, name, extraSources }: { id: string | null; name: string; extraSources?: (string | null)[] }) {
  const [stage, setStage] = useState(0);
  // ESPN first (the normal source, tied to this row's own identity), then any
  // extra fallbacks the caller opts in (see isUnmatchedRookieDataset below) —
  // same multi-stage cycling pattern as team-rosters' PlayerHeadshot.
  const sources = [espnHeadshot(id), ...(extraSources ?? [])].filter((u): u is string => !!u);
  const targetUrl = sources[stage] ?? null;

  // Render the <img src> one tick AFTER mount rather than in the same pass.
  // load/error don't bubble, so React attaches onError directly on the node
  // during commit — but an <img> rendered with src already set can start
  // (and finish) a fast failure, e.g. a local 404, in that SAME commit,
  // before that listener is live. The event is then simply lost (nothing was
  // listening yet) and the row is stuck on a broken image forever, unable to
  // ever reach the next candidate or the initials fallback. Deferring src to
  // a follow-up render via useEffect guarantees the listener already exists
  // before the browser starts the request, at the cost of a one-frame delay
  // before any headshot (including ones that resolve immediately) appears.
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null);
  useEffect(() => {
    setRenderedUrl(targetUrl);
  }, [targetUrl]);

  if (renderedUrl) {
    return (
      <img
        src={renderedUrl}
        alt=""
        width={40}
        height={40}
        onError={() => setStage((s) => s + 1)}
        className="sr-headshot-img"
      />
    );
  }
  // Initials fallback — no image source resolved (or not rendered yet).
  return (
    <span className="sr-headshot-fallback" aria-hidden>
      {initials(name)}
    </span>
  );
}

function TeamLogo({ team }: { team: string | null }) {
  const [ok, setOk] = useState(true);
  if (!team) return <span className="sr-td-team-text">—</span>;
  const file = TEAM_LOGO[team];
  if (file && ok) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- static team wordmark from public/
      <img
        src={`/images/nba%20team%20images/${file}`}
        alt={team}
        width={28}
        height={28}
        loading="lazy"
        onError={() => setOk(false)}
        className="sr-team-logo"
      />
    );
  }
  // Unknown/unmapped code — show the raw text rather than nothing.
  return <span className="sr-td-team-text">{team}</span>;
}

// Sortable numeric header cell.
function SortTh({
  label, sortKey, sort, onSort, strong, wide,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
  strong?: boolean;
  /** MINUS1V is a touch wider than the other headers in Geist — see .sr-num-h-wide. */
  wide?: boolean;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className={`sr-th sr-num-h sr-th-sortable ${wide ? "sr-num-h-wide" : ""} ${active ? "sr-th-active" : ""} ${strong ? "sr-th-strong" : ""}`}
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
  /** Keyed by fhe_id, resolved server-side in page.tsx — see its AGE_BY_FHE_ID
   *  note on why this is neither a rank nor a name join. */
  ageByFheId: Record<string, number>;
  draftYearByFheId: Record<string, number>;
}) {
  const { players, valuesBySize, leagueSizes, canonicalSize, seasons, activeSeason, ageByFheId, draftYearByFheId } = props;
  const router = useRouter();

  // Consensus ages are a snapshot at the latest season (2026 = 2025-26); shift
  // back one year per prior season so the displayed age is dynamic to the dataset.
  // Keyed by fhe_id, NOT consensus_rank — rank numbers get reassigned to a
  // different player on every dynasty refresh, so joining on rank would silently
  // attach a stale rank's *new* owner's age to this row (it did: Harden at 19).
  const seasonNum = parseInt(activeSeason, 10) || 2026;
  const ageOf = (s: SeasonPlayerStats): number | null => {
    const base = s.fhe_id ? ageByFheId[s.fhe_id] : undefined;
    if (base == null) return null;
    return base - (2026 - seasonNum);
  };

  // Rookie/sophomore status is SEASON-relative here (unlike /dynasty-rankings and
  // /team-rosters, which tag a player's status TODAY) — this table shows historical
  // per-season stat rows, so a 2025 draftee reads ROOKIE on the 2025-26 dataset and
  // SOPHOMORE on 2026-27, not "sophomore" on every season he's ever played. Draft
  // year is a fixed fact, so it works against any season in the picker (hoopR season
  // N = the draftYear+1/draftYear+2 year for a player's rookie/sophomore season).
  //
  // A Summer League dataset is the on-ramp to the FOLLOWING season, not a season
  // of its own — July 2026 Vegas (season=2026, our calendar-year key) kicks off
  // the 2026-27 season (hoopR season 2027), so it classifies like season 2027
  // would: 2026 draftees are rookies, 2025 draftees are sophomores. This shift
  // applies to every Summer League dataset, not just 2026 — the plain formula
  // would otherwise mislabel (or blank-badge) the debuting draft class in ANY
  // year's summer dataset the same way.
  const isSummerDataset = activeSeason.split(":")[1] === "summer";
  const classSeasonNum = isSummerDataset ? seasonNum + 1 : seasonNum;
  const classOf = (s: SeasonPlayerStats): "rookie" | "soph" | null => {
    const draftYear = s.fhe_id ? draftYearByFheId[s.fhe_id] : undefined;
    if (draftYear == null) return null;
    if (classSeasonNum === draftYear + 1) return "rookie";
    if (classSeasonNum === draftYear + 2) return "soph";
    return null;
  };

  // Season switch is a soft navigation (server refetch); a pending flag dims the
  // table while the new data streams in. The client component is NOT remounted,
  // so we must clear the flag once the new dataset arrives — keyed on the
  // activeSeason prop changing — else the table stays dimmed + non-interactive.
  const [seasonPending, setSeasonPending] = useState(false);
  // Only the canonical league size ships with the page; other sizes are fetched
  // on demand and cached here. poolPending dims the table during that fetch.
  const [loadedValues, setLoadedValues] = useState<ValuesBySize>(valuesBySize);
  const [poolPending, setPoolPending] = useState(false);
  const onSeasonChange = (key: string) => {
    if (key === activeSeason) return;
    setSeasonPending(true);
    router.push(`/seasonal-rankings?d=${encodeURIComponent(key)}`);
  };
  // On season change the server ships the new dataset's canonical size; reset the
  // on-demand cache so sizes loaded for the previous season aren't reused.
  useEffect(() => {
    setSeasonPending(false);
    setLoadedValues(valuesBySize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSeason]);

  const [leagueSize, setLeagueSize] = useState<number>(
    leagueSizes.includes(canonicalSize) ? canonicalSize : leagueSizes[leagueSizes.length - 1],
  );
  // Datasets can carry a different default pool (e.g. Summer League defaults to
  // 250, not the usual 400) — resync when switching INTO one, not just on first
  // load, so the Player Pool always starts at the new dataset's own default.
  useEffect(() => {
    setLeagueSize(leagueSizes.includes(canonicalSize) ? canonicalSize : leagueSizes[leagueSizes.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonicalSize]);

  // Fetch a league size's values on demand when the Player Pool changes to a
  // size not yet loaded. When it arrives, loadedValues updates → this effect
  // re-runs, the guard hits, and poolPending clears.
  useEffect(() => {
    if (loadedValues[leagueSize]) {
      setPoolPending(false);
      return;
    }
    let cancelled = false;
    setPoolPending(true);
    const [seasonStr, type] = activeSeason.split(":");
    fetch(`/api/seasonal-values?season=${seasonStr}&type=${encodeURIComponent(type)}&size=${leagueSize}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: SeasonPlayerValues[]) => {
        if (cancelled) return;
        const map: Record<string, SeasonPlayerValues> = {};
        for (const v of rows) map[v.player_id] = v;
        setLoadedValues((prev) => ({ ...prev, [leagueSize]: map }));
      })
      .catch(() => {
        if (!cancelled) setPoolPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leagueSize, activeSeason, loadedValues]);
  const [teamFilter, setTeamFilter] = useState<Set<string>>(new Set());
  const [posFilter, setPosFilter] = useState<Set<string>>(new Set());
  // Multi-select, same union pattern as posFilter: empty = no filter, and
  // "vet" (neither rookie nor sophomore this season) can combine with the
  // other two so a manager can e.g. hide rookies+sophomores at once, or
  // show rookies and sophomores together while excluding veterans.
  const [classFilter, setClassFilter] = useState<Set<"rookie" | "soph" | "vet">>(new Set());
  const toggleClass = (c: "rookie" | "soph" | "vet") => {
    const next = new Set(classFilter);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setClassFilter(next);
  };
  const [perGame, setPerGame] = useState(true);
  const [minGames, setMinGames] = useState(0); // 0 = any; else inclusive minimum (N+)
  const [minMins, setMinMins] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "value", dir: "desc" });
  // CatV mode: which of the three values the CatV column shows + ranks by.
  // 9CatV = standard value (avg of 9 z-scores); 8CatV = turnovers removed
  // (avg of the other 8); Minus1V = best 8 (drop each player's worst category).
  const [catMode, setCatMode] = useState<"9cat" | "8cat" | "minus1v">("9cat");
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [tickedOnly, setTickedOnly] = useState(false);
  // Mobile only: filters render as an overlay above the table (not pushed above
  // it in normal flow) so the player list always starts right under the nav —
  // see .sr-controls-inner / .sr-mobile-filter-toggle in the mobile media query.
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const activeFilterCount =
    (teamFilter.size > 0 ? 1 : 0) +
    (posFilter.size > 0 ? 1 : 0) +
    (classFilter.size > 0 ? 1 : 0) +
    (minGames > 0 ? 1 : 0) +
    (minMins > 0 ? 1 : 0) +
    (tickedOnly ? 1 : 0) +
    (search.trim() ? 1 : 0);

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

  // Measures the column-header row's own rendered height so the ticked-summary
  // row (see tickedSummary below) can stick directly beneath it — sr-th cells
  // are themselves sticky at top:0, so this second sticky row needs a dynamic
  // top offset rather than a hardcoded one (font/padding shrink on mobile).
  const headerRowRef = useRef<HTMLTableRowElement>(null);
  const [headerRowH, setHeaderRowH] = useState(38);
  useEffect(() => {
    const el = headerRowRef.current;
    if (!el) return;
    const compute = () => setHeaderRowH(el.getBoundingClientRect().height);
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
    const vmap = loadedValues[leagueSize] ?? {};
    return players.map((s) => ({ s, v: vmap[s.player_id] ?? null }));
  }, [players, loadedValues, leagueSize]);

  // Population mean/σ for the USG/FGA/FTA heatmap (see meanStd/zOf above).
  // Mode-matched to Per Game vs Totals so the coloring never disagrees with
  // the number the cell displays (totals scales FGA/FTA by games played).
  const rateStats = useMemo(() => {
    const totOf = (perGameVal: number | null, gp: number | null) =>
      perGameVal == null ? null : perGameVal * (gp ?? 0);
    const nums = (vals: (number | null)[]) => vals.filter((v): v is number => v != null);
    const fga = nums(players.map((s) => (perGame ? s.fga : totOf(s.fga, s.g))));
    const fta = nums(players.map((s) => (perGame ? s.fta : totOf(s.fta, s.g))));
    const usg = nums(players.map((s) => s.usg_pct));
    return { fga: meanStd(fga), fta: meanStd(fta), usg: meanStd(usg) };
  }, [players, perGame]);

  // The CatV value a row displays/sorts by. `value` is the AVERAGE of the 9
  // category z-scores (sum/9) and `minus1v` the average of the best 8, so 8CatV
  // must re-average over 8: drop the turnover z-score from the sum (value·9) and
  // divide by 8 → (value·9 − v_to)/8. (v_to is already sign-flipped so fewer TOs
  // read positive, hence subtraction removes the turnover category cleanly.)
  const catValue = (av: ActiveV | null): number | null => {
    const base = av?.value;
    if (base == null || !Number.isFinite(base)) return null;
    if (catMode === "minus1v") return av?.minus1v ?? null;
    if (catMode === "8cat") {
      const to = av?.to;
      return to == null || !Number.isFinite(to) ? base : (base * 9 - to) / 8;
    }
    return base;
  };

  // Pull the value a row sorts by for the active key. value/minus1v/fg_v/ft_v
  // follow the Per Game vs Totals toggle (different value sets); counting stats
  // follow it via totalling, so ordering matches what's on screen.
  const sortValue = (s: SeasonPlayerStats, av: ActiveV | null, key: SortKey): number | null => {
    switch (key) {
      case "value": return catValue(av);
      case "minus1v": return av?.minus1v ?? null;
      case "fg_v": return av?.fg ?? null;
      case "ft_v": return av?.ft ?? null;
      case "consensus": return s.consensus_rank ?? null;
      case "age": return ageOf(s);
      case "g": return s.g ?? null; // a count — never totalled
      case "usg": return s.usg_pct ?? null; // already a rate — never totalled
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
  }, [merged, sort, perGame, catMode]);

  const visible = useMemo<Row[]>(() => {
    const q = search.trim().toLowerCase();
    return rankedAll.filter(({ s }) => {
      if (tickedOnly && !checked.has(s.player_id)) return false;
      if (teamFilter.size > 0 && !(s.team && teamFilter.has(s.team))) return false;
      if (posFilter.size > 0 && !(s.position && [...posFilter].some((p) => s.position!.includes(p)))) return false;
      if (classFilter.size > 0) {
        const cls = classOf(s) ?? "vet";
        if (!classFilter.has(cls)) return false;
      }
      if (minGames > 0 && (s.g ?? 0) < minGames) return false;
      if (minMins > 0 && (s.mpg ?? 0) <= minMins) return false;
      if (q && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankedAll, tickedOnly, checked, teamFilter, posFilter, classFilter, minGames, minMins, search]);

  /**
   * Combined stat line for whatever's ticked AND currently visible (a ticked
   * player hidden by a filter drops out, same as "Ticked Only" elsewhere).
   * Counting stats sum their season TOTALS (mpg/pts/etc. × g) regardless of
   * the Per Game/Totals toggle — that raw total is the one true number;
   * per-game display just divides it by combined GP afterward, so a
   * plain average of two players' per-game lines never has to happen (that
   * would silently give a 10-game player the same weight as an 82-game one).
   * FG%/FT% are combined FGM/FTM over combined FGA/FTA (attempt-weighted,
   * not attempt-count-weighted-by-games), and USG% is weighted by total
   * minutes played — the same three ratios either mode displays, exactly
   * like a single player's own FG%/FT%/USG% cell never changes with the
   * Per Game/Totals toggle.
   *
   * Conditional-formatting scores (v*) reuse each ticked player's OWN
   * backend V-score (av.pts/av.fg3/etc. from pickV) rather than inventing a
   * parallel scoring system — combined via the exact same weight basis as
   * the raw stat next to it (GP for counting cats, FGA/FTA for FG%/FT%), so
   * the color a cell shows is directly traceable to the number it displays.
   * Minus1V/CatV/FG%V/FT%V still read "—": those are baseline-pool
   * aggregates a client-side reweighting can't reproduce.
   */
  const tickedSummary = useMemo(() => {
    const rows = visible.filter(({ s }) => checked.has(s.player_id));
    if (rows.length === 0) return null;
    let g = 0, min = 0, pts = 0, fg3m = 0, reb = 0, ast = 0, stl = 0, blk = 0, tov = 0;
    let fga = 0, fta = 0, fgm = 0, ftm = 0, usgWeighted = 0;
    let gpV = 0, fgaV = 0, ftaV = 0;
    let vPtsS = 0, vFg3S = 0, vRebS = 0, vAstS = 0, vStlS = 0, vBlkS = 0, vToS = 0, vFgS = 0, vFtS = 0;
    for (const { s, v } of rows) {
      const gp = s.g ?? 0;
      g += gp;
      min += (s.mpg ?? 0) * gp;
      pts += (s.pts ?? 0) * gp;
      fg3m += (s.fg3m ?? 0) * gp;
      reb += (s.reb ?? 0) * gp;
      ast += (s.ast ?? 0) * gp;
      stl += (s.stl ?? 0) * gp;
      blk += (s.blk ?? 0) * gp;
      tov += (s.tov ?? 0) * gp;
      const fgaTot = (s.fga ?? 0) * gp;
      const ftaTot = (s.fta ?? 0) * gp;
      fga += fgaTot;
      fta += ftaTot;
      fgm += fgaTot * (s.fg_pct ?? 0);
      ftm += ftaTot * (s.ft_pct ?? 0);
      if (s.usg_pct != null) usgWeighted += s.usg_pct * ((s.mpg ?? 0) * gp);

      const av = pickV(v, perGame);
      if (av) {
        gpV += gp;
        if (av.pts != null) vPtsS += av.pts * gp;
        if (av.fg3 != null) vFg3S += av.fg3 * gp;
        if (av.reb != null) vRebS += av.reb * gp;
        if (av.ast != null) vAstS += av.ast * gp;
        if (av.stl != null) vStlS += av.stl * gp;
        if (av.blk != null) vBlkS += av.blk * gp;
        if (av.to != null) vToS += av.to * gp;
        fgaV += fgaTot;
        ftaV += ftaTot;
        if (av.fg != null) vFgS += av.fg * fgaTot;
        if (av.ft != null) vFtS += av.ft * ftaTot;
      }
    }
    return {
      n: rows.length, g, min, pts, fg3m, reb, ast, stl, blk, tov, fga, fta,
      fgPct: fga > 0 ? fgm / fga : null,
      ftPct: fta > 0 ? ftm / fta : null,
      usgPct: min > 0 ? usgWeighted / min : null,
      vPts: gpV > 0 ? vPtsS / gpV : null,
      vFg3: gpV > 0 ? vFg3S / gpV : null,
      vReb: gpV > 0 ? vRebS / gpV : null,
      vAst: gpV > 0 ? vAstS / gpV : null,
      vStl: gpV > 0 ? vStlS / gpV : null,
      vBlk: gpV > 0 ? vBlkS / gpV : null,
      vTo: gpV > 0 ? vToS / gpV : null,
      vFg: fgaV > 0 ? vFgS / fgaV : null,
      vFt: ftaV > 0 ? vFtS / ftaV : null,
    };
  }, [visible, checked, perGame]);

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
  // Headshot fallback below (prospect art / cdn.nba.com) is scoped strictly to
  // THESE two datasets — /images/prospects/ holds art for multiple draft
  // classes (2025's Cooper Flagg sits next to 2026's Cameron Boozer), so
  // enabling it broadly for older Summer League datasets risks a name-slug
  // collision showing the wrong player's photo. Both datasets here are safe:
  // Summer League 2026 and the 2026-27 Projections are the only two places
  // the 2026 draft class appears with no real ESPN id yet (both resolve
  // rookies to the same synthetic `sl-<nbaComId>`, per build-projection-
  // values.ts's Summer League 2026 identity-fallback), so there's no other
  // class's art to collide with.
  const isUnmatchedRookieDataset = activeSeason === "2026:summer" || activeSeason === "2027:projection";

  return (
    <div className="sr-shell">
      <PlatformSidebarNav active="cat-values" />

      <div className="sr-controls" ref={controlsRef}>
        {/* Mobile only: compact toggle that opens the filters as an overlay
            above the table, instead of the full control stack pushing the
            table down the page (desktop is unaffected — hidden via CSS). */}
        <button
          type="button"
          className="sr-mobile-filter-toggle"
          onClick={() => setMobileFiltersOpen((v) => !v)}
          aria-expanded={mobileFiltersOpen}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="20" y2="6" /><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
            <line x1="4" y1="12" x2="20" y2="12" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
            <line x1="4" y1="18" x2="20" y2="18" /><circle cx="11" cy="18" r="2" fill="currentColor" stroke="none" />
          </svg>
          Filters
          {activeFilterCount > 0 && <span className="sr-mobile-filter-count">{activeFilterCount}</span>}
          <span className="sr-mobile-filter-caret">{mobileFiltersOpen ? "▲" : "▼"}</span>
        </button>
        {mobileFiltersOpen && <div className="sr-mobile-backdrop" onClick={() => setMobileFiltersOpen(false)} />}

        <div className={`sr-controls-inner ${mobileFiltersOpen ? "sr-controls-inner-open" : ""}`}>
          <div className="sr-mobile-panel-header">
            <span>Filters</span>
            <button type="button" className="sr-mobile-panel-done" onClick={() => setMobileFiltersOpen(false)}>
              Done
            </button>
          </div>
          {/* Season — reloads the page with a different dataset */}
          <div className="sr-group sr-g-season">
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
          <div className="sr-group sr-g-pool">
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

          {/* Cat Value mode — 9CatV (full) vs 8CatV (turnovers removed) */}
          <div className="sr-group sr-g-catmode">
            <label className="sr-label" htmlFor="sr-catmode">Cat Value</label>
            <select
              id="sr-catmode"
              className="sr-select"
              value={catMode}
              onChange={(e) => setCatMode(e.target.value as "9cat" | "8cat" | "minus1v")}
              title="9CatV = standard · 8CatV removes turnovers · Minus1V drops each player's worst category"
            >
              <option value="9cat">9CatV</option>
              <option value="8cat">8CatV (no TO)</option>
              <option value="minus1v">Minus1V</option>
            </select>
          </div>

          {/* Position multi-select */}
          <div className="sr-group sr-g-position sr-g-full">
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

          {/* Rookie/sophomore class — season-relative to the active dataset, see classOf().
              Multi-select like Position: Rookies + Sophomores together shows either,
              Veterans excludes both, and any combination unions/excludes accordingly. */}
          <div className="sr-group sr-g-class sr-g-full">
            <span className="sr-label">Class</span>
            <div className="sr-pill-row">
              <button
                type="button"
                className={`sr-pill ${classFilter.size === 0 ? "sr-pill-on" : ""}`}
                onClick={() => setClassFilter(new Set())}
              >
                ALL
              </button>
              <button
                type="button"
                className={`sr-pill ${classFilter.has("rookie") ? "sr-pill-on" : ""}`}
                onClick={() => toggleClass("rookie")}
              >
                Rookies
              </button>
              <button
                type="button"
                className={`sr-pill ${classFilter.has("soph") ? "sr-pill-on" : ""}`}
                onClick={() => toggleClass("soph")}
              >
                Sophomores
              </button>
              <button
                type="button"
                className={`sr-pill ${classFilter.has("vet") ? "sr-pill-on" : ""}`}
                onClick={() => toggleClass("vet")}
              >
                Veterans
              </button>
            </div>
          </div>

          {/* Per-game / Totals (display only) */}
          <div className="sr-group sr-g-mode sr-g-full">
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

          {/* Ticked-player filter — grouped with the other pill buttons */}
          <div className="sr-group sr-g-mylist sr-g-full">
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

          {/* Rank by (mirrors header-click sorting) */}
          <div className="sr-group sr-g-rankby">
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
              <option value="value">CatV</option>
              <option value="minus1v">Minus1V</option>
              <option value="consensus">Consensus Rank</option>
              {!["value", "minus1v", "consensus"].includes(sort.key) && (
                <option value="" disabled>Column…</option>
              )}
            </select>
          </div>

          {/* Team */}
          <div className="sr-group sr-g-team">
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
          <div className="sr-group sr-g-mingames">
            <label className="sr-label" htmlFor="sr-mingames">Min Games</label>
            <select
              id="sr-mingames"
              className="sr-select"
              value={minGames}
              onChange={(e) => setMinGames(Number(e.target.value))}
            >
              <option value={0}>Any</option>
              <option value={3}>Min 3+</option>
              <option value={5}>Min 5+</option>
              <option value={10}>Min 10+</option>
            </select>
          </div>

          {/* Min minutes (display filter) */}
          <div className="sr-group sr-g-minmins">
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
          <div className="sr-group sr-group-search sr-g-search sr-g-full">
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
            className={`sr-table-scroll ${seasonPending || poolPending ? "sr-pending" : ""}`}
            style={{ maxHeight: `calc(100vh - ${topOffset}px)` }}
          >
            <table className="sr-table">
              <thead>
                <tr ref={headerRowRef}>
                  <th className="sr-th sr-th-pick" aria-label="Tick" />
                  <th className="sr-th sr-num-h sr-th-rank">RANK</th>
                  <th className="sr-th sr-th-shot" aria-label="Headshot" />
                  <th className="sr-th sr-th-player sr-sticky-col">PLAYER</th>
                  <th className="sr-th sr-w-tag" aria-label="Rookie/Sophomore" />
                  <th className="sr-th sr-w">TEAM</th>
                  <th className="sr-th sr-w">POS</th>
                  <SortTh label="AGE" sortKey="age" sort={sort} onSort={onSort} />
                  <SortTh label="GP" sortKey="g" sort={sort} onSort={onSort} />
                  <SortTh label="MIN" sortKey="mpg" sort={sort} onSort={onSort} />
                  <SortTh label="USG" sortKey="usg" sort={sort} onSort={onSort} />
                  <SortTh label="CatV" sortKey="value" sort={sort} onSort={onSort} strong />
                  <SortTh label="MINUS1V" sortKey="minus1v" sort={sort} onSort={onSort} wide />
                  <SortTh label="PTS" sortKey="pts" sort={sort} onSort={onSort} />
                  <SortTh label="3PM" sortKey="fg3m" sort={sort} onSort={onSort} />
                  <SortTh label="REB" sortKey="reb" sort={sort} onSort={onSort} />
                  <SortTh label="AST" sortKey="ast" sort={sort} onSort={onSort} />
                  <SortTh label="STL" sortKey="stl" sort={sort} onSort={onSort} />
                  <SortTh label="BLK" sortKey="blk" sort={sort} onSort={onSort} />
                  <SortTh label="FGA" sortKey="fga" sort={sort} onSort={onSort} />
                  <SortTh label="FG%" sortKey="fg_pct" sort={sort} onSort={onSort} />
                  <SortTh label="FTA" sortKey="fta" sort={sort} onSort={onSort} />
                  <SortTh label="FT%" sortKey="ft_pct" sort={sort} onSort={onSort} />
                  <SortTh label="TO" sortKey="tov" sort={sort} onSort={onSort} />
                  <SortTh label="FG%V" sortKey="fg_v" sort={sort} onSort={onSort} />
                  <SortTh label="FT%V" sortKey="ft_v" sort={sort} onSort={onSort} />
                </tr>
              </thead>
              <tbody>
                {tickedSummary && (() => {
                  const ts = tickedSummary;
                  const per = (total: number) => (ts.g > 0 ? total / ts.g : null);
                  const cellStyle = { top: headerRowH };
                  // left is NOT set here — it comes from sr-td-pick/sr-td-rank/
                  // sr-td-shot/sr-sticky-col, whose left offset (and, for shot,
                  // display:none) already changes correctly per breakpoint (the
                  // headshot column disappears and PLAYER shifts left on mobile).
                  // An inline left here would override that responsive CSS with a
                  // fixed desktop value at every viewport width.
                  // USG/FGA/FTA have no backend V-score to reuse (see rateStats/
                  // zOf above), so the combined NUMBER itself is z-scored against
                  // the same population every individual row's USG/FGA/FTA cell
                  // uses — mode-matched, exactly like those per-row cells.
                  const zUsgTs = zOf(ts.usgPct, rateStats.usg);
                  const zFgaTs = zOf(perGame ? per(ts.fga) : ts.fga, rateStats.fga);
                  const zFtaTs = zOf(perGame ? per(ts.fta) : ts.fta, rateStats.fta);
                  // Layer the tint over a guaranteed-OPAQUE base in one declaration
                  // (rather than replacing the background outright, as the plain
                  // per-row cells do) — this row is position:sticky, and a
                  // semi-transparent inline background on a sticky cell lets
                  // whatever the browser composites underneath (stale scrolled
                  // content) bleed through. A flat layered gradient has no such
                  // gap: the opaque var(--bg-card) is always the bottom layer.
                  const bg = (v: number | null | undefined) => {
                    const tint = statBg(v);
                    return { ...cellStyle, background: `linear-gradient(${tint}, ${tint}), var(--bg-card, #1a1a1a)` };
                  };
                  return (
                    <tr className="sr-summary-tr">
                      <td className="sr-td sr-summary-cell sr-summary-frozen sr-td-pick" style={cellStyle} />
                      <td className="sr-td sr-num sr-summary-cell sr-summary-frozen sr-td-rank" style={cellStyle}>Σ</td>
                      <td className="sr-td sr-summary-cell sr-summary-frozen sr-td-shot" style={cellStyle} />
                      <td className="sr-td sr-td-player sr-summary-cell sr-summary-frozen sr-sticky-col" style={cellStyle}>
                        {ts.n} TICKED
                      </td>
                      <td className="sr-td sr-summary-cell" style={cellStyle} />
                      <td className="sr-td sr-summary-cell" style={cellStyle} />
                      <td className="sr-td sr-summary-cell" style={cellStyle} />
                      <td className="sr-td sr-num sr-summary-cell" style={cellStyle}>—</td>
                      <td className="sr-td sr-num sr-summary-cell" style={cellStyle}>{ts.g}</td>
                      <td className="sr-td sr-num sr-summary-cell" style={cellStyle}>{perGame ? f1(per(ts.min)) : fInt(ts.min)}</td>
                      <td className="sr-td sr-num sr-summary-cell" style={bg(zUsgTs)}>{f1(ts.usgPct)}</td>
                      <td className="sr-td sr-num sr-summary-cell" style={cellStyle}>—</td>
                      <td className="sr-td sr-num sr-num-wide sr-summary-cell" style={cellStyle}>—</td>
                      <td className="sr-td sr-num sr-summary-cell" style={bg(ts.vPts)}>{perGame ? f1(per(ts.pts)) : fInt(ts.pts)}</td>
                      <td className="sr-td sr-num sr-summary-cell" style={bg(ts.vFg3)}>{perGame ? f1(per(ts.fg3m)) : fInt(ts.fg3m)}</td>
                      <td className="sr-td sr-num sr-summary-cell" style={bg(ts.vReb)}>{perGame ? f1(per(ts.reb)) : fInt(ts.reb)}</td>
                      <td className="sr-td sr-num sr-summary-cell" style={bg(ts.vAst)}>{perGame ? f1(per(ts.ast)) : fInt(ts.ast)}</td>
                      <td className="sr-td sr-num sr-summary-cell" style={bg(ts.vStl)}>{perGame ? f1(per(ts.stl)) : fInt(ts.stl)}</td>
                      <td className="sr-td sr-num sr-summary-cell" style={bg(ts.vBlk)}>{perGame ? f1(per(ts.blk)) : fInt(ts.blk)}</td>
                      <td className="sr-td sr-num sr-summary-cell" style={bg(zFgaTs)}>{perGame ? f1(per(ts.fga)) : fInt(ts.fga)}</td>
                      <td className="sr-td sr-num sr-summary-cell" style={bg(ts.vFg)}>{fPct(ts.fgPct)}</td>
                      <td className="sr-td sr-num sr-summary-cell" style={bg(zFtaTs)}>{perGame ? f1(per(ts.fta)) : fInt(ts.fta)}</td>
                      <td className="sr-td sr-num sr-summary-cell" style={bg(ts.vFt)}>{fPct(ts.ftPct)}</td>
                      <td className="sr-td sr-num sr-summary-cell" style={bg(ts.vTo)}>{perGame ? f1(per(ts.tov)) : fInt(ts.tov)}</td>
                      <td className="sr-td sr-num sr-summary-cell" style={cellStyle}>—</td>
                      <td className="sr-td sr-num sr-summary-cell" style={cellStyle}>—</td>
                    </tr>
                  );
                })()}
                {visible.map(({ s, v, rank }) => {
                  const g = s.g ?? 0;
                  const tot = (perGameVal: number | null | undefined) =>
                    perGameVal == null ? null : perGameVal * g;
                  const cGP = s.g == null ? "—" : String(s.g);
                  const cMin = perGame ? f1(s.mpg) : fInt(tot(s.mpg));
                  const cUsg = f1(s.usg_pct); // a rate — same value in both Per Game / Totals modes
                  const cP = perGame ? f1(s.pts) : fInt(tot(s.pts));
                  const c3 = perGame ? f1(s.fg3m) : fInt(tot(s.fg3m));
                  const cR = perGame ? f1(s.reb) : fInt(tot(s.reb));
                  const cA = perGame ? f1(s.ast) : fInt(tot(s.ast));
                  const cS = perGame ? f1(s.stl) : fInt(tot(s.stl));
                  const cB = perGame ? f1(s.blk) : fInt(tot(s.blk));
                  const cFga = perGame ? f1(s.fga) : fInt(tot(s.fga));
                  const cFta = perGame ? f1(s.fta) : fInt(tot(s.fta));
                  const cTo = perGame ? f1(s.tov) : fInt(tot(s.tov));
                  // Heatmap z-scores for USG/FGA/FTA (see rateStats/zOf above) —
                  // mode-matched to the same raw number the cell displays.
                  const zUsg = zOf(s.usg_pct, rateStats.usg);
                  const zFga = zOf(perGame ? s.fga : tot(s.fga), rateStats.fga);
                  const zFta = zOf(perGame ? s.fta : tot(s.fta), rateStats.fta);

                  // Mode-resolved value set drives the summary/value cells + heatmap.
                  const av = pickV(v, perGame);
                  // Minus1V mode: thin blue outline on the one category dropped
                  // (each player's worst), so you can see what they're punting.
                  const dropped = catMode === "minus1v" ? droppedCat(av) : null;
                  const drop = (cell: string) => (dropped === cell ? " sr-outline" : "");
                  // 8CatV ignores turnovers → dim the TO column data.
                  const toDim = catMode === "8cat" ? " sr-dim" : "";
                  // Bold the actively-sorted column's cells (and only that column).
                  const bold = (key: SortKey) => (sort.key === key ? " sr-sorted" : "");
                  const cls = classOf(s);

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
                      <td className="sr-td sr-num sr-td-rank">{rank}</td>
                      <td className="sr-td sr-td-shot">
                        <Headshot
                          id={s.headshot_id}
                          name={s.name}
                          extraSources={isUnmatchedRookieDataset ? [...prospectHeadshotCandidates(s.name), nbaHeadshotUrl(s.name)] : undefined}
                        />
                      </td>
                      <td className="sr-td sr-td-player sr-sticky-col" title={s.name}>
                        {shortenPlayerName(s.name)}
                      </td>
                      <td className="sr-td sr-td-tag">
                        {cls === "rookie" ? (
                          <span className="dr-rookie-badge" title="Rookie this season">R</span>
                        ) : cls === "soph" ? (
                          <span className="dr-soph-badge" title="Sophomore this season">S</span>
                        ) : null}
                      </td>
                      <td className="sr-td sr-td-team sr-w">
                        <TeamLogo team={s.team} />
                      </td>
                      <td className="sr-td sr-w">{s.position ?? "—"}</td>
                      <td className={`sr-td sr-num${bold("age")}`}>{fAge(ageOf(s))}</td>
                      <td className={`sr-td sr-num${bold("g")}`}>{cGP}</td>
                      <td className={`sr-td sr-num${bold("mpg")}`}>{cMin}</td>
                      <td className={`sr-td sr-num${bold("usg")}`} style={{ background: statBg(zUsg) }}>{cUsg}</td>
                      <td className={`sr-td sr-num${bold("value")}`} style={{ background: valueBg(catValue(av)) }}>
                        {fVal(catValue(av))}
                      </td>
                      <td className={`sr-td sr-num sr-num-wide${bold("minus1v")}`} style={{ background: valueBg(av?.minus1v) }}>
                        {fVal(av?.minus1v)}
                      </td>
                      <td className={`sr-td sr-num${drop("pts")}${bold("pts")}`} style={{ background: statBg(av?.pts) }}>{cP}</td>
                      <td className={`sr-td sr-num${drop("fg3m")}${bold("fg3m")}`} style={{ background: statBg(av?.fg3) }}>{c3}</td>
                      <td className={`sr-td sr-num${drop("reb")}${bold("reb")}`} style={{ background: statBg(av?.reb) }}>{cR}</td>
                      <td className={`sr-td sr-num${drop("ast")}${bold("ast")}`} style={{ background: statBg(av?.ast) }}>{cA}</td>
                      <td className={`sr-td sr-num${drop("stl")}${bold("stl")}`} style={{ background: statBg(av?.stl) }}>{cS}</td>
                      <td className={`sr-td sr-num${drop("blk")}${bold("blk")}`} style={{ background: statBg(av?.blk) }}>{cB}</td>
                      <td className={`sr-td sr-num${bold("fga")}`} style={{ background: statBg(zFga) }}>{cFga}</td>
                      <td className={`sr-td sr-num${drop("fg_pct")}${bold("fg_pct")}`} style={{ background: statBg(av?.fg) }}>{fPct(s.fg_pct)}</td>
                      <td className={`sr-td sr-num${bold("fta")}`} style={{ background: statBg(zFta) }}>{cFta}</td>
                      <td className={`sr-td sr-num${drop("ft_pct")}${bold("ft_pct")}`} style={{ background: statBg(av?.ft) }}>{fPct(s.ft_pct)}</td>
                      <td className={`sr-td sr-num${drop("tov")}${toDim}${bold("tov")}`} style={{ background: statBg(av?.to) }}>{cTo}</td>
                      <td className={`sr-td sr-num${bold("fg_v")}`} style={{ background: statBg(av?.fg) }}>{fVal(av?.fg)}</td>
                      <td className={`sr-td sr-num${bold("ft_v")}`} style={{ background: statBg(av?.ft) }}>{fVal(av?.ft)}</td>
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

      <section
        aria-label="About player category values"
        style={{ padding: "40px 32px 56px", maxWidth: 860, margin: "0 auto", color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7 }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--text-secondary)" }}>
          About Player Category Values (CatV)
        </h2>
        {isSummerDataset && (
          <p style={{ marginBottom: 12, color: "var(--text-primary)" }}>
            This dataset is Summer League (Vegas) production only, scored against its own standalone
            baseline pool — small samples against non-NBA-caliber competition, so these values are
            NOT comparable to regular-season or playoff CatV.
          </p>
        )}
        <p>
          Fantasy Hoops Edge Player Category Values (CatV) measure how much a player contributes
          above a league-baseline replacement in each of the nine standard roto categories: points,
          rebounds, assists, steals, blocks, field-goal percentage, free-throw percentage,
          three-pointers made, and turnovers. A positive CatV means the player lifts your team above
          the baseline in that category; a negative value means he costs you ground.
        </p>
        <p style={{ marginTop: 12 }}>
          Baselines are calibrated per league size — a 12-team league has a shallower player pool
          than a 20-team league, so the replacement level is higher. CatV automatically adjusts so
          that a player ranked #120 overall reads as a fringe starter in a 12-team league and a
          valuable contributor in a 20-team league. Minus1V shows the marginal cost of dropping that
          player from your roster — useful for evaluating trade and waiver-wire decisions.
        </p>
        <p style={{ marginTop: 12 }}>
          Values are derived from real NBA box-score data and recomputed each season. The tool
          supports both current-season and prior-season datasets so managers can compare year-over-year
          trends and project which players are trending up or down across categories.
        </p>
      </section>
      <Footer />

      <style>{`
        /* Desktop: left rail sidebar (position:fixed, 236px) offsets via
           padding-left. Mobile falls back to the old fixed top <nav>
           (52px) — see PlatformSidebarNav and the media query below. */
        .sr-shell { min-height: 100vh; display: flex; flex-direction: column; padding-left: 236px; }
        .sr-controls {
          position: sticky; top: 0; z-index: 50;
          background: var(--bg-surface); border-bottom: 1px solid var(--border-main);
        }
        .sr-controls-inner {
          display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end;
          padding: 12px 20px; max-width: 1400px; margin: 0 auto;
        }
        /* Mobile-only overlay pieces — invisible on desktop, unhidden inside
           the max-width:767px block below. */
        .sr-mobile-filter-toggle, .sr-mobile-backdrop, .sr-mobile-panel-header { display: none; }
        .sr-group { display: flex; flex-direction: column; gap: 6px; }
        .sr-group-search { flex: 1 1 160px; min-width: 140px; }
        .sr-label {
          font-family: var(--rt-font-sans); font-size: 10px; font-weight: 600;
          letter-spacing: 1.5px; text-transform: uppercase; color: var(--text-muted);
        }
        .sr-pill-row { display: flex; gap: 6px; flex-wrap: wrap; }
        /* All filter buttons: same font/size, uppercase, and the same 34px height
           as the dropdowns for a consistent control row. */
        .sr-pill {
          font-family: var(--rt-font-sans); font-size: 13px; font-weight: 500;
          letter-spacing: 0.5px; text-transform: uppercase;
          height: 34px; padding: 0 12px; border-radius: 7px; cursor: pointer;
          display: inline-flex; align-items: center;
          background: var(--bg-card, #1a1a1a); color: var(--text-secondary);
          border: 1px solid var(--border-main); transition: all 0.15s; white-space: nowrap;
        }
        .sr-pill:disabled { opacity: 0.4; cursor: not-allowed; }
        .sr-pill:hover { color: var(--text-primary); border-color: var(--rt-primary); }
        .sr-pill-on {
          background: var(--rt-primary); color: #fff; border-color: var(--rt-primary);
        }
        /* Form controls only — NOT the table's numeric cells (which reuse the
           .sr-num class); keep these selectors off .sr-num to avoid painting a
           --bg-card background onto RANK/AGE/GP/MIN. */
        .sr-select, .sr-search {
          font-family: var(--rt-font-sans); font-size: 13px;
          padding: 7px 10px; border-radius: 7px;
          background: var(--bg-card, #1a1a1a); color: var(--text-primary);
          border: 1px solid var(--border-main); height: 34px;
        }
        .sr-select:focus, .sr-search:focus {
          outline: none; border-color: var(--rt-primary);
        }
        .sr-search { width: 100%; }

        .sr-main { flex: 1; }
        .sr-empty {
          text-align: center; color: var(--text-secondary); padding: 60px 20px;
          font-family: var(--rt-font-sans);
        }
        .sr-empty code {
          font-family: var(--rt-font-mono); font-size: 12px;
          background: var(--bg-card, #1a1a1a); padding: 2px 6px; border-radius: 4px;
        }
        /* Inner scroll box → both the thead (top:0) and the player column (left:0)
           freeze like Excel panes against this container's scrollport. */
        .sr-table-scroll { overflow: auto; width: 100%; }
        .sr-pending { opacity: 0.45; transition: opacity 0.15s; pointer-events: none; }
        .sr-table {
          /* size to the fixed columns and centre, so wide viewports get white
             space on both sides instead of the table spanning the whole page */
          border-collapse: separate; border-spacing: 0; margin: 0 auto;
        }
        .sr-th {
          position: sticky; top: 0; z-index: 10;
          background: var(--bg-body);
          font-family: var(--rt-font-sans); font-size: 15px; font-weight: 400;
          letter-spacing: 0; color: var(--text-secondary); text-transform: uppercase;
          padding: 7px 4px; text-align: center; white-space: nowrap;
          border-bottom: 1px solid var(--border-main);
        }
        /* Number/value columns AND team/pos share one fixed width (header + cells). */
        .sr-num-h, .sr-num, .sr-w { width: 56px; min-width: 56px; max-width: 56px; }
        /* MINUS1V renders a touch wider than the other headers in Geist Sans (was
           fine at 56px in the old VT323 font) — widen just this column, header
           and data cell together, rather than the shared width above. */
        .sr-num-h-wide, .sr-num-wide { width: 74px; min-width: 74px; max-width: 74px; }
        .sr-th-sortable { cursor: pointer; user-select: none; }
        .sr-th-sortable:hover { color: var(--text-primary); }
        .sr-th-strong { color: var(--text-primary); }
        .sr-th-active { color: var(--rt-primary); font-weight: 700; }
        .sr-sort-arrow { margin-left: 2px; font-size: 10px; }
        /* leading tick-box column — fixed + aligned far left, before RANK.
           This, RANK, and the headshot all stay pinned as the table scrolls
           right through the stat columns, same as the PLAYER column. */
        .sr-th-pick, .sr-td-pick { width: 30px; min-width: 30px; max-width: 30px; padding: 0 0 0 10px; }
        .sr-td-pick input { width: 13px; height: 13px; accent-color: var(--rt-primary); cursor: pointer; display: block; margin: 0 auto; }
        .sr-th-shot { width: 40px; }
        /* Shortened names ("F. SURNAME") fit in a much tighter column than full
           names did. A rare long single-word surname (Antetokounmpo,
           Mamukelashvili, Niederhauser…) that shortenPlayerName can't compress
           any further wraps to a second line instead of getting cut off —
           title attribute still carries the full name for a hover tooltip. */
        .sr-th-player, .sr-td-player { width: 148px; min-width: 148px; max-width: 148px; }
        /* Compound selector (not just .sr-td-player) so this reliably beats
           the later .sr-td { white-space: nowrap } rule regardless of source
           order/specificity ties. */
        .sr-td.sr-td-player { white-space: normal; word-break: break-word; line-height: 1.15; }
        /* Rookie/sophomore badge gets its own narrow column (not squeezed inline
           after the name) so it can never collide with or truncate the player name. */
        .sr-w-tag, .sr-td-tag { width: 28px; min-width: 28px; max-width: 28px; padding: 5px 2px; }
        .sr-td-tag .dr-rookie-badge, .sr-td-tag .dr-soph-badge { margin-left: 0; }

        .sr-th-pick, .sr-th-rank, .sr-th-shot { position: sticky; z-index: 20; background: var(--bg-body); }
        .sr-td-pick, .sr-td-rank, .sr-td-shot { position: sticky; z-index: 5; background: var(--bg-body); }
        .sr-th-pick, .sr-td-pick { left: 0; }
        .sr-th-rank, .sr-td-rank { left: 30px; }
        .sr-th-shot, .sr-td-shot { left: 86px; } /* 30 (pick) + 56 (rank) */
        .sr-tr:hover .sr-td-pick, .sr-tr:hover .sr-td-rank, .sr-tr:hover .sr-td-shot { background: var(--bg-card-hover, #1c1c1c); }
        /* the frozen corner cell (PLAYER header) needs to win on both axes */
        .sr-th.sr-sticky-col { left: 126px; z-index: 20; background: var(--bg-body); } /* 30 + 56 + 40 (shot) */

        .sr-tr:hover .sr-td { background: var(--bg-card-hover, rgba(255,255,255,0.03)); }
        .sr-td {
          padding: 5px 5px; font-size: 15px; color: var(--text-primary);
          border-bottom: 1px solid var(--border-main); white-space: nowrap;
          font-family: var(--rt-font-mono); text-align: center; line-height: 1.05;
        }
        /* Number/value columns: same font, smaller than the name/text columns. */
        .sr-num {
          text-align: center; font-size: 15px; padding: 5px 4px;
          font-variant-numeric: tabular-nums;
        }
        /* Bold only the actively-sorted column's cells. */
        .sr-sorted { font-weight: 700; color: var(--text-primary); }
        /* 8CatV: the ignored turnover column is dimmed to near invisible. */
        .sr-dim { opacity: 0.16; transition: opacity 0.15s; }
        /* Minus1V: a very thin blue outline marks each player's dropped category. */
        .sr-outline { box-shadow: inset 0 0 0 1px var(--blueprint); border-radius: 4px; }
        .sr-td-player { font-weight: 400; text-transform: uppercase; font-family: var(--rt-font-sans); }
        .sr-td-team-text { color: var(--text-secondary); }
        .sr-team-logo { width: 28px; height: 28px; object-fit: contain; display: block; margin: 0 auto; }

        /* sticky player column — same base background as the data cells (which
           show the page body), so no column has a different shade in either theme */
        .sr-sticky-col { position: sticky; left: 126px; z-index: 5; background: var(--bg-body); }
        .sr-tr:hover .sr-sticky-col { background: var(--bg-card-hover, #1c1c1c); }

        /* Ticked-players combined stat line (tickedSummary) — a second sticky
           row living inside <thead>, right below the column-header row (its
           top offset is measured dynamically via headerRowH, since header
           height varies by breakpoint). Non-frozen cells only stick vertically;
           the leading pick/rank/shot/player cells reuse the header's own
           left-offsets (0/30/86/126) via sr-td-pick/sr-td-rank/sr-td-shot/
           sr-sticky-col, but need a higher z-index (16) than normal body rows'
           frozen columns (5) so they stay on top while the table scrolls,
           while still losing to the actual header row (20) if they ever overlap.
           Declared after sr-sticky-col/sr-td-pick etc. so it wins their z-index/
           background on the ties (equal specificity, later source wins). */
        .sr-summary-cell {
          position: sticky; z-index: 9;
          background: var(--bg-card, #1a1a1a); color: var(--text-primary);
          font-weight: 700; border-top: 1px solid var(--border-main);
          border-bottom: 2px solid var(--rt-primary);
        }
        .sr-summary-frozen { z-index: 16; }

        .sr-headshot-img {
          width: 34px; height: 34px; border-radius: 50%; object-fit: cover;
          object-position: center top; background: var(--bg-card, #1a1a1a);
          display: block;
        }
        .sr-headshot-fallback {
          width: 34px; height: 34px; border-radius: 50%;
          display: inline-flex; align-items: center; justify-content: center;
          background: var(--bg-card, #1a1a1a); color: var(--text-secondary);
          font-family: var(--rt-font-sans); font-size: 12px; font-weight: 600;
        }
        .sr-count {
          text-align: center; font-size: 11px; color: var(--text-muted);
          padding: 10px 0 24px; font-family: var(--rt-font-sans);
        }

        /* iPad portrait (768-1023px): PlatformSidebarNav drops its sidebar at
           this same <=1023px breakpoint (see .platform-sidebar-desktop in
           globals.css), so this shell needs the same top-nav clearance the
           phone block below already has — without the phone block's OTHER
           rules (the collapsible filter-toggle overlay), since
           .sr-controls-inner is already flex-wrap:wrap on desktop and
           should reflow fine at this width on its own. min-width-bounded so
           it can't cascade-conflict with the phone block below. 64px (not
           phone's 52px): SiteNav is only actually 52px tall right at 768px
           itself (its own max-width:768px breakpoint) — this over-reserves
           slightly at that one exact width rather than under-reserving
           across the rest of the range. */
        @media (min-width: 768px) and (max-width: 1023px) {
          .sr-shell { padding-left: 0; padding-top: 64px; }
          .sr-controls { top: 64px; }
        }

        @media (max-width: 767px) {
          .sr-shell { padding-left: 0; padding-top: 52px; }
          .sr-controls { top: 52px; }

          /* Filters no longer sit in normal flow pushing the table down — the
             compact toggle bar is all that occupies real height; the full
             control stack becomes a fixed overlay above the table, opened on
             demand. This is what keeps the player list at the top of the
             screen on mobile (see .sr-controls-inner below). */
          .sr-mobile-filter-toggle {
            display: flex; align-items: center; gap: 8px;
            width: 100%; height: 40px; padding: 0 14px; margin: 0;
            background: var(--bg-card, #1a1a1a); border: none; cursor: pointer;
            color: var(--text-primary); font-family: var(--rt-font-sans);
            font-size: 12px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase;
          }
          .sr-mobile-filter-count {
            display: inline-flex; align-items: center; justify-content: center;
            min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px;
            background: var(--rt-primary); color: #fff; font-size: 10px; font-weight: 700;
          }
          .sr-mobile-filter-caret { margin-left: auto; font-size: 9px; color: var(--text-muted); }

          .sr-mobile-backdrop {
            display: block; position: fixed; inset: 92px 0 0 0; z-index: 80;
            background: rgba(0,0,0,0.6);
          }

          /* Two-column grid, not the base rule's flex-wrap row: flex-direction:
             column + inherited flex-wrap:wrap used to overflow into a second
             *column* off-screen right once content exceeded the fixed-height
             overlay, forcing a horizontal scroll to reach some filters. Grid
             sizes columns to the container instead, so everything stays
             reachable with only vertical scroll. Pairs are ordered via
             .sr-g-* (see below), independent of desktop's DOM-order flex-wrap. */
          .sr-controls-inner {
            display: none; /* hidden until opened — see .sr-controls-inner-open */
            position: fixed; top: 92px; left: 0; right: 0; bottom: 0; z-index: 90;
            grid-template-columns: 1fr 1fr; align-items: end; gap: 10px;
            background: var(--bg-surface); overflow-y: auto; overflow-x: hidden;
            padding: 4px 14px 28px; max-width: none; margin: 0;
            box-shadow: 0 12px 24px rgba(0,0,0,0.35);
          }
          .sr-controls-inner.sr-controls-inner-open { display: grid; }
          /* Grid items default to min-width:max-content, which can overflow a
             tight column; the select must shrink to fill its cell. */
          .sr-controls-inner .sr-group { min-width: 0; }
          .sr-controls-inner .sr-select { width: 100%; }
          .sr-controls-inner .sr-g-full,
          .sr-controls-inner .sr-mobile-panel-header { grid-column: 1 / -1; }
          .sr-controls-inner .sr-g-season { order: 1; }
          .sr-controls-inner .sr-g-pool { order: 2; }
          .sr-controls-inner .sr-g-catmode { order: 3; }
          .sr-controls-inner .sr-g-rankby { order: 4; }
          .sr-controls-inner .sr-g-position { order: 5; }
          .sr-controls-inner .sr-g-class { order: 6; }
          .sr-controls-inner .sr-g-mode { order: 7; }
          .sr-controls-inner .sr-g-mylist { order: 8; }
          .sr-controls-inner .sr-g-team { order: 9; }
          .sr-controls-inner .sr-g-mingames { order: 10; }
          .sr-controls-inner .sr-g-minmins { order: 11; }
          .sr-controls-inner .sr-g-search { order: 12; }
          .sr-mobile-panel-header {
            display: flex; align-items: center; justify-content: space-between;
            position: sticky; top: 0; z-index: 1;
            margin: 0 -14px; padding: 12px 14px; background: var(--bg-surface);
            border-bottom: 1px solid var(--border-main);
            font-family: var(--rt-font-sans); font-size: 12px; font-weight: 700;
            letter-spacing: 1px; text-transform: uppercase; color: var(--text-secondary);
          }
          .sr-mobile-panel-done {
            height: 30px; padding: 0 14px; border-radius: 7px; cursor: pointer;
            background: var(--rt-primary); color: #fff; border: none;
            font-family: var(--rt-font-sans); font-size: 12px; font-weight: 700; text-transform: uppercase;
          }

          .sr-th-shot, .sr-td-shot { display: none; }
          /* headshot column is gone, so the frozen PLAYER column shifts left
             to sit right after RANK — 30 (pick) + 42 (rank, shrunk below). */
          .sr-th.sr-sticky-col, .sr-sticky-col { left: 72px; }
          /* Smaller + narrower than desktop, so a phone in landscape shows
             several more of the 9-cat columns before horizontal scroll kicks in. */
          .sr-th, .sr-td, .sr-num { font-size: 11px; }
          .sr-th { padding: 6px 3px; }
          .sr-td { padding: 4px 3px; }
          .sr-num-h, .sr-num, .sr-w { width: 40px; min-width: 40px; max-width: 40px; }
          .sr-num-h-wide, .sr-num-wide { width: 52px; min-width: 52px; max-width: 52px; }
          .sr-th-player, .sr-td-player { width: 104px; min-width: 104px; max-width: 104px; }
          .sr-th-rank, .sr-td-rank { left: 30px; }
          .sr-team-logo { width: 20px; height: 20px; }
          .sr-headshot-img, .sr-headshot-fallback { width: 26px; height: 26px; }
          .sr-headshot-fallback { font-size: 10px; }
          .sr-count { font-size: 10px; padding: 8px 0 18px; }
        }

        /* Phone in landscape: most modern phones are wider than the 767px
           sitewide mobile breakpoint once rotated (e.g. ~844px), so they'd
           otherwise fall back to the full desktop sidebar/table sizing here.
           Keyed on height + orientation instead of width so it reliably
           catches landscape phones regardless of exact width — tightens the
           table further so more of the 9-cat columns fit before horizontal
           scroll is needed. Table-only: doesn't touch the sidebar/filter-panel
           layout, which still follows the sitewide width breakpoint. */
        @media (max-height: 480px) and (orientation: landscape) {
          .sr-th, .sr-td, .sr-num { font-size: 10px; }
          .sr-th { padding: 5px 2px; }
          .sr-td { padding: 3px 2px; }
          .sr-num-h, .sr-num, .sr-w { width: 36px; min-width: 36px; max-width: 36px; }
          .sr-num-h-wide, .sr-num-wide { width: 46px; min-width: 46px; max-width: 46px; }
          .sr-th-player, .sr-td-player { width: 92px; min-width: 92px; max-width: 92px; }
          .sr-team-logo { width: 18px; height: 18px; }
          .sr-headshot-img, .sr-headshot-fallback { width: 22px; height: 22px; }
          .sr-headshot-fallback { font-size: 9px; }
        }
      `}</style>
    </div>
  );
}
