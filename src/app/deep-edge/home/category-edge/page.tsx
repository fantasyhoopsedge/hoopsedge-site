"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { LeagueAnalysis, ResolvedPlayer } from "@/lib/fantrax/analyze";
import { categoryEdges, projectRotoStandings } from "@/lib/fantrax/analyze";
import { CATEGORY_LABEL, type FheCategory } from "@/lib/fantrax/league";
import { DEFAULT_GAMES_CAP_SETTINGS, DEFAULT_LEAGUE_TAGS } from "@/lib/fantrax/league-tags";
import { FormatConfirmPrompt } from "@/lib/fantrax/format-confirm";
import {
  buildOptimalLineup, categoryTier, rankTierLabel, teamPerGameStat,
  resolveEffectiveScoring, type LineupAssignment, type LineupValueMode,
} from "@/lib/fantrax/lineup";
import {
  buildDepthWeightedProfiles, buildDepthWeightedTeamProfile, depthCaption, depthWeight,
  deriveRankingsFormat, simulateH2HCategoryStandings,
} from "@/lib/fantrax/power-rankings";
import { PlayerHeadshot } from "@/app/team-rosters/_components/roster-headshot";
import { HubShell } from "../../_components/hub-shell";
import { IconChevronLeft, IconSliders } from "../../_components/icons";
import { tierBg, tierFill } from "../../_components/tier-colors";
import { useActiveLeague } from "../../_lib/use-saved-leagues";

const TIER_COLOR: Record<string, string> = {
  promoter: "var(--rt-up)",
  passive: "#c98a1f",
  detractor: "var(--rt-down)",
};

/** Hover tooltip for the category-row headshot chips — a real, immediate
 *  tooltip rather than the native `title` attribute, which has a delay and
 *  is easy to miss entirely. */
const CHIP_TOOLTIP_CSS = `
  .de-chip { position: relative; }
  .de-chip-tooltip {
    position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%) translateY(-6px);
    background: var(--rt-ink); color: var(--rt-canvas); font-size: 11px; font-weight: 600;
    padding: 4px 9px; border-radius: 6px; white-space: nowrap; opacity: 0; pointer-events: none;
    transition: opacity 0.12s ease; z-index: 20;
  }
  .de-chip:hover .de-chip-tooltip { opacity: 1; }
`;

/** A player headshot chip in a category row — bigger than the old 26px
 *  photo (hard to make out who's who at a glance) and shows the player's
 *  name on hover via CHIP_TOOLTIP_CSS above. Shared between the starters
 *  and bench chip lists so both get the same sizing/tooltip behavior. */
function CategoryChip({ name, slot, ring, dimmed }: { name: string; slot: string; ring: string; dimmed?: boolean }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("");
  return (
    <div className="de-chip" style={{ textAlign: "center", opacity: dimmed ? 0.4 : 1 }}>
      <span className="de-chip-tooltip">{name}</span>
      <div style={{ width: 46, height: 46, borderRadius: "50%", padding: 2, border: `2px solid ${ring}` }}>
        <PlayerHeadshot name={name} size={40} initials={initials} background="var(--rt-surface-strong)" color={ring} fontSize={13} />
      </div>
      <div style={{ fontSize: 9.5, color: "var(--rt-muted)", marginTop: 3, fontFamily: "var(--rt-font-mono)" }}>{slot}</div>
    </div>
  );
}

/** 11th/12th/13th are the well-known exception to the 1st/2nd/3rd rule —
 *  handled here since ranks run up to a league's full team count. */
function ordinal(rank: number): string {
  if (rank % 100 >= 11 && rank % 100 <= 13) return `${rank}th`;
  const suffix = rank % 10 === 1 ? "st" : rank % 10 === 2 ? "nd" : rank % 10 === 3 ? "rd" : "th";
  return `${rank}${suffix}`;
}

