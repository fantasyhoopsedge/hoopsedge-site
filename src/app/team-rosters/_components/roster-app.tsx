"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CATS,
  DYNASTY_TIER_META,
  STATSET_COLORS,
  STATSET_DEFS,
  TEAM_LOGO,
  TEAMS,
  type FvMetric,
  type Player,
  type SeasonMode,
  type SortKey,
} from "./roster-data";
import {
  buildRankedProfile,
  caret,
  catValCur,
  catValPrior,
  catZ,
  changeColor,
  contractFor,
  fvOf,
  fvValue,
  heroName,
  initials,
  money,
  ordinal,
  posLabel,
  projSeasonVal,
  shortName,
  singularTier,
  starTier,
  tagBadge,
  zFor,
} from "./roster-helpers";
import { PlayerHeadshot } from "./roster-headshot";
import { TrendHero, type TrendMetric } from "./player-trend-chart";
import { TAG_META, type TrendTag } from "./trend-insight";
import { CompareModal } from "./compare-modal";

// hoopR stat season for the trend chart (2026 = the 2025-26 season) — matches
// roster-live-data.ts's STATS_SEASON; this page has no season switcher yet.
const TRENDS_SEASON = 2026;
const TRENDS_SEASON_TYPE = "regular";
const TREND_METRIC: Record<FvMetric, TrendMetric> = { minus1: "minus1V", ninecat: "nineCatV", eightcat: "eightCatV" };

// Edge Pro (season comparison / projections) hasn't shipped yet — locked for everyone.
const PRO_UNLOCKED = false;
// Highlight the top-5 dynasty-consensus players on the roster with the accent plate.
const ACCENT_RANK = 5;
// Projected 2026-27 luxury tax line, for the payroll summary card.
const TAX_LINE = 200_400_000;

// Compare modal: up to 4 players, persisted across page navigation.
const MAX_COMPARE = 4;
const COMPARE_STORAGE_KEY = "fhe-compare-players";

