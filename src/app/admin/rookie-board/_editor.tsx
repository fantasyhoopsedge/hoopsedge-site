"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CATS, CAT_LABELS, MAX_BOARD_SIZE, tierInfo, PROSPECT_POOL, ageFromBirthdate,
  type BoardPlayer, type BoardTier, type PoolProspect,
} from "@/lib/rookie-board";

const POSITIONS = ["G", "F", "C", "G/F", "F/C"];

interface VersionEntry { version: string; label: string; savedAt: string; players: number; note?: string }

// ── small helpers ──────────────────────────────────────────────
const starNum = (v: string): number => parseInt(v) || 0;
const starStr = (n: number): string => (n >= 1 && n <= 5 ? `${n}★` : "");
const pickFor = (rank: number) => `1.${String(rank).padStart(2, "0")}`;
/** Next published version label, e.g. "1.0" → "1.1". */
const bumpMinor = (v: string): string => {
  const [maj, min] = (v || "1.0").split(".");
  return `${maj || "1"}.${(parseInt(min || "0", 10) || 0) + 1}`;
};

/** Loose name key for matching across sources: lowercased, accents removed,
 * punctuation and Jr/Sr/II/III/IV suffixes stripped. */
function normalizeName(name: string): string {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,'‘’]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Recompute rank + pick from array position. */
function renumber(players: BoardPlayer[]): BoardPlayer[] {
  return players.map((p, i) => ({ ...p, rank: i + 1, pick: pickFor(i + 1) }));
}

function blankPlayer(rank: number, tier: number): BoardPlayer {
  return {
    rank, pick: pickFor(rank), name: "", school: "", nbaTeam: "", contract: "", pos: "G", tier, age: null, ht: "",
    pts: "", reb: "", ast: "", stl: "", blk: "", fg: "", ft: "", tpm: "", to: "", verdict: "",
  };
}

/** Build a board row from a pool prospect — prefills team→school, position,
 * height, live age (from birthdate), and seeds the verdict with Matt's stat
 * line as a starting point. Ratings start empty for the admin to set. */
function prospectToPlayer(p: PoolProspect, rank: number, tier: number): BoardPlayer {
  const liveAge = ageFromBirthdate(p.birthdate) ?? p.age;
  return {
    rank, pick: pickFor(rank), name: p.name, school: p.team, nbaTeam: "", contract: "", pos: p.pos, tier,
    age: liveAge != null ? Math.round(liveAge * 10) / 10 : null,
    birthdate: p.birthdate ?? undefined, ht: p.ht,
    pts: "", reb: "", ast: "", stl: "", blk: "", fg: "", ft: "", tpm: "", to: "",
    verdict: p.statline,
  };
}

// ── star rating control ────────────────────────────────────────
function StarPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const n = starNum(value);
  return (
    <div className="rb-star-picker">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          className={"rb-star-dot" + (s <= n ? " on" : "")}
          onClick={() => onChange(s === n ? "" : starStr(s))}
          title={`${s}★`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export function RookieBoardEditor() {
  const [players, setPlayers] = useState<BoardPlayer[]>([]);
  const [tiers, setTiers] = useState<BoardTier[]>([]);
  const [version, setVersion] = useState<string>("");
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [canWrite, setCanWrite] = useState(true);
  const [selectedRank, setSelectedRank] = useState<number | null>(null);
  const [panelMode, setPanelMode] = useState<"player" | "tiers">("player");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isDraft, setIsDraft] = useState(false); // editing a persisted WIP draft (not published)
  const [liveVersion, setLiveVersion] = useState<string>("");
  const [liveOrder, setLiveOrder] = useState<string[]>([]); // live ranking (player names) for the re-rank check
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Undo history: each entry is the full board state captured *before* a change.
  const [history, setHistory] = useState<{ players: BoardPlayer[]; tiers: BoardTier[] }[]>([]);
  const coalesceRef = useRef<{ key: string; t: number } | null>(null);

  // ── load ──
  useEffect(() => {
    fetch("/api/admin/rookie-board")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setPlayers(d.board.players);
        setTiers(d.board.tiers);
        setVersion(d.board.version);
        setLiveVersion(d.liveVersion ?? d.board.version);
        setLiveOrder(d.liveOrder ?? d.board.players.map((p: BoardPlayer) => p.name));
        setVersions(d.versions ?? []);
        setCanWrite(d.canWrite);
        setIsDraft(Boolean(d.isDraft));
      })
      .catch((e) => setToast({ kind: "err", msg: e.message }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Ctrl/Cmd+Z outside a text field triggers Undo. Inside inputs/textareas the
  // browser's native text undo handles it, so we leave those alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // re-bind each render so undo() closes over fresh state

  const selected = useMemo(
    () => players.find((p) => p.rank === selectedRank) ?? null,
    [players, selectedRank],
  );

  // Has the ranked roster changed vs the live board? If so, edits are a re-rank
  // and must go out as a new version; "Publish details" is disabled. Matched by
  // normalized name (renaming a player reads as a roster change — rare, intended).
  const orderChanged = useMemo(() => {
    const cur = players.map((p) => normalizeName(p.name));
    const liv = liveOrder.map(normalizeName);
    return cur.length !== liv.length || cur.some((n, i) => n !== liv[i]);
  }, [players, liveOrder]);

  // Pool prospects not currently on the board — removing a player frees them up
  // again. Names are normalized (accents/suffixes/punctuation stripped) so a
  // ranked "Karim Lopez" still matches Matt's "Karim López".
  const availableProspects = useMemo(() => {
    const onBoard = new Set(players.map((p) => normalizeName(p.name)));
    const q = pickerQuery.trim().toLowerCase();
    return PROSPECT_POOL
      .filter((p) => !onBoard.has(normalizeName(p.name)))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q));
  }, [players, pickerQuery]);

  // Tier → contiguous rank range it covers (tiers ordered by board position).
  // minEnd/maxEnd bound how far the boundary with the next tier can move while
  // keeping every tier at least one player.
  const tierRanges = useMemo(() => {
    const used = tiers
      .map((t) => t.id)
      .filter((id) => players.some((p) => p.tier === id))
      .map((id) => ({ id, ranks: players.filter((p) => p.tier === id).map((p) => p.rank) }))
      .sort((a, b) => Math.min(...a.ranks) - Math.min(...b.ranks));
    const map: Record<number, { start: number; end: number; count: number; isLast: boolean; minEnd: number; maxEnd: number }> = {};
    used.forEach((u, i) => {
      const start = Math.min(...u.ranks);
      const end = Math.max(...u.ranks);
      const isLast = i === used.length - 1;
      const nextEnd = isLast ? players.length : Math.max(...used[i + 1].ranks);
      map[u.id] = { start, end, count: u.ranks.length, isLast, minEnd: start, maxEnd: nextEnd - 1 };
    });
    return map;
  }, [players, tiers]);

  /** Move the boundary between a tier and the one below it: every player is
   * reassigned to a tier by the new contiguous rank blocks. */
  function setTierEnd(tierId: number, rawEnd: number) {
    const range = tierRanges[tierId];
    if (!range || range.isLast) return;
    const end = Math.max(range.minEnd, Math.min(range.maxEnd, rawEnd));
    if (end === range.end) return;

    const used = tiers
      .map((t) => t.id)
      .filter((id) => players.some((p) => p.tier === id))
      .map((id) => ({ id, end: Math.max(...players.filter((p) => p.tier === id).map((p) => p.rank)), min: Math.min(...players.filter((p) => p.tier === id).map((p) => p.rank)) }))
      .sort((a, b) => a.min - b.min);
    const i = used.findIndex((u) => u.id === tierId);
    pushHistory();
    setPlayers((prev) => {
      const next = prev.map((p) => ({ ...p }));
      let start = 1;
      used.forEach((u, j) => {
        const e = j === used.length - 1 ? prev.length : j === i ? end : u.end;
        next.forEach((p) => { if (p.rank >= start && p.rank <= e) p.tier = u.id; });
        start = e + 1;
      });
      return next;
    });
    setDirty(true);
  }

  // ── undo history ──
  // Snapshot the pre-change state before each mutation. Consecutive typed edits
  // to the same field coalesce into a single history entry (within 1s) so Undo
  // reverts a whole edit instead of one keystroke at a time.
  function pushHistory(coalesceKey?: string) {
    const now = Date.now();
    if (
      coalesceKey && coalesceRef.current &&
      coalesceRef.current.key === coalesceKey && now - coalesceRef.current.t < 1000
    ) {
      coalesceRef.current.t = now;
      return;
    }
    coalesceRef.current = coalesceKey ? { key: coalesceKey, t: now } : null;
    setHistory((h) => [...h.slice(-49), { players, tiers }]);
  }

  function undo() {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    setPlayers(last.players);
    setTiers(last.tiers);
    setHistory((h) => h.slice(0, -1));
    setDirty(history.length > 1); // popping the last entry restores the loaded board
    coalesceRef.current = null;
    if (selectedRank != null && !last.players.some((p) => p.rank === selectedRank)) {
      setSelectedRank(null);
    }
  }

  // ── mutators ──
  function mutate(updater: (prev: BoardPlayer[]) => BoardPlayer[]) {
    pushHistory();
    setPlayers((prev) => renumber(updater(prev)));
    setDirty(true);
  }

  function patchSelected(patch: Partial<BoardPlayer>, coalesceKey?: string) {
    if (selectedRank == null) return;
    pushHistory(coalesceKey);
    setPlayers((prev) => prev.map((p) => (p.rank === selectedRank ? { ...p, ...patch } : p)));
    setDirty(true);
  }

  function reorder(from: number, to: number) {
    if (from === to) return;
    pushHistory();
    setPlayers((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      // Adopt the tier of the new neighbour so tiers stay contiguous blocks —
      // dragging a player into another tier's region moves them into that tier.
      const neighbour = next[to - 1] ?? next[to + 1];
      next[to] = neighbour ? { ...moved, tier: neighbour.tier } : moved;
      return renumber(next);
    });
    setSelectedRank(to + 1); // moved row lands at index `to`
    setDirty(true);
  }

  function openPicker() {
    if (players.length >= MAX_BOARD_SIZE) {
      setToast({ kind: "err", msg: `Board is capped at ${MAX_BOARD_SIZE} players.` });
      return;
    }
    setPickerQuery("");
    setPickerOpen(true);
  }

  /** Append a new row (from the pool, or a blank custom one), select it. */
  function addPlayer(prospect?: PoolProspect) {
    if (players.length >= MAX_BOARD_SIZE) {
      setToast({ kind: "err", msg: `Board is capped at ${MAX_BOARD_SIZE} players.` });
      return;
    }
    const lastTier = players.length ? players[players.length - 1].tier : 1;
    const newRank = players.length + 1;
    mutate((prev) => [
      ...prev,
      prospect ? prospectToPlayer(prospect, newRank, lastTier) : blankPlayer(newRank, lastTier),
    ]);
    setSelectedRank(newRank);
    setPanelMode("player");
    setPickerOpen(false);
  }

  function removePlayer(rank: number) {
    mutate((prev) => prev.filter((p) => p.rank !== rank));
    if (selectedRank === rank) setSelectedRank(null);
  }

  /** Stable group-by-tier: keeps within-tier order, orders groups by tier id. */
  function sortByTier() {
    mutate((prev) => [...prev].sort((a, b) => a.tier - b.tier));
  }

  /** Bring back a tier that has no players: hand it the boundary player from the
   * nearest adjacent tier (the first of the next-higher tier, else the last of
   * the previous tier), so it reappears as a 1-player block in the right spot. */
  function restoreTier(tierId: number) {
    if (players.some((p) => p.tier === tierId)) return;
    const higher = players.filter((p) => p.tier > tierId);
    const lower = players.filter((p) => p.tier < tierId);
    let donorRank: number | null = null;
    if (higher.length) {
      const nextTier = Math.min(...higher.map((p) => p.tier));
      donorRank = Math.min(...players.filter((p) => p.tier === nextTier).map((p) => p.rank));
    } else if (lower.length) {
      const prevTier = Math.max(...lower.map((p) => p.tier));
      donorRank = Math.max(...players.filter((p) => p.tier === prevTier).map((p) => p.rank));
    }
    if (donorRank == null) return;
    pushHistory();
    setPlayers((prev) => prev.map((p) => (p.rank === donorRank ? { ...p, tier: tierId } : p)));
    setDirty(true);
  }

  function patchTier(id: number, patch: Partial<BoardTier>, coalesceKey?: string) {
    pushHistory(coalesceKey);
    setTiers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    setDirty(true);
  }

  async function save() {
    if (!canWrite) {
      setToast({ kind: "err", msg: "Saving is disabled in production. Run the tool locally." });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/rookie-board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ players, tiers }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "save failed");
      setVersion(d.version);
      setLiveVersion(d.version);
      setVersions((v) => [...v, { version: d.version, label: d.board.label, savedAt: d.board.updatedAt, players: d.players }]);
      setPlayers(d.board.players);
      setTiers(d.board.tiers);
      setLiveOrder(d.board.players.map((p: BoardPlayer) => p.name));
      setDirty(false);
      setIsDraft(false); // publishing supersedes the draft
      setHistory([]);
      coalesceRef.current = null;
      setToast({ kind: "ok", msg: `Published ${d.board.label} — it's now live (previous archived as v${d.previousVersion}).` });
    } catch (e) {
      setToast({ kind: "err", msg: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  /** Push player detail edits live WITHOUT a version bump (same players, same
   * order). Rejected server-side if the roster changed — use Publish then. */
  async function publishDetails() {
    if (!canWrite) {
      setToast({ kind: "err", msg: "Saving is disabled in production. Run the tool locally." });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/rookie-board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ players, tiers, mode: "details" }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "publish failed");
      setPlayers(d.board.players);
      setTiers(d.board.tiers);
      setDirty(false);
      setIsDraft(false); // detail publish also clears any WIP draft server-side
      setHistory([]);
      coalesceRef.current = null;
      setToast({ kind: "ok", msg: `Detail edits are live — board stays v${d.version}, no new version.` });
    } catch (e) {
      setToast({ kind: "err", msg: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  /** Persist current edits as a WIP draft — no version bump, not published. */
  async function saveDraft() {
    if (!canWrite) {
      setToast({ kind: "err", msg: "You don't have edit access." });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/rookie-board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ players, tiers, draft: true }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "draft save failed");
      setDirty(false);
      setIsDraft(true);
      setToast({ kind: "ok", msg: `WIP draft saved — not published. The live board stays v${liveVersion}.` });
    } catch (e) {
      setToast({ kind: "err", msg: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  /** Throw away the WIP draft and reload the live board. */
  async function discardDraft() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/rookie-board", { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "discard failed");
      setPlayers(d.board.players);
      setTiers(d.board.tiers);
      setVersion(d.board.version);
      setLiveVersion(d.board.version);
      setIsDraft(false);
      setDirty(false);
      setHistory([]);
      setSelectedRank(null);
      setToast({ kind: "ok", msg: `Draft discarded — reverted to live v${d.board.version}.` });
    } catch (e) {
      setToast({ kind: "err", msg: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="rb-shell"><div className="rb-loading">Loading board…</div><style>{STYLES}</style></div>;
  }

  return (
    <div className="rb-shell">
      {/* ── Header ── */}
      <header className="rb-head">
        <div>
          <div className="rb-eyebrow">FHE ADMIN · LOCAL AUTHORING</div>
          <h1 className="rb-title">2026 Rookie Board Editor</h1>
          <div className="rb-sub">
            Live: <strong>v{liveVersion || version}</strong> · {players.length} players
            {isDraft && <span className="rb-draft-tag"> · editing WIP draft</span>}
            {dirty && <span className="rb-dirty"> · unsaved changes</span>}
          </div>
        </div>
        <div className="rb-head-actions">
          {/* Mode toggle: edit a player vs. edit the tier definitions */}
          <div className="rb-toggle" role="tablist" aria-label="Edit mode">
            <button
              className={"rb-toggle-btn" + (panelMode === "player" ? " on" : "")}
              onClick={() => setPanelMode("player")}
              role="tab" aria-selected={panelMode === "player"}
            >Edit player</button>
            <button
              className={"rb-toggle-btn" + (panelMode === "tiers" ? " on" : "")}
              onClick={() => setPanelMode("tiers")}
              role="tab" aria-selected={panelMode === "tiers"}
            >Edit tiers</button>
          </div>
          <a className="rb-link" href="/draft-board" target="_blank" rel="noreferrer">View live board ↗</a>
          <button className="rb-btn ghost" onClick={openPicker} disabled={players.length >= MAX_BOARD_SIZE}>
            + Add player ({players.length}/{MAX_BOARD_SIZE})
          </button>
          <button className="rb-btn ghost" onClick={sortByTier}>Group by tier</button>
          <button className="rb-btn ghost" onClick={undo} disabled={history.length === 0} title="Undo last change (Ctrl+Z)">
            ↩ Undo{history.length > 0 ? ` (${history.length})` : ""}
          </button>
          <button
            className="rb-btn wip"
            onClick={saveDraft}
            disabled={saving || (!dirty && isDraft)}
            title="Save your work-in-progress without publishing a new version"
          >
            {saving ? "Saving…" : "💾 Save WIP"}
          </button>
          <button
            className="rb-btn details"
            onClick={publishDetails}
            disabled={saving || (!dirty && !isDraft) || orderChanged}
            title={
              orderChanged
                ? "You've reordered or changed the roster — use Publish → version to snapshot that."
                : "Push player detail edits (ratings, verdict, bio, tier colors) live without a new version"
            }
          >
            {saving ? "Publishing…" : "Publish details"}
          </button>
          <button className="rb-btn primary" onClick={save} disabled={saving || (!dirty && !isDraft)}>
            {saving ? "Publishing…" : `Publish → v${bumpMinor(liveVersion || version)}`}
          </button>
        </div>
      </header>

      {isDraft && (
        <div className="rb-draft-banner">
          <span>
            You&apos;re editing an <strong>unpublished WIP draft</strong>. It&apos;s saved locally and survives reloads,
            but the live board stays <strong>v{liveVersion}</strong> until you publish.
          </span>
          <button className="rb-btn ghost sm" onClick={discardDraft} disabled={saving}>Discard draft</button>
        </div>
      )}

      {!canWrite && (
        <div className="rb-warn">
          Read-only: your account doesn&apos;t have board-editing access.
        </div>
      )}

      <div className="rb-body">
        {/* ── Left: draggable board list ── */}
        <div className="rb-list">
          {players.map((p, i) => {
            const t = tierInfo(p.tier, tiers);
            const prevTier = i > 0 ? players[i - 1].tier : null;
            const showDivider = i === 0 || p.tier !== prevTier;
            return (
              <div key={p.rank}>
                {showDivider && (
                  <div className="rb-tier-divider">
                    <span style={{ color: t.color }}>// {t.label}</span>
                  </div>
                )}
                <div
                  className={
                    "rb-row" +
                    (selectedRank === p.rank ? " sel" : "") +
                    (dragOver === i ? " dragover" : "")
                  }
                  draggable
                  onDragStart={() => { dragFrom.current = i; }}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(i); }}
                  onDragLeave={() => setDragOver((d) => (d === i ? null : d))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragFrom.current != null) reorder(dragFrom.current, i);
                    dragFrom.current = null;
                    setDragOver(null);
                  }}
                  onDragEnd={() => { dragFrom.current = null; setDragOver(null); }}
                  onClick={() => { setSelectedRank(p.rank); setPanelMode("player"); }}
                >
                  <span className="rb-grip" title="Drag to reorder">⋮⋮</span>
                  <span className="rb-rank" style={{ color: t.color }}>{p.rank}</span>
                  <span className="rb-row-name">{p.name || <em className="rb-empty">— new player —</em>}</span>
                  <span className="rb-row-meta">{p.pos} · {p.nbaTeam || p.school || "—"}</span>
                  <button
                    className="rb-row-del"
                    title="Remove from board"
                    onClick={(e) => { e.stopPropagation(); removePlayer(p.rank); }}
                  >✕</button>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Right: edit panel (player editor or tier manager) ── */}
        <div className="rb-panel">
          {panelMode === "tiers" ? (
            <TierManager
              tiers={tiers}
              onPatch={patchTier}
              ranges={tierRanges}
              onSetTierEnd={setTierEnd}
              onRestoreTier={restoreTier}
              boardSize={players.length}
              versions={versions}
              currentVersion={liveVersion || version}
            />
          ) : !selected ? (
            <div className="rb-edit">
              <p className="rb-hint" style={{ marginTop: 0 }}>
                Select a player on the left to edit ratings, verdict, tier and bio —
                or use <strong>+ Add player</strong> to bring one in from Matt&apos;s board.
              </p>
            </div>
          ) : (
            <div className="rb-edit">
              <div className="rb-edit-head">
                <span className="rb-edit-rank">#{selected.rank}</span>
                <input
                  className="rb-input rb-name-input"
                  value={selected.name}
                  placeholder="Player name"
                  onChange={(e) => patchSelected({ name: e.target.value }, `name-${selected.rank}`)}
                />
                <button className="rb-btn ghost sm" onClick={() => setPanelMode("tiers")}>Tiers ⚙</button>
              </div>

              <div className="rb-grid3">
                <label className="rb-field">
                  <span>College</span>
                  <input className="rb-input" value={selected.school}
                    onChange={(e) => patchSelected({ school: e.target.value }, `school-${selected.rank}`)} />
                </label>
                <label className="rb-field">
                  <span>NBA Team</span>
                  <input className="rb-input" value={selected.nbaTeam ?? ""} placeholder="MEM"
                    onChange={(e) => patchSelected({ nbaTeam: e.target.value }, `nbaTeam-${selected.rank}`)} />
                </label>
                <label className="rb-field">
                  <span>Contract</span>
                  <input className="rb-input" value={selected.contract ?? ""} placeholder="Rookie Scale"
                    onChange={(e) => patchSelected({ contract: e.target.value }, `contract-${selected.rank}`)} />
                </label>
                <label className="rb-field">
                  <span>Position</span>
                  <select className="rb-input" value={selected.pos}
                    onChange={(e) => patchSelected({ pos: e.target.value })}>
                    {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label className="rb-field">
                  <span>Height</span>
                  <input className="rb-input" value={selected.ht} placeholder={`6'8"`}
                    onChange={(e) => patchSelected({ ht: e.target.value }, `ht-${selected.rank}`)} />
                </label>
                <label className="rb-field">
                  <span>Age</span>
                  <input className="rb-input" type="number" step="0.1" value={selected.age ?? ""}
                    onChange={(e) => patchSelected({ age: e.target.value === "" ? null : Number(e.target.value) }, `age-${selected.rank}`)} />
                </label>
                <label className="rb-field rb-field-wide">
                  <span>Tier</span>
                  <select className="rb-input" value={selected.tier}
                    onChange={(e) => patchSelected({ tier: Number(e.target.value) })}>
                    {tiers.map((t) => <option key={t.id} value={t.id}>{t.id} · {t.label}</option>)}
                  </select>
                </label>
              </div>

              <div className="rb-section">Category ratings</div>
              <div className="rb-stats">
                {CATS.map((cat) => (
                  <div className="rb-stat" key={cat}>
                    <span className="rb-stat-label">{CAT_LABELS[cat]}</span>
                    <StarPicker
                      value={selected[cat] as string}
                      onChange={(v) => patchSelected({ [cat]: v } as Partial<BoardPlayer>)}
                    />
                  </div>
                ))}
              </div>

              <div className="rb-section">Dynasty verdict</div>
              <textarea
                className="rb-input rb-verdict"
                rows={7}
                value={selected.verdict}
                placeholder="Add or amend the dynasty verdict…"
                onChange={(e) => patchSelected({ verdict: e.target.value }, `verdict-${selected.rank}`)}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Add-player picker: pool prospects not already on the board ── */}
      {pickerOpen && (
        <div className="rb-modal-backdrop" onClick={() => setPickerOpen(false)}>
          <div className="rb-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rb-modal-head">
              <div>
                <div className="rb-section" style={{ margin: 0 }}>Add a prospect</div>
                <div className="rb-modal-sub">
                  {availableProspects.length} available · from Matt&apos;s top-100 board, minus players already ranked
                </div>
              </div>
              <button className="rb-btn ghost sm" onClick={() => setPickerOpen(false)}>✕</button>
            </div>
            <input
              autoFocus
              className="rb-input"
              placeholder="Search by name or team…"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
            />
            <button className="rb-pool-custom" onClick={() => addPlayer()}>
              ✎ Add a custom player (not on Matt&apos;s board)
            </button>
            <div className="rb-pool-list">
              {availableProspects.length === 0 ? (
                <div className="rb-hint" style={{ padding: "12px 4px" }}>No matching prospects.</div>
              ) : (
                availableProspects.map((p) => {
                  const age = ageFromBirthdate(p.birthdate) ?? p.age;
                  return (
                    <button key={p.name} className="rb-pool-row" onClick={() => addPlayer(p)}>
                      <span className="rb-pool-rank">#{p.rank}</span>
                      <span className="rb-pool-name">{p.name}</span>
                      <span className="rb-pool-meta">
                        {p.pos} · {p.team}{p.ht ? ` · ${p.ht}` : ""}{age != null ? ` · ${age.toFixed(1)}y` : ""}
                      </span>
                      <span className="rb-pool-add">+ Add</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {toast && <div className={"rb-toast " + toast.kind}>{toast.msg}</div>}
      <style>{STYLES}</style>
    </div>
  );
}

// ── Tier manager + version history (shown when no player selected) ──
type TierRange = { start: number; end: number; count: number; isLast: boolean; minEnd: number; maxEnd: number };
function TierManager({
  tiers, onPatch, ranges, onSetTierEnd, onRestoreTier, boardSize, versions, currentVersion,
}: {
  tiers: BoardTier[];
  onPatch: (id: number, patch: Partial<BoardTier>, coalesceKey?: string) => void;
  ranges: Record<number, TierRange>;
  onSetTierEnd: (id: number, end: number) => void;
  onRestoreTier: (id: number) => void;
  boardSize: number;
  versions: VersionEntry[];
  currentVersion: string;
}) {
  return (
    <div className="rb-edit">
      <div className="rb-section" style={{ marginTop: 0 }}>Tiers — rename, recolor &amp; set ranges</div>
      <div className="rb-tier-list">
        {tiers.map((t) => {
          const r = ranges[t.id];
          return (
            <div className="rb-tier-edit" key={t.id}>
              <span className="rb-tier-id">{t.id}</span>
              <input
                type="color"
                className="rb-color"
                value={resolveColor(t.color)}
                onChange={(e) => onPatch(t.id, { color: e.target.value }, `tiercolor-${t.id}`)}
                title="Tier color"
              />
              <input
                className="rb-input"
                value={t.label}
                onChange={(e) => onPatch(t.id, { label: e.target.value.toUpperCase().replace(/\s+/g, "_") }, `tierlabel-${t.id}`)}
              />
              {r ? (
                <div className="rb-tier-range" title="Ranks in this tier — move the boundary with the tier below">
                  <span className="rb-range-text">{r.start}–{r.isLast ? boardSize : r.end}</span>
                  {!r.isLast && (
                    <span className="rb-range-steppers">
                      <button onClick={() => onSetTierEnd(t.id, r.end - 1)} disabled={r.end <= r.minEnd} title="Shrink (give a player to the next tier)">−</button>
                      <button onClick={() => onSetTierEnd(t.id, r.end + 1)} disabled={r.end >= r.maxEnd} title="Grow (take a player from the next tier)">+</button>
                    </span>
                  )}
                </div>
              ) : (
                <button
                  className="rb-tier-restore"
                  onClick={() => onRestoreTier(t.id)}
                  title="This tier has no players — pull one in from the neighbouring tier"
                >↻ Restore</button>
              )}
            </div>
          );
        })}
      </div>
      <p className="rb-hint">
        Use <strong>− / +</strong> to move each tier&apos;s lower boundary, e.g. grow tier 1 from 1–1 to 1–2.
        Colors and labels reflect the live board. Select a player on the left to set an individual tier.
      </p>

      {versions.length > 0 && (
        <>
          <div className="rb-section">Version history</div>
          <div className="rb-versions">
            {[...versions].reverse().map((v) => (
              <div
                key={v.version}
                className={"rb-version" + (v.version === currentVersion ? " current" : "")}
              >
                <strong>v{v.version}</strong>
                <span>{v.label}</span>
                <span className="rb-version-meta">{v.savedAt} · {v.players}p{v.version === currentVersion ? " · live" : ""}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** <input type=color> needs a 6-digit hex. Tier colors may be stored as CSS
 * variables (var(--dynasty-gold)); resolve those to their real hex via the
 * document so the swatch shows the current color coding, not a grey fallback. */
function resolveColor(c: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  const varMatch = c.match(/var\((--[\w-]+)\)/);
  if (varMatch && typeof window !== "undefined") {
    const val = getComputedStyle(document.documentElement).getPropertyValue(varMatch[1]).trim();
    if (/^#[0-9a-fA-F]{6}$/.test(val)) return val;
    const rgb = val.match(/\d+/g);
    if (rgb && rgb.length >= 3) {
      return "#" + rgb.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
    }
  }
  return "#64748b";
}

const STYLES = `
  .rb-shell { min-height: 100vh; background: #000; color: var(--text-secondary, #cbd5e1);
    font-family: 'Inter', system-ui, sans-serif; padding: 28px 32px 80px; }
  .rb-loading { padding: 80px; text-align: center; color: var(--text-muted, #64748b); }
  .rb-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
    flex-wrap: wrap; margin-bottom: 18px; }
  .rb-eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 3px;
    color: var(--edge-orange, #f97316); margin-bottom: 6px; }
  .rb-title { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 30px; color: #fff; margin: 0; text-transform: uppercase; letter-spacing: .5px; }
  .rb-sub { font-size: 13px; color: var(--text-muted, #94a3b8); margin-top: 6px; }
  .rb-dirty { color: var(--edge-orange, #f97316); font-weight: 600; }
  .rb-head-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .rb-toggle { display: inline-flex; background: var(--bg-card, #131a28); border: 1px solid var(--border-main, #1e293b);
    border-radius: 9px; padding: 3px; gap: 3px; }
  .rb-toggle-btn { font-family: 'Oswald', sans-serif; font-size: 13px; letter-spacing: .5px; text-transform: uppercase;
    border: none; background: none; color: var(--text-muted, #94a3b8); padding: 7px 14px; border-radius: 7px; cursor: pointer; }
  .rb-toggle-btn.on { background: var(--edge-orange, #f97316); color: #1a0e00; font-weight: 700; }
  .rb-link { color: var(--blueprint-glow, #38bdf8); font-size: 12px; text-decoration: none; }
  .rb-link:hover { text-decoration: underline; }
  .rb-btn { font-family: 'Oswald', sans-serif; font-size: 13px; letter-spacing: .5px; text-transform: uppercase;
    border-radius: 8px; padding: 9px 14px; cursor: pointer; border: 1px solid transparent; }
  .rb-btn.sm { padding: 5px 9px; font-size: 11px; }
  .rb-btn.primary { background: var(--green-elite, #22c55e); color: #06210f; font-weight: 700; }
  .rb-btn.primary:disabled { background: #1e293b; color: #475569; cursor: not-allowed; }
  .rb-btn.ghost { background: transparent; border-color: var(--border-main, #1e293b); color: var(--text-secondary, #cbd5e1); }
  .rb-btn.ghost:hover { border-color: var(--edge-orange, #f97316); }
  .rb-btn.ghost:disabled { opacity: .4; cursor: not-allowed; }
  .rb-btn.wip { background: transparent; border-color: var(--dynasty-gold, #f0c040); color: var(--dynasty-gold, #f0c040); font-weight: 700; }
  .rb-btn.wip:hover:not(:disabled) { background: rgba(240,192,64,.1); }
  .rb-btn.wip:disabled { opacity: .4; cursor: not-allowed; }
  .rb-btn.details { background: var(--blueprint-glow, #38bdf8); color: #04222e; font-weight: 700; }
  .rb-btn.details:hover:not(:disabled) { filter: brightness(1.08); }
  .rb-btn.details:disabled { background: #1e293b; color: #475569; cursor: not-allowed; }
  .rb-draft-tag { color: var(--dynasty-gold, #f0c040); font-weight: 600; }
  .rb-draft-banner { display: flex; align-items: center; justify-content: space-between; gap: 14px;
    background: rgba(240,192,64,.1); border: 1px solid rgba(240,192,64,.35); color: #f5d77a;
    padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
  .rb-draft-banner strong { color: #fff; }
  .rb-warn { background: rgba(249,115,22,.1); border: 1px solid rgba(249,115,22,.35); color: #fdba74;
    padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
  .rb-warn code { font-family: 'JetBrains Mono', monospace; color: #fff; }

  .rb-body { display: grid; grid-template-columns: minmax(340px, 1fr) minmax(380px, 1.1fr); gap: 22px; align-items: start; }
  @media (max-width: 900px) { .rb-body { grid-template-columns: 1fr; } }

  .rb-list { background: var(--bg-surface, #0f1420); border: 1px solid var(--border-main, #1e293b); border-radius: 14px; padding: 10px; }
  .rb-tier-divider { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; letter-spacing: 2px;
    padding: 14px 8px 6px; }
  .rb-row { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 9px;
    cursor: pointer; border: 1px solid transparent; background: var(--bg-card, #131a28); margin-bottom: 4px; transition: border-color .12s; }
  .rb-row:hover { border-color: var(--border-main, #334155); }
  .rb-row.sel { border-color: var(--edge-orange, #f97316); background: rgba(249,115,22,.08); }
  .rb-row.dragover { border-color: var(--blueprint-glow, #38bdf8); border-style: dashed; }
  .rb-grip { color: var(--text-muted, #475569); cursor: grab; font-size: 13px; letter-spacing: -2px; }
  .rb-rank { font-family: 'Oswald', sans-serif; font-weight: 800; font-size: 18px; min-width: 28px; text-align: center; }
  .rb-row-name { font-weight: 600; color: #fff; font-size: 14px; flex: 0 0 auto; }
  .rb-empty { color: var(--text-muted, #64748b); font-weight: 400; }
  .rb-row-meta { font-size: 11px; color: var(--text-muted, #64748b); margin-left: auto; white-space: nowrap; }
  .rb-row-del { background: none; border: none; color: var(--text-muted, #475569); cursor: pointer; font-size: 12px; padding: 2px 4px; }
  .rb-row-del:hover { color: var(--red-severe, #ef4444); }

  .rb-panel { background: var(--bg-surface, #0f1420); border: 1px solid var(--border-main, #1e293b); border-radius: 14px;
    padding: 20px; position: sticky; top: 20px; }
  .rb-edit-head { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
  .rb-edit-rank { font-family: 'Oswald', sans-serif; font-weight: 800; font-size: 22px; color: var(--edge-orange, #f97316); }
  .rb-name-input { font-size: 16px; font-weight: 700; flex: 1; }
  .rb-grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 8px; }
  .rb-field { display: flex; flex-direction: column; gap: 4px; }
  .rb-field-wide { grid-column: 1 / -1; }
  .rb-field > span { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 1px; color: var(--text-muted, #64748b); text-transform: uppercase; }
  .rb-input { background: var(--bg-card, #0b1018); border: 1px solid var(--border-main, #334155); border-radius: 7px;
    color: #fff; padding: 8px 10px; font-size: 13px; font-family: inherit; width: 100%; }
  .rb-input:focus { outline: none; border-color: var(--edge-orange, #f97316); }
  .rb-section { font-family: 'Oswald', sans-serif; text-transform: uppercase; letter-spacing: 2px; font-size: 12px;
    color: var(--edge-orange, #f97316); margin: 20px 0 12px; }
  .rb-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 14px; }
  .rb-stat { display: flex; flex-direction: column; gap: 4px; }
  .rb-stat-label { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 1px; color: var(--text-muted, #64748b); }
  .rb-star-picker { display: flex; gap: 2px; }
  .rb-star-dot { background: none; border: none; cursor: pointer; font-size: 16px; line-height: 1; padding: 0; color: var(--border-main, #334155); }
  .rb-star-dot.on { color: var(--dynasty-gold, #f0c040); }
  .rb-verdict { resize: vertical; line-height: 1.6; }

  .rb-tier-list { display: flex; flex-direction: column; gap: 8px; }
  .rb-tier-edit { display: flex; align-items: center; gap: 10px; }
  .rb-tier-id { font-family: 'Oswald', sans-serif; font-weight: 800; width: 22px; text-align: center; color: var(--text-muted, #94a3b8); }
  .rb-tier-range { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .rb-range-text { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-secondary, #cbd5e1);
    min-width: 42px; text-align: right; font-variant-numeric: tabular-nums; }
  .rb-range-steppers { display: inline-flex; gap: 3px; }
  .rb-range-steppers button { width: 22px; height: 24px; border-radius: 6px; cursor: pointer;
    background: var(--bg-card, #131a28); border: 1px solid var(--border-main, #334155);
    color: var(--text-secondary, #cbd5e1); font-size: 14px; line-height: 1; padding: 0; }
  .rb-range-steppers button:hover:not(:disabled) { border-color: var(--edge-orange, #f97316); color: #fff; }
  .rb-range-steppers button:disabled { opacity: .3; cursor: not-allowed; }
  .rb-tier-empty { font-size: 11px; color: var(--text-muted, #64748b); font-style: italic; }
  .rb-tier-restore { background: rgba(240,192,64,.12); border: 1px solid rgba(240,192,64,.4); color: var(--dynasty-gold, #f0c040);
    border-radius: 6px; padding: 4px 8px; font-size: 11px; cursor: pointer; white-space: nowrap; }
  .rb-tier-restore:hover { background: rgba(240,192,64,.22); }
  .rb-color { width: 34px; height: 30px; border: 1px solid var(--border-main, #334155); border-radius: 6px; background: none; cursor: pointer; padding: 2px; }
  .rb-hint { font-size: 12px; color: var(--text-muted, #64748b); margin: 14px 0 0; }
  .rb-versions { display: flex; flex-direction: column; gap: 6px; }
  .rb-version { display: flex; align-items: baseline; gap: 10px; padding: 8px 10px; border-radius: 8px; text-decoration: none;
    background: var(--bg-card, #131a28); border: 1px solid var(--border-main, #1e293b); color: var(--text-secondary, #cbd5e1); font-size: 12px; }
  .rb-version:hover { border-color: var(--blueprint-glow, #38bdf8); }
  .rb-version.current { border-color: var(--green-elite, #22c55e); }
  .rb-version strong { color: #fff; font-family: 'JetBrains Mono', monospace; }
  .rb-version-meta { margin-left: auto; color: var(--text-muted, #64748b); }

  .rb-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 50;
    padding: 12px 20px; border-radius: 10px; font-size: 13px; max-width: 90vw; box-shadow: 0 10px 30px rgba(0,0,0,.5); }
  .rb-toast.ok { background: var(--green-elite, #22c55e); color: #06210f; font-weight: 600; }
  .rb-toast.err { background: var(--red-severe, #ef4444); color: #fff; }

  /* ── Add-player picker modal ── */
  .rb-modal-backdrop { position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,.6);
    display: flex; align-items: flex-start; justify-content: center; padding: 8vh 16px; }
  .rb-modal { background: var(--bg-surface, #0f1420); border: 1px solid var(--border-main, #1e293b);
    border-radius: 14px; padding: 18px; width: 100%; max-width: 520px; display: flex; flex-direction: column; gap: 12px;
    box-shadow: 0 20px 60px rgba(0,0,0,.6); }
  .rb-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .rb-modal-sub { font-size: 12px; color: var(--text-muted, #64748b); margin-top: 4px; }
  .rb-pool-custom { text-align: left; background: var(--bg-card, #131a28); border: 1px dashed var(--border-main, #334155);
    color: var(--text-secondary, #cbd5e1); border-radius: 8px; padding: 9px 12px; font-size: 12px; cursor: pointer; }
  .rb-pool-custom:hover { border-color: var(--edge-orange, #f97316); color: #fff; }
  .rb-pool-list { display: flex; flex-direction: column; gap: 4px; max-height: 52vh; overflow-y: auto; }
  .rb-pool-row { display: flex; align-items: center; gap: 10px; text-align: left; width: 100%;
    background: var(--bg-card, #131a28); border: 1px solid var(--border-main, #1e293b); border-radius: 8px;
    padding: 8px 11px; cursor: pointer; color: var(--text-secondary, #cbd5e1); }
  .rb-pool-row:hover { border-color: var(--edge-orange, #f97316); }
  .rb-pool-rank { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-muted, #64748b); min-width: 34px; }
  .rb-pool-name { font-weight: 600; color: #fff; font-size: 14px; }
  .rb-pool-meta { font-size: 11px; color: var(--text-muted, #64748b); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rb-pool-add { margin-left: auto; font-family: 'Oswald', sans-serif; font-size: 11px; text-transform: uppercase;
    letter-spacing: 1px; color: var(--edge-orange, #f97316); white-space: nowrap; }
`;