function formatPerGame(cat: FheCategory, raw: number): string {
  return cat === "FG" || cat === "FT" ? raw.toFixed(3).replace(/^0(?=\.)/, "") : raw.toFixed(1);
}
function formatTotal(cat: FheCategory, raw: number): string {
  return cat === "FG" || cat === "FT" ? raw.toFixed(3).replace(/^0(?=\.)/, "") : Math.round(raw).toLocaleString("en-US");
}
function formatDelta(cat: FheCategory, raw: number): string {
  const sign = raw > 0 ? "+" : raw < 0 ? "" : "±";
  return cat === "FG" || cat === "FT" ? `${sign}${raw.toFixed(3).replace(/^-?0(?=\.)/, raw < 0 ? "-" : "")}` : `${sign}${raw.toFixed(1)}`;
}

const STAT_KEY: Record<FheCategory, keyof { pts: 1; fg3m: 1; reb: 1; ast: 1; stl: 1; blk: 1; tov: 1 }> = {
  PTS: "pts", FG3: "fg3m", REB: "reb", AST: "ast", STL: "stl", BLK: "blk", TO: "tov", FG: "pts", FT: "pts",
};

const VALUE_MODE_LABEL: Record<LineupValueMode, string> = {
  league: "League", nineCatV: "9-Cat", eightCatV: "8-Cat", minus1V: "Minus1V",
};

/**
 * Per-game display is the AVERAGE across the lineup's players, not the
 * team-combined sum teamPerGameStat() itself returns — matches how Ash's own
 * reference roster table reports its "Σ N TICKED" row (e.g. MIN 31.3, not a
 * ~190 combined-minutes figure). Deliberately local to Category Edge rather
 * than changing teamPerGameStat() itself: Power Rankings' Roto table uses
 * that same shared helper for genuinely team-combined per-game production
 * (its own design reference showed large combined numbers, e.g. 108.8 PTS
 * for a team), and changing its semantics would silently break that screen.
 * FG%/FT% are already a blended average inside teamPerGameStat(), not a sum
 * — dividing those again would corrupt the percentage, so they pass through.
 */
function perPlayerAverage(players: ResolvedPlayer[], cat: FheCategory): number {
  const raw = teamPerGameStat(players, cat);
  if (cat === "FG" || cat === "FT") return raw;
  return players.length > 0 ? raw / players.length : 0;
}

/** Raw (non-sign-flipped) display value for a category off a team's season
 *  totals — display only, distinct from power-rankings.ts's statValue()
 *  which sign-flips TO for W/L comparison. */
function totalsValue(statTotals: { pts: number; fg3m: number; reb: number; ast: number; stl: number; blk: number; tov: number; fg_pct: number | null; ft_pct: number | null }, cat: FheCategory): number {
  if (cat === "FG") return statTotals.fg_pct ?? 0;
  if (cat === "FT") return statTotals.ft_pct ?? 0;
  return statTotals[STAT_KEY[cat] as "pts" | "fg3m" | "reb" | "ast" | "stl" | "blk" | "tov"];
}

