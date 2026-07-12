"use client";

import { useRef, useState } from "react";
import { PRO_UNLOCKED, TEAMS, type Player, type SeasonMode } from "./roster-data";
import { PlayerCompareCard } from "./player-compare-card";
import { catOrderFor } from "./roster-helpers";
import type { TrendMetric } from "./trend-insight";

const MAX_COMPARE = 4;
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

/** One empty grid slot — either a dashed "+ Add player" tile, or (once
 * clicked) an inline team + search + player-list picker. Fetches another
 * team's roster via /api/team-rosters/[team] (see that route's comment for
 * why a Route Handler can call the otherwise server-only getTeamRoster());
 * reuses the already-loaded `currentTeamPlayers` when the picked team
 * matches the page's own team, avoiding a redundant fetch. */
function AddPlayerSlot({
  currentTeam,
  currentTeamPlayers,
  excludeIds,
  onAdd,
}: {
  currentTeam: string;
  currentTeamPlayers: Player[];
  excludeIds: Set<string>;
  onAdd: (player: Player) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pickerTeam, setPickerTeam] = useState(currentTeam);
  const [roster, setRoster] = useState<Player[] | null>(currentTeam === pickerTeam ? currentTeamPlayers : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  // Guards against out-of-order fetch responses: if the team is switched
  // again before an in-flight request resolves, that stale response must
  // not clobber the roster with the wrong team's players.
  const requestId = useRef(0);

  const loadTeam = async (team: string) => {
    const thisRequest = ++requestId.current;
    setPickerTeam(team);
    setSearch("");
    if (team === currentTeam) {
      setRoster(currentTeamPlayers);
      setError(false);
      return;
    }
    setRoster(null);
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/team-rosters/${team}`);
      if (!res.ok) throw new Error("failed");
      const data: Player[] = await res.json();
      if (thisRequest !== requestId.current) return;
      setRoster(data);
    } catch {
      if (thisRequest !== requestId.current) return;
      setError(true);
    } finally {
      if (thisRequest === requestId.current) setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          minHeight: 220,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 8,
          border: "1.5px dashed var(--rt-hairline)",
          borderRadius: 16,
          background: "none",
          color: "var(--rt-muted)",
          cursor: "pointer",
          fontFamily: "var(--rt-font-sans)",
        }}
      >
        <span style={{ fontSize: 22 }}>+</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Add player</span>
      </button>
    );
  }

  const qLower = search.toLowerCase();
  const candidates = (roster ?? []).filter((p) => !excludeIds.has(p.id) && (!qLower || p.name.toLowerCase().includes(qLower)));

  return (
    <div style={{ border: "1px solid var(--rt-hairline)", borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 8, minHeight: 220 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <select
          value={pickerTeam}
          onChange={(e) => loadTeam(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            height: 32,
            border: "1px solid var(--rt-hairline)",
            borderRadius: 8,
            background: "var(--rt-surface-strong)",
            color: "var(--rt-ink)",
            fontFamily: "var(--rt-font-sans)",
            fontSize: 12,
            padding: "0 8px",
          }}
        >
          {TEAMS.map((t) => (
            <option key={t.abbr} value={t.abbr}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          style={{ width: 26, height: 26, flex: "0 0 26px", borderRadius: 999, border: "1px solid var(--rt-hairline)", background: "var(--rt-surface-strong)", color: "var(--rt-muted)", cursor: "pointer" }}
        >
          ×
        </button>
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search players"
        style={{ height: 32, border: "1px solid var(--rt-hairline)", borderRadius: 8, background: "var(--rt-surface-strong)", color: "var(--rt-ink)", fontFamily: "var(--rt-font-sans)", fontSize: 12, padding: "0 10px", outline: "none" }}
      />
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {loading && <div style={{ fontSize: 12, color: "var(--rt-muted)", padding: "8px 4px" }}>Loading roster…</div>}
        {error && <div style={{ fontSize: 12, color: "var(--rt-down)", padding: "8px 4px" }}>Couldn&apos;t load that roster.</div>}
        {!loading && !error && candidates.length === 0 && <div style={{ fontSize: 12, color: "var(--rt-muted)", padding: "8px 4px" }}>No players match.</div>}
        {candidates.map((p) => (
          <button
            key={p.id}
            type="button"
            className="rt-hover-surface"
            onClick={() => {
              onAdd(p);
              setOpen(false);
            }}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 8px", border: "none", background: "none", borderRadius: 8, cursor: "pointer", textAlign: "left" }}
          >
            <span style={{ fontSize: 13, color: "var(--rt-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
            <span style={{ fontSize: 11, color: "var(--rt-muted)", flexShrink: 0 }}>{p.pos}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function CompareModal({
  currentTeam,
  currentTeamPlayers,
  players,
  onAdd,
  onRemove,
  onClose,
  isMobile,
}: {
  currentTeam: string;
  currentTeamPlayers: Player[];
  players: Player[];
  onAdd: (player: Player) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  isMobile: boolean;
}) {
  const [mode, setMode] = useState<SeasonMode>("cur");
  const [metric, setMetric] = useState<TrendMetric>("minus1V");
  const excludeIds = new Set(players.map((p) => p.id));
  const emptySlots = Math.max(0, MAX_COMPARE - players.length);
  // Anchor every card's 9-category row order to the first player added, so
  // categories line up across columns for an easy eyeball comparison. If
  // that player is removed, the next one in line becomes the new anchor.
  const anchorOrder = players.length > 0 ? catOrderFor(players[0]) : undefined;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 260, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)", padding: isMobile ? 12 : 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1100px, 100%)",
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          background: "var(--rt-canvas)",
          border: "1px solid var(--rt-hairline)",
          borderRadius: 20,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          padding: isMobile ? 16 : 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--rt-ink)" }}>Compare players</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
              {METRIC_DEFS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMetric(m.id)}
                  style={{
                    padding: "6px 12px",
                    border: "none",
                    cursor: "pointer",
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
            <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
              {MODE_DEFS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "6px 12px",
                    border: "none",
                    cursor: "pointer",
                    borderRadius: 999,
                    fontFamily: "var(--rt-font-sans)",
                    fontSize: 12,
                    fontWeight: 600,
                    background: mode === m.id ? "var(--rt-ink)" : "transparent",
                    color: mode === m.id ? "var(--rt-canvas)" : "var(--rt-body)",
                  }}
                >
                  {m.id === "proj" && !PRO_UNLOCKED && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  )}
                  {m.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close compare"
              style={{ width: 36, height: 36, borderRadius: 999, border: "1px solid var(--rt-hairline)", background: "none", color: "var(--rt-ink)", cursor: "pointer" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ margin: "0 auto" }} aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, minmax(220px, 1fr))", gap: 14, marginTop: 18, overflowX: isMobile ? "visible" : "auto" }}>
          {players.map((p) => (
            <PlayerCompareCard key={p.id} player={p} mode={mode} metric={metric} catOrder={anchorOrder} onRemove={() => onRemove(p.id)} />
          ))}
          {Array.from({ length: emptySlots }).map((_, i) => (
            // Keyed off players.length + i (not just i) so every slot remounts
            // fresh — with the picker reset to currentTeam — whenever a player
            // is added or removed, instead of a lower-indexed slot's stale
            // open/pickerTeam/roster state bleeding into the "next" slot.
            <AddPlayerSlot key={`${players.length}-${i}`} currentTeam={currentTeam} currentTeamPlayers={currentTeamPlayers} excludeIds={excludeIds} onAdd={onAdd} />
          ))}
        </div>
      </div>
    </div>
  );
}
