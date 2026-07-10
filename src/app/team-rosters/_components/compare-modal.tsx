"use client";

import { useState } from "react";
import { TEAMS, type Player, type SeasonMode } from "./roster-data";
import { PlayerCompareCard } from "./player-compare-card";

const MAX_COMPARE = 4;
const MODE_DEFS: { id: SeasonMode; label: string }[] = [
  { id: "cur", label: "Current" },
  { id: "prior", label: "Prior" },
  { id: "proj", label: "Projection" },
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

  const loadTeam = async (team: string) => {
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
      setRoster(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
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
  const excludeIds = new Set(players.map((p) => p.id));
  const emptySlots = Math.max(0, MAX_COMPARE - players.length);

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
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
              {MODE_DEFS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  style={{
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
            <PlayerCompareCard key={p.id} player={p} mode={mode} onRemove={() => onRemove(p.id)} />
          ))}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <AddPlayerSlot key={i} currentTeam={currentTeam} currentTeamPlayers={currentTeamPlayers} excludeIds={excludeIds} onAdd={onAdd} />
          ))}
        </div>
      </div>
    </div>
  );
}