function CategoryEdgeContent() {
  const { saved, loading: loadingSaved } = useActiveLeague();
  const [analysis, setAnalysis] = useState<LeagueAnalysis | null>(null);
  const [error, setError] = useState("");
  const [depth, setDepth] = useState(0);
  const [statMode, setStatMode] = useState<"perGame" | "totals">("perGame");
  const [valueMode, setValueMode] = useState<LineupValueMode>("league");
  // Manual starter overrides — replaces a plain rule-out model. Forcing a
  // bench player IN makes them claim a slot before the normal best-value
  // pass runs; forcing a starter OUT excludes them entirely. A player can
  // hold at most one of these at a time (toggling clears the other).
  const [forcedIn, setForcedIn] = useState<Set<string>>(new Set());
  const [forcedOut, setForcedOut] = useState<Set<string>>(new Set());
  const [showAdjust, setShowAdjust] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const params = new URLSearchParams({
      leagueId: saved.leagueId,
      dataset: saved.settings.defaultDataset ?? "2027:projection",
      leagueType: saved.settings.leagueType ?? "redraft",
    });
    if (saved.teamId) params.set("teamId", saved.teamId);
    fetch(`/api/fantrax/league?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setAnalysis(data);
      })
      .catch((err) => setError(String(err)));
  }, [saved]);

  const format = useMemo(() => {
    if (!analysis || !saved) return null;
    return deriveRankingsFormat(analysis, {
      format: saved.settings.format ?? DEFAULT_LEAGUE_TAGS.format,
      formatConfirmed: saved.settings.formatConfirmed,
    });
  }, [analysis, saved]);

  const lineupCadence = saved?.settings.lineupCadence ?? DEFAULT_GAMES_CAP_SETTINGS.lineupCadence;
  const capPos = saved?.settings.capPos ?? DEFAULT_GAMES_CAP_SETTINGS.capPos;
  const capPosN = saved?.settings.capPosN ?? DEFAULT_GAMES_CAP_SETTINGS.capPosN;
  const capMatch = saved?.settings.capMatch ?? DEFAULT_GAMES_CAP_SETTINGS.capMatch;
  const capMatchN = saved?.settings.capMatchN ?? DEFAULT_GAMES_CAP_SETTINGS.capMatchN;

  const computed = useMemo(() => {
    if (!analysis || !analysis.myTeamId || !saved || !format || format === "unconfirmed" || format === "points") return null;
    const { league, myTeamId } = analysis;
    const { scored, positionSlots } = resolveEffectiveScoring(league, saved.settings);
    const myRoster = analysis.rosters.find((r) => r.teamId === myTeamId);
    if (!myRoster) return null;

    // Chip-level display only — real, unweighted per-player stats/z-scores,
    // so the row's headline "per-game"/"totals" numbers and player tiers
    // stay honest ("the numbers shown are real…", per the subtitle below).
    const availablePlayers = myRoster.players.filter((p) => !forcedOut.has(p.fantraxId));
    const lineup = buildOptimalLineup(availablePlayers, positionSlots, null, { valueMode, forcedIn });
    const effectiveStarters: LineupAssignment[] = [
      ...lineup.starters,
      ...lineup.bench.slice(0, depth).map((player) => ({ slot: "Flx", player })),
    ];
    const effectiveBench = lineup.bench.slice(depth);

    // Ranking-driving totals — every team's profile extended by the SAME
    // weighted depth, so +1/+2/+3 is a fair comparison, not a bonus only I
    // get. Fixes a real bug (2026-08-12): building just my own profile with
    // full-value bench additions while every other team stayed at depth 0
    // made Win% climb toward 100% the deeper you went — an ever-inflating
    // "me + N free players" against unmodified opponents, not a real signal.
    const weight = depthWeight(lineupCadence, format, capPos, capMatch);
    const profiles = buildDepthWeightedProfiles(analysis, depth, weight, { scored, positionSlots });
    const myProfileIdx = profiles.findIndex((p) => p.teamId === myTeamId);
    const myProfile = buildDepthWeightedTeamProfile(
      availablePlayers, myTeamId, myRoster.teamName, positionSlots, scored, depth, weight, null, { valueMode, forcedIn },
    );
    if (myProfileIdx >= 0) profiles[myProfileIdx] = myProfile;

    const standings = projectRotoStandings(profiles, scored);
    const edges = categoryEdges(myTeamId, profiles, standings, scored);
    const totalPoints = standings.find((s) => s.teamId === myTeamId)?.totalPoints ?? 0;
    const maxPoints = scored.length * league.teamCount;
    const top10 = edges.filter((e) => e.rank <= 10).length;

    const h2h = format === "h2hcat" ? simulateH2HCategoryStandings(profiles, scored) : null;
    const myH2H = h2h?.find((r) => r.teamId === myTeamId) ?? null;

    // League-average per category, both display modes — the "vs lg" delta.
    const leagueAvgPerGame: Partial<Record<FheCategory, number>> = {};
    const leagueAvgTotal: Partial<Record<FheCategory, number>> = {};
    for (const cat of scored) {
      leagueAvgPerGame[cat] = profiles.reduce((sum, p) => sum + perPlayerAverage(p.starters, cat), 0) / profiles.length;
      leagueAvgTotal[cat] = profiles.reduce((sum, p) => sum + totalsValue(p.statTotals, cat), 0) / profiles.length;
    }

    return {
      myRoster, lineup, effectiveStarters, effectiveBench, scored, edges, totalPoints, maxPoints, top10,
      teamCount: league.teamCount, myProfile, myH2H, leagueAvgPerGame, leagueAvgTotal,
    };
  }, [analysis, depth, saved, format, forcedIn, forcedOut, valueMode, lineupCadence, capPos, capMatch]);

  const hasLeague = Boolean(saved);

  return (
    <HubShell hasLeague={hasLeague} breadcrumb={saved ? `${saved.leagueName} · Category Edge` : "Category Edge"}>
      <Link href="/deep-edge/home" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--rt-muted)", fontSize: 13, textDecoration: "none", marginBottom: 16 }}>
        <IconChevronLeft size={14} /> Back to {saved?.leagueName ?? "home"}
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Category Edge</h1>
        <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 10.5, padding: "4px 9px", borderRadius: 100, background: "var(--rt-surface-strong)", color: "var(--rt-muted)" }}>
          {computed ? `${computed.scored.length}-CAT ${format === "roto" ? "ROTO" : "H2H"}` : "9-CAT ROTO"}
        </span>
        <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 10.5, padding: "4px 9px", borderRadius: 100, background: "var(--rt-surface-strong)", color: "var(--rt-muted)" }}>Z-SCORE WEIGHTED</span>
      </div>

      {loadingSaved || (saved && !analysis && !error) ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>Loading…</p>
      ) : error ? (
        <p style={{ color: "var(--rt-down)", fontSize: 13.5 }}>{error}</p>
      ) : !saved ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>No league connected yet.</p>
      ) : format === "unconfirmed" ? (
        <div style={{ maxWidth: 480 }}>
          <FormatConfirmPrompt
            onConfirm={(v) => {
              fetch("/api/fantrax/saved", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  leagueId: saved.leagueId, leagueName: saved.leagueName, teamId: saved.teamId, teamName: saved.teamName,
                  settings: { ...saved.settings, format: v, formatConfirmed: true },
                }),
              }).then(() => window.location.reload());
            }}
          />
        </div>
      ) : format === "points" ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>
          Category Edge is a category-by-category breakdown — it doesn&apos;t apply to points-scored leagues. Try Power Rankings instead.
        </p>
      ) : !computed ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>
          This league doesn&apos;t have your team selected — pick your team from Settings first.
        </p>
      ) : (
        <>
          <style>{CHIP_TOOLTIP_CSS}</style>
          <p style={{ color: "var(--rt-body)", fontSize: 14, margin: "0 0 24px", maxWidth: 640 }}>
            Your best {computed.lineup.starters.length}{depth > 0 ? ` +${depth}` : ""} vs every team&apos;s best lineup in {saved.leagueName}, category by category. Ranks are
            driven by z-scores; the numbers shown are real {statMode === "perGame" ? "per-game averages" : "season totals"}.
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
              {["Best", "+1", "+2", "+3", "+4", "+5"].map((label, i) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setDepth(i)}
                  style={{
                    padding: "7px 14px", border: "none", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                    background: depth === i ? "var(--rt-canvas)" : "transparent",
                    color: depth === i ? "var(--rt-ink)" : "var(--rt-muted)",
                    boxShadow: depth === i ? "0 1px 3px rgba(0,0,0,0.15)" : "none",
                  }}
                >
                  {i === 0 ? `Best ${computed.lineup.starters.length}` : label}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 12.5, color: "var(--rt-muted)", maxWidth: 420 }}>
              {depth === 0
                ? <>&quot;Best {computed.lineup.starters.length}&quot; is the lineup started weekly across your league&apos;s slots.</>
                : depthCaption(lineupCadence, format!, capPos, capMatch, capPosN, capMatchN)}
            </span>
            <div style={{ marginLeft: "auto", display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
              {(["perGame", "totals"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setStatMode(mode)}
                  style={{
                    padding: "7px 14px", border: "none", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                    background: statMode === mode ? "var(--rt-canvas)" : "transparent",
                    color: statMode === mode ? "var(--rt-ink)" : "var(--rt-muted)",
                    boxShadow: statMode === mode ? "0 1px 3px rgba(0,0,0,0.15)" : "none",
                  }}
                >
                  {mode === "perGame" ? "Per game" : "Totals"}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setShowAdjust((s) => !s)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8, height: 38, padding: "0 16px", borderRadius: 100,
                border: `1px solid ${showAdjust ? "var(--rt-primary)" : "var(--rt-hairline)"}`, background: "transparent",
                color: "var(--rt-ink)", fontWeight: 700, fontSize: 12.5, cursor: "pointer",
              }}
            >
              <IconSliders size={16} /> Adjust starters{forcedIn.size + forcedOut.size > 0 ? ` (${forcedIn.size + forcedOut.size} changed)` : ""}
            </button>
            <span style={{ fontSize: 12.5, color: "var(--rt-muted)" }}>Rank lineup by</span>
            <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
              {(Object.keys(VALUE_MODE_LABEL) as LineupValueMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setValueMode(mode)}
                  style={{
                    padding: "7px 14px", border: "none", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                    background: valueMode === mode ? "var(--rt-canvas)" : "transparent",
                    color: valueMode === mode ? "var(--rt-ink)" : "var(--rt-muted)",
                    boxShadow: valueMode === mode ? "0 1px 3px rgba(0,0,0,0.15)" : "none",
                  }}
                >
                  {VALUE_MODE_LABEL[mode]}
                </button>
              ))}
            </div>
          </div>

          {computed.lineup.unplaceable.length > 0 && (
            <div style={{ padding: "10px 16px", borderRadius: 12, background: "rgba(219,43,57,0.08)", color: "var(--rt-down)", fontSize: 12.5, marginBottom: 16 }}>
              ⚠ Can&apos;t fit {computed.lineup.unplaceable.map((p) => p.name).join(", ")} — no eligible slot left. Bench someone else first.
            </div>
          )}

          {showAdjust && (
            <div style={{ padding: 18, borderRadius: 20, background: "var(--rt-surface-soft)", marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Who&apos;s available?</div>
                  <p style={{ fontSize: 12.5, color: "var(--rt-muted)", margin: 0, maxWidth: 560 }}>
                    Tap a bench player to start them, or a starter to bench them — swap in whoever you want. We&apos;ll flag it if a pick
                    can&apos;t legally fit your league&apos;s slots.
                  </p>
                </div>
                {forcedIn.size + forcedOut.size > 0 && (
                  <button
                    type="button"
                    onClick={() => { setForcedIn(new Set()); setForcedOut(new Set()); }}
                    style={{ background: "none", border: "none", color: "var(--rt-primary)", fontWeight: 700, fontSize: 12.5, cursor: "pointer", flexShrink: 0 }}
                  >
                    Reset
                  </button>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
                {computed.myRoster.players.map((p) => {
                  const out = forcedOut.has(p.fantraxId);
                  const forced = forcedIn.has(p.fantraxId);
                  const cantFit = computed.lineup.unplaceable.some((u) => u.fantraxId === p.fantraxId);
                  // Depth-inclusive: a bench player pulled in by +1/+2/+3 counts
                  // as "in the lineup" here too, not just the base slot picks —
                  // that's what lets a chip move from grey to full as depth grows.
                  const assignment = computed.effectiveStarters.find((a) => a.player.fantraxId === p.fantraxId);
                  const inLineup = Boolean(assignment);
                  const status = out ? "Ruled out" : cantFit ? "Can't fit" : assignment ? `Starts ${assignment.slot}${forced ? " (forced)" : ""}` : "Bench";
                  const borderColor = out || cantFit ? "var(--rt-down)" : inLineup ? "var(--rt-ink)" : "var(--rt-hairline)";
                  return (
                    <button
                      key={p.fantraxId}
                      type="button"
                      onClick={() => {
                        if (forcedIn.has(p.fantraxId) || forcedOut.has(p.fantraxId)) {
                          setForcedIn((s) => { const n = new Set(s); n.delete(p.fantraxId); return n; });
                          setForcedOut((s) => { const n = new Set(s); n.delete(p.fantraxId); return n; });
                        } else if (inLineup) {
                          setForcedOut((s) => new Set(s).add(p.fantraxId));
                        } else {
                          setForcedIn((s) => new Set(s).add(p.fantraxId));
                        }
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, textAlign: "left",
                        border: `1px solid ${borderColor}`,
                        background: out || cantFit ? "rgba(219,43,57,0.06)" : "var(--rt-canvas)", cursor: "pointer",
                        opacity: out ? 0.7 : inLineup || cantFit ? 1 : 0.45,
                        filter: !out && !cantFit && !inLineup ? "grayscale(0.6)" : "none",
                      }}
                    >
                      <PlayerHeadshot name={p.name} size={42} initials={p.name.split(" ").map((w) => w[0]).slice(0, 2).join("")} background="var(--rt-surface-strong)" color="var(--rt-muted)" fontSize={13} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: out ? "line-through" : "none" }}>
                          {p.name}
                        </div>
                        <div style={{ fontSize: 11, color: out || cantFit ? "var(--rt-down)" : "var(--rt-muted)" }}>
                          {p.eligible.join(", ")} · {status}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 28 }}>
            {format === "roto" ? (
              <div style={{ padding: 18, borderRadius: 16, border: "1px solid var(--rt-hairline)" }}>
                <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 10.5, color: "var(--rt-muted)", marginBottom: 6 }}>ROTO SCORE</div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>
                  {computed.totalPoints} <span style={{ fontSize: 15, fontWeight: 400, color: "var(--rt-muted)" }}>/ {computed.maxPoints}</span>
                </div>
              </div>
            ) : computed.myH2H ? (
              <div style={{ padding: 18, borderRadius: 16, border: "1px solid var(--rt-hairline)" }}>
                <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 10.5, color: "var(--rt-muted)", marginBottom: 6 }}>WIN % · PROJECTED RECORD</div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>
                  {(computed.myH2H.winPct * 100).toFixed(1)}%{" "}
                  <span style={{ fontSize: 15, fontWeight: 400, color: "var(--rt-muted)" }}>
                    {computed.myH2H.totalWins}-{computed.myH2H.totalDraws}-{computed.myH2H.totalLosses}
                  </span>
                </div>
              </div>
            ) : null}
            <div style={{ padding: 18, borderRadius: 16, border: "1px solid var(--rt-hairline)" }}>
              <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 10.5, color: "var(--rt-muted)", marginBottom: 6 }}>TOP-10 CATS</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>
                {computed.top10} <span style={{ fontSize: 15, fontWeight: 400, color: "var(--rt-muted)" }}>/ {computed.scored.length}</span>
              </div>
            </div>
            <div style={{ padding: 18, borderRadius: 16, border: "1px solid var(--rt-hairline)" }}>
              <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 10.5, color: "var(--rt-muted)", marginBottom: 8 }}>STRONGEST 2</div>
              {computed.edges.slice(0, 2).map((e) => (
                <div key={e.category} style={{ fontSize: 13, fontWeight: 600 }}>
                  {CATEGORY_LABEL[e.category]} <span style={{ fontWeight: 400, color: tierFill(e.rank, computed.teamCount) }}>{ordinal(e.rank)} · {rankTierLabel(e.rank, computed.teamCount)}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: 18, borderRadius: 16, border: "1px solid var(--rt-hairline)" }}>
              <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 10.5, color: "var(--rt-muted)", marginBottom: 8 }}>WEAKEST 2</div>
              {computed.edges.slice(-2).reverse().map((e) => (
                <div key={e.category} style={{ fontSize: 13, fontWeight: 600 }}>
                  {CATEGORY_LABEL[e.category]} <span style={{ fontWeight: 400, color: tierFill(e.rank, computed.teamCount) }}>{ordinal(e.rank)} · {rankTierLabel(e.rank, computed.teamCount)}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 16, fontSize: 12, color: "var(--rt-muted)" }}>
            <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: TIER_COLOR.promoter, marginRight: 5 }} />Promoter</span>
            <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: TIER_COLOR.passive, marginRight: 5 }} />Passive</span>
            <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: TIER_COLOR.detractor, marginRight: 5 }} />Detractor</span>
            <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", border: "1px solid var(--rt-hairline)", marginRight: 5 }} />Not in lineup</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {computed.edges.map((edge) => {
              const raw = statMode === "perGame"
                ? perPlayerAverage(computed.effectiveStarters.map((a) => a.player), edge.category)
                : totalsValue(computed.myProfile.statTotals, edge.category);
              const display = statMode === "perGame" ? formatPerGame(edge.category, raw) : formatTotal(edge.category, raw);
              const avg = statMode === "perGame" ? computed.leagueAvgPerGame[edge.category] : computed.leagueAvgTotal[edge.category];
              const delta = avg != null ? raw - avg : null;
              return (
                <div key={edge.category} style={{ display: "flex", alignItems: "center", gap: 20, padding: "16px 0", borderTop: "1px solid var(--rt-hairline)", flexWrap: "wrap" }}>
                  <div style={{ width: 90, flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{CATEGORY_LABEL[edge.category]}</div>
                    <div style={{ fontSize: 10.5, color: "var(--rt-muted)", fontFamily: "var(--rt-font-mono)" }}>{statMode === "perGame" ? "PER GAME" : "TOTAL"}</div>
                  </div>
                  <div style={{ width: 100, flexShrink: 0 }}>
                    <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 20, fontWeight: 700 }}>{display}</div>
                    {delta != null && (
                      <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 11, color: delta >= 0 ? "var(--rt-up)" : "var(--rt-down)" }}>
                        {formatDelta(edge.category, delta)} vs lg
                      </div>
                    )}
                  </div>
                  <div style={{ width: 130, flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      {ordinal(edge.rank)}{" "}
                      <span style={{ fontWeight: 400, color: "var(--rt-muted)" }}>of {computed.teamCount}</span>
                    </div>
                    <span
                      style={{
                        display: "inline-block", marginTop: 3, fontSize: 10.5, fontFamily: "var(--rt-font-mono)", fontWeight: 700,
                        padding: "2px 7px", borderRadius: 100,
                        background: tierBg(edge.rank, computed.teamCount), color: tierFill(edge.rank, computed.teamCount),
                      }}
                    >
                      {rankTierLabel(edge.rank, computed.teamCount).toUpperCase()}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 14, flex: 1 }}>
                    {[...computed.effectiveStarters]
                      .sort((a, b) => (b.player.cats[edge.category] ?? -Infinity) - (a.player.cats[edge.category] ?? -Infinity))
                      .map((a) => {
                        const tier = categoryTier(a.player.cats[edge.category]);
                        const ring = tier ? TIER_COLOR[tier] : "var(--rt-hairline)";
                        return <CategoryChip key={a.player.fantraxId} name={a.player.name} slot={a.slot} ring={ring} />;
                      })}
                    {[...computed.effectiveBench]
                      .sort((a, b) => (b.cats[edge.category] ?? -Infinity) - (a.cats[edge.category] ?? -Infinity))
                      .slice(0, 6)
                      .map((p) => (
                        <CategoryChip key={p.fantraxId} name={p.name} slot={p.slot} ring="var(--rt-hairline)" dimmed />
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </HubShell>
  );
}

export default function CategoryEdgePage() {
  return (
    <Suspense fallback={null}>
      <CategoryEdgeContent />
    </Suspense>
  );
}
