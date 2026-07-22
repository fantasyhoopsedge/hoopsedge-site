"use client";

import { Component, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { normalizePlayerName } from "@/lib/dynasty-rankings";
import { TEAM_LOGO, type Player } from "./roster-data";
import { initials, shortName } from "./roster-helpers";
import { PlayerHeadshot } from "./roster-headshot";

/**
 * A render-time throw anywhere in DepthChartBody would otherwise be caught
 * by the ROUTE-level error.tsx (see src/app/error.tsx), which takes over the
 * entire page with a full-screen "Something went wrong" card — not a silent
 * gap where the chart used to be. If that's not what users are seeing, this
 * boundary is what would tell us: it confines the failure to just this
 * component and prints the real error message instead of nothing.
 */
export class DepthChartErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("Depth chart render error:", error);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "32px 4px", fontSize: 14, color: "var(--rt-down)" }}>
          Depth chart failed to render: {this.state.error.message || String(this.state.error)}
        </div>
      );
    }
    return this.props.children;
  }
}

type DepthChartRow = {
  player: string;
  pos: string;
  tier: string;
  projMpg: number | null;
  projGames: number | null;
  usg: number | null;
};

// Display order + heading for each tier bucket. "cut" is excluded entirely —
// the API route already filters those rows out (see /api/nba/depth-chart).
const GROUP_ORDER: { tier: string; heading: string }[] = [
  { tier: "starter", heading: "Starters" },
  { tier: "rotation", heading: "Rotation" },
  { tier: "reserve", heading: "Reserves" },
  { tier: "fringe", heading: "Fringe" },
];

// Usage-role tags (Stage 1 role-context tier — see src/lib/role-context-store.ts).
// /api/nba/role-context only ever returns players whose tier differs from the
// "no_change" default, so any hit here is itself the "there's a change" signal.
const USAGE_TAG_META: Record<string, { label: string; glyph: string; color: string }> = {
  won_job: { label: "Won job", glyph: "▲", color: "var(--rt-up)" },
  expanded: { label: "Expanded", glyph: "▲", color: "var(--rt-up)" },
  reduced: { label: "Reduced", glyph: "▼", color: "var(--rt-down)" },
  clear_backup: { label: "Clear backup", glyph: "▼", color: "var(--rt-down)" },
};

// Single source of truth for every column's width, shared by the header row
// and every data row — generating both from the same array is what actually
// guarantees they can't drift out of alignment (two separate hard-coded
// copies is exactly how they drifted before: a label needing more room than
// its column, or a minWidth set on one row type but not the other).
// grow is always 0 (nothing stretches to fill leftover space — that's what
// left a dead gap after short names); shrink:1 on player is a safety valve
// for real narrow phones, not something that should normally kick in.
// No dedicated "Signal" column — see the Player cell below for why.
const COL_GAP = 14;
const COLS = {
  pos: { basis: 32, min: 32, grow: 0, shrink: 0, align: "left" as const },
  player: { basis: 168, min: 120, grow: 0, shrink: 1, align: "left" as const },
  mpg: { basis: 42, min: 36, grow: 0, shrink: 0, align: "right" as const },
  gp: { basis: 30, min: 26, grow: 0, shrink: 0, align: "right" as const },
  usg: { basis: 38, min: 32, grow: 0, shrink: 0, align: "right" as const },
};
type ColKey = keyof typeof COLS;
const colFlex = (key: ColKey): CSSProperties => {
  const c = COLS[key];
  return { flex: `${c.grow} ${c.shrink} ${c.basis}px`, minWidth: c.min, boxSizing: "border-box" };
};

// Position color-coding — deliberately not green/red (those already mean
// up/down usage signal on this same view).
const POS_COLOR: { id: "G" | "F" | "C"; color: string }[] = [
  { id: "G", color: "#3b82f6" },
  { id: "F", color: "#a78bfa" },
  { id: "C", color: "#00c8e0" },
];
const posColorFor = (pos: string): string => POS_COLOR.find((p) => pos.toUpperCase().includes(p.id))?.color ?? "var(--rt-muted)";

