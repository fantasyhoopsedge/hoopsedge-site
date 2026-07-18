"use client";
import { useEffect, useMemo, useState } from "react";

interface TierOption { value: string; mult: number; label: string; hint: string }
interface Row {
  team: string; player: string; cls: string; dynRank: number | null;
  tier: string; note: string; source: string;
}

const keyOf = (r: { team: string; player: string }) => `${r.team}||${r.player}`;

const CLASS_COLOR: Record<string, string> = {
  rookie: "#a855f7", sophomore: "#3b82f6", veteran: "#64748b",
};
const TIER_COLOR: Record<string, string> = {
  won_job: "#22c55e", expanded: "#38bdf8", no_change: "#64748b",
  reduced: "#f59e0b", clear_backup: "#f43f5e",
};

export function RoleContextEditor() {
  const [rows, setRows] = useState<Row[]>([]);
  const [tiers, setTiers] = useState<TierOption[]>([]);
  const [isDraft, setIsDraft] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  const [team, setTeam] = useState<string>("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [confirmMode, setConfirmMode] = useState<null | "publish" | "discard">(null);

  // edited tier per player key; original = the tiers as loaded (for dirty diffing).
  const [edited, setEdited] = useState<Map<string, string>>(new Map());
  const [original, setOriginal] = useState<Map<string, string>>(new Map());

  function ingest(data: { rows: Row[]; isDraft: boolean; tiers?: TierOption[] }) {
    setRows(data.rows);
    setIsDraft(data.isDraft);
    if (data.tiers) setTiers(data.tiers);
    const m = new Map(data.rows.map((r) => [keyOf(r), r.tier]));
    setEdited(new Map(m));
    setOriginal(new Map(m));
  }

  useEffect(() => {
    fetch("/api/admin/role-context")
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else ingest(d); })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const teams = useMemo(
    () => [...new Set(rows.map((r) => r.team))].sort(),
    [rows],
  );

  // dirty = key whose edited tier differs from what was loaded.
  const dirtyKeys = useMemo(() => {
    const s = new Set<string>();
    for (const [k, v] of edited) if (original.get(k) !== v) s.add(k);
    return s;
  }, [edited, original]);

  const dirtyByTeam = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of dirtyKeys) {
      const t = k.split("||")[0];
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    return m;
  }, [dirtyKeys]);

  const teamRows = useMemo(() => {
    let list = rows.filter((r) => r.team === team);
    if (flaggedOnly) {
      list = list.filter((r) => r.note.trim() || dirtyKeys.has(keyOf(r)) || edited.get(keyOf(r)) !== "no_change");
    }
    return list.sort((a, b) => (a.dynRank ?? 1e9) - (b.dynRank ?? 1e9));
  }, [rows, team, flaggedOnly, dirtyKeys, edited]);

  function setTier(r: Row, tier: string) {
    setEdited((prev) => new Map(prev).set(keyOf(r), tier));
    setStatus("");
  }

  async function send(mode: "wip" | "publish") {
    setConfirmMode(null);
    const edits = [...dirtyKeys].map((k) => {
      const [t, ...rest] = k.split("||");
      return { team: t, player: rest.join("||"), tier: edited.get(k)! };
    });
    setSaving(true); setError(""); setStatus("");
    try {
      const res = await fetch("/api/admin/role-context", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ edits, mode }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`);
      ingest(d);
      setStatus(mode === "publish"
        ? `Published ${d.changed} change(s) to the canonical CSV. Draft cleared.`
        : `Saved ${d.changed} change(s) to the WIP draft.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function discard() {
    setConfirmMode(null);
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/admin/role-context", { method: "DELETE" });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`);
      ingest(d);
      setStatus("Draft discarded — reverted to canonical.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const tierMeta = (v: string) => tiers.find((t) => t.value === v);

  if (loading) return <div className="rc-root"><p className="rc-muted" style={{ padding: 24 }}>Loading roster…</p><Style /></div>;

  return (
    <div className="rc-root">
      <header className="rc-head">
        <div>
          <h1>Role Context <span className="rc-sub">· Tier Pass</span></h1>
          <p className="rc-muted">
            {rows.length} players · {dirtyKeys.size} unsaved change{dirtyKeys.size === 1 ? "" : "s"}
            {isDraft && <span className="rc-pill rc-pill-draft">WIP draft</span>}
          </p>
        </div>
      </header>

      {error && <div className="rc-banner rc-err">{error}</div>}
      {status && <div className="rc-banner rc-ok">{status}</div>}

      {/* team selector */}
      <section className="rc-teams">
        {teams.map((t) => {
          const n = dirtyByTeam.get(t) ?? 0;
          return (
            <button
              key={t}
              className={"rc-team" + (t === team ? " on" : "")}
              onClick={() => setTeam(t)}
            >
              {t}
              {n > 0 && <span className="rc-dot">{n}</span>}
            </button>
          );
        })}
      </section>

      {!team && <p className="rc-muted rc-hint">Select a team to set player tiers.</p>}

      {team && (
        <>
          <div className="rc-toolbar">
            <strong>{team}</strong>
            <label className="rc-check">
              <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
              flagged only
            </label>
          </div>

          <ul className="rc-list">
            {teamRows.map((r) => {
              const k = keyOf(r);
              const val = edited.get(k) ?? r.tier;
              const dirty = dirtyKeys.has(k);
              return (
                <li key={k} className={"rc-card" + (dirty ? " dirty" : "")}>
                  <div className="rc-cardtop">
                    <span className="rc-rank">{r.dynRank ?? "—"}</span>
                    <span className="rc-name">{r.player}</span>
                    <span className="rc-class" style={{ ["--c" as string]: CLASS_COLOR[r.cls] ?? "#64748b" }}>
                      {r.cls}
                    </span>
                  </div>
                  {r.note.trim() && <p className="rc-note">{r.note}</p>}
                  <div className="rc-tierrow">
                    <select
                      className="rc-select"
                      value={val}
                      onChange={(e) => setTier(r, e.target.value)}
                      style={{ ["--t" as string]: TIER_COLOR[val] ?? "#64748b" }}
                    >
                      {tiers.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label} ×{t.mult.toFixed(2)}
                        </option>
                      ))}
                    </select>
                    {tierMeta(val) && <span className="rc-tierhint">{tierMeta(val)!.hint}</span>}
                  </div>
                </li>
              );
            })}
            {teamRows.length === 0 && <li className="rc-muted rc-hint">No players match this filter.</li>}
          </ul>
        </>
      )}

      {/* sticky action bar — with an inline confirm strip (no blocking dialogs) */}
      <footer className="rc-actions">
        {confirmMode === "publish" ? (
          <>
            <div className="rc-actioninfo rc-confirmtext">
              Publish {dirtyKeys.size} change{dirtyKeys.size === 1 ? "" : "s"} to the canonical CSV?
            </div>
            <button className="rc-btn rc-ghost" disabled={saving} onClick={() => setConfirmMode(null)}>Cancel</button>
            <button className="rc-btn rc-pub" disabled={saving} onClick={() => send("publish")}>Yes, publish</button>
          </>
        ) : confirmMode === "discard" ? (
          <>
            <div className="rc-actioninfo rc-confirmtext">Discard the WIP draft and revert to canonical?</div>
            <button className="rc-btn rc-ghost" disabled={saving} onClick={() => setConfirmMode(null)}>Keep</button>
            <button className="rc-btn rc-danger" disabled={saving} onClick={discard}>Discard</button>
          </>
        ) : (
          <>
            <div className="rc-actioninfo">
              {dirtyKeys.size > 0 ? `${dirtyKeys.size} change${dirtyKeys.size === 1 ? "" : "s"}` : "no changes"}
            </div>
            {isDraft && (
              <button className="rc-btn rc-ghost" disabled={saving} onClick={() => setConfirmMode("discard")}>
                Discard
              </button>
            )}
            <button className="rc-btn rc-wip" disabled={saving || dirtyKeys.size === 0} onClick={() => send("wip")}>
              Save WIP
            </button>
            <button className="rc-btn rc-pub" disabled={saving || dirtyKeys.size === 0} onClick={() => setConfirmMode("publish")}>
              Publish
            </button>
          </>
        )}
      </footer>

      <Style />
    </div>
  );
}

