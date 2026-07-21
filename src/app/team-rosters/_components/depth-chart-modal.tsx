"use client";

import { useEffect, useState } from "react";
import { normalizePlayerName } from "@/lib/dynasty-rankings";
import type { Player } from "./roster-data";
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

const HEADERS: { label: string; align: "left" | "right" }[] = [
  { label: "Role", align: "left" },
  { label: "Pos", align: "left" },
  { label: "", align: "left" },
  { label: "Player", align: "left" },
  { label: "GP", align: "right" },
  { label: "MPG", align: "right" },
  { label: "USG", align: "right" },
  { label: "Usage Signal", align: "left" },
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

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 260, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)", padding: isMobile ? 12 : 24 }}
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
          padding: isMobile ? 16 : 24,
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
          <div style={{ marginTop: 16, overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 460, borderCollapse: "collapse", fontFamily: "var(--rt-font-sans)" }}>
              <thead>
                <tr>
                  {HEADERS.map((h, i) => (
                    <th
                      key={i}
                      style={{
                        textAlign: h.align,
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        color: "var(--rt-muted)",
                        fontWeight: 700,
                        padding: "8px 10px",
                        borderBottom: "1px solid var(--rt-hairline)",
                        background: "var(--rt-surface-strong)",
                        whiteSpace: "nowrap",
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
                    return (
                      <tr
                        key={`${g.tier}-${r.player}`}
                        style={{
                          background: zebra ? "color-mix(in srgb, var(--rt-up) 6%, transparent)" : "transparent",
                          borderBottom: isLastInGroup && !isLastGroup ? "2px solid var(--rt-primary)" : "1px solid var(--rt-hairline-soft)",
                        }}
                      >
                        <td style={{ padding: "8px 10px", fontSize: 12, fontWeight: 700, color: "var(--rt-muted)", whiteSpace: "nowrap" }}>{g.label}</td>
                        <td style={{ padding: "8px 10px", fontSize: 12, color: "var(--rt-muted)" }}>{r.pos}</td>
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
