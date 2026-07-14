"use client";

import { useState } from "react";
import { PlayerCompareCard } from "./player-compare-card";
import type { Player, SeasonMode } from "./roster-data";
import type { TrendMetric } from "./trend-insight";

const MODE_DEFS: { id: SeasonMode; label: string }[] = [
  { id: "recent", label: "Recent" },
  { id: "cur", label: "Current" },
  { id: "prior", label: "Prior" },
  { id: "proj", label: "Projection" },
];
const METRIC_DEFS: { id: TrendMetric; label: string }[] = [
  { id: "minus1V", label: "Minus1V" },
  { id: "nineCatV", label: "9CatV" },
  { id: "eightCatV", label: "8CatV" },
];

/**
 * Single-player quick-view popover — the same PlayerCompareCard used in the
 * team-rosters compare modal (headshot/bio, salary, dynasty rank, Minus1V
 * rank + trend chart via TrendHero, 9-category profile), opened from a row
 * click elsewhere in the app (e.g. Dynasty Consensus) instead of requiring a
 * full navigation to /team-rosters/[team] to see a player's recent trend.
 */
export function PlayerQuickViewModal({
  player,
  loading,
  error,
  onClose,
  onCompare,
  isMobile,
}: {
  player: Player | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  /** Opens the shared 4-player CompareModal prefilled with this card's
   * player — omit to hide the button (e.g. contexts with no compare tool). */
  onCompare?: () => void;
  isMobile: boolean;
}) {
  const [mode, setMode] = useState<SeasonMode>("cur");
  const [metric, setMetric] = useState<TrendMetric>("minus1V");

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 260, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)", padding: isMobile ? 12 : 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(380px, 100%)",
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          background: "var(--rt-canvas)",
          border: "1px solid var(--rt-hairline)",
          borderRadius: 20,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          padding: isMobile ? 16 : 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
            {METRIC_DEFS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMetric(m.id)}
                disabled={!player}
                style={{
                  padding: "6px 10px",
                  border: "none",
                  cursor: player ? "pointer" : "default",
                  opacity: player ? 1 : 0.5,
                  borderRadius: 999,
                  fontFamily: "var(--rt-font-sans)",
                  fontSize: 12,
                  fontWeight: 600,
                  background: metric === m.id ? "var(--rt-primary)" : "transparent",
                  color: metric === m.id ? "var(--rt-on-primary)" : "var(--rt-body)",
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          {onCompare && (
            <button
              type="button"
              onClick={onCompare}
              disabled={!player}
              style={{
                padding: "6px 14px",
                border: "none",
                cursor: player ? "pointer" : "default",
                opacity: player ? 1 : 0.5,
                borderRadius: 999,
                background: "var(--rt-primary)",
                color: "var(--rt-on-primary)",
                fontFamily: "var(--rt-font-sans)",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Compare
            </button>
          )}
          <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
            {MODE_DEFS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                disabled={!player}
                style={{
                  padding: "6px 12px",
                  border: "none",
                  cursor: player ? "pointer" : "default",
                  opacity: player ? 1 : 0.5,
                  borderRadius: 999,
                  fontFamily: "var(--rt-font-sans)",
                  fontSize: 12,
                  fontWeight: 600,
                  background: mode === m.id ? "var(--rt-ink)" : "transparent",
                  color: mode === m.id ? "var(--rt-canvas)" : "var(--rt-body)",
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close player card"
            style={{ width: 36, height: 36, borderRadius: 999, border: "1px solid var(--rt-hairline)", background: "none", color: "var(--rt-ink)", cursor: "pointer" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ margin: "0 auto" }} aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div style={{ marginTop: 18 }}>
          {loading ? (
            <div style={{ padding: "48px 0", textAlign: "center", color: "var(--rt-muted)", fontSize: 13 }}>Loading player…</div>
          ) : error ? (
            <div style={{ padding: "48px 0", textAlign: "center", color: "var(--rt-muted)", fontSize: 13, lineHeight: 1.5 }}>{error}</div>
          ) : player ? (
            <PlayerCompareCard player={player} mode={mode} metric={metric} onRemove={onClose} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