function Style() {
  return (
    <style>{`
      .rc-root { max-width: 720px; margin: 0 auto; padding: 16px 14px 120px; color: #e2e8f0;
        font-family: system-ui, -apple-system, sans-serif; -webkit-tap-highlight-color: transparent; }
      .rc-head h1 { font-size: 20px; margin: 0; color: #fff; font-weight: 700; }
      .rc-sub { color: #64748b; font-weight: 500; }
      .rc-muted { color: #94a3b8; font-size: 13px; margin: 4px 0 0; }
      .rc-hint { padding: 20px 4px; }
      .rc-pill { font-size: 11px; padding: 2px 7px; border-radius: 999px; margin-left: 8px; font-weight: 600; }
      .rc-pill-draft { background: #78350f; color: #fbbf24; }
      .rc-banner { margin: 12px 0; padding: 10px 12px; border-radius: 10px; font-size: 13px; }
      .rc-err { background: #4c0519; color: #fecdd3; }
      .rc-ok { background: #052e16; color: #86efac; }

      .rc-teams { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin: 14px 0; }
      .rc-team { position: relative; padding: 10px 0; border: 1px solid #1e293b; background: #0f172a;
        color: #cbd5e1; border-radius: 10px; font-weight: 700; font-size: 13px; cursor: pointer; }
      .rc-team.on { background: #1d4ed8; border-color: #3b82f6; color: #fff; }
      .rc-dot { position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; padding: 0 4px;
        background: #f59e0b; color: #111; border-radius: 999px; font-size: 11px; line-height: 18px; font-weight: 800; }

      .rc-toolbar { display: flex; align-items: center; justify-content: space-between;
        margin: 8px 2px 10px; font-size: 15px; color: #fff; }
      .rc-check { font-size: 13px; color: #94a3b8; display: flex; align-items: center; gap: 6px; }
      .rc-check input { width: 16px; height: 16px; }

      .rc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
      .rc-card { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 12px; }
      .rc-card.dirty { border-color: #f59e0b; box-shadow: 0 0 0 1px #f59e0b33; }
      .rc-cardtop { display: flex; align-items: center; gap: 10px; }
      .rc-rank { min-width: 34px; text-align: center; font-variant-numeric: tabular-nums; font-weight: 700;
        color: #38bdf8; font-size: 14px; background: #0b1220; border: 1px solid #1e293b; border-radius: 8px; padding: 3px 0; }
      .rc-name { flex: 1; font-weight: 600; color: #fff; font-size: 15px; }
      .rc-class { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em;
        color: var(--c); border: 1px solid color-mix(in srgb, var(--c) 50%, transparent);
        background: color-mix(in srgb, var(--c) 15%, transparent); padding: 2px 7px; border-radius: 999px; }
      .rc-note { margin: 8px 0 0; font-size: 12px; color: #93c5a9; line-height: 1.35;
        background: #0b1220; border-left: 3px solid #334155; padding: 6px 9px; border-radius: 6px; }
      .rc-tierrow { margin-top: 10px; }
      .rc-select { width: 100%; padding: 11px 12px; font-size: 15px; font-weight: 600; color: #fff;
        background: #0b1220; border: 2px solid var(--t); border-radius: 10px; appearance: none;
        background-image: linear-gradient(color-mix(in srgb, var(--t) 12%, transparent), color-mix(in srgb, var(--t) 12%, transparent)); }
      .rc-tierhint { display: block; margin-top: 6px; font-size: 12px; color: #94a3b8; }

      .rc-actions { position: fixed; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 8px;
        padding: 12px 14px calc(12px + env(safe-area-inset-bottom)); background: #0b1220ee;
        backdrop-filter: blur(8px); border-top: 1px solid #1e293b; }
      .rc-actioninfo { flex: 1; font-size: 13px; color: #94a3b8; }
      .rc-btn { padding: 11px 16px; border-radius: 10px; font-weight: 700; font-size: 14px; border: none;
        cursor: pointer; color: #fff; }
      .rc-btn:disabled { opacity: .4; cursor: default; }
      .rc-ghost { background: transparent; border: 1px solid #334155; color: #cbd5e1; }
      .rc-wip { background: #334155; }
      .rc-pub { background: #16a34a; }
      .rc-danger { background: #dc2626; }
      .rc-confirmtext { color: #fbbf24; font-weight: 600; }

      @media (min-width: 640px) {
        .rc-teams { grid-template-columns: repeat(10, 1fr); }
      }
    `}</style>
  );
}