/** Position badge as an outlined circle — a transparent tint fill + colored
 * ring, not a filled pill. */
function PosCircle({ pos }: { pos: string }) {
  const color = posColorFor(pos);
  return (
    <span
      style={{
        flex: "0 0 32px",
        width: 32,
        height: 32,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        border: `1.5px solid ${color}`,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        color,
        fontSize: pos.length > 2 ? 9 : 12,
        fontWeight: 800,
      }}
    >
      {pos}
    </span>
  );
}

/** The actual depth-chart content: tier subheadings (Starters/Rotation/
 * Reserves/Fringe) instead of a per-row role label, circular position
 * badges (clickable as filters), separate MPG/GP columns (no combined
 * "33.0 / 65g" string), and a large team-logo watermark behind the
 * Starters block. Pure content, no chrome, and no artificial width cap —
 * it fills whatever width its container gives it, same as everything else
 * on the page. The two call sites wrap it differently:
 *   - DepthChartModal (desktop/tablet): backdrop + card + pinned header.
 *   - DepthChartInline (mobile): swapped in for the roster list, no backdrop.
 */
export function DepthChartBody({
  team,
  teamName,
  players,
}: {
  team: string;
  teamName: string;
  players: Player[];
}) {
  const [rows, setRows] = useState<DepthChartRow[] | null>(null);
  const [error, setError] = useState(false);
  // Usage-role tags, keyed by normalizePlayerName — only players with a
  // non-default tier are ever present (see /api/nba/role-context). Fetched
  // separately from the depth-chart rows and failed-open (an empty map just
  // means no tags render) since it's a supplementary signal, not core data.
  const [roleTagMap, setRoleTagMap] = useState<Record<string, string>>({});
  // TEMP DEBUG (remove once the iPhone "loads then goes blank" report is
  // resolved — see PR #23 follow-up): every code path below already renders
  // visible text, and the route-level error.tsx isn't firing either, so a
  // render crash doesn't explain a silent blank. This is a plain on-screen
  // trace of fetch outcomes so it can be read directly off a phone screen
  // with no devtools access, instead of guessing further.
  const [debugTrace, setDebugTrace] = useState("mounted, fetch pending");

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(false);
    setRoleTagMap({});
    setDebugTrace(`effect ran for team=${team}`);

    fetch(`/api/nba/depth-chart?team=${team}`)
      .then((r) => {
        // A redirected/non-OK response (e.g. Vercel Deployment Protection
        // bouncing an unauthenticated preview session to vercel.com/sso-api)
        // isn't JSON — .json() would throw with no useful detail. Logging the
        // actual status here is what makes that failure mode diagnosable
        // instead of just reading as "nothing happened".
        if (!cancelled) setDebugTrace(`depth-chart HTTP ${r.status}${r.redirected ? ` (redirected to ${r.url})` : ""}`);
        if (!r.ok) {
          console.error(`/api/nba/depth-chart -> ${r.status}${r.redirected ? ` (redirected to ${r.url})` : ""}`);
        }
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        if (d.error) {
          setDebugTrace(`depth-chart API returned error: ${d.error}`);
          setError(true);
          return;
        }
        setDebugTrace(`depth-chart OK, ${(d.rows ?? []).length} rows`);
        setRows(d.rows ?? []);
      })
      .catch((err) => {
        console.error("Failed to load depth chart:", err);
        if (!cancelled) {
          setDebugTrace(`fetch threw: ${err instanceof Error ? err.message : String(err)}`);
          setError(true);
        }
      });

    fetch(`/api/nba/role-context?team=${team}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || d.error) return;
        const map: Record<string, string> = {};
        for (const row of d.rows ?? []) map[normalizePlayerName(row.player)] = row.tier;
        setRoleTagMap(map);
      })
      .catch(() => {
        // supplementary — a failed fetch just means no tags render
      });

    return () => {
      cancelled = true;
    };
  }, [team]);

  const playerByKey = new Map(players.map((p) => [normalizePlayerName(p.name), p]));

  // Position/class filtering happens upstream now, not here — the caller
  // passes `players` already filtered by the page's own All/G/F/C/Rookies/
  // Sophomores/Veterans pills (see roster-app.tsx's `list`), so a row is
  // visible exactly when its player survived that filter. This replaces a
  // second, duplicate G/F/C-only filter bar that used to live on this
  // component — same controls, shown twice, was just clutter.
  const filteredRows = (rows ?? []).filter((r) => playerByKey.has(normalizePlayerName(r.player)));

  const grouped = GROUP_ORDER.map((g) => ({
    ...g,
    rows: filteredRows.filter((r) => r.tier === g.tier).sort((a, b) => (b.projMpg ?? 0) - (a.projMpg ?? 0)),
  })).filter((g) => g.rows.length > 0);

  const logoFile = TEAM_LOGO[team];
  const logoSrc = logoFile ? `/images/nba%20team%20images/${logoFile}` : null;

  // TEMP DEBUG — see the note by setDebugTrace above. Renders unconditionally,
  // above every other branch, so it's visible even if something below it were
  // to somehow produce nothing: proof-of-mount plus the exact fetch outcome,
  // readable straight off a phone screen.
  const debugBanner = (
    <div style={{ padding: "6px 4px", fontSize: 10, fontFamily: "monospace", color: "var(--rt-primary)", wordBreak: "break-word" }}>
      DEBUG: {debugTrace}
    </div>
  );

  if (rows === null && !error) {
    return (
      <>
        {debugBanner}
        <div style={{ padding: "32px 4px", fontSize: 14, color: "var(--rt-muted)" }}>Loading depth chart…</div>
      </>
    );
  }
  if (error) {
    return (
      <>
        {debugBanner}
        <div style={{ padding: "32px 4px", fontSize: 14, color: "var(--rt-down)" }}>Couldn&apos;t load the depth chart.</div>
      </>
    );
  }

  const colHeader = (key: ColKey, label: string) => (
    <div
      style={{
        ...colFlex(key),
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        textAlign: COLS[key].align,
        fontSize: 12,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: "var(--rt-body-strong)",
        fontWeight: 800,
      }}
    >
      {label}
    </div>
  );

  return (
    <>
      {debugBanner}
      {grouped.length === 0 && (
        <div style={{ padding: "32px 4px", fontSize: 14, color: "var(--rt-muted)" }}>
          {(rows ?? []).length === 0 ? `No published depth chart yet for ${teamName}.` : "No players match the current filters."}
        </div>
      )}

      {grouped.length > 0 && (
        // marginBottom is deliberate, not left to the parent's flex gap alone —
        // a dense multi-tier card ending right up against the next section's
        // text read as cramped even with that gap in place.
        <div style={{ border: "1px solid var(--rt-hairline)", borderRadius: 16, overflow: "hidden", marginBottom: 24 }}>
          {/* justifyContent:"center" — every row shares the same fixed column
              widths (Player included, no longer flex-growing), so on a card
              wider than the row actually needs, the whole compact row centers
              as one balanced unit instead of hugging the left edge with a
              lopsided empty margin on the right. */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: COL_GAP, padding: "12px 16px", background: "var(--rt-surface-strong)" }}>
            {colHeader("pos", "")}
            {colHeader("player", "Player")}
            {colHeader("mpg", "MPG")}
            {colHeader("gp", "GP")}
            {colHeader("usg", "USG")}
          </div>

          {grouped.map((g) => (
            <div key={g.tier} style={{ position: "relative" }}>
              <div
                style={{
                  padding: "14px 14px 6px",
                  fontSize: 13,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--rt-primary)",
                }}
              >
                {g.heading}
              </div>

              {/* Team-logo watermark, sized to ~40% of the section's width —
                  only behind the Starters block, faint enough to sit behind text. */}
              {g.tier === "starter" && logoSrc && (
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    pointerEvents: "none",
                    zIndex: 0,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- static team wordmark from public/ */}
                  <img src={logoSrc} alt="" style={{ width: "40%", height: "90%", objectFit: "contain", opacity: 0.1 }} />
                </div>
              )}

              <div style={{ position: "relative", zIndex: 1 }}>
                {g.rows.map((r) => {
                  const p = playerByKey.get(normalizePlayerName(r.player));
                  const displayName = p?.name ?? r.player;
                  // The depth-chart source's own `pos` can be a stale single
                  // letter (e.g. "G") where the roster's canonical position
                  // for that player is a combo (e.g. "G/F") — prefer the
                  // roster's value whenever the player is matched, so this
                  // view doesn't silently disagree with the rest of the page.
                  const displayPos = p?.pos ?? r.pos;
                  const tagTier = roleTagMap[normalizePlayerName(r.player)];
                  const tagMeta = tagTier ? USAGE_TAG_META[tagTier] : null;
                  return (
                    <div
                      key={r.player}
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: COL_GAP, padding: "13px 16px", borderTop: "1px solid var(--rt-hairline-soft)" }}
                    >
                      <div style={colFlex("pos")}>
                        <PosCircle pos={displayPos} />
                      </div>
                      <div style={{ ...colFlex("player"), display: "flex", alignItems: "center", gap: 10 }}>
                        <PlayerHeadshot
                          name={displayName}
                          size={30}
                          initials={initials(displayName)}
                          background="var(--rt-surface-strong)"
                          color="var(--rt-ink)"
                          fontSize={11}
                          rookie={p?.tag === "rookie"}
                        />
                        {/* Name + usage-signal badge stack vertically here instead
                            of Signal getting its own column. A column reserved for
                            Signal costs every row that width whether or not it has
                            a tag — most don't — and it's exactly the horizontal
                            room a real phone doesn't have to spare. Stacking uses
                            vertical space instead (abundant, and only the ~4-5
                            tagged rows pay for it) and happens to fill the space
                            under short names that used to just sit empty. */}
                        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--rt-ink)", lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {shortName(displayName)}
                          </span>
                          {tagMeta && (
                            <span
                              title={`Usage signal: ${tagMeta.label}`}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 3,
                                alignSelf: "flex-start",
                                padding: "1px 6px",
                                borderRadius: 999,
                                border: `1px solid ${tagMeta.color}`,
                                background: `color-mix(in srgb, ${tagMeta.color} 12%, transparent)`,
                                color: tagMeta.color,
                                fontSize: 9,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.02em",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {tagMeta.glyph} {tagMeta.label}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ ...colFlex("mpg"), textAlign: "right", fontSize: 14, fontWeight: 600, fontFamily: "var(--rt-font-mono)", color: "var(--rt-ink)", fontVariantNumeric: "tabular-nums" }}>
                        {r.projMpg != null ? r.projMpg.toFixed(1) : "—"}
                      </div>
                      <div style={{ ...colFlex("gp"), textAlign: "right", fontSize: 14, fontWeight: 600, fontFamily: "var(--rt-font-mono)", color: "var(--rt-ink)", fontVariantNumeric: "tabular-nums" }}>
                        {r.projGames != null ? Math.round(r.projGames) : "—"}
                      </div>
                      <div style={{ ...colFlex("usg"), textAlign: "right", fontSize: 14, fontWeight: 600, fontFamily: "var(--rt-font-mono)", color: "var(--rt-ink)", fontVariantNumeric: "tabular-nums" }}>
                        {r.usg != null ? r.usg.toFixed(1) : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
