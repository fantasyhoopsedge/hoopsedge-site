"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { PlatformSidebarNav } from "@/components/platform-sidebar-nav";
import { PlayerHeadshot } from "@/app/team-rosters/_components/roster-headshot";
import { TEAM_LOGO } from "@/app/team-rosters/_components/roster-data";
import { downloadCsv } from "@/lib/csv-export";
import {
  ROLE_TAGS, ROLE_TAG_LABEL, renumber, moveFromConsensus, moveFromConsensusAvg,
  type DynastyBoardPlayer, type EcosystemPlayer, type RoleTag,
} from "@/lib/dynasty-board";

const POSITIONS = ["G", "F", "C", "G/F", "F/C"];

function initials(name: string): string {
  const parts = name.trim().split(" ");
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function TeamLogo({ team }: { team: string }) {
  const [ok, setOk] = useState(true);
  const file = TEAM_LOGO[team];
  if (!file || !ok || team === "FA") {
    return <span className="dyb-team-pill">{team || "FA"}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small fixed-size crest, no next/image config needed
    <img
      src={`/images/nba%20team%20images/${file}`}
      alt={team}
      width={20}
      height={20}
      onError={() => setOk(false)}
      style={{ width: 20, height: 20, objectFit: "contain", display: "block" }}
    />
  );
}

/** Renders a ▲N/▼N/—/NEW badge for a precomputed rank delta. Shared by the
 * "vs Baseline" and "vs Consensus Avg" comparisons — both dynamically recompute
 * as the custom order changes, since `delta` is derived fresh on every render. */
function MoveBadge({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="dyb-move new">NEW</span>;
  if (delta === 0) return <span className="dyb-move flat">—</span>;
  const up = delta > 0;
  return (
    <span className={"dyb-move" + (up ? " up" : " down")}>
      {up ? "▲" : "▼"} {Math.abs(delta)}
    </span>
  );
}

function RoleBadge({ tag }: { tag: DynastyBoardPlayer["roleTag"] }) {
  if (!tag) return <span className="dyb-role none">—</span>;
  return <span className={"dyb-role " + tag}>{ROLE_TAG_LABEL[tag] ?? tag}</span>;
}

const f1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const fInt = (v: number | null) => (v == null ? "—" : String(Math.round(v)));
const fRank = (v: number | null) => (v == null ? "—" : `#${v}`);

type PlayerClass = "rookie" | "sophomore" | "veteran";
const CLASS_LABEL: Record<PlayerClass, string> = { rookie: "Rookie", sophomore: "Sophomore", veteran: "Veteran" };
function classOf(p: DynastyBoardPlayer): PlayerClass {
  if (p.isRookie) return "rookie";
  if (p.isSophomore) return "sophomore";
  return "veteran";
}

/** Toggles `value` in/out of a string[] filter set, used by the multi-select chip groups. */
function toggleIn(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function DynastyBoardEditor() {
  const [players, setPlayers] = useState<DynastyBoardPlayer[]>([]);
  const [canWrite, setCanWrite] = useState(true);
  const [isDraft, setIsDraft] = useState(false);
  const [isSeed, setIsSeed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [classFilter, setClassFilter] = useState<string[]>([]);
  const [contractFilter, setContractFilter] = useState<string[]>([]);

  const dragKey = useRef<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const [history, setHistory] = useState<DynastyBoardPlayer[][]>([]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pool, setPool] = useState<EcosystemPlayer[] | null>(null);
  const [poolLoading, setPoolLoading] = useState(false);

  // ── load ──
  useEffect(() => {
    fetch("/api/admin/dynasty-board")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setPlayers(d.doc.players);
        setIsDraft(Boolean(d.isDraft));
        setIsSeed(Boolean(d.isSeed));
        setCanWrite(d.canWrite);
      })
      .catch((e) => setToast({ kind: "err", msg: e.message }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

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

  const selected = useMemo(() => players.find((p) => p.name === selectedKey) ?? null, [players, selectedKey]);

  const teamOptions = useMemo(() => {
    const set = new Set(players.map((p) => p.team).filter(Boolean));
    return [...set].sort();
  }, [players]);

  const contractOptions = useMemo(() => {
    const set = new Set(players.map((p) => p.contractStatus).filter((v): v is string => Boolean(v)));
    return [...set].sort();
  }, [players]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (posFilter && p.position !== posFilter) return false;
      if (teamFilter && p.team !== teamFilter) return false;
      if (roleFilter && (p.roleTag ?? "") !== roleFilter) return false;
      if (classFilter.length && !classFilter.includes(classOf(p))) return false;
      if (contractFilter.length && !contractFilter.includes(p.contractStatus ?? "")) return false;
      return true;
    });
  }, [players, search, posFilter, teamFilter, roleFilter, classFilter, contractFilter]);

  const filtersActive = Boolean(
    search || posFilter || teamFilter || roleFilter || classFilter.length || contractFilter.length,
  );

  // ── undo ──
  function pushHistory() {
    setHistory((h) => [...h.slice(-49), players]);
  }
  function undo() {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    setPlayers(last);
    setHistory((h) => h.slice(0, -1));
    setDirty(history.length > 1);
  }

  // ── reordering — keyed by player name so it stays correct under an active filter ──
  function reorder(fromName: string, toName: string) {
    if (fromName === toName) return;
    pushHistory();
    setPlayers((prev) => {
      const next = [...prev];
      const fromIdx = next.findIndex((p) => p.name === fromName);
      const toIdx = next.findIndex((p) => p.name === toName);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return renumber(next);
    });
    setDirty(true);
  }

  function moveBy(name: string, delta: number) {
    pushHistory();
    setPlayers((prev) => {
      const idx = prev.findIndex((p) => p.name === name);
      if (idx === -1) return prev;
      const to = Math.max(0, Math.min(prev.length - 1, idx + delta));
      if (to === idx) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(to, 0, moved);
      return renumber(next);
    });
    setDirty(true);
  }

  function moveToRank(name: string, rank: number) {
    pushHistory();
    setPlayers((prev) => {
      const idx = prev.findIndex((p) => p.name === name);
      if (idx === -1) return prev;
      const to = Math.max(0, Math.min(prev.length - 1, rank - 1));
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(to, 0, moved);
      return renumber(next);
    });
    setDirty(true);
  }

  function patchSelected(patch: Partial<DynastyBoardPlayer>) {
    if (!selectedKey) return;
    setPlayers((prev) => prev.map((p) => (p.name === selectedKey ? { ...p, ...patch } : p)));
    setDirty(true);
  }

  function removePlayer(name: string) {
    pushHistory();
    setPlayers((prev) => renumber(prev.filter((p) => p.name !== name)));
    if (selectedKey === name) setSelectedKey(null);
    setDirty(true);
  }

  /** Appends an ecosystem-pool candidate to the bottom of the board — no
   * FHE/FBI Baseline rank (consensusRank stays null, shown as "NEW"). */
  function addPlayer(candidate: EcosystemPlayer) {
    pushHistory();
    setPlayers((prev) => {
      if (prev.some((p) => p.name === candidate.name)) return prev; // already on the board
      const next: DynastyBoardPlayer[] = [
        ...prev,
        { ...candidate, customRank: prev.length + 1, consensusRank: null, consensusAvgRank: null, note: "" },
      ];
      return renumber(next);
    });
    setDirty(true);
  }

  function openPicker() {
    setPickerQuery("");
    setPickerOpen(true);
    if (pool === null && !poolLoading) {
      setPoolLoading(true);
      fetch("/api/admin/dynasty-board/pool")
        .then((r) => r.json())
        .then((d) => {
          if (d.error) throw new Error(d.error);
          setPool(d.pool);
        })
        .catch((e) => setToast({ kind: "err", msg: e.message }))
        .finally(() => setPoolLoading(false));
    }
  }

  const boardNames = useMemo(() => new Set(players.map((p) => p.name)), [players]);
  const pickerResults = useMemo(() => {
    if (!pool) return [];
    const q = pickerQuery.trim().toLowerCase();
    return pool
      .filter((c) => !boardNames.has(c.name))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.team.toLowerCase().includes(q));
  }, [pool, pickerQuery, boardNames]);

  // ── persistence ──
  async function saveDraft() {
    if (!canWrite) { setToast({ kind: "err", msg: "You don't have edit access." }); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/dynasty-board", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ players, draft: true }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "draft save failed");
      setPlayers(d.doc.players);
      setIsDraft(true);
      setIsSeed(false);
      setDirty(false);
      setToast({ kind: "ok", msg: "WIP draft saved." });
    } catch (e) {
      setToast({ kind: "err", msg: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!canWrite) { setToast({ kind: "err", msg: "You don't have edit access." }); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/dynasty-board", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ players }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "publish failed");
      setPlayers(d.doc.players);
      setIsDraft(false);
      setIsSeed(false);
      setDirty(false);
      setHistory([]);
      setToast({ kind: "ok", msg: `Published ${d.players} players. Export CSV any time to take a snapshot.` });
    } catch (e) {
      setToast({ kind: "err", msg: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function discardDraft() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/dynasty-board", { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "discard failed");
      setPlayers(d.doc.players);
      setIsDraft(false);
      setIsSeed(Boolean(d.isSeed));
      setDirty(false);
      setHistory([]);
      setSelectedKey(null);
      setToast({ kind: "ok", msg: "Draft discarded." });
    } catch (e) {
      setToast({ kind: "err", msg: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function resetToConsensus() {
    if (!window.confirm("Reset to the FHE/FBI Baseline order? Your current custom order will be replaced (saved as a new WIP draft).")) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/dynasty-board", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "reset failed");
      setPlayers(d.doc.players);
      setIsDraft(true);
      setIsSeed(false);
      setDirty(false);
      setHistory([]);
      setSelectedKey(null);
      setToast({ kind: "ok", msg: "Reset to FHE/FBI Baseline order — saved as a WIP draft." });
    } catch (e) {
      setToast({ kind: "err", msg: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const columns = [
      "Rank", "Player", "Team", "Position", "Age",
      "FHE/FBI Baseline Rank", "Move vs Baseline",
      "v1.1 Consensus Avg Rank", "Move vs Consensus Avg",
      "Rookie", "Sophomore", "Role", "Contract", "Contract Status",
      "Minus1V Rank", "MPG", "GP", "USG%", "Note",
    ];
    const rows = players.map((p) => [
      p.customRank, p.name, p.team, p.position,
      p.age != null ? p.age.toFixed(1) : "",
      p.consensusRank, moveFromConsensus(p),
      p.consensusAvgRank != null ? p.consensusAvgRank.toFixed(1) : "", moveFromConsensusAvg(p),
      p.isRookie ? "Yes" : "No", p.isSophomore ? "Yes" : "No",
      p.roleTag ? (ROLE_TAG_LABEL[p.roleTag] ?? p.roleTag) : "",
      p.contract, p.contractStatus ?? "",
      p.minus1vRank ?? "", p.mpg != null ? p.mpg.toFixed(1) : "", p.gp != null ? Math.round(p.gp) : "",
      p.usg != null ? p.usg.toFixed(1) + "%" : "", p.note,
    ]);
    downloadCsv(`dynasty-board-${new Date().toISOString().slice(0, 10)}.csv`, columns, rows);
    setToast({ kind: "ok", msg: `Exported ${players.length} players to CSV.` });
  }

  if (loading) {
    return (
      <div className="dyb-shell">
        <PlatformSidebarNav active="dynasty-board-editor" />
        <div className="dyb-loading">Loading board…</div>
        <style>{STYLES}</style>
      </div>
    );
  }

  return (
    <div className="dyb-shell">
      <PlatformSidebarNav active="dynasty-board-editor" />

      <header className="dyb-head">
        <div>
          <div className="dyb-eyebrow">FHE ADMIN · CUSTOM RANKINGS</div>
          <h1 className="dyb-title">Dynasty Board Editor</h1>
          <div className="dyb-sub">
            Baseline: FHE/FBI rankings · {players.length} players
            {isSeed && <span className="dyb-seed-tag"> · fresh seed, not yet saved</span>}
            {isDraft && <span className="dyb-draft-tag"> · editing WIP draft</span>}
            {dirty && <span className="dyb-dirty"> · unsaved changes</span>}
          </div>
        </div>
        <div className="dyb-head-actions">
          <button className="dyb-btn ghost" onClick={openPicker}>+ Add player</button>
          <button className="dyb-btn ghost" onClick={resetToConsensus} disabled={saving}>
            ↺ Reset to baseline
          </button>
          <button className="dyb-btn ghost" onClick={undo} disabled={history.length === 0} title="Undo last reorder (Ctrl+Z)">
            ↩ Undo{history.length > 0 ? ` (${history.length})` : ""}
          </button>
          <button className="dyb-btn ghost" onClick={exportCsv}>⬇ Export CSV</button>
          <button
            className="dyb-btn wip"
            onClick={saveDraft}
            disabled={saving || (!dirty && isDraft)}
            title="Save your work-in-progress without publishing"
          >
            {saving ? "Saving…" : "💾 Save WIP"}
          </button>
          <button className="dyb-btn primary" onClick={publish} disabled={saving || (!dirty && !isDraft && !isSeed)}>
            {saving ? "Publishing…" : "Publish"}
          </button>
        </div>
      </header>

      {isDraft && (
        <div className="dyb-draft-banner">
          <span>
            You&apos;re editing an <strong>unpublished WIP draft</strong>. It&apos;s saved and survives reloads,
            but the published board stays as it was until you publish.
          </span>
          <button className="dyb-btn ghost sm" onClick={discardDraft} disabled={saving}>Discard draft</button>
        </div>
      )}

      {!canWrite && (
        <div className="dyb-warn">Read-only: your account doesn&apos;t have board-editing access.</div>
      )}

      <div className="dyb-filters">
        <input
          className="dyb-search"
          type="text"
          placeholder="Search player…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={posFilter} onChange={(e) => setPosFilter(e.target.value)}>
          <option value="">All positions</option>
          {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
          <option value="">All teams</option>
          {teamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">All roles</option>
          {ROLE_TAGS.map((r) => <option key={r} value={r}>{ROLE_TAG_LABEL[r]}</option>)}
          <option value="cut">{ROLE_TAG_LABEL.cut}</option>
        </select>
        {filtersActive && (
          <span className="dyb-filter-count">{filtered.length} of {players.length} shown</span>
        )}
      </div>

      <div className="dyb-chip-row">
        <div className="dyb-chip-group">
          <span className="dyb-chip-label">Class</span>
          {(["rookie", "sophomore", "veteran"] as PlayerClass[]).map((c) => (
            <button
              key={c}
              type="button"
              className={"dyb-chip" + (classFilter.includes(c) ? " on" : "")}
              onClick={() => setClassFilter((prev) => toggleIn(prev, c))}
            >
              {CLASS_LABEL[c]}
            </button>
          ))}
          {classFilter.length > 0 && (
            <button type="button" className="dyb-chip-clear" onClick={() => setClassFilter([])}>Clear</button>
          )}
        </div>
        <div className="dyb-chip-group">
          <span className="dyb-chip-label">Contract</span>
          {contractOptions.map((c) => (
            <button
              key={c}
              type="button"
              className={"dyb-chip" + (contractFilter.includes(c) ? " on" : "")}
              onClick={() => setContractFilter((prev) => toggleIn(prev, c))}
            >
              {c}
            </button>
          ))}
          {contractFilter.length > 0 && (
            <button type="button" className="dyb-chip-clear" onClick={() => setContractFilter([])}>Clear</button>
          )}
        </div>
      </div>

      <div className="dyb-body">
        <div className="dyb-table-scroll">
          <table className="dyb-table">
            <colgroup>
              <col style={{ width: 28 }} />
              <col style={{ width: 74 }} />
              <col style={{ width: 240 }} />
              <col style={{ width: 46 }} />
              <col style={{ width: 84 }} />
              <col style={{ width: 52 }} />
              <col style={{ width: 74 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 88 }} />
              <col style={{ width: 66 }} />
              <col style={{ width: 52 }} />
              <col style={{ width: 46 }} />
              <col style={{ width: 62 }} />
              <col style={{ width: 190 }} />
              <col style={{ width: 36 }} />
            </colgroup>
            <thead>
              <tr>
                <th className="dyb-th-grip" />
                <th># </th>
                <th>Player</th>
                <th>Pos</th>
                <th>Team</th>
                <th>Age</th>
                <th title="FHE/FBI Baseline rank — currently sourced from the FBI-HE expert's own rank">FHE/FBI#</th>
                <th title="Current v1.1 multi-expert consensus average rank (dynasty-rankings.json)">V1.1#</th>
                <th>Role</th>
                <th title="Minus1V per-game projected rank">M-1V#</th>
                <th>MPG</th>
                <th>GP</th>
                <th>USG%</th>
                <th>Contract</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.name}
                  className={
                    "dyb-row" +
                    (selectedKey === p.name ? " sel" : "") +
                    (dragOverKey === p.name ? " dragover" : "")
                  }
                  draggable={!filtersActive}
                  onDragStart={() => { dragKey.current = p.name; }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverKey(p.name); }}
                  onDragLeave={() => setDragOverKey((k) => (k === p.name ? null : k))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragKey.current) reorder(dragKey.current, p.name);
                    dragKey.current = null;
                    setDragOverKey(null);
                  }}
                  onDragEnd={() => { dragKey.current = null; setDragOverKey(null); }}
                  onClick={() => setSelectedKey(p.name)}
                >
                  <td className="dyb-td-grip">
                    <span className="dyb-grip" title={filtersActive ? "Clear filters to drag-reorder" : "Drag to reorder"}>⋮⋮</span>
                  </td>
                  <td className="dyb-td-rank">
                    <div className="dyb-rank-stack">
                      <span className="dyb-rank-num">{p.customRank}</span>
                      <MoveBadge delta={moveFromConsensus(p)} />
                    </div>
                    <div className="dyb-nudge">
                      <button onClick={(e) => { e.stopPropagation(); moveBy(p.name, -1); }} title="Move up" aria-label="Move up">▲</button>
                      <button onClick={(e) => { e.stopPropagation(); moveBy(p.name, 1); }} title="Move down" aria-label="Move down">▼</button>
                    </div>
                  </td>
                  <td className="dyb-td-player">
                    <div className="dyb-player-cell">
                      <PlayerHeadshot
                        name={p.name}
                        size={30}
                        initials={initials(p.name)}
                        background="var(--rt-surface-strong)"
                        color="var(--rt-ink)"
                        fontSize={11}
                        rookie={p.isRookie}
                      />
                      <div className="dyb-player-name">
                        <span>{p.name}</span>
                        {p.isRookie && <span className="dyb-tag rook">R</span>}
                        {!p.isRookie && p.isSophomore && <span className="dyb-tag soph">S</span>}
                        {p.note && <span className="dyb-tag note" title={p.note}>note</span>}
                      </div>
                    </div>
                  </td>
                  <td className="dyb-pos">{p.position}</td>
                  <td><div className="dyb-team-cell"><TeamLogo team={p.team} />{p.team || "FA"}</div></td>
                  <td className="dyb-num">{p.age != null ? p.age.toFixed(1) : "—"}</td>
                  <td className="dyb-num dyb-muted">{p.consensusRank != null ? `#${p.consensusRank}` : "—"}</td>
                  <td className="dyb-num dyb-muted">
                    <div className="dyb-rank-stack">
                      <span>{p.consensusAvgRank != null ? p.consensusAvgRank.toFixed(1) : "—"}</span>
                      <MoveBadge delta={moveFromConsensusAvg(p)} />
                    </div>
                  </td>
                  <td><RoleBadge tag={p.roleTag} /></td>
                  <td className="dyb-num">{fRank(p.minus1vRank)}</td>
                  <td className="dyb-num">{f1(p.mpg)}</td>
                  <td className="dyb-num">{fInt(p.gp)}</td>
                  <td className="dyb-num">{p.usg != null ? p.usg.toFixed(1) + "%" : "—"}</td>
                  <td className="dyb-contract">{p.contract || "—"}</td>
                  <td className="dyb-td-remove">
                    <button
                      className="dyb-remove-btn"
                      title={`Remove ${p.name} from the board`}
                      aria-label={`Remove ${p.name}`}
                      onClick={(e) => { e.stopPropagation(); removePlayer(p.name); }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={14} className="dyb-empty">No players match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Detail panel ── */}
        <aside className="dyb-panel">
          {!selected ? (
            <div className="dyb-panel-empty">Select a player to see full details and add a note.</div>
          ) : (
            <div className="dyb-panel-body">
              <div className="dyb-panel-head">
                <PlayerHeadshot
                  name={selected.name}
                  size={56}
                  initials={initials(selected.name)}
                  background="var(--rt-surface-strong)"
                  color="var(--rt-ink)"
                  fontSize={18}
                  rookie={selected.isRookie}
                />
                <div>
                  <div className="dyb-panel-name">{selected.name}</div>
                  <div className="dyb-panel-meta">
                    {selected.position} · <TeamLogo team={selected.team} /> {selected.team || "FA"}
                    {selected.age != null ? ` · ${selected.age.toFixed(1)} yo` : ""}
                  </div>
                </div>
              </div>

              <div className="dyb-panel-grid">
                <div><div className="dyb-panel-label">Custom rank</div><div className="dyb-panel-value">#{selected.customRank}</div></div>
                <div><div className="dyb-panel-label">FHE/FBI Baseline rank</div><div className="dyb-panel-value">{selected.consensusRank != null ? `#${selected.consensusRank}` : "Not on baseline"}</div></div>
                <div><div className="dyb-panel-label">v1.1 Consensus Avg rank</div><div className="dyb-panel-value">{selected.consensusAvgRank != null ? selected.consensusAvgRank.toFixed(1) : "—"}</div></div>
                <div><div className="dyb-panel-label">Move vs. baseline</div><div className="dyb-panel-value"><MoveBadge delta={moveFromConsensus(selected)} /></div></div>
                <div><div className="dyb-panel-label">Move vs. consensus avg</div><div className="dyb-panel-value"><MoveBadge delta={moveFromConsensusAvg(selected)} /></div></div>
                <div><div className="dyb-panel-label">Minus1V rank</div><div className="dyb-panel-value">{fRank(selected.minus1vRank)}</div></div>
                <div><div className="dyb-panel-label">MPG</div><div className="dyb-panel-value">{f1(selected.mpg)}</div></div>
                <div><div className="dyb-panel-label">GP</div><div className="dyb-panel-value">{fInt(selected.gp)}</div></div>
                <div><div className="dyb-panel-label">USG%</div><div className="dyb-panel-value">{selected.usg != null ? selected.usg.toFixed(1) + "%" : "—"}</div></div>
                <div><div className="dyb-panel-label">Contract</div><div className="dyb-panel-value">{selected.contract || "—"}</div></div>
              </div>

              <div className="dyb-panel-field">
                <label>Role tag</label>
                <select
                  value={selected.roleTag ?? ""}
                  onChange={(e) => patchSelected({ roleTag: (e.target.value || null) as RoleTag | "cut" | null })}
                >
                  <option value="">—</option>
                  {ROLE_TAGS.map((r) => <option key={r} value={r}>{ROLE_TAG_LABEL[r]}</option>)}
                  <option value="cut">{ROLE_TAG_LABEL.cut}</option>
                </select>
              </div>

              <div className="dyb-panel-field">
                <label>Jump to rank</label>
                <div className="dyb-jump-row">
                  <input
                    type="number"
                    min={1}
                    max={players.length}
                    defaultValue={selected.customRank}
                    key={selected.name + selected.customRank}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") moveToRank(selected.name, Number((e.target as HTMLInputElement).value) || selected.customRank);
                    }}
                    id="dyb-jump-input"
                  />
                  <button
                    className="dyb-btn ghost sm"
                    onClick={() => {
                      const input = document.getElementById("dyb-jump-input") as HTMLInputElement | null;
                      moveToRank(selected.name, Number(input?.value) || selected.customRank);
                    }}
                  >
                    Go
                  </button>
                </div>
              </div>

              <div className="dyb-panel-field">
                <label>Note</label>
                <textarea
                  rows={4}
                  value={selected.note}
                  onChange={(e) => patchSelected({ note: e.target.value.slice(0, 500) })}
                  placeholder="Why did you move them here? (visible in the CSV export)"
                />
              </div>
            </div>
          )}
        </aside>
      </div>

      {pickerOpen && (
        <div className="dyb-modal-backdrop" onClick={() => setPickerOpen(false)}>
          <div className="dyb-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dyb-modal-head">
              <h2>Add a player</h2>
              <button className="dyb-modal-close" onClick={() => setPickerOpen(false)} aria-label="Close">×</button>
            </div>
            <p className="dyb-modal-hint">
              Every ecosystem player not already on the FHE/FBI Baseline. Added players show a{" "}
              <span className="dyb-move new">NEW</span> badge instead of a consensus rank.
            </p>
            <input
              className="dyb-modal-search"
              type="text"
              autoFocus
              placeholder="Search by name or team…"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
            />
            <div className="dyb-modal-list">
              {poolLoading && <div className="dyb-modal-empty">Loading ecosystem players…</div>}
              {!poolLoading && pool !== null && pickerResults.length === 0 && (
                <div className="dyb-modal-empty">
                  {pickerQuery ? "No matches." : "Every ecosystem player is already on the board."}
                </div>
              )}
              {pickerResults.map((c) => (
                <div key={c.name} className="dyb-modal-row">
                  <div className="dyb-modal-row-main">
                    <span className="dyb-modal-row-name">{c.name}</span>
                    <span className="dyb-modal-row-meta">
                      {c.position} · <TeamLogo team={c.team} /> {c.team || "FA"}
                      {c.age != null ? ` · ${c.age.toFixed(1)} yo` : ""}
                      {c.minus1vRank != null ? ` · M-1V ${fRank(c.minus1vRank)}` : ""}
                    </span>
                  </div>
                  <button className="dyb-btn ghost sm" onClick={() => addPlayer(c)}>+ Add</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && <div className={"dyb-toast " + toast.kind}>{toast.msg}</div>}
      <style>{STYLES}</style>
    </div>
  );
}

const STYLES = `
  .dyb-shell { min-height: 100vh; background: var(--rt-canvas); color: var(--rt-body);
    font-family: var(--rt-font-sans); padding: 28px 32px 80px; padding-left: 268px; }
  @media (max-width: 1023px) { .dyb-shell { padding-left: 32px; padding-top: 80px; } }
  .dyb-loading { padding: 80px; text-align: center; color: var(--rt-muted); }

  .dyb-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; flex-wrap: wrap; margin-bottom: 16px; }
  .dyb-eyebrow { font-family: var(--rt-font-mono); font-size: 10px; letter-spacing: 3px; color: var(--rt-primary); margin-bottom: 6px; }
  .dyb-title { font-weight: 700; font-size: 28px; color: var(--rt-body-strong); margin: 0; letter-spacing: -.3px; }
  .dyb-sub { font-size: 13px; color: var(--rt-muted); margin-top: 6px; }
  .dyb-dirty { color: var(--rt-primary); font-weight: 600; }
  .dyb-draft-tag { color: var(--rt-primary); }
  .dyb-seed-tag { color: var(--rt-muted); }

  .dyb-head-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .dyb-btn { font-family: var(--rt-font-sans); font-size: 13px; font-weight: 600; border-radius: 8px;
    padding: 9px 14px; cursor: pointer; border: 1px solid var(--rt-hairline); background: var(--rt-surface-soft);
    color: var(--rt-body-strong); transition: opacity .12s, border-color .12s; }
  .dyb-btn:disabled { opacity: .45; cursor: not-allowed; }
  .dyb-btn.ghost { background: transparent; }
  .dyb-btn.ghost:hover:not(:disabled) { border-color: var(--rt-primary); }
  .dyb-btn.sm { padding: 6px 10px; font-size: 12px; }
  .dyb-btn.wip { background: var(--rt-surface-strong); }
  .dyb-btn.primary { background: var(--rt-primary); color: var(--rt-on-primary); border-color: var(--rt-primary); }
  .dyb-btn.primary:hover:not(:disabled) { background: var(--rt-primary-active); }

  .dyb-draft-banner { display: flex; justify-content: space-between; align-items: center; gap: 12px;
    background: rgba(250,70,22,.08); border: 1px solid rgba(250,70,22,.3); border-radius: 10px;
    padding: 10px 14px; font-size: 13px; color: var(--rt-body); margin-bottom: 14px; }
  .dyb-warn { background: rgba(219,43,57,.1); border: 1px solid rgba(219,43,57,.35); border-radius: 10px;
    padding: 10px 14px; font-size: 13px; color: var(--rt-body); margin-bottom: 14px; }

  .dyb-filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
  .dyb-filters select, .dyb-search { font-family: var(--rt-font-sans); font-size: 13px; border-radius: 8px;
    border: 1px solid var(--rt-hairline); background: var(--rt-surface-soft); color: var(--rt-body-strong);
    padding: 8px 10px; }
  .dyb-search { min-width: 200px; }
  .dyb-filter-count { font-size: 12px; color: var(--rt-muted); margin-left: auto; }

  .dyb-chip-row { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; margin-bottom: 14px; }
  .dyb-chip-group { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .dyb-chip-label { font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase;
    color: var(--rt-muted); margin-right: 2px; }
  .dyb-chip { font-family: var(--rt-font-sans); font-size: 12px; font-weight: 600; cursor: pointer;
    border: 1px solid var(--rt-hairline); background: var(--rt-surface-soft); color: var(--rt-body);
    border-radius: 999px; padding: 5px 12px; transition: background .12s, border-color .12s, color .12s; }
  .dyb-chip:hover { border-color: var(--rt-primary); }
  .dyb-chip.on { background: var(--rt-primary); border-color: var(--rt-primary); color: var(--rt-on-primary); }
  .dyb-chip-clear { font-family: var(--rt-font-sans); font-size: 11px; color: var(--rt-muted); background: none;
    border: none; cursor: pointer; text-decoration: underline; padding: 4px 2px; }
  .dyb-chip-clear:hover { color: var(--rt-primary); }

  .dyb-body { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 20px; align-items: start; }
  @media (max-width: 1100px) { .dyb-body { grid-template-columns: 1fr; } }

  .dyb-table-scroll { overflow: auto; max-height: calc(100vh - 240px); min-height: 320px;
    border: 1px solid var(--rt-hairline); border-radius: 12px; background: var(--rt-surface-soft); }
  /* table-layout:fixed + border-collapse:separate — position:sticky on <th> silently
     breaks under border-collapse:collapse and auto layout (same fix /dynasty-rankings'
     .dr-table uses); an explicit <colgroup> gives fixed layout real column widths. */
  .dyb-table { width: 100%; min-width: 1146px; table-layout: fixed; border-collapse: separate;
    border-spacing: 0; font-size: 13px; white-space: nowrap; }
  .dyb-table thead th { text-align: left; font-size: 10px; letter-spacing: 1px; text-transform: uppercase;
    color: var(--rt-muted); padding: 10px 10px; border-bottom: 1px solid var(--rt-hairline); position: sticky; top: 0;
    z-index: 5; background: var(--rt-surface-soft); box-shadow: 0 1px 0 var(--rt-hairline); }
  .dyb-th-grip { width: 20px; }
  .dyb-row { cursor: pointer; transition: background .1s; }
  .dyb-row:hover { background: var(--rt-surface-strong); }
  .dyb-row.sel { background: rgba(250,70,22,.08); }
  .dyb-row.dragover { outline: 2px dashed var(--rt-primary); outline-offset: -2px; }
  .dyb-row td { padding: 7px 10px; vertical-align: middle; color: var(--rt-body);
    border-bottom: 1px solid var(--rt-hairline-soft); overflow: hidden; text-overflow: ellipsis; }
  .dyb-td-grip { cursor: grab; }
  .dyb-grip { color: var(--rt-muted-soft); font-size: 14px; }
  .dyb-td-rank { display: flex; align-items: center; gap: 6px; }
  .dyb-rank-stack { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; }
  .dyb-rank-num { font-weight: 700; color: var(--rt-body-strong); font-variant-numeric: tabular-nums; }
  .dyb-move { font-size: 10px; font-variant-numeric: tabular-nums; }
  .dyb-move.up { color: var(--rt-up); }
  .dyb-move.down { color: var(--rt-down); }
  .dyb-move.flat { color: var(--rt-muted-soft); }
  .dyb-move.new { color: var(--rt-primary); font-weight: 700; }
  .dyb-nudge { display: flex; flex-direction: column; }
  .dyb-nudge button { border: none; background: none; color: var(--rt-muted-soft); cursor: pointer; font-size: 9px; line-height: 1; padding: 1px; }
  .dyb-nudge button:hover { color: var(--rt-primary); }

  .dyb-player-cell { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .dyb-player-name { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--rt-body-strong);
    white-space: nowrap; min-width: 0; overflow: hidden; }
  .dyb-player-name > span:first-child { overflow: hidden; text-overflow: ellipsis; }
  .dyb-tag { font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 5px; letter-spacing: .5px; }
  .dyb-tag.rook { background: rgba(250,70,22,.15); color: var(--rt-primary); }
  .dyb-tag.soph { background: rgba(59,130,246,.15); color: #3b82f6; }
  .dyb-tag.note { background: var(--rt-surface-strong); color: var(--rt-muted); text-transform: uppercase; }

  .dyb-pos { color: var(--rt-muted); }
  .dyb-team-cell { display: flex; align-items: center; gap: 6px; }
  .dyb-team-pill { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 5px; background: var(--rt-surface-strong); color: var(--rt-muted); }
  .dyb-num { text-align: right; font-variant-numeric: tabular-nums; }
  .dyb-muted { color: var(--rt-muted); }
  .dyb-contract { color: var(--rt-muted); font-size: 12px; }
  .dyb-empty { text-align: center; padding: 40px; color: var(--rt-muted); }

  .dyb-role { font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 999px; border: 1px solid transparent; }
  .dyb-role.starter { background: rgba(22,160,106,.12); color: var(--rt-up); border-color: rgba(22,160,106,.3); }
  .dyb-role.rotation { background: rgba(250,70,22,.12); color: var(--rt-primary); border-color: rgba(250,70,22,.3); }
  .dyb-role.reserve { background: var(--rt-surface-strong); color: var(--rt-body); }
  .dyb-role.fringe { background: rgba(219,43,57,.1); color: var(--rt-down); border-color: rgba(219,43,57,.25); }
  .dyb-role.cut { background: var(--rt-surface-strong); color: var(--rt-muted-soft); text-decoration: line-through; }
  .dyb-role.none { color: var(--rt-muted-soft); }

  .dyb-panel { position: sticky; top: 20px; background: var(--rt-surface-soft); border: 1px solid var(--rt-hairline);
    border-radius: 12px; padding: 16px; min-height: 200px; }
  .dyb-panel-empty { color: var(--rt-muted); font-size: 13px; padding: 20px 4px; }
  .dyb-panel-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .dyb-panel-name { font-weight: 700; font-size: 16px; color: var(--rt-body-strong); }
  .dyb-panel-meta { font-size: 12px; color: var(--rt-muted); display: flex; align-items: center; gap: 4px; }
  .dyb-panel-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; margin-bottom: 16px;
    padding-bottom: 14px; border-bottom: 1px solid var(--rt-hairline-soft); }
  .dyb-panel-label { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: var(--rt-muted); margin-bottom: 2px; }
  .dyb-panel-value { font-size: 13px; font-weight: 600; color: var(--rt-body-strong); }
  .dyb-panel-field { margin-bottom: 14px; }
  .dyb-panel-field label { display: block; font-size: 11px; font-weight: 600; color: var(--rt-muted); margin-bottom: 5px; }
  .dyb-panel-field select, .dyb-panel-field textarea, .dyb-panel-field input { width: 100%; font-family: var(--rt-font-sans);
    font-size: 13px; border-radius: 8px; border: 1px solid var(--rt-hairline); background: var(--rt-canvas);
    color: var(--rt-body-strong); padding: 8px 10px; box-sizing: border-box; resize: vertical; }
  .dyb-jump-row { display: flex; gap: 6px; }
  .dyb-jump-row input { flex: 1; }

  .dyb-td-remove { text-align: center; }
  .dyb-remove-btn { width: 22px; height: 22px; border-radius: 6px; border: 1px solid var(--rt-hairline);
    background: var(--rt-surface-soft); color: var(--rt-muted); font-size: 14px; line-height: 1; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center; transition: background .12s, color .12s, border-color .12s; }
  .dyb-remove-btn:hover { background: var(--rt-down); border-color: var(--rt-down); color: #fff; }

  .dyb-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 60;
    display: flex; align-items: center; justify-content: center; padding: 24px; }
  .dyb-modal { width: 100%; max-width: 560px; max-height: 80vh; display: flex; flex-direction: column;
    background: var(--rt-surface-soft); border: 1px solid var(--rt-hairline); border-radius: 14px;
    padding: 20px; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
  .dyb-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
  .dyb-modal-head h2 { font-size: 17px; font-weight: 700; color: var(--rt-body-strong); margin: 0; }
  .dyb-modal-close { border: none; background: none; color: var(--rt-muted); font-size: 20px; line-height: 1;
    cursor: pointer; padding: 4px; }
  .dyb-modal-close:hover { color: var(--rt-primary); }
  .dyb-modal-hint { font-size: 12px; color: var(--rt-muted); margin: 0 0 12px; }
  .dyb-modal-search { font-family: var(--rt-font-sans); font-size: 13px; border-radius: 8px;
    border: 1px solid var(--rt-hairline); background: var(--rt-canvas); color: var(--rt-body-strong);
    padding: 9px 12px; margin-bottom: 12px; }
  .dyb-modal-list { overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
  .dyb-modal-empty { color: var(--rt-muted); font-size: 13px; text-align: center; padding: 24px 4px; }
  .dyb-modal-row { display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 8px 10px; border-radius: 8px; }
  .dyb-modal-row:hover { background: var(--rt-surface-strong); }
  .dyb-modal-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .dyb-modal-row-name { font-size: 13px; font-weight: 600; color: var(--rt-body-strong); }
  .dyb-modal-row-meta { font-size: 11px; color: var(--rt-muted); display: flex; align-items: center; gap: 4px; }

  .dyb-toast { position: fixed; bottom: 24px; right: 24px; padding: 12px 18px; border-radius: 10px; font-size: 13px;
    font-weight: 600; box-shadow: 0 8px 24px rgba(0,0,0,.35); z-index: 50; max-width: 360px; }
  .dyb-toast.ok { background: var(--rt-up); color: #fff; }
  .dyb-toast.err { background: var(--rt-down); color: #fff; }
`;
