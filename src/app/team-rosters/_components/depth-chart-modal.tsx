"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { normalizePlayerName } from "@/lib/dynasty-rankings";
import { TEAM_LOGO, type Player } from "./roster-data";
import { initials } from "./roster-helpers";
import { PlayerHeadshot } from "./roster-headshot";

type DepthChartRow = {
  player: string;
  pos: string;
  tier: string;
  projMpg: number | null;
  projGames: number | null;
  usg: number | null;
};

// Display order + label for each tier bucket. "cut" is excluded entirely —
// the API route already filters those rows out (see /api/nba/depth-chart).
const GROUP_ORDER: { tier: string; label: string }[] = [
  { tier: "starter", label: "Starter" },
  { tier: "rotation", label: "Rotation" },
  { tier: "reserve", label: "Reserves" },
  { tier: "fringe", label: "Fringe" },
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

// Position color-coding — distinct hues pulled from the same palette already
// used for dynasty tiers (DYNASTY_TIER_META in roster-data.ts), so it reads
// as one FHE system rather than a one-off. Deliberately NOT green/red (those
// already carry the up/down usage-signal meaning on this same table).
// Combo positions ("G/F", "F/C") key off the primary (first-listed) spot.
const POS_COLOR: Record<string, string> = { G: "#3b82f6", F: "#a78bfa", C: "#00c8e0" };
const posColorFor = (pos: string): string => POS_COLOR[pos.trim().charAt(0).toUpperCase()] ?? "var(--rt-muted)";

const HEADERS: { label: string; align: "left" | "right" | "center"; width?: string }[] = [
  { label: "Role", align: "left" },
  { label: "Pos", align: "left" },
  { label: "", align: "left" },
  { label: "Player", align: "left" },
  { label: "GP", align: "right" },
  { label: "MPG", align: "right" },
  { label: "USG", align: "right" },
  { label: "Usage Signal", align: "left" },
];

// Mobile has no room for 8 columns at once (measured live: the desktop table's
// 460px min-width overflowed a 375px phone viewport, forcing a horizontal
// scrollbar the modal should never need on open). Rather than stacking two
// numbers on top of each other in tiny type, each cell folds its two data
// points onto ONE line ("Starter · G", "29.0 / 69g") so every column can run
// a normal, readable font size — the header itself names the pairing
// ("Role/Pos", "GP/MPG") instead of hiding it in a second line under a
// separate header-less column. Headshot moves into the Player cell (flex row)
// so it's not its own column either. Explicit widths (summing to 100%) since
// table-layout:fixed sizes columns off the header row's widths, not content.
const MOBILE_HEADERS: { label: string; align: "left" | "right" | "center"; width: string }[] = [
  { label: "Role/Pos", align: "left", width: "23%" },
  { label: "Player", align: "left", width: "32%" },
  { label: "MPG/GP", align: "right", width: "23%" },
  { label: "USG", align: "right", width: "12%" },
  { label: "Signal", align: "center", width: "10%" },
];

/** Pop-up depth chart for the current team, read from the published
 * /admin/depth-chart tool (projected 2026-27 role + minutes + usage — see
 * src/lib/depth-chart-store.ts). Joins by normalizePlayerName against the
 * roster's own Player[] purely for headshot art + rookie-fallback ordering;
 * every displayed number (GP/MPG/USG) comes straight from the depth-chart
 * source, so it stays internally consistent rather than mixing real
 * current-season box scores with a projected-season role chart. */
export function DepthChartModal({
  team,
  teamName,
  players,
  onClose,
  isMobile,
}: {
  team: string;
  teamName: string;
  players: Player[];
  onClose: () => void;
  isMobile: boolean;
}) {
  const [rows, setRows] = useState<DepthChartRow[] | null>(null);
  const [error, setError] = useState(false);
  // Usage-role tags, keyed by normalizePlayerName — only players with a
  // non-default tier are ever present (see /api/nba/role-context). Fetched
  // separately from the depth-chart rows and failed-open (an empty map just
  // means no tags render) since it's a supplementary signal, not core data.
  const [roleTagMap, setRoleTagMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(false);
    setRoleTagMap({});

    fetch(`/api/nba/depth-chart?team=${team}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) {
          setError(true);
          return;
        }
        setRows(d.rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setError(true);
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

  const grouped = GROUP_ORDER.map((g) => ({
    ...g,
    rows: (rows ?? [])
      .filter((r) => r.tier === g.tier)
      .sort((a, b) => (b.projMpg ?? 0) - (a.projMpg ?? 0)),
  })).filter((g) => g.rows.length > 0);

  // Faint team-logo watermark behind the Starter block specifically (not the
  // whole table) — approximate height from the starter row count since a
  // <tbody> segment can't itself be measured before render; a few px of
  // drift against real row height is fine for a decorative background.
  const logoFile = TEAM_LOGO[team];
  const logoSrc = logoFile ? `/images/nba%20team%20images/${logoFile}` : null;
  const starterCount = grouped.find((g) => g.tier === "starter")?.rows.length ?? 0;
  const headerRowH = isMobile ? 38 : 34;
  const starterRowH = isMobile ? 64 : 47;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 260, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)", padding: isMobile ? 8 : 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 100%)",
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          background: "var(--rt-canvas)",
          border: "1px solid var(--rt-hairline)",
          borderRadius: 20,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          padding: isMobile ? 12 : 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--rt-ink)" }}>Depth Chart</div>
            <div style={{ fontSize: 13, color: "var(--rt-muted)", marginTop: 2 }}>{teamName} · Projected 2026–27</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close depth chart"
            style={{ width: 36, height: 36, flex: "0 0 36px", borderRadius: 999, border: "1px solid var(--rt-hairline)", background: "none", color: "var(--rt-ink)", cursor: "pointer" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ margin: "0 auto" }} aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {rows === null && !error && (
          <div style={{ padding: "32px 4px", fontSize: 13, color: "var(--rt-muted)" }}>Loading depth chart…</div>
        )}
        {error && (
          <div style={{ padding: "32px 4px", fontSize: 13, color: "var(--rt-down)" }}>Couldn&apos;t load the depth chart.</div>
        )}
        {rows !== null && !error && grouped.length === 0 && (
          <div style={{ padding: "32px 4px", fontSize: 13, color: "var(--rt-muted)" }}>No published depth chart yet for {teamName}.</div>
        )}

        {rows !== null && !error && grouped.length > 0 && (
          <div style={{ marginTop: 16, overflowX: isMobile ? "hidden" : "auto", position: "relative" }}>
            {logoSrc && starterCount > 0 && (
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  top: headerRowH,
                  left: 0,
                  right: 0,
                  height: starterCount * starterRowH,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  pointerEvents: "none",
                  zIndex: 0,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- static team wordmark from public/ */}
                <img
                  src={logoSrc}
                  alt=""
                  style={{ width: isMobile ? 130 : 170, height: isMobile ? 130 : 170, objectFit: "contain", opacity: 0.08 }}
                />
              </div>
            )}
            <table style={{ position: "relative", zIndex: 1, width: "100%", minWidth: isMobile ? 0 : 460, tableLayout: isMobile ? "fixed" : "auto", borderCollapse: "collapse", fontFamily: "var(--rt-font-sans)" }}>
              <thead>
                <tr>
                  {(isMobile ? MOBILE_HEADERS : HEADERS).map((h, i) => (
                    <th
                      key={i}
                      style={{
                        boxSizing: "border-box",
                        textAlign: h.align,
                        width: h.width,
                        fontSize: isMobile ? 11.5 : 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        color: "var(--rt-muted)",
                        fontWeight: 700,
                        padding: isMobile ? "8px 4px" : "8px 10px",
                        borderBottom: "1px solid var(--rt-hairline)",
                        background: "var(--rt-surface-strong)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        position: "sticky",
                        top: 0,
                      }}
                    >
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grouped.map((g, gi) =>
                  g.rows.map((r, ri) => {
                    const p = playerByKey.get(normalizePlayerName(r.player));
                    const isLastInGroup = ri === g.rows.length - 1;
                    const isLastGroup = gi === grouped.length - 1;
                    const zebra = ri % 2 === 1;
                    const displayName = p?.name ?? r.player;
                    const tagTier = roleTagMap[normalizePlayerName(r.player)];
                    const tagMeta = tagTier ? USAGE_TAG_META[tagTier] : null;
                    const rowStyle: CSSProperties = {
                      background: zebra ? "color-mix(in srgb, var(--rt-primary) 6%, transparent)" : "transparent",
                      borderBottom: isLastInGroup && !isLastGroup ? "2px solid var(--rt-primary)" : "1px solid var(--rt-hairline-soft)",
                    };

                    if (isMobile) {
                      const gpMpg = r.projMpg != null
                        ? `${r.projMpg.toFixed(1)}${r.projGames != null ? ` / ${Math.round(r.projGames)}g` : ""}`
                        : "—";
                      return (
                        <tr key={`${g.tier}-${r.player}`} style={rowStyle}>
                          <td style={{ boxSizing: "border-box", padding: "10px 4px", fontSize: 13, fontWeight: 700, color: "var(--rt-muted)", lineHeight: 1.3 }}>
                            {g.label} · <span style={{ color: posColorFor(r.pos), fontWeight: 800 }}>{r.pos}</span>
                          </td>
                          <td style={{ boxSizing: "border-box", padding: "10px 4px", overflow: "hidden" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                              <PlayerHeadshot
                                name={displayName}
                                size={24}
                                initials={initials(displayName)}
                                background="var(--rt-surface-strong)"
                                color="var(--rt-ink)"
                                fontSize={10}
                                rookie={p?.tag === "rookie"}
                              />
                              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: "var(--rt-ink)", lineHeight: 1.25 }}>{displayName}</span>
                            </div>
                          </td>
                          <td style={{ boxSizing: "border-box", padding: "10px 4px", fontSize: 13, textAlign: "right", fontFamily: "var(--rt-font-mono)", color: "var(--rt-body)", fontVariantNumeric: "tabular-nums", lineHeight: 1.3 }}>
                            {gpMpg}
                          </td>
                          <td style={{ boxSizing: "border-box", padding: "10px 4px", fontSize: 13, textAlign: "right", fontFamily: "var(--rt-font-mono)", color: "var(--rt-body)", fontVariantNumeric: "tabular-nums", overflow: "hidden" }}>
                            {r.usg != null ? r.usg.toFixed(1) : "—"}
                          </td>
                          <td style={{ boxSizing: "border-box", padding: "10px 2px", textAlign: "center", overflow: "hidden" }}>
                            {tagMeta && (
                              <span
                                title={`Usage signal: ${tagMeta.label}`}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: 22,
                                  height: 22,
                                  borderRadius: 999,
                                  border: `1px solid ${tagMeta.color}`,
                                  background: `color-mix(in srgb, ${tagMeta.color} 12%, transparent)`,
                                  color: tagMeta.color,
                                  fontSize: 12,
                                  fontWeight: 700,
                                }}
                              >
                                {tagMeta.glyph}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={`${g.tier}-${r.player}`} style={rowStyle}>
                        <td style={{ padding: "8px 10px", fontSize: 12, fontWeight: 700, color: "var(--rt-muted)", whiteSpace: "nowrap" }}>{g.label}</td>
                        <td style={{ padding: "8px 10px" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: "2px 7px",
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 800,
                              color: posColorFor(r.pos),
                              background: `color-mix(in srgb, ${posColorFor(r.pos)} 14%, transparent)`,
                              border: `1px solid color-mix(in srgb, ${posColorFor(r.pos)} 40%, transparent)`,
                            }}
                          >
                            {r.pos}
                          </span>
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          <PlayerHeadshot
                            name={displayName}
                            size={30}
                            initials={initials(displayName)}
                            background="var(--rt-surface-strong)"
                            color="var(--rt-ink)"
                            fontSize={11}
                            rookie={p?.tag === "rookie"}
                          />
                        </td>
                        <td style={{ padding: "8px 10px", fontSize: 13, fontWeight: 600, color: "var(--rt-ink)", whiteSpace: "nowrap" }}>{displayName}</td>
                        <td style={{ padding: "8px 10px", fontSize: 13, textAlign: "right", fontFamily: "var(--rt-font-mono)", color: "var(--rt-body)", fontVariantNumeric: "tabular-nums" }}>
                          {r.projGames != null ? Math.round(r.projGames) : "—"}
                        </td>
                        <td style={{ padding: "8px 10px", fontSize: 13, textAlign: "right", fontFamily: "var(--rt-font-mono)", color: "var(--rt-body)", fontVariantNumeric: "tabular-nums" }}>
                          {r.projMpg != null ? r.projMpg.toFixed(1) : "—"}
                        </td>
                        <td style={{ padding: "8px 10px", fontSize: 13, textAlign: "right", fontFamily: "var(--rt-font-mono)", color: "var(--rt-body)", fontVariantNumeric: "tabular-nums" }}>
                          {r.usg != null ? r.usg.toFixed(1) : "—"}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {tagMeta && (
                            <span
                              title={`Usage signal: ${tagMeta.label}`}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                padding: "3px 9px",
                                borderRadius: 999,
                                border: `1px solid ${tagMeta.color}`,
                                background: `color-mix(in srgb, ${tagMeta.color} 12%, transparent)`,
                                color: tagMeta.color,
                                fontSize: 10,
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.03em",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <span style={{ fontSize: 10 }}>{tagMeta.glyph}</span>
                              {tagMeta.label}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
