"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CATS,
  DYNASTY_TIER_META,
  PRO_UNLOCKED,
  TEAM_LOGO,
  TEAMS,
  type FvMetric,
  type Player,
  type SeasonMode,
  type SortKey,
} from "./roster-data";
import {
  buildRankedProfile,
  buildRecentProfile,
  caret,
  catOrderFor,
  catValCur,
  catZ,
  changeColor,
  contractFor,
  fvOf,
  fvValue,
  heroName,
  initials,
  money,
  mpgBarFor,
  ordinal,
  posLabel,
  seasonTriosFor,
  shortName,
  singularTier,
  tagBadge,
} from "./roster-helpers";
import { PlayerHeadshot } from "./roster-headshot";
import { TrendHero, usePlayerTrend, type TrendMetric } from "./player-trend-chart";
import { TAG_META, type TrendTag } from "./trend-insight";
import { CompareModal } from "./compare-modal";

// hoopR stat season for the trend chart (2026 = the 2025-26 season) — matches
// roster-live-data.ts's STATS_SEASON; this page has no season switcher yet.
const TRENDS_SEASON = 2026;
const TRENDS_SEASON_TYPE = "regular";
const TREND_METRIC: Record<FvMetric, TrendMetric> = { minus1: "minus1V", ninecat: "nineCatV", eightcat: "eightCatV" };

// Highlight the top-5 dynasty-consensus players on the roster with the accent plate.
const ACCENT_RANK = 5;
// Projected 2026-27 luxury tax line, for the payroll summary card.
const TAX_LINE = 200_400_000;

// Compare modal: up to 4 players, persisted across page navigation.
const MAX_COMPARE = 4;
const COMPARE_STORAGE_KEY = "fhe-compare-players";

const FV_HEADER: Record<FvMetric, string> = { minus1: "Minus1V", ninecat: "9CatV", eightcat: "8CatV" };
const SEASON_LABEL: Record<SeasonMode, string> = { cur: "2025–26", prior: "2024–25", proj: "2026–27 proj.", recent: "Last 8 weeks" };

// The single Edge Pro CTA shown wherever locked projection data would otherwise
// display — one shared paywall pitch, themed for the dark hero card or the
// regular light canvas card.
function EdgeProPromo({ tone, onMaybeLater }: { tone: "hero" | "card"; onMaybeLater: () => void }) {
  const ink = tone === "hero" ? "var(--rt-hero-ink)" : "var(--rt-ink)";
  const inkSoft = tone === "hero" ? "var(--rt-hero-ink-soft)" : "var(--rt-body)";
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--rt-primary)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 600, color: ink }}>Edge Pro</span>
      </div>
      <div style={{ fontSize: 12, color: inkSoft, marginTop: 7, lineHeight: 1.5 }}>
        Unlock 2026–27 projections, season comparisons, and trade scenarios across your league.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 13 }}>
        <button
          type="button"
          className="rt-hover-primary"
          style={{ height: 36, padding: "0 16px", border: "none", cursor: "pointer", borderRadius: 999, background: "var(--rt-primary)", color: "var(--rt-on-primary)", fontFamily: "var(--rt-font-sans)", fontSize: 12, fontWeight: 600 }}
        >
          Start Pro · $9/mo
        </button>
        <button
          type="button"
          onClick={onMaybeLater}
          style={{ height: 36, padding: "0 14px", border: "none", cursor: "pointer", borderRadius: 999, background: "transparent", color: inkSoft, fontFamily: "var(--rt-font-sans)", fontSize: 12, fontWeight: 600 }}
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