const FV_HEADER: Record<FvMetric, string> = { minus1: "Minus1V", ninecat: "9CatV", eightcat: "8CatV" };
const SEASON_LABEL: Record<SeasonMode, string> = { cur: "2025–26", prior: "2024–25", proj: "2026–27 proj." };

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
  // Position/status filter pills are multi-select (toggle on/off, OR'd
  // together) rather than single-select — "all" is a special value that
  // means "no specific filter," auto-restored whenever the last specific
  // filter is deselected, and cleared the moment any specific filter is picked.
  const [posFilters, setPosFilters] = useState<Set<string>>(new Set(["all"]));
  function togglePosFilter(id: string) {
    setPosFilters((prev) => {
      if (id === "all") return new Set(["all"]);
      const next = new Set(prev);
      next.delete("all");
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next.size === 0 ? new Set(["all"]) : next;
    });
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
    if (isMobile) setMobileDetailOpen(true);
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

  const posFilterDefs = [
    { id: "all", label: "All players" },
    { id: "G", label: "Guards" },
    { id: "F", label: "Forwards" },
    { id: "C", label: "Centers" },
    { id: "rook", label: "Rookies" },
    { id: "soph", label: "Sophomores" },
  ];

  let list = players.filter((p) => {
    const posOk =
      posFilters.has("all") ||
      Array.from(posFilters).some((id) => (id === "rook" ? p.tag === "rookie" : id === "soph" ? p.tag === "soph" : p.group === id));
    const qOk = !qLower || p.name.toLowerCase().includes(qLower);
    return posOk && qOk;
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
    const statSet = STATSET_DEFS.map((d) => {
      const cat = CATS.find((c) => c.key === d.key)!;
      const tier = starTier(catValCur(p, cat));
      return { label: d.label, color: STATSET_COLORS[tier] };
    });
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
      statSet,
      tag,
      tagShort: p.tag === "rookie" ? "R" : p.tag === "soph" ? "S" : "",
      salary: money(p.salary),
      keyVal: sortProjLocked ? "—" : sort === "dynasty" ? "#" + p.consensus : sort === "salary" ? money(p.salary) : fvRankStr,
      keyLabel: sortProjLocked ? "" : sort === "dynasty" ? "Dynasty rank" : sort === "salary" ? "Cap hit" : fvHdr + " rank",
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
  const isProj = modeNow === "proj";
  const isPrior = modeNow === "prior";
  const projLocked = isProj && !PRO_UNLOCKED;
  const gamesLine = isProj ? "Model projection · per game 2026–27" : isPrior ? "Per game · 2024–25" : "Per game · 2025–26";
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
  const hasCurrentSample = sp.gp > 0;
  const noProfileData =
    (isPrior && sp.priorGp === 0) ||
    (isProj && !hasCurrentSample) ||
    (modeNow === "cur" && sp.catVals.length === 0 && !hasCurrentSample);
  const noDataReason = isPrior ? "No 2024–25 games on record" : "No 2025–26 games logged yet";
  // Current mode only: show movement vs. the real 2024-25 line, so a look at
  // "now" also reads as "up/down from last year" without switching tabs.
  const showPriorCompare = modeNow === "cur" && sp.priorGp > 0;
  const valForStat = (c: (typeof CATS)[number]) => (isProj ? projSeasonVal(sp, c) : isPrior ? (sp.priorPg?.[c.key] ?? 0) : sp.pg[c.key]);
  const fmtStat = (c: (typeof CATS)[number]) => {
    const v = valForStat(c);
    if (c.key === "fgp" || c.key === "ftp") return (v * 100).toFixed(1) + "%";
    return v.toFixed(1);
  };
  const zOf = (c: (typeof CATS)[number]) => (modeNow === "cur" ? catValCur(sp, c) : isPrior ? catValPrior(sp, c) : zFor(c, valForStat(c)));
  const zBg = (c: (typeof CATS)[number]) => {
    const z = zOf(c);
    if (z >= 1.25) return "rgba(22,160,106,0.18)";
    if (z >= 0.5) return "rgba(22,160,106,0.09)";
    if (z <= -1.25) return "rgba(219,43,57,0.16)";
    if (z <= -0.5) return "rgba(219,43,57,0.08)";
    return "transparent";
  };
  // vs. 2024-25 delta for the season-stats grid, e.g. "▲2.6%" / "▼0.5". Sign
  // of "improved" flips for TO (lower is better) so the color reads correctly.
  const deltaFor = (c: (typeof CATS)[number]): { text: string; color: string } | null => {
    if (!showPriorCompare) return null;
    const isPct = c.key === "fgp" || c.key === "ftp";
    const diff = valForStat(c) - (sp.priorPg![c.key] ?? 0);
    const shown = isPct ? diff * 100 : diff;
    if (Math.abs(shown) < 0.05) return null; // negligible float noise, not a real move
    const improved = c.invert ? diff < 0 : diff > 0;
    return {
      text: `${diff >= 0 ? "▲" : "▼"}${Math.abs(shown).toFixed(1)}${isPct ? "%" : ""}`,
      color: improved ? "var(--rt-up)" : "var(--rt-down)",
    };
  };
  const statRows = CATS.map((c) => ({ label: c.label, value: fmtStat(c), bg: projLocked ? "transparent" : zBg(c), delta: deltaFor(c) }));

  // 9-cat profile math (row order anchored to Current mode, z/color/bar per
  // row) lives in buildRankedProfile() so the single-player panel here and
  // every card in the compare modal share one implementation.
  const profile = buildRankedProfile(sp, modeNow);

  const contract = contractFor(sp);
  const dTag = sp.tag ? tagBadge(sp.tag, true) : null;

  // Tier is shown persistently in the hero header regardless of sort — this is
  // the single lookup both that tag and the "Dynasty tier" sort view share.
  const heroTier = sp.tier != null ? DYNASTY_TIER_META[sp.tier] ?? null : null;

  const trendMetric = TREND_METRIC[activeMetric];

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
  const listGridCols = "minmax(210px,1.4fr) 40px 36px minmax(80px,0.95fr) minmax(90px,1fr) minmax(90px,1fr) minmax(262px,1.7fr)";

  return (
    <>
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
      {/* ================= MAIN COLUMN ================= */}
      {(!isMobile || !mobileDetailOpen) && (
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
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
          {/* Summary cards */}
          <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(3, 1fr) 1.25fr", gap: isMobile ? 12 : 16 }}>
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

          {/* Position filters */}
          <div style={{ flexShrink: 0, display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", gap: isMobile ? 10 : 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: isMobile ? "wrap" : "nowrap" }}>
              {posFilterDefs.map((pf) => {
                const on = posFilters.has(pf.id);
                return (
                  <button
                    key={pf.id}
                    type="button"
                    onClick={() => togglePosFilter(pf.id)}
                    style={{
                      flexShrink: 0,
                      padding: "9px 18px",
                      border: "none",
                      cursor: "pointer",
                      borderRadius: 999,
                      fontFamily: "var(--rt-font-sans)",
                      fontSize: 14,
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
              {!isMobile && (
                <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--rt-muted)" }}>
                  {cards.length} of {players.length} players
                </span>
              )}
              {!isMobile && (
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

          {/* Player grid */}
          {!isMobile && viewMode === "grid" && (
            <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
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
                      <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 18, fontWeight: 500, color: "var(--rt-ink)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{c.keyVal}</div>
                      <div style={{ fontSize: 11, color: "var(--rt-muted)", marginTop: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>{c.keyLabel}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "var(--rt-font-mono)", fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: c.fvToneColor }}>
                        <span style={{ fontSize: 10 }}>{c.fvToneArrow}</span>
                        {c.fvVerdict}
                      </span>
                      <div style={{ fontSize: 11, color: "var(--rt-muted)", marginTop: 5 }}>{fvHdr} verdict</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Player list */}
          {!isMobile && viewMode === "list" && (
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
                  <span style={{ fontFamily: "var(--rt-font-sans)", fontSize: 10, fontWeight: 600, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Stat set</span>
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
                    <div style={{ display: "flex", flexWrap: "nowrap", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
                      {c.statSet.map((s, i) => (
                        <span key={i} style={{ fontFamily: "var(--rt-font-mono)", fontSize: 12, fontWeight: 600, color: s.color }}>
                          {s.label}
                        </span>
                      ))}
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
        </div>
      </div>
      )}

      {/* ================= DETAIL PANEL ================= */}
      {(!isMobile || mobileDetailOpen) && (
      <aside
        style={
          isMobile
            ? { position: "fixed", inset: 0, zIndex: 250, width: "100%", height: "100%", background: "var(--rt-surface-soft)", overflow: "auto" }
            : { width: 392, flex: "0 0 392px", height: "100%", borderLeft: "1px solid var(--rt-hairline)", background: "var(--rt-surface-soft)", overflow: "auto" }
        }
      >
        {isMobile && (
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
              rank={poolRankOf(sp, activeMetric)}
              consensusRank={sp.consensus}
              consensusDir={sp.dir}
              age={sp.age}
              gamesPlayed={sp.gp}
              mpg={sp.mpg}
              isRookie={sp.tag === "soph"}
            />
          )}
        </div>

        <div style={{ padding: "18px 18px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Shared Current/Prior/Projection toggle — drives both the 9-cat profile and season stats below */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--rt-muted)" }}>{SEASON_LABEL[modeNow]}</span>
            <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
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

            {profile.noData ? (
              <div style={{ padding: "20px 0", textAlign: "center", color: "var(--rt-muted)", fontSize: 12, lineHeight: 1.5 }}>
                {noDataReason} — {isProj ? "2026–27 projection" : isPrior ? "2024–25 profile" : "profile"} unavailable.
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
                    <span style={{ width: 46, textAlign: "right", fontFamily: "var(--rt-font-mono)", fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: projLocked ? "var(--rt-muted-soft)" : row.color }}>
                      {projLocked ? "—" : (row.z >= 0 ? "+" : "−") + Math.abs(row.z).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Season stats — driven by the shared toggle above */}
          <div style={{ background: "var(--rt-canvas)", border: "1px solid var(--rt-hairline)", borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--rt-ink)" }}>Season stats</div>
            <div style={{ fontSize: 12, color: "var(--rt-muted)", marginTop: 6 }}>{gamesLine}</div>
            {noProfileData ? (
              <div style={{ padding: "20px 0", textAlign: "center", color: "var(--rt-muted)", fontSize: 12, lineHeight: 1.5 }}>
                {noDataReason} — {isProj ? "2026–27 projection" : isPrior ? "2024–25 stat line" : "stat line"} unavailable.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 8px", marginTop: 18 }}>
                {statRows.map((row) => (
                  <div key={row.label}>
                    <div style={{ lineHeight: 1, display: "flex", alignItems: "baseline", gap: 5, flexWrap: "wrap" }}>
                      <span style={{ display: "inline-block", padding: "5px 9px", marginLeft: -9, borderRadius: 8, background: row.bg, fontFamily: "var(--rt-font-mono)", fontSize: 20, fontWeight: 500, color: projLocked ? "var(--rt-muted-soft)" : "var(--rt-ink)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                        {projLocked ? "—" : row.value}
                      </span>
                      {row.delta && !projLocked && (
                        <span
                          title="vs. 2024–25"
                          style={{ fontFamily: "var(--rt-font-mono)", fontSize: 11, fontWeight: 700, color: row.delta.color, fontVariantNumeric: "tabular-nums" }}
                        >
                          {row.delta.text}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--rt-muted)", marginTop: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>{row.label}</div>
                  </div>
                ))}
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
                    color: "var(--rt-muted)",
                    border: "1px solid var(--rt-hairline)",
                    borderRadius: 999,
                    padding: "3px 9px",
                  }}
                >
                  {contract.status}
                </span>
              )}
            </div>
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
          </div>

          {/* Rookie draft */}
          {sp.draft && (
            <div style={{ background: "var(--rt-canvas)", border: "1px solid var(--rt-hairline)", borderRadius: 16, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--rt-ink)" }}>Rookie draft</span>
                <span style={{ display: "inline-flex", alignItems: "center", padding: "5px 12px", borderRadius: 999, background: "var(--rt-surface-strong)", color: "var(--rt-primary)", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  Tier {sp.draft.tier}
                </span>
              </div>
              <div style={{ display: "flex", gap: 28, marginTop: 16 }}>
                <div>
                  <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 24, fontWeight: 500, color: "var(--rt-ink)", fontVariantNumeric: "tabular-nums" }}>#{sp.draft.pick}</div>
                  <div style={{ fontSize: 11, color: "var(--rt-muted)", marginTop: 4 }}>{sp.draft.year} draft pick</div>
                </div>
                <div>
                  <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 24, fontWeight: 500, color: "var(--rt-ink)", fontVariantNumeric: "tabular-nums" }}>#{sp.consensus}</div>
                  <div style={{ fontSize: 11, color: "var(--rt-muted)", marginTop: 4 }}>rookie board rank</div>
                </div>
              </div>
            </div>
          )}

          {/* CTAs */}
          <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
            <button
              type="button"
              className="rt-hover-primary"
              onClick={() => openCompare(sp)}
              style={{ flex: 1, height: 44, border: "none", cursor: "pointer", borderRadius: 999, background: "var(--rt-primary)", color: "var(--rt-on-primary)", fontFamily: "var(--rt-font-sans)", fontSize: 15, fontWeight: 600 }}
            >
              Compare
            </button>
          </div>
        </div>
      </aside>
      )}
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