export function RosterApp({
  theme,
  players,
  team,
  ageRank,
}: {
  theme: "light" | "dark";
  players: Player[];
  team: string;
  ageRank: { rank: number; total: number } | null;
}) {
  const dark = theme === "dark";
  const router = useRouter();

  const [selectedId, setSelectedId] = useState(players[0]?.id ?? "");
  // Position and class are two INDEPENDENT multi-select filter groups, ANDed
  // together — Guards + Rookies shows rookie guards, not all guards plus all
  // rookies. Each group is itself an OR (Guards + Forwards shows either).
  // Empty set = no filter within that group ("all").
  const [posFilters, setPosFilters] = useState<Set<string>>(new Set());
  const [classFilters, setClassFilters] = useState<Set<string>>(new Set());
  function togglePosFilter(id: string) {
    setPosFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleClassFilter(id: string) {
    setClassFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearAllFilters() {
    setPosFilters(new Set());
    setClassFilters(new Set());
  }
  const [mode, setMode] = useState<SeasonMode | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("dynasty");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [colSort, setColSort] = useState<string | null>(null);
  const [colDir, setColDir] = useState<"asc" | "desc">("desc");
  const [fvMetric, setFvMetric] = useState<FvMetric>("minus1");
  const [teamMenuOpen, setTeamMenuOpen] = useState(false);
  const selectedTeamBtnRef = useRef<HTMLButtonElement | null>(null);
  // Scroll the current team into view (centered) when the switcher opens,
  // instead of always resetting to Atlanta at the top of the alphabetical list.
  useEffect(() => {
    if (teamMenuOpen) {
      selectedTeamBtnRef.current?.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }, [teamMenuOpen]);
  // Detail panel now stays mounted (see the aside render below) so the
  // ROSTER LIST's own scroll position survives opening/closing it — but that
  // means the detail panel's scroll would otherwise persist too, showing the
  // previous player's scroll depth when a new one is opened. Reset it to the
  // top on every player switch, same as its old mount-fresh behavior.
  const detailPanelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    detailPanelRef.current?.scrollTo({ top: 0 });
  }, [selectedId]);
  // Mobile has no room for the list+detail split — the detail panel becomes
  // a full-screen view you navigate into (see the aside render below) rather
  // than a persistent 392px rail, so track whether it's currently showing.
  const [isMobile, setIsMobile] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // iPad portrait/landscape (768-1023px) isn't "mobile" (isMobile above
  // stays false) — but measured live, several of the desktop-sized layout
  // choices below don't actually fit that range: the fixed 236px sidebar
  // plus a fixed 392px detail rail left as little as ~140px for the roster
  // list itself, the 4-column summary-stat grid (repeat(3,1fr) 1.25fr)
  // overflowed its row by ~164px, and the position/class filter pills
  // (flexWrap:"nowrap") overflowed by ~404px — all three assumed real-
  // desktop width that this range doesn't have. isCompactViewport below
  // reuses the same "not enough room" signal for all three instead of
  // building three separate treatments, and matches the <1024px breakpoint
  // draft-board already uses for the identical list+detail-rail tradeoff
  // (see .db-detail-col in globals.css).
  const [isTabletWidth, setIsTabletWidth] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    setIsTabletWidth(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsTabletWidth(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  // iPad landscape (1024-1279px) keeps the sidebar (236px is a reasonable
  // ~20% of that width, and it's not the thing squeezing this page) but
  // still doesn't have room for BOTH the roster list and a persistent
  // 392px detail rail at the same time — measured live, the summary-stat
  // grid and filter pills were overflowing there too, same as portrait
  // was before isCompactViewport covered it. Upper-bounded at 1279 (not
  // open-ended) so real desktop windows keep the persistent rail — see
  // .db-detail-col in globals.css, which uses the same 1280px cutoff for
  // the identical tradeoff on draft-board.
  const [isLandscapeTabletWidth, setIsLandscapeTabletWidth] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px) and (max-width: 1279px)");
    setIsLandscapeTabletWidth(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsLandscapeTabletWidth(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const isCompactViewport = isMobile || isTabletWidth || isLandscapeTabletWidth;
  // Portrait + phone specifically (not landscape): the detail panel's
  // full-screen takeover treatment. Landscape gets a centered pop-up over
  // a dimmed backdrop instead — same pattern draft-board uses for its own
  // 1024-1279px range (see .db-detail-modal-backdrop) — so it needs its
  // own narrower flag rather than reusing isCompactViewport wholesale.
  const isFullScreenOverlay = isMobile || isTabletWidth;
  // iPad portrait specifically (not landscape, and not phone — phone
  // already has its own separate compact card list below, gated on
  // isMobile). The sidebar is dropped for this whole range (see
  // roster-tokens.css), which alone fixes most of the squeeze, but the
  // grid view's cards still only got 2 narrow columns there — the list
  // view (a proper multi-column row, same pattern as every other data
  // table on the site) uses that width far better than a squeezed card
  // grid, so this range skips grid entirely. Landscape keeps its sidebar
  // AND both view modes — once the detail rail is an overlay there's
  // plenty of room for either.
  const isTabletPortrait = isTabletWidth && !isMobile;
  const effectiveViewMode = isTabletPortrait ? "list" : viewMode;

  // Compare modal: up to 4 players, persisted in sessionStorage (mirrors the
  // theme localStorage pattern in team-rosters-shell.tsx) so the list
  // survives a full page navigation (e.g. switching teams), not just
  // opening/closing the modal.
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareList, setCompareList] = useState<Player[]>([]);
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(COMPARE_STORAGE_KEY);
      if (stored) setCompareList(JSON.parse(stored));
    } catch {
      // sessionStorage unavailable or corrupt — start empty
    }
  }, []);
  const updateCompareList = (next: Player[]) => {
    setCompareList(next);
    try {
      sessionStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore — compare list just won't persist across navigation
    }
  };
  const openCompare = (prefill?: Player) => {
    setCompareOpen(true);
    if (prefill && compareList.length < MAX_COMPARE && !compareList.some((p) => p.id === prefill.id)) {
      updateCompareList([...compareList, prefill]);
    }
  };
  const addToCompare = (player: Player) => {
    if (compareList.length >= MAX_COMPARE || compareList.some((p) => p.id === player.id)) return;
    updateCompareList([...compareList, player]);
  };
  const removeFromCompare = (id: string) => updateCompareList(compareList.filter((p) => p.id !== id));

  const selectPlayer = (id: string) => {
    setSelectedId(id);
    if (isCompactViewport) setMobileDetailOpen(true);
  };

  const modeNow: SeasonMode = mode ?? "cur";
  const fvUseProj = sort === "proj" && PRO_UNLOCKED;
  const activeMetric: FvMetric = fvUseProj ? "minus1" : fvMetric;
  // Real precomputed season_player_values for the current season; proj is
  // Pro-locked jitter (unchanged).
  const fvMetricOf = (p: Player, m: FvMetric) => (fvUseProj ? fvValue(m, catZ(CATS, p, true)) : fvOf(p, m));
  // Pool-wide rank (across ALL players at the league size), per FV metric.
  const poolRankOf = (p: Player, m: FvMetric): number | null =>
    m === "ninecat" ? p.rankNineCat : m === "eightcat" ? p.rankEightCat : p.rankMinus1;
  // Sort key for a fantasy-value metric: null (unranked — no real season data,
  // e.g. an unseeded 2-way/undrafted rookie) rather than the metric's raw
  // z-score, whose "no data" default is 0 — which lands in the MIDDLE of a
  // sorted list of real z-scores (mean ~0 by construction) instead of the
  // bottom. Comparators using this must sink `null` to the end regardless of
  // sort direction — see sortByFvMissingLast().
  const fvSortValue = (p: Player, m: FvMetric): number | null => (poolRankOf(p, m) == null ? null : fvMetricOf(p, m));
  // Blended consensus-vs-real-value tone (server-precomputed, see trend-insight.ts), per FV metric.
  const tagOf = (p: Player, m: FvMetric): TrendTag | null =>
    m === "ninecat" ? p.tagNineCat : m === "eightcat" ? p.tagEightCat : p.tagMinus1;
  const fvHdr = fvUseProj ? "Proj M1V" : FV_HEADER[activeMetric];

  const qLower = q.toLowerCase();
  // Undrafted/two-way players with no cap hit yet shouldn't drag down payroll or age averages.
  const salariedPlayers = players.filter((p) => p.salary > 0);
  const totalPayroll = salariedPlayers.reduce((a, p) => a + p.salary, 0);
  const avgAge = salariedPlayers.length ? salariedPlayers.reduce((a, p) => a + p.age, 0) / salariedPlayers.length : 0;
  const taxDiff = totalPayroll - TAX_LINE;
  const taxCaption = `${money(Math.abs(taxDiff))}`;
  const taxLineCaption = `tax line ($${(TAX_LINE / 1e6).toFixed(1)}M)`;
  const ageCaption = (() => {
    if (!ageRank || ageRank.total <= 1) return "vs. league average";
    const { rank, total } = ageRank;
    if (rank === 1) return "youngest core in the league";
    if (rank === total) return "oldest core in the league";
    if (rank <= 5) return `${ordinal(rank)}-youngest team in the league`;
    const fromBottom = total - rank + 1;
    if (fromBottom <= 5) return `${ordinal(fromBottom)}-oldest team in the league`;
    return "middle of the pack, age-wise";
  })();

  const positionFilterDefs = [
    { id: "G", label: "Guards" },
    { id: "F", label: "Forwards" },
    { id: "C", label: "Centers" },
  ];
  const classFilterDefs = [
    { id: "rook", label: "Rookies" },
    { id: "soph", label: "Sophomores" },
    { id: "vet", label: "Veterans" },
  ];
  const classOf = (p: Player): "rook" | "soph" | "vet" => (p.tag === "rookie" ? "rook" : p.tag === "soph" ? "soph" : "vet");

  let list = players.filter((p) => {
    const posOk = posFilters.size === 0 || posFilters.has(p.group);
    const classOk = classFilters.size === 0 || classFilters.has(classOf(p));
    const qOk = !qLower || p.name.toLowerCase().includes(qLower);
    return posOk && classOk && qOk;
  });

  if (colSort) {
    const dir = colDir === "asc" ? 1 : -1;
    const catObj = CATS.find((c) => c.key === colSort);
    // fanv can be null (unranked — see fvSortValue) and must sink to the
    // bottom regardless of sort direction; every other column always has a
    // real value to compare.
    const valOf = (p: Player): string | number | null => {
      if (colSort === "name") return p.name;
      if (colSort === "pos") return p.pos;
      if (colSort === "age") return p.age;
      if (colSort === "salary") return p.salary;
      if (colSort === "dyn") return p.consensus;
      if (colSort === "fanv") return fvSortValue(p, activeMetric);
      if (catObj) return catValCur(p, catObj);
      return p.dynasty;
    };
    list = [...list].sort((a, b) => {
      const va = valOf(a);
      const vb = valOf(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
  } else {
    const fvKeys: SortKey[] = ["minus1", "ninecat", "eightcat"];
    const sortMetric: FvMetric | null = sort === "proj" ? activeMetric : fvKeys.includes(sort) ? (sort as FvMetric) : null;
    list = [...list].sort((a, b) => {
      if (sort === "salary") return b.salary - a.salary;
      if (sortMetric) {
        // Unranked (no real season data) always sinks to the bottom — its
        // raw metric value defaults to 0, which is the MIDDLE of a sorted
        // z-score pool (mean ~0), not the bottom.
        const va = fvSortValue(a, sortMetric);
        const vb = fvSortValue(b, sortMetric);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return vb - va;
      }
      return b.dynasty - a.dynasty;
    });
  }

  const isTop = (p: Player) => p.consensus <= ACCENT_RANK;
  // Sort dropdown parked on "Projections (Pro)": show the lock in place of every
  // FV-derived cell instead of silently falling back to the real metric.
  const sortProjLocked = sort === "proj" && !PRO_UNLOCKED;

  const cards = list.map((p) => {
    const sel = p.id === selectedId;
    // Real CatV rank trend for the active fantasy metric (blended consensus vs.
    // real-value read — see trend-insight.ts), independent of what the roster is sorted by.
    const activeRank = poolRankOf(p, activeMetric);
    const activeRankStr = activeRank != null ? "#" + activeRank : p.projected ? "proj" : "—";
    const activeTag = tagOf(p, activeMetric);
    const activeTagMeta = activeTag ? TAG_META[activeTag] : null;
    const verdict = activeTagMeta?.label ?? null;
    const toneColor = activeTagMeta?.color ?? "var(--rt-muted)";
    const toneArrow = activeTagMeta?.emoji ?? "–";
    const tag = p.tag ? tagBadge(p.tag, dark) : null;
    // Rank shown when sorted by a fantasy metric = pool-wide rank for that metric.
    const cardMetric: FvMetric =
      sort === "minus1" || sort === "ninecat" || sort === "eightcat" ? (sort as FvMetric) : activeMetric;
    const cardRank = poolRankOf(p, cardMetric);
    const fvRankStr = cardRank != null ? "#" + cardRank : p.projected ? "proj" : "—";
    return {
      id: p.id,
      name: p.name,
      isRookie: p.tag === "rookie",
      listName: shortName(p.name),
      initials: initials(p.name),
      meta: "#" + p.jersey + " · " + p.pos + " · Age " + p.age,
      pos: p.pos,
      age: String(p.age),
      thru: "thru " + p.thru,
      contractFull: p.contractYears
        ? p.contractYears + " yr" + (p.contractYears > 1 ? "s" : "") + " / " + money(p.contractTotal ?? 0)
        : "",
      tag,
      tagShort: p.tag === "rookie" ? "R" : p.tag === "soph" ? "S" : "",
      salary: money(p.salary),
      keyVal: sortProjLocked ? "—" : sort === "dynasty" ? "#" + p.consensus : sort === "salary" ? money(p.salary) : fvRankStr,
      keyLabel: sortProjLocked ? "" : sort === "dynasty" ? "Dynasty rank" : sort === "salary" ? "Cap hit" : fvHdr,
      dynRank: "#" + p.consensus,
      change: p.change,
      caret: caret(p.dir),
      changeColor: changeColor(p.dir),
      fvRank: sortProjLocked ? "—" : activeRankStr,
      fvVerdict: sortProjLocked ? "" : (verdict ?? "—"),
      fvToneColor: sortProjLocked ? "var(--rt-muted)" : toneColor,
      fvToneArrow: sortProjLocked ? "" : toneArrow,
      plateBg: isTop(p) ? "var(--rt-primary)" : "var(--rt-surface-strong)",
      plateFg: isTop(p) ? "var(--rt-on-primary)" : "var(--rt-ink)",
      cardBorder: sel ? "var(--rt-primary)" : "var(--rt-hairline)",
      rowBg: sel ? "var(--rt-surface-strong)" : "transparent",
    };
  });

  // ---- selected player detail ----
  const sp = players.find((p) => p.id === selectedId) ?? players[0];
  const spTrend = usePlayerTrend(sp.id, TRENDS_SEASON, TRENDS_SEASON_TYPE);
  const isProj = modeNow === "proj";
  const isPrior = modeNow === "prior";
  const isRecent = modeNow === "recent";
  const projLocked = isProj && !PRO_UNLOCKED;
  // Prior is real 2024-25 season_player_stats/season_player_values (see
  // roster-live-data.ts) — priorGp === 0 means the player has no prior-season
  // row (rookies, or a player who missed that season entirely). Projection is
  // still jitter around the CURRENT per-game line (a projection model isn't
  // wired in yet — see roster-helpers.ts), so it's meaningless for a player
  // with no 2025–26 games (e.g. out all season hurt): jittering zero still
  // nets zero, and z-scoring a literal 0% FG/FT against the league mean
  // produces a nonsensical double-digit z. Current mode has the same failure
  // mode when there's no real season_player_values row to fall back on either
  // (catVals empty). Guard all three instead of rendering garbage.

  // 9-cat profile math (row order anchored to Current mode, z/color/bar per
  // row) lives in buildRankedProfile()/buildRecentProfile() so the
  // single-player panel here and every card in the compare modal share one
  // implementation.
  const profile = isRecent ? buildRecentProfile(spTrend, catOrderFor(sp), sp.gp, sp.mpg) : buildRankedProfile(sp, modeNow);
  const spDisplayMpg = isRecent ? (spTrend.data?.recent?.mpg ?? null) : isPrior ? sp.priorMpg : sp.mpg;
  // No MPG whenever the profile itself has nothing to show (Recent under its
  // 10-GP gate, or literally zero games that season, e.g. Prior for a player who
  // wasn't in the league yet) — a minutes number next to a "no data" message for
  // the same window reads as contradictory.
  const spHideMpg = projLocked || profile.noData;
  const spMpgBar = spDisplayMpg != null && !spHideMpg ? mpgBarFor(spDisplayMpg) : null;

  const contract = contractFor(sp);
  const isNewRookieScale = contract.status === "Rookie Scale" && sp.tag === "rookie";
  const dTag = sp.tag ? tagBadge(sp.tag, true) : null;

  // Tier is shown persistently in the hero header regardless of sort — this is
  // the single lookup both that tag and the "Dynasty tier" sort view share.
  const heroTier = sp.tier != null ? DYNASTY_TIER_META[sp.tier] ?? null : null;

  const trendMetric = TREND_METRIC[activeMetric];
  // Season anchors (rank + gp + mpg) for the active value metric — drive the
  // per-mode GP/rank/arrow in TrendHero (shared with the compare cards).
  const spTrios = seasonTriosFor(sp, trendMetric);

  const curTeam = TEAMS.find((t) => t.abbr === team) ?? TEAMS.find((t) => t.abbr === "OKC")!;

  function sortCol(col: string) {
    const def: Record<string, "asc" | "desc"> = { name: "asc", salary: "desc", dyn: "asc", fanv: "desc" };
    if (colSort === col) {
      setColDir(colDir === "asc" ? "desc" : "asc");
    } else {
      setColSort(col);
      setColDir(def[col] ?? "desc");
    }
  }

  function onSortChange(v: SortKey) {
    setColSort(null);
    setSort(v);
    if (v === "minus1" || v === "ninecat" || v === "eightcat") setFvMetric(v);
  }

  // "Maybe later" on the Projections paywall modal: snap back to the last real FV metric sort.
  const dismissProjSort = () => setSort(fvMetric);

  const listHeaderDefs: { key: string; label: string; align: "flex-start" | "center" }[] = [
    { key: "name", label: "Player", align: "flex-start" },
    { key: "pos", label: "Pos", align: "center" },
    { key: "age", label: "Age", align: "center" },
    { key: "salary", label: "Salary", align: "center" },
    { key: "dyn", label: "Dynasty", align: "center" },
    { key: "fanv", label: fvHdr, align: "center" },
  ];

  const noResults = cards.length === 0;
  const listGridCols = "minmax(210px,1.4fr) 40px 36px minmax(80px,0.95fr) minmax(90px,1fr) minmax(90px,1fr)";

  return (
    <>
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
      {/* ================= MAIN COLUMN ================= */}
      {/* Always mounted (hidden via display:none on mobile when the detail
          panel is open) rather than conditionally unmounted — the roster
          list's scroll position lives on this DOM node's overflow:auto, so
          unmounting it on every player tap reset the scroll to the top on
          return. display:none preserves scrollTop across the toggle. */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: isCompactViewport && mobileDetailOpen ? "none" : "flex", flexDirection: "column" }}>
        {/* Topbar */}
        <div
          style={{
            flex: isMobile ? "0 0 auto" : "0 0 68px",
            borderBottom: "1px solid var(--rt-hairline)",
            display: "flex",
            alignItems: "center",
            flexWrap: isMobile ? "wrap" : "nowrap",
            gap: isMobile ? 10 : 16,
            padding: isMobile ? "10px 16px" : "0 28px",
          }}
        >
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="rt-hover-surface"
              onClick={() => setTeamMenuOpen((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                background: "none",
                border: "none",
                padding: "5px 10px 5px 5px",
                cursor: "pointer",
                borderRadius: 12,
                fontFamily: "var(--rt-font-sans)",
              }}
            >
              {TEAM_LOGO[curTeam.abbr] ? (
                // eslint-disable-next-line @next/next/no-img-element -- static team wordmark from public/
                <img
                  src={`/images/nba%20team%20images/${TEAM_LOGO[curTeam.abbr]}`}
                  alt=""
                  width={48}
                  height={48}
                  style={{ width: isMobile ? 36 : 48, height: isMobile ? 36 : 48, flex: isMobile ? "0 0 36px" : "0 0 48px", objectFit: "contain" }}
                />
              ) : (
                <span
                  style={{
                    width: 40,
                    height: 40,
                    flex: "0 0 40px",
                    borderRadius: 999,
                    background: "var(--rt-surface-strong)",
                    color: "var(--rt-ink)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--rt-font-mono)",
                    fontSize: 13,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                  }}
                >
                  {curTeam.abbr}
                </span>
              )}
              <div style={{ textAlign: "left" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: isMobile ? 16 : 19, fontWeight: 600, color: "var(--rt-ink)", letterSpacing: "-0.3px", whiteSpace: "nowrap" }}>
                    {curTeam.name}
                  </span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--rt-muted)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ transform: teamMenuOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 140ms ease" }}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </div>
                {!isMobile && <div style={{ fontSize: 13, color: "var(--rt-muted)" }}>Active roster · 2026–27 season</div>}
              </div>
            </button>
            {teamMenuOpen && (
              <>
                <div onClick={() => setTeamMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    left: 0,
                    zIndex: 41,
                    width: 300,
                    maxHeight: 380,
                    overflow: "auto",
                    background: "var(--rt-canvas)",
                    border: "1px solid var(--rt-hairline)",
                    borderRadius: 14,
                    boxShadow: "0 12px 32px rgba(0,0,0,0.14)",
                    padding: 6,
                  }}
                >
                  {TEAMS.map((t) => (
                    <button
                      key={t.abbr}
                      ref={t.abbr === curTeam.abbr ? selectedTeamBtnRef : undefined}
                      type="button"
                      className="rt-hover-surface"
                      onClick={() => {
                        setTeamMenuOpen(false);
                        router.push(`/team-rosters/${t.abbr}`);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 11,
                        width: "100%",
                        padding: "8px 10px",
                        border: "none",
                        cursor: "pointer",
                        borderRadius: 10,
                        background: t.abbr === curTeam.abbr ? "var(--rt-surface-strong)" : "transparent",
                        fontFamily: "var(--rt-font-sans)",
                        textAlign: "left",
                      }}
                    >
                      {TEAM_LOGO[t.abbr] ? (
                        // eslint-disable-next-line @next/next/no-img-element -- static team wordmark from public/
                        <img
                          src={`/images/nba%20team%20images/${TEAM_LOGO[t.abbr]}`}
                          alt=""
                          width={30}
                          height={30}
                          style={{ width: 30, height: 30, flex: "0 0 30px", objectFit: "contain" }}
                        />
                      ) : (
                        <span
                          style={{
                            width: 30,
                            height: 30,
                            flex: "0 0 30px",
                            borderRadius: 999,
                            background: "var(--rt-surface-strong)",
                            color: "var(--rt-ink)",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontFamily: "var(--rt-font-mono)",
                            fontSize: 11,
                            fontWeight: 600,
                            letterSpacing: "0.03em",
                          }}
                        >
                          {t.abbr}
                        </span>
                      )}
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, color: "var(--rt-ink)", whiteSpace: "nowrap" }}>
                        {t.name}
                      </span>
                      {t.abbr === curTeam.abbr && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--rt-primary)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 16px" }}>
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div style={{ marginLeft: isMobile ? 0 : "auto", width: isMobile ? "100%" : "auto", display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                height: 42,
                padding: "0 18px",
                background: "var(--rt-surface-strong)",
                borderRadius: 999,
                width: isMobile ? "auto" : 230,
                flex: isMobile ? 1 : undefined,
                minWidth: 0,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--rt-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search roster"
                style={{ border: "none", outline: "none", background: "transparent", fontFamily: "var(--rt-font-sans)", fontSize: 14, color: "var(--rt-ink)", width: "100%", minWidth: 0 }}
              />
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 42, padding: "0 6px 0 16px", background: "var(--rt-surface-strong)", borderRadius: 999, flexShrink: 0 }}>
              <span style={{ fontSize: 13, color: "var(--rt-body)", fontWeight: 500 }}>Sort</span>
              <select
                value={sort}
                onChange={(e) => onSortChange(e.target.value as SortKey)}
                style={{ border: "none", background: "transparent", outline: "none", fontFamily: "var(--rt-font-sans)", fontSize: 13, fontWeight: 600, color: "var(--rt-ink)", cursor: "pointer", padding: "8px 4px" }}
              >
                <option value="dynasty">Dynasty value</option>
                <option value="minus1">Minus1V (Fantasy)</option>
                <option value="ninecat">9CatV (Fantasy)</option>
                <option value="eightcat">8CatV (Fantasy)</option>
                <option value="salary">Salary</option>
                <option value="proj">Projections (Pro)</option>
              </select>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--rt-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8 }}>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>
          </div>
        </div>

        {/* Scroll area */}
        <div style={{ flex: 1, overflow: "auto", padding: isMobile ? "16px 16px 28px" : "24px 28px 36px", display: "flex", flexDirection: "column", gap: isMobile ? 16 : 22 }}>
          {/* Summary cards. isCompactViewport (not isMobile): the 4-track
              repeat(3,1fr) 1.25fr overflowed its row by ~164px at iPad
              portrait width — measured live at 768px, where it's clearly
              not "mobile" but still nowhere near enough room for 4 columns. */}
          <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: isCompactViewport ? "repeat(2, 1fr)" : "repeat(3, 1fr) 1.25fr", gap: isMobile ? 12 : 16 }}>
            <div style={{ background: "var(--rt-canvas)", border: "1px solid var(--rt-hairline)", borderRadius: 16, padding: isMobile ? "14px 16px" : "20px 22px" }}>
              <div style={{ fontSize: 13, color: "var(--rt-muted)" }}>Active roster</div>
              <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: isMobile ? 26 : 38, fontWeight: 500, letterSpacing: "-1px", color: "var(--rt-ink)", marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
                {salariedPlayers.length}
              </div>
              <div style={{ fontSize: 12, color: "var(--rt-muted-soft)", marginTop: 2 }}>players under contract</div>
            </div>
            <div style={{ background: "var(--rt-canvas)", border: "1px solid var(--rt-hairline)", borderRadius: 16, padding: isMobile ? "14px 16px" : "20px 22px" }}>
              <div style={{ fontSize: 13, color: "var(--rt-muted)" }}>Total salaried</div>
              <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: isMobile ? 26 : 38, fontWeight: 500, letterSpacing: "-1px", color: "var(--rt-ink)", marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
                {money(totalPayroll)}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--rt-muted-soft)", marginTop: 2 }}>
                {taxCaption}
                <span style={{ fontSize: 10, color: taxDiff >= 0 ? "var(--rt-down)" : "var(--rt-up)" }}>{taxDiff >= 0 ? "▲" : "▼"}</span>
                {taxLineCaption}
              </div>
            </div>
            <div style={{ background: "var(--rt-canvas)", border: "1px solid var(--rt-hairline)", borderRadius: 16, padding: isMobile ? "14px 16px" : "20px 22px" }}>
              <div style={{ fontSize: 13, color: "var(--rt-muted)" }}>Average age</div>
              <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: isMobile ? 26 : 38, fontWeight: 500, letterSpacing: "-1px", color: "var(--rt-ink)", marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
                {avgAge.toFixed(1)}
              </div>
              <div style={{ fontSize: 12, color: "var(--rt-muted-soft)", marginTop: 2 }}>{ageCaption}</div>
            </div>
            <div
              className="rt-hover-shadow"
              onClick={() => openCompare()}
              style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 16, background: "var(--rt-canvas)", border: "1px solid var(--rt-hairline)", borderRadius: 16, padding: isMobile ? "14px 16px" : "16px 20px", cursor: "pointer" }}
            >
              <span style={{ width: isMobile ? 36 : 48, height: isMobile ? 36 : 48, flex: isMobile ? "0 0 36px" : "0 0 48px", borderRadius: 999, background: "var(--rt-primary)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <svg width={isMobile ? 17 : 22} height={isMobile ? 17 : 22} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 3h5v5" /><path d="M21 3l-7 7" /><path d="M8 21H3v-5" /><path d="M3 21l7-7" />
                </svg>
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: isMobile ? 14 : 16, fontWeight: 600, color: "var(--rt-ink)" }}>Build a trade</div>
                {!isMobile && <div style={{ fontSize: 13, color: "var(--rt-muted)" }}>Compare assets &amp; dynasty value</div>}
              </div>
            </div>
          </div>

          {/* Position filters. isCompactViewport (not isMobile) on flexWrap:
              nowrap forced the position pills + divider + class pills +
              count text + view toggle onto one line that overflowed by
              ~404px at iPad portrait width — measured live at 768px. */}
          <div style={{ flexShrink: 0, display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", gap: isMobile ? 10 : 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 8, flexWrap: isCompactViewport ? "wrap" : "nowrap" }}>
              <button
                type="button"
                onClick={clearAllFilters}
                style={{
                  flexShrink: 0,
                  padding: isMobile ? "7px 12px" : "9px 18px",
                  border: "none",
                  cursor: "pointer",
                  borderRadius: 999,
                  fontFamily: "var(--rt-font-sans)",
                  fontSize: isMobile ? 12.5 : 14,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  background: posFilters.size === 0 && classFilters.size === 0 ? "var(--rt-ink)" : "var(--rt-surface-strong)",
                  color: posFilters.size === 0 && classFilters.size === 0 ? "var(--rt-canvas)" : "var(--rt-body)",
                }}
              >
                All players
              </button>
              {positionFilterDefs.map((pf) => {
                const on = posFilters.has(pf.id);
                return (
                  <button
                    key={pf.id}
                    type="button"
                    onClick={() => togglePosFilter(pf.id)}
                    style={{
                      flexShrink: 0,
                      padding: isMobile ? "7px 12px" : "9px 18px",
                      border: "none",
                      cursor: "pointer",
                      borderRadius: 999,
                      fontFamily: "var(--rt-font-sans)",
                      fontSize: isMobile ? 12.5 : 14,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      background: on ? "var(--rt-ink)" : "var(--rt-surface-strong)",
                      color: on ? "var(--rt-canvas)" : "var(--rt-body)",
                    }}
                  >
                    {pf.label}
                  </button>
                );
              })}
              {/* Thin divider between the position group and the class group —
                  they're independent (ANDed) filters, not one flat list. Hidden
                  whenever the pills can wrap onto their own rows (phone, and
                  now tablet too), where a 1px bar reads as a stray mark
                  rather than a separator. */}
              {!isCompactViewport && <span style={{ width: 1, alignSelf: "stretch", background: "var(--rt-hairline)", flexShrink: 0 }} />}
              {classFilterDefs.map((cf) => {
                const on = classFilters.has(cf.id);
                return (
                  <button
                    key={cf.id}
                    type="button"
                    onClick={() => toggleClassFilter(cf.id)}
                    style={{
                      flexShrink: 0,
                      padding: isMobile ? "7px 12px" : "9px 18px",
                      border: "none",
                      cursor: "pointer",
                      borderRadius: 999,
                      fontFamily: "var(--rt-font-sans)",
                      fontSize: isMobile ? 12.5 : 14,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      background: on ? "var(--rt-ink)" : "var(--rt-surface-strong)",
                      color: on ? "var(--rt-canvas)" : "var(--rt-body)",
                    }}
                  >
                    {cf.label}
                  </button>
                );
              })}
              {!isMobile && (
                <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--rt-muted)" }}>
                  {cards.length} of {players.length} players
                </span>
              )}
              {/* Toggle hidden (not just !isMobile) in tablet portrait — that
                  range is forced to list-only below (effectiveViewMode), so
                  a grid/list picker there would offer a choice that doesn't
                  do anything. */}
              {!isMobile && !isTabletPortrait && (
                <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
                  <button
                    type="button"
                    aria-label="Grid view"
                    onClick={() => setViewMode("grid")}
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 28, border: "none", cursor: "pointer", borderRadius: 999, background: viewMode !== "list" ? "var(--rt-canvas)" : "transparent" }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={viewMode !== "list" ? "var(--rt-ink)" : "var(--rt-muted)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label="List view"
                    onClick={() => setViewMode("list")}
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 28, border: "none", cursor: "pointer", borderRadius: 999, background: viewMode === "list" ? "var(--rt-canvas)" : "transparent" }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={viewMode === "list" ? "var(--rt-ink)" : "var(--rt-muted)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
            {isMobile && (
              <span style={{ fontSize: 13, color: "var(--rt-muted)" }}>
                {cards.length} of {players.length} players
              </span>
            )}
          </div>

          {/* Player grid. iPad portrait is forced to list view above
              (effectiveViewMode) and phone has its own separate compact
              card list further down, so this only ever renders on real
              desktop OR iPad landscape (both view modes stay available
              there — see isLandscapeTabletWidth above). Landscape is
              pinned to exactly 2 columns (not auto-fill's 3 narrower
              ones) — per explicit request, and it also fixes the name
              truncation auto-fill's 3-up was causing there. 2 wide
              columns has plenty of room even at 1024px (the low end of
              that range), so no padding/avatar/gap trim is needed there
              anymore either — reverted to the same static values desktop
              always used. */}
          {!isMobile && effectiveViewMode === "grid" && (
            <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: isLandscapeTabletWidth ? "repeat(2, 1fr)" : "repeat(auto-fill, minmax(220px, 1fr))", gap: 18 }}>
              {cards.map((c) => (
                <div
                  key={c.id}
                  className="rt-hover-shadow"
                  onClick={() => selectPlayer(c.id)}
                  style={{
                    position: "relative",
                    cursor: "pointer",
                    background: "var(--rt-canvas)",
                    border: `1px solid ${c.cardBorder}`,
                    borderRadius: 16,
                    padding: 18,
                    transition: "box-shadow 140ms ease, border-color 140ms ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <PlayerHeadshot name={c.name} size={52} initials={c.initials} background={c.plateBg} color={c.plateFg} fontSize={18} rookie={c.isRookie} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 600, color: "var(--rt-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                      <div style={{ fontSize: 13, color: "var(--rt-muted)", marginTop: 2 }}>{c.meta}</div>
                    </div>
                  </div>
                  <div style={{ height: 24, marginTop: 10 }}>
                    {c.tag && (
                      <span
                        style={{
                          padding: "4px 11px",
                          borderRadius: 999,
                          border: `1px solid ${c.tag.border}`,
                          background: c.tag.bg,
                          color: c.tag.color,
                          fontFamily: "var(--rt-font-sans)",
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.tag.label}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--rt-hairline-soft)" }}>
                    <div style={{ textAlign: "left" }}>
                      <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 18, fontWeight: 500, color: "var(--rt-ink)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{c.salary}</div>
                      {c.contractFull && (
                        <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 10, color: "var(--rt-muted-soft)", marginTop: 3 }}>{c.contractFull}</div>
                      )}
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "var(--rt-font-mono)", fontSize: 18, fontWeight: 500, color: "var(--rt-ink)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                        {c.keyVal}
                        {sort === "dynasty" ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: c.changeColor }}>
                            {c.caret}
                            {c.change !== "—" ? c.change : ""}
                          </span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--rt-muted)", marginTop: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>{c.keyLabel}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "var(--rt-font-mono)", fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: c.fvToneColor }}>
                        <span style={{ fontSize: 10 }}>{c.fvToneArrow}</span>
                        {c.fvVerdict}
                      </span>
                      <div style={{ fontSize: 11, color: "var(--rt-muted)", marginTop: 5 }}>Verdict</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Player list */}
          {!isMobile && effectiveViewMode === "list" && (
            <div style={{ flexShrink: 0 }}>
              <div style={{ border: "1px solid var(--rt-hairline)", borderRadius: 16, overflowX: "auto" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: listGridCols,
                    gap: 12,
                    alignItems: "center",
                    padding: "11px 16px",
                    background: "var(--rt-surface-soft)",
                    borderBottom: "1px solid var(--rt-hairline)",
                  }}
                >
                  {listHeaderDefs.map((h) => {
                    const active = colSort === h.key;
                    return (
                      <button
                        key={h.key}
                        type="button"
                        onClick={() => sortCol(h.key)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                          width: "100%",
                          justifyContent: h.align,
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          fontFamily: "var(--rt-font-sans)",
                          fontSize: 10,
                          fontWeight: 600,
                          color: active ? "var(--rt-ink)" : "var(--rt-muted)",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        {h.label}
                        <span style={{ fontSize: 7, lineHeight: 1 }}>{active ? (colDir === "asc" ? "▲" : "▼") : ""}</span>
                      </button>
                    );
                  })}
                </div>
                {cards.map((c) => (
                  <div
                    key={c.id}
                    className="rt-hover-surface"
                    onClick={() => selectPlayer(c.id)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: listGridCols,
                      gap: 12,
                      alignItems: "center",
                      padding: "13px 16px",
                      cursor: "pointer",
                      borderBottom: "1px solid var(--rt-hairline-soft)",
                      background: c.rowBg,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <PlayerHeadshot name={c.name} size={38} initials={c.initials} background={c.plateBg} color={c.plateFg} fontSize={14} rookie={c.isRookie} />
                      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--rt-ink)", whiteSpace: "nowrap" }}>{c.listName}</span>
                        {c.tag && (
                          <span
                            style={{
                              flex: "0 0 auto",
                              width: 18,
                              height: 18,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: 999,
                              border: `1px solid ${c.tag.border}`,
                              background: c.tag.bg,
                              color: c.tag.color,
                              fontFamily: "var(--rt-font-mono)",
                              fontSize: 10,
                              fontWeight: 700,
                            }}
                          >
                            {c.tagShort}
                          </span>
                        )}
                      </div>
                    </div>
                    <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 13, fontWeight: 500, color: "var(--rt-body)", fontVariantNumeric: "tabular-nums", textAlign: "center" }}>{c.pos}</span>
                    <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 13, fontWeight: 500, color: "var(--rt-body)", fontVariantNumeric: "tabular-nums", textAlign: "center" }}>{c.age}</span>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                      <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 14, fontWeight: 500, color: "var(--rt-ink)", fontVariantNumeric: "tabular-nums" }}>{c.salary}</span>
                      <span style={{ fontSize: 10, color: "var(--rt-muted)" }}>{c.contractFull || c.thru}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                      <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 14, fontWeight: 500, color: "var(--rt-ink)", fontVariantNumeric: "tabular-nums" }}>{c.dynRank}</span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontFamily: "var(--rt-font-mono)", fontSize: 11, fontWeight: 500, fontVariantNumeric: "tabular-nums", color: c.changeColor }}>
                        <span style={{ fontSize: 8 }}>{c.caret}</span>
                        {c.change}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                      <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 14, fontWeight: 600, color: "var(--rt-ink)", fontVariantNumeric: "tabular-nums" }}>{c.fvRank}</span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontFamily: "var(--rt-font-mono)", fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: c.fvToneColor }}>
                        <span style={{ fontSize: 8 }}>{c.fvToneArrow}</span>
                        {c.fvVerdict}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mobile: one compact row layout regardless of the desktop grid/list
             toggle — the full list-view columns need ~800px minimum, and grid
             cards don't fit 2-3 up on a 375px screen. Tapping a row opens the
             full-screen detail view (see selectPlayer / the aside below). */}
          {isMobile && (
            <div style={{ flexShrink: 0, border: "1px solid var(--rt-hairline)", borderRadius: 16, overflow: "hidden" }}>
              {cards.map((c) => (
                <div
                  key={c.id}
                  className="rt-hover-surface"
                  onClick={() => selectPlayer(c.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    cursor: "pointer",
                    borderBottom: "1px solid var(--rt-hairline-soft)",
                    background: c.rowBg,
                  }}
                >
                  <PlayerHeadshot name={c.name} size={40} initials={c.initials} background={c.plateBg} color={c.plateFg} fontSize={14} rookie={c.isRookie} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--rt-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.listName}
                      </span>
                      {c.tag && (
                        <span
                          style={{
                            flex: "0 0 auto",
                            width: 16,
                            height: 16,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: 999,
                            border: `1px solid ${c.tag.border}`,
                            background: c.tag.bg,
                            color: c.tag.color,
                            fontFamily: "var(--rt-font-mono)",
                            fontSize: 9,
                            fontWeight: 700,
                          }}
                        >
                          {c.tagShort}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--rt-muted)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.pos} · Age {c.age} · {c.salary}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flex: "0 0 auto" }}>
                    <div style={{ display: "flex", gap: 10 }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 8, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Dynasty</div>
                        <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 13, fontWeight: 600, color: "var(--rt-ink)", fontVariantNumeric: "tabular-nums" }}>{c.dynRank}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 8, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{fvHdr}</div>
                        <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 13, fontWeight: 600, color: "var(--rt-ink)", fontVariantNumeric: "tabular-nums" }}>{c.fvRank}</div>
                      </div>
                    </div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 3, fontFamily: "var(--rt-font-mono)", fontSize: 10, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: c.fvToneColor }}>
                      <span style={{ fontSize: 7 }}>{c.fvToneArrow}</span>
                      {c.fvVerdict}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {noResults && (
            <div style={{ flexShrink: 0, padding: 48, textAlign: "center", color: "var(--rt-muted)", fontSize: 15 }}>
              No players match your filter. Clear the search to see the full roster.
            </div>
          )}

          <section
            aria-label="About NBA team rosters"
            style={{ flexShrink: 0, padding: "40px 4px 8px", maxWidth: 860, color: "var(--rt-muted)", fontSize: 13, lineHeight: 1.7 }}
          >
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--rt-body)" }}>
              About NBA Team Rosters
            </h2>
            <p>
              Each team page pairs the current active roster with dynasty consensus rank, salary and
              contract terms, and per-player 9-category fantasy value (9CatV, Minus1V, 8CatV) — so you
              can see how a team&apos;s real assets stack up as fantasy assets in one place, not spread
              across three tools.
            </p>
            <p style={{ marginTop: 12 }}>
              Trend tags (Climbing, Sinking, Tanking, Acing, and the rest) compare a player&apos;s
              rolling 20-week fantasy value against his dynasty consensus rank, flagging players
              trending meaningfully above or below where experts have them ranked. Tap a player for
              game logs, category breakdowns, and full contract-year detail; use Build a trade to
              compare multiple players&apos; dynasty value side by side.
            </p>
            <p style={{ marginTop: 12 }}>
              Rosters, salaries, and stats are drawn from real box-score data and updated as trades,
              signings, and contract options are reported — a team missing a recent move reflects a
              pending data update, not a permanent gap.
            </p>
          </section>
        </div>
      </div>

      {/* iPad landscape only: dimmed backdrop behind the pop-up below,
          click to dismiss — same mechanism as draft-board's
          .db-detail-modal-backdrop. Portrait/phone don't get one (their
          full-screen aside has nothing behind it to dim); desktop's
          persistent rail obviously doesn't either. */}
      {isLandscapeTabletWidth && mobileDetailOpen && (
        <div
          onClick={() => setMobileDetailOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 255, background: "rgba(0,0,0,0.6)" }}
        />
      )}

      {/* ================= DETAIL PANEL ================= */}
      {/* Also always mounted on mobile now (display:none when closed) for the
          same reason as the main column above — and so its own scroll
          resets to the top fresh each time a NEW player is opened (handled
          by the effect below), rather than keeping a stale unmount/remount. */}
      <aside
        ref={detailPanelRef}
        style={
          isFullScreenOverlay
            ? { position: "fixed", inset: 0, zIndex: 250, width: "100%", height: "100%", background: "var(--rt-surface-soft)", overflow: "auto", display: mobileDetailOpen ? "block" : "none" }
            : isLandscapeTabletWidth
              ? { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 260, width: "min(600px, 90vw)", maxHeight: "85vh", borderRadius: 16, border: "1px solid var(--rt-hairline)", background: "var(--rt-surface-soft)", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.45)", display: mobileDetailOpen ? "block" : "none" }
              : { width: 392, flex: "0 0 392px", height: "100%", borderLeft: "1px solid var(--rt-hairline)", background: "var(--rt-surface-soft)", overflow: "auto" }
        }
      >
        {isFullScreenOverlay && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--rt-hairline)", background: "var(--rt-canvas)", position: "sticky", top: 0, zIndex: 1 }}>
            <button
              type="button"
              onClick={() => setMobileDetailOpen(false)}
              aria-label="Back to roster"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, border: "1px solid var(--rt-hairline)", borderRadius: 100, background: "none", color: "var(--rt-ink)", cursor: "pointer" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <span style={{ fontFamily: "var(--rt-font-sans)", fontSize: 15, fontWeight: 600, color: "var(--rt-ink)" }}>Player detail</span>
          </div>
        )}
        {/* Court hero — dark in dark mode, light in light mode, never forced dark */}
        <div style={{ position: "relative", overflow: "hidden", background: "var(--rt-hero-bg)", color: "var(--rt-hero-ink)", borderBottom: "1px solid var(--rt-hero-hairline)", padding: "26px 24px 24px" }}>
          {/* iPad landscape's pop-up close button — matches draft-board's
              ProspectDetailPanel close button (same position-on-hero
              treatment, rt- tokens instead of the sitewide ones). */}
          {isLandscapeTabletWidth && (
            <button
              type="button"
              onClick={() => setMobileDetailOpen(false)}
              aria-label="Close"
              style={{ position: "absolute", top: 14, right: 14, zIndex: 10, background: "color-mix(in srgb, var(--rt-hero-ink) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--rt-hero-ink) 20%, transparent)", color: "var(--rt-hero-ink)", borderRadius: "50%", width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}
            >✕</button>
          )}
          {TEAM_LOGO[sp.team] && (
            // eslint-disable-next-line @next/next/no-img-element -- static team wordmark from public/, sized as a background flourish
            <img
              src={`/images/nba%20team%20images/${TEAM_LOGO[sp.team]}`}
              alt=""
              width={150}
              height={150}
              style={{ position: "absolute", top: -20, right: -14, width: 150, height: 150, objectFit: "contain", opacity: 0.14, pointerEvents: "none", userSelect: "none" }}
            />
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 16, position: "relative" }}>
            <PlayerHeadshot name={sp.name} size={62} initials={initials(sp.name)} background="var(--rt-primary)" color="var(--rt-on-primary)" fontSize={23} rookie={sp.tag === "rookie"} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.4px", lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {heroName(sp.name)}
                </span>
                {dTag && (
                  <span
                    style={{
                      flex: "0 0 auto",
                      width: 20,
                      height: 20,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 999,
                      border: `1px solid ${dTag.border}`,
                      background: dTag.bg,
                      color: dTag.color,
                      fontFamily: "var(--rt-font-mono)",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {sp.tag === "rookie" ? "R" : "S"}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, color: "var(--rt-hero-ink-soft)", marginTop: 4 }}>
                {posLabel(sp.pos)} · Age {sp.age}
              </div>
              {heroTier && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 7 }}>
                  <span style={{ width: 7, height: 7, flex: "0 0 7px", borderRadius: 999, background: heroTier.color }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: heroTier.color }}>
                    Tier {sp.tier} - {singularTier(heroTier.name)}
                  </span>
                </div>
              )}
            </div>
          </div>
          {projLocked ? (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--rt-hero-hairline)" }}>
              <EdgeProPromo tone="hero" onMaybeLater={() => setMode("cur")} />
            </div>
          ) : (
            <TrendHero
              playerId={sp.id}
              season={TRENDS_SEASON}
              seasonType={TRENDS_SEASON_TYPE}
              metric={trendMetric}
              metricLabel={fvHdr}
              cur={spTrios.cur}
              prior={spTrios.prior}
              priorPrior={spTrios.priorPrior}
              consensusRank={sp.consensus}
              consensusDir={sp.dir}
              consensusDelta={sp.dirDelta}
              age={sp.age}
              isRookie={sp.tag === "soph"}
              mode={modeNow}
              prefetched={spTrend}
              tag={sp.tag}
            />
          )}
        </div>

        <div style={{ padding: "18px 18px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* CTAs — sits between the trend chart above and the 9-cat profile below */}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              className="rt-hover-primary"
              onClick={() => openCompare(sp)}
              style={{ flex: 1, height: 44, border: "none", cursor: "pointer", borderRadius: 999, background: "var(--rt-primary)", color: "var(--rt-on-primary)", fontFamily: "var(--rt-font-sans)", fontSize: 15, fontWeight: 600 }}
            >
              Compare
            </button>
          </div>

          {/* Shared Recent/Current/Prior/Projection toggle — drives the 9-cat profile below */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--rt-muted)" }}>{SEASON_LABEL[modeNow]}</span>
            <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
              <button
                type="button"
                onClick={() => setMode("recent")}
                style={{ padding: "6px 11px", border: "none", cursor: "pointer", borderRadius: 999, fontFamily: "var(--rt-font-sans)", fontSize: 12, fontWeight: 600, background: modeNow === "recent" ? "var(--rt-ink)" : "transparent", color: modeNow === "recent" ? "var(--rt-canvas)" : "var(--rt-body)" }}
              >
                Recent
              </button>
              <button
                type="button"
                onClick={() => setMode("cur")}
                style={{ padding: "6px 11px", border: "none", cursor: "pointer", borderRadius: 999, fontFamily: "var(--rt-font-sans)", fontSize: 12, fontWeight: 600, background: modeNow === "cur" ? "var(--rt-ink)" : "transparent", color: modeNow === "cur" ? "var(--rt-canvas)" : "var(--rt-body)" }}
              >
                Current
              </button>
              <button
                type="button"
                onClick={() => setMode("prior")}
                style={{ padding: "6px 11px", border: "none", cursor: "pointer", borderRadius: 999, fontFamily: "var(--rt-font-sans)", fontSize: 12, fontWeight: 600, background: modeNow === "prior" ? "var(--rt-ink)" : "transparent", color: modeNow === "prior" ? "var(--rt-canvas)" : "var(--rt-body)" }}
              >
                Prior
              </button>
              <button
                type="button"
                onClick={() => setMode("proj")}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 11px", border: "none", cursor: "pointer", borderRadius: 999, fontFamily: "var(--rt-font-sans)", fontSize: 12, fontWeight: 600, background: modeNow === "proj" ? "var(--rt-ink)" : "transparent", color: modeNow === "proj" ? "var(--rt-canvas)" : "var(--rt-body)" }}
              >
                {!PRO_UNLOCKED && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                )}
                Projection
              </button>
            </div>
          </div>

          {/* 9-category profile: ranked z-score, driven by the shared toggle above */}
          <div style={{ background: "var(--rt-canvas)", border: "1px solid var(--rt-hairline)", borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--rt-ink)" }}>9-category profile</div>
            <div style={{ fontSize: 12, color: "var(--rt-muted)", marginTop: 6 }}>
              {projLocked ? "2026–27 model projection · Edge Pro" : "Ranked high to low · z-score vs league"}
            </div>

            {spMpgBar && (
              <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 0 0" }}>
                <span style={{ width: 34, fontSize: 12, fontWeight: 600, color: "var(--rt-ink)" }}>MPG</span>
                <span style={{ position: "relative", flex: 1, height: 8, background: "var(--rt-hairline-soft)", borderRadius: 999, overflow: "hidden" }}>
                  <span style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${spMpgBar.widthPct}%`, background: spMpgBar.color, borderRadius: 999 }} />
                </span>
                <span style={{ width: 52, textAlign: "right", fontFamily: "var(--rt-font-mono)", fontSize: 12, fontWeight: 700, color: spMpgBar.color }}>
                  {spDisplayMpg!.toFixed(1)}
                </span>
              </div>
            )}

            {profile.noData ? (
              <div style={{ padding: "20px 0", textAlign: "center", color: "var(--rt-muted)", fontSize: 12, lineHeight: 1.5 }}>
                {profile.reason}
              </div>
            ) : (
              <div style={{ marginTop: 14 }}>
                {profile.rows.map((row, i) => (
                  <div
                    key={row.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      padding: "8px 0",
                      borderBottom: i < profile.rows.length - 1 ? "1px solid var(--rt-hairline-soft)" : "none",
                    }}
                  >
                    <span style={{ width: 34, fontSize: 12, fontWeight: 600, color: "var(--rt-ink)" }}>{row.label}</span>
                    <span style={{ position: "relative", flex: 1, height: 14 }}>
                      <span style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, background: "var(--rt-hairline)" }} />
                      {!projLocked && (
                        <span
                          style={{
                            position: "absolute",
                            top: "50%",
                            transform: "translateY(-50%)",
                            height: 8,
                            left: row.bar.left,
                            width: row.bar.width,
                            background: row.color,
                            borderRadius: 999,
                          }}
                        />
                      )}
                    </span>
                    <span style={{ width: 52, textAlign: "right", fontFamily: "var(--rt-font-mono)", fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: projLocked ? "var(--rt-muted-soft)" : row.color }}>
                      {projLocked ? "—" : row.stat}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {isRecent && (
              <div style={{ marginTop: 12, fontSize: 11, color: "var(--rt-muted)", lineHeight: 1.4 }}>
                Recent shows the trailing 8-week stat profile.
              </div>
            )}
          </div>

          {/* Salary & contract */}
          <div style={{ background: "var(--rt-canvas)", border: "1px solid var(--rt-hairline)", borderRadius: 16, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--rt-ink)" }}>Salary &amp; contract</span>
              {contract.status && (
                <span
                  style={{
                    fontFamily: "var(--rt-font-sans)",
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: isNewRookieScale ? "var(--dynasty-gold)" : "var(--rt-muted)",
                    border: `1px solid ${isNewRookieScale ? "var(--dynasty-gold)" : "var(--rt-hairline)"}`,
                    borderRadius: 999,
                    padding: "3px 9px",
                  }}
                >
                  {contract.status}
                </span>
              )}
            </div>
            {contract.rows.length === 0 ? (
              <div style={{ padding: "20px 0", textAlign: "center", color: "var(--rt-muted)", fontSize: 12, lineHeight: 1.5 }}>
                No salary data yet — contract terms haven&apos;t been reported.
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Contract terms</div>
                    <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 22, fontWeight: 500, letterSpacing: "-0.5px", color: "var(--rt-ink)", marginTop: 5, fontVariantNumeric: "tabular-nums" }}>
                      {contract.n} yr{contract.n > 1 ? "s" : ""} · {money(contract.total)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Avg salary</div>
                    <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 18, fontWeight: 500, color: "var(--rt-ink)", marginTop: 5, fontVariantNumeric: "tabular-nums" }}>{money(contract.avg)}</div>
                  </div>
                </div>
                <div style={{ marginTop: 18, paddingTop: 4, borderTop: "1px solid var(--rt-hairline-soft)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto 34px 74px", gap: 10, padding: "11px 0 9px" }}>
                    <span style={{ fontSize: 10, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Year</span>
                    <span style={{ fontSize: 10, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Team</span>
                    <span style={{ fontSize: 10, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center" }}>Age</span>
                    <span style={{ fontSize: 10, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right" }}>Salary</span>
                  </div>
                  {contract.rows.map((yr, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto 34px 74px", gap: 10, padding: "9px 0", borderTop: "1px solid var(--rt-hairline-soft)", alignItems: "center" }}>
                      <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 13, color: "var(--rt-ink)", fontVariantNumeric: "tabular-nums" }}>{yr.year}</span>
                      <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 13, color: "var(--rt-body)", fontVariantNumeric: "tabular-nums" }}>{yr.team}</span>
                      <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 13, color: "var(--rt-muted)", fontVariantNumeric: "tabular-nums", textAlign: "center" }}>{yr.age}</span>
                      <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 13, color: "var(--rt-ink)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                        {yr.salary}
                        {yr.estimated && (
                          <sup title="Even-split estimate" style={{ fontSize: 8, color: "var(--rt-muted)", marginLeft: 2, fontFamily: "var(--rt-font-sans)", letterSpacing: "0.03em" }}>est</sup>
                        )}
                        {yr.qo && (
                          <sup title="Qualifying offer — a real cap hold, not a negotiated salary" style={{ fontSize: 8, color: "var(--rt-muted)", marginLeft: 2, fontFamily: "var(--rt-font-sans)", letterSpacing: "0.03em" }}>QO</sup>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Rookie draft — 2026 draft class only (sp.draft is null for everyone else) */}
          {sp.draft && (
            <div style={{ background: "var(--rt-canvas)", border: "1px solid var(--rt-hairline)", borderRadius: 16, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--rt-ink)" }}>Rookie draft</span>
                {sp.draft.boardTier != null && (
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "5px 12px", borderRadius: 999, background: sp.draft.boardTierColor ?? "var(--rt-surface-strong)", color: "#0b0e14", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    Tier {sp.draft.boardTier}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "16px 28px", marginTop: 16 }}>
                <div>
                  <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: sp.draft.pick != null ? 24 : 15, fontWeight: 500, color: "var(--rt-ink)", fontVariantNumeric: "tabular-nums" }}>
                    {sp.draft.pick != null ? `#${sp.draft.pick}` : "Un-drafted"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--rt-muted)", marginTop: 4 }}>{sp.draft.year} draft pick</div>
                </div>
                {sp.draft.boardRank != null && (
                  <div>
                    <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 24, fontWeight: 500, color: "var(--rt-ink)", fontVariantNumeric: "tabular-nums" }}>#{sp.draft.boardRank}</div>
                    <div style={{ fontSize: 11, color: "var(--rt-muted)", marginTop: 4 }}>rookie board rank</div>
                  </div>
                )}
                {sp.draft.boardTierLabel && (
                  <div>
                    <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 15, fontWeight: 600, color: sp.draft.boardTierColor ?? "var(--rt-ink)" }}>{sp.draft.boardTierLabel}</div>
                    <div style={{ fontSize: 11, color: "var(--rt-muted)", marginTop: 4 }}>rookie board tier</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
    {sortProjLocked && (
      <div
        onClick={dismissProjSort}
        style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)" }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ width: 360, maxWidth: "calc(100vw - 32px)", background: "var(--rt-canvas)", border: "1px solid var(--rt-hairline)", borderRadius: 20, padding: 24, boxShadow: "0 24px 60px rgba(0,0,0,0.35)" }}
        >
          <EdgeProPromo tone="card" onMaybeLater={dismissProjSort} />
        </div>
      </div>
    )}
    {compareOpen && (
      <CompareModal
        currentTeam={team}
        currentTeamPlayers={players}
        players={compareList}
        onAdd={addToCompare}
        onRemove={removeFromCompare}
        onClose={() => setCompareOpen(false)}
        isMobile={isMobile}
      />
    )}
    </>
  );
}
