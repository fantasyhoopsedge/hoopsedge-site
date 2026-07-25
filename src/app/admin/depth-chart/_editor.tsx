"use client";
import { useEffect, useMemo, useState } from "react";
import { allocateTeam, impliedRawLoad, TEAM_MINUTE_BUDGET, type AllocateInput } from "@/lib/allocate-team";

interface TierOption { value: string; label: string; hint: string }
interface Row {
  team: string; player: string; pos: string; tier: string; injury: string;
  projMpg: number | null; projGames: number | null; usg: number | null;
  salaryNow: number | null; statusNow: string;
  salaryNext: number | null; statusNext: string;
  overrideGames: number | null; overrideMpg: number | null;
}
type Edit = { tier: string; injury: string; overrideGames: number | null; overrideMpg: number | null };
interface TeamRow { team: string; category: string; note: string }

// Role-context usage flags (bundled snapshot from flag_role_changes.py --emit-json).
interface PlayerFlag { badge: "up" | "down" | "return" | "check"; label: string; reason: string }
interface TeamFlag {
  net: number; freed: number; reclaimed: number; severity: string;
  flags: Array<{ priority: number; headline: string; detail: string }>;
}
interface RoleFlagsDoc {
  teams: Record<string, TeamFlag>; players: Record<string, PlayerFlag>; generatedAt?: string;
}

const keyOf = (r: { team: string; player: string }) => `${r.team}||${r.player}`;
const TIER_ORDER = ["starter", "rotation", "reserve", "fringe", "cut"] as const;

// Badge visuals. up/down reuse the rt- semantic pair (more/less usage); return is the
// informational purple already used for restricted_fa; check is an amber "double-check".
const BADGE_META: Record<PlayerFlag["badge"], { glyph: string; text: string; color: string }> = {
  up: { glyph: "▲", text: "expand?", color: "var(--rt-up)" },
  down: { glyph: "▼", text: "reduce?", color: "var(--rt-down)" },
  return: { glyph: "⟳", text: "return", color: "#a78bfa" },
  check: { glyph: "⚑", text: "check", color: "#f59e0b" },
};

// Role-context USAGE multipliers — MUST stay byte-identical to USG_TIERS in
// models/aggregation/assemble.py (the value the model actually applies). Shown as the
// live "usage ×N" hint when a non-default tier is picked, so Ash sees the factor his
// selection pushes. Minutes are a separate lever (role-context-store's `mult`); this is
// the usage-rate factor.
const USG_MULT: Record<string, number> = {
  won_job: 1.08, expanded: 1.04, no_change: 1.0, reduced: 0.95, clear_backup: 0.88,
};
const RC_DEFAULT_TIER = "no_change";
const rcIsSet = (tier: string | undefined) => !!tier && tier !== RC_DEFAULT_TIER;
const rcIsUp = (tier: string) => (USG_MULT[tier] ?? 1) > 1;

// rt-up (player holds the leverage) / rt-down (team holds the leverage) for the two
// option types; the other three statuses get distinct hues that don't collide with
// --rt-primary's orange, matching the semantic-color-is-separate-from-accent rule.
// "guaranteed" is deliberately unlisted -- the default, unremarkable state gets no color.
const STATUS_COLOR: Record<string, string> = {
  player_option: "var(--rt-up)",
  team_option: "var(--rt-down)",
  restricted_fa: "#a78bfa",
  non_guaranteed: "var(--rt-muted)",
  unrestricted_fa: "#38bdf8",
};
const LEGEND_ITEMS: Array<[string, string]> = [
  ["guaranteed", "Signed"],
  ["player_option", "Player Option"],
  ["team_option", "Team Option"],
  ["restricted_fa", "Restricted FA"],
  ["non_guaranteed", "Non-Guaranteed"],
  ["unrestricted_fa", "Unrestricted FA"],
];

function money(v: number | null): string {
  if (v == null) return "FA";
  return `$${(v / 1_000_000).toFixed(1)}M`;
}

function SalaryCell({ amount, status }: { amount: number | null; status: string }) {
  const color = STATUS_COLOR[status];
  return <span className="dc-sal" style={color ? { color } : undefined}>{money(amount)}</span>;
}

function Legend() {
  return (
    <div className="dc-legend">
      {LEGEND_ITEMS.map(([key, label]) => (
        <span key={key} className="dc-legend-item">
          <span className="dc-legend-dot" style={{ background: STATUS_COLOR[key] ?? "var(--rt-body)" }} />
          {label}
        </span>
      ))}
    </div>
  );
}

function PlayerBadge({ flag }: { flag: PlayerFlag }) {
  const m = BADGE_META[flag.badge];
  return (
    <span className="dc-badge" style={{ color: m.color, borderColor: m.color }}
      title={`${flag.label} — ${flag.reason}`}>
      <span className="dc-badge-glyph">{m.glyph}</span>{m.text}
    </span>
  );
}

// Per-team usage picture from the flagger: the net usage-vol freed/reclaimed and the
// headline flags. Sits beside the minute-budget chip so the two Stage-1 signals — minutes
// (this tool) and usage-role (role-context) — read together. Advisory: tags are set in
// /admin/role-context, this only surfaces WHERE to consider one.
function TeamFlagsBar({ tf, applied, conflicts, generatedAt }: {
  tf: TeamFlag | undefined; applied: { up: number; down: number }; conflicts: number; generatedAt?: string;
}) {
  if (!tf) return null;
  const inflow = tf.net < 0;
  const off = tf.flags.length > 0;
  const nApplied = applied.up + applied.down;
  const snap = generatedAt ? new Date(generatedAt).toLocaleDateString() : null;
  return (
    <div className={"dc-flagbar" + (off ? " dc-flagbar-on" : "")}>
      <span className="dc-flagbar-label">Role-context usage</span>
      <span className="dc-flagbar-net">
        net {tf.net > 0 ? "+" : ""}{tf.net.toFixed(0)} vol
        <span className="dc-flagbar-dir">{inflow ? "returning ↑" : "freed ↓"}</span>
      </span>
      {nApplied > 0 && (
        <span className="dc-applied-pill" title="Role-context usage factors already set on this team">
          {nApplied} applied<span className="dc-applied-split"> ({applied.up}↑ {applied.down}↓)</span>
        </span>
      )}
      {conflicts > 0 && (
        <span className="dc-conflict-pill"
          title="Applied factor's direction disagrees with the flagger's current badge on this team">
          ⚠ {conflicts} conflict{conflicts === 1 ? "" : "s"}
        </span>
      )}
      {off ? (
        <ul className="dc-flagbar-list">
          {tf.flags.map((f, i) => (
            <li key={i} title={f.detail}>{f.headline}</li>
          ))}
        </ul>
      ) : (
        <span className="dc-flagbar-clear">usage picture stable / already tagged</span>
      )}
      {snap && (
        <span className="dc-flagbar-snap" title="Badges are a snapshot. After roster moves, re-run flag_role_changes.py --emit-json to refresh them.">
          flags snapshot: {snap}
        </span>
      )}
    </div>
  );
}

function TeamCategoryBar({
  team, value, note, options, dirty, onChange,
}: {
  team: string; value: string; note: string; options: TierOption[]; dirty: boolean;
  onChange: (v: string) => void;
}) {
  const meta = options.find((o) => o.value === value);
  return (
    <div className={"dc-catbar" + (dirty ? " dc-catbar-dirty" : "")}>
      <span className="dc-catbar-label">{team} team category</span>
      <select className="dc-select dc-catbar-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {meta?.hint && <span className="dc-catbar-hint">{meta.hint}</span>}
      {note && <span className="dc-catbar-note">{note}</span>}
    </div>
  );
}

// The live running total this tool was missing -- see teamTotals in DepthChartEditor.
// "in budget" (within 0.5 min, the same tolerance project.py's own gate uses) is
// green; anything else is flagged. The free-player count is the actionable part:
// with 0 free players, no amount of further waiting will close the gap -- the
// tilt has nobody left to redistribute to, so the only way to hit budget is to
// loosen one override or hand-tune the rest until this number reads 241.75.
function TeamLoadChip({ load, locked, free }: { load: number; locked: number; free: number }) {
  const diff = load - TEAM_MINUTE_BUDGET;
  const inBudget = Math.abs(diff) <= 0.5;
  return (
    <div className={"dc-loadbar" + (inBudget ? "" : " dc-loadbar-off")}>
      <span className="dc-loadbar-label">Team load</span>
      <span className="dc-loadbar-value">{load.toFixed(1)}</span>
      <span className="dc-loadbar-target">/ {TEAM_MINUTE_BUDGET} min</span>
      {!inBudget && (
        <span className="dc-loadbar-diff">{diff > 0 ? "+" : ""}{diff.toFixed(1)}</span>
      )}
      <span className="dc-loadbar-free">
        {free > 0
          ? `${free} player${free === 1 ? "" : "s"} unlocked -- absorbing the remainder live`
          : locked > 0
            ? "every player overridden -- nothing left to auto-balance, this total is fixed until you edit a number"
            : ""}
      </span>
    </div>
  );
}

export function DepthChartEditor() {
  const [rows, setRows] = useState<Row[]>([]);
  const [tiers, setTiers] = useState<TierOption[]>([]);
  const [injuries, setInjuries] = useState<TierOption[]>([]);
  const [injuryReduction, setInjuryReduction] = useState<Record<string, Record<string, number>>>({});
  const [roleFlags, setRoleFlags] = useState<RoleFlagsDoc | null>(null);
  const [isDraft, setIsDraft] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [team, setTeam] = useState("");
  const [confirmMode, setConfirmMode] = useState<null | "publish" | "discard">(null);

  const [edited, setEdited] = useState<Map<string, Edit>>(new Map());
  const [original, setOriginal] = useState<Map<string, Edit>>(new Map());

  // Team-category is its own store (team_category_docs, a REAL Stage 1 input) --
  // fetched/saved alongside the per-player tiers but tracked separately since it's
  // keyed by team, not team+player.
  const [categories, setCategories] = useState<TierOption[]>([]);
  const [catIsDraft, setCatIsDraft] = useState(false);
  const [catEdited, setCatEdited] = useState<Map<string, string>>(new Map());
  const [catOriginal, setCatOriginal] = useState<Map<string, string>>(new Map());
  const [catNotes, setCatNotes] = useState<Map<string, string>>(new Map());

  // Role-context USAGE tier — its own store (role_context_docs, the value the model's usage
  // nudge reads), edited here in the cockpit alongside minutes so the flagger badge, the
  // action (this dropdown), and the minute context all sit in one row. Keyed team||player.
  const [rcTierOptions, setRcTierOptions] = useState<TierOption[]>([]);
  const [rcIsDraft, setRcIsDraft] = useState(false);
  const [rcEdited, setRcEdited] = useState<Map<string, string>>(new Map());
  const [rcOriginal, setRcOriginal] = useState<Map<string, string>>(new Map());

  function ingest(data: {
    rows: Row[]; isDraft: boolean; tiers?: TierOption[]; injuries?: TierOption[];
    injuryReduction?: Record<string, Record<string, number>>; roleFlags?: RoleFlagsDoc;
  }) {
    setRows(data.rows);
    setIsDraft(data.isDraft);
    if (data.tiers) setTiers(data.tiers);
    if (data.injuries) setInjuries(data.injuries);
    if (data.injuryReduction) setInjuryReduction(data.injuryReduction);
    if (data.roleFlags) setRoleFlags(data.roleFlags);  // static snapshot; only the GET carries it
    const m = new Map(data.rows.map((r) => [keyOf(r), {
      tier: r.tier, injury: r.injury,
      overrideGames: r.overrideGames ?? null, overrideMpg: r.overrideMpg ?? null,
    }]));
    setEdited(new Map(m));
    setOriginal(new Map(m));
  }

  function ingestCategories(data: { teams: TeamRow[]; isDraft: boolean; categories?: TierOption[] }) {
    setCatIsDraft(data.isDraft);
    if (data.categories) setCategories(data.categories);
    const m = new Map(data.teams.map((t) => [t.team, t.category]));
    setCatEdited(new Map(m));
    setCatOriginal(new Map(m));
    setCatNotes(new Map(data.teams.map((t) => [t.team, t.note])));
  }

  function ingestRoleContext(data: {
    rows: Array<{ team: string; player: string; tier: string }>; isDraft: boolean; tiers?: TierOption[];
  }) {
    setRcIsDraft(data.isDraft);
    if (data.tiers) setRcTierOptions(data.tiers);
    const m = new Map(data.rows.map((r) => [keyOf(r), r.tier || RC_DEFAULT_TIER]));
    setRcEdited(new Map(m));
    setRcOriginal(new Map(m));
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/depth-chart").then((r) => r.json()),
      fetch("/api/admin/team-category").then((r) => r.json()),
      fetch("/api/admin/role-context").then((r) => r.json()),
    ])
      .then(([d, c, rc]) => {
        if (d.error) setError(d.error);
        else ingest(d);
        if (c.error) setError((prev) => prev || c.error);
        else ingestCategories(c);
        if (rc.error) setError((prev) => prev || rc.error);
        else ingestRoleContext(rc);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const teams = useMemo(() => [...new Set(rows.map((r) => r.team))].sort(), [rows]);

  const sameOverride = (a: number | null, b: number | null) => (a ?? null) === (b ?? null);

  const dirtyKeys = useMemo(() => {
    const s = new Set<string>();
    for (const [k, v] of edited) {
      const o = original.get(k);
      if (!o || o.tier !== v.tier || o.injury !== v.injury
        || !sameOverride(o.overrideGames, v.overrideGames) || !sameOverride(o.overrideMpg, v.overrideMpg)) s.add(k);
    }
    return s;
  }, [edited, original]);

  const catDirtyTeams = useMemo(() => {
    const s = new Set<string>();
    for (const [t, v] of catEdited) if (catOriginal.get(t) !== v) s.add(t);
    return s;
  }, [catEdited, catOriginal]);

  const rcDirtyKeys = useMemo(() => {
    const s = new Set<string>();
    for (const [k, v] of rcEdited) if ((rcOriginal.get(k) ?? RC_DEFAULT_TIER) !== v) s.add(k);
    return s;
  }, [rcEdited, rcOriginal]);

  const dirtyByTeam = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of dirtyKeys) {
      const t = k.split("||")[0];
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    for (const k of rcDirtyKeys) {
      const t = k.split("||")[0];
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    for (const t of catDirtyTeams) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  }, [dirtyKeys, rcDirtyKeys, catDirtyTeams]);

  const totalDirty = dirtyKeys.size + rcDirtyKeys.size + catDirtyTeams.size;

  // Applied role factors — the "you already acted here" reminder. Counts non-default tiers
  // in the current working state, per team and league-wide, split up (usage ↑) / down (↓).
  const rcApplied = useMemo(() => {
    const byTeam = new Map<string, { up: number; down: number }>();
    let up = 0, down = 0;
    for (const [k, v] of rcEdited) {
      if (!rcIsSet(v)) continue;
      const t = k.split("||")[0];
      const cur = byTeam.get(t) ?? { up: 0, down: 0 };
      if (rcIsUp(v)) { cur.up++; up++; } else { cur.down++; down++; }
      byTeam.set(t, cur);
    }
    return { byTeam, up, down, total: up + down };
  }, [rcEdited]);

  // Conflicts — a set usage factor that goes AGAINST the flagger's direction: the badge says
  // EXPAND (▲) but you set a reduction, or says REDUCE (▼) but you set an expansion. Only the
  // ▲/▼ badges carry a direction (⟳ return / ⚑ check don't). Surfaces per-row + per-team +
  // league-wide so a re-review after roster moves catches factors that no longer match.
  const rcConflicts = useMemo(() => {
    const keys = new Set<string>();
    const byTeam = new Map<string, number>();
    for (const [k, v] of rcEdited) {
      if (!rcIsSet(v)) continue;
      const badge = roleFlags?.players[k]?.badge;
      const badgeDir = badge === "up" ? "up" : badge === "down" ? "down" : null;
      if (!badgeDir) continue;
      const appliedDir = rcIsUp(v) ? "up" : "down";
      if (badgeDir !== appliedDir) {
        keys.add(k);
        const t = k.split("||")[0];
        byTeam.set(t, (byTeam.get(t) ?? 0) + 1);
      }
    }
    return { keys, byTeam, total: keys.size };
  }, [rcEdited, roleFlags]);

  const teamRows = useMemo(() => rows.filter((r) => r.team === team), [rows, team]);

  const usgRange = useMemo(() => {
    const vals = teamRows.map((r) => r.usg).filter((v): v is number => v != null);
    if (!vals.length) return { min: 0, max: 0 };
    return { min: Math.min(...vals), max: Math.max(...vals) };
  }, [teamRows]);

  function usgTint(v: number | null): string {
    if (v == null) return "transparent";
    const { min, max } = usgRange;
    const mid = (min + max) / 2;
    const half = (max - min) / 2 || 1;
    const t = Math.max(-1, Math.min(1, (v - mid) / half));
    const pct = Math.round(Math.abs(t) * 22);
    const hue = t >= 0 ? "var(--rt-up)" : "var(--rt-down)";
    return `color-mix(in srgb, ${hue} ${pct}%, transparent)`;
  }

  const grouped = useMemo(() => {
    const g = new Map<string, Row[]>(TIER_ORDER.map((t) => [t, []]));
    for (const r of teamRows) {
      const tier = edited.get(keyOf(r))?.tier ?? r.tier;
      (g.get(tier) ?? g.get("reserve")!).push(r);
    }
    for (const list of g.values()) list.sort((a, b) => (b.projMpg ?? 0) - (a.projMpg ?? 0));
    return g;
  }, [teamRows, edited]);

  // Live redistribution preview -- as soon as ANY player on this team carries a
  // manual override, re-run the exact same tilted-proportional allocator the real
  // model uses (src/lib/allocate-team.ts, a byte-identical port of minutes.py's
  // allocate()) so the rest of the roster's MPG visibly rescales around the locked
  // player, without waiting on a Python round-trip. Games stay untouched for
  // everyone except the overridden player himself -- availability (games) is an
  // independent input to the allocator, not something the zero-sum minutes budget
  // redistributes; only load (MPG) is zero-sum across the team. "cut" players are
  // excluded from the pool, same as the real model.
  const preview = useMemo(() => {
    const map = new Map<string, { mpg: number; games: number }>();
    if (!teamRows.length) return map;
    let anyOverride = false;
    const inputs: AllocateInput[] = [];
    for (const r of teamRows) {
      const e = edited.get(keyOf(r)) ?? blankEdit(r);
      if (e.tier === "cut") continue;
      const hasOverride = e.overrideGames != null || e.overrideMpg != null;
      if (hasOverride) anyOverride = true;
      const baseMpg = r.projMpg ?? 0;
      const baseGames = r.projGames ?? 0;
      const availability = (e.overrideGames ?? baseGames) / 82;
      const rawLoad = impliedRawLoad(baseMpg, baseGames);
      const locked = hasOverride ? (e.overrideMpg ?? baseMpg) * availability : undefined;
      inputs.push({ key: keyOf(r), rawLoad, availability, locked });
    }
    if (!anyOverride) return map;
    for (const res of allocateTeam(inputs)) {
      map.set(res.key, { mpg: Math.round(res.projMpg * 10) / 10, games: Math.round(res.projGames * 10) / 10 });
    }
    return map;
  }, [teamRows, edited]);

  // Live team-total readout -- the thing that was missing. Ash was hand-tuning up
  // to 18 players' overrides against a 241.75 target with no running total visible
  // anywhere in the tool, only discovering a mismatch later from a Python rerun.
  // This sums the SAME numbers `preview` already computes (falls back to the
  // model's own un-overridden load for any player with no override yet, so the
  // total is meaningful even before a single override is typed) and reports how
  // many players are actually free to absorb the remainder -- when that count hits
  // zero (every player overridden, GSW's exact situation), the tilt above has
  // nothing left to redistribute and this total is simply whatever Ash's own
  // numbers sum to; no further "reconciliation" is possible without either
  // loosening one override or hand-tuning the rest to close the gap. That is a
  // fact about a fully-locked roster, not a bug this tool can compute its way out
  // of -- see project.py's identical "fully manually-locked" acceptance.
  const teamTotals = useMemo(() => {
    let load = 0, locked = 0, free = 0;
    for (const r of teamRows) {
      const e = edited.get(keyOf(r)) ?? blankEdit(r);
      if (e.tier === "cut") continue;
      const hasOverride = e.overrideGames != null || e.overrideMpg != null;
      hasOverride ? locked++ : free++;
      const live = preview.get(keyOf(r));
      if (live) {
        load += live.mpg * (live.games / 82);
      } else {
        load += (r.projMpg ?? 0) * ((r.projGames ?? 0) / 82);
      }
    }
    return { load, locked, free };
  }, [teamRows, edited, preview]);

  function blankEdit(r: Row): Edit {
    return { tier: r.tier, injury: r.injury, overrideGames: r.overrideGames ?? null, overrideMpg: r.overrideMpg ?? null };
  }

  function setTier(r: Row, tier: string) {
    setEdited((prev) => {
      const next = new Map(prev);
      const cur = next.get(keyOf(r)) ?? blankEdit(r);
      next.set(keyOf(r), { ...cur, tier });
      return next;
    });
    setStatus("");
  }

  function setInjury(r: Row, injury: string) {
    setEdited((prev) => {
      const next = new Map(prev);
      const cur = next.get(keyOf(r)) ?? blankEdit(r);
      next.set(keyOf(r), { ...cur, injury });
      return next;
    });
    setStatus("");
  }

  function setOverrideGames(r: Row, v: string) {
    const overrideGames = v.trim() === "" ? null : Number(v);
    setEdited((prev) => {
      const next = new Map(prev);
      const cur = next.get(keyOf(r)) ?? blankEdit(r);
      next.set(keyOf(r), { ...cur, overrideGames: Number.isFinite(overrideGames) ? overrideGames : null });
      return next;
    });
    setStatus("");
  }

  function setOverrideMpg(r: Row, v: string) {
    const overrideMpg = v.trim() === "" ? null : Number(v);
    setEdited((prev) => {
      const next = new Map(prev);
      const cur = next.get(keyOf(r)) ?? blankEdit(r);
      next.set(keyOf(r), { ...cur, overrideMpg: Number.isFinite(overrideMpg) ? overrideMpg : null });
      return next;
    });
    setStatus("");
  }

  function setCategory(t: string, category: string) {
    setCatEdited((prev) => new Map(prev).set(t, category));
    setStatus("");
  }

  function setRcTier(r: Row, tier: string) {
    setRcEdited((prev) => new Map(prev).set(keyOf(r), tier));
    setStatus("");
  }

  async function send(mode: "wip" | "publish") {
    setConfirmMode(null);
    // "Live MPG" is what the team-wide reallocation actually redistributed onto every
    // free player once ANY teammate got a manual override -- but it was purely a preview
    // (computed in `preview`, never captured into `edited`), so a free player's ripple
    // effect never made it into the saved doc even though the tool showed it as the
    // trustworthy, budget-balanced number. Bake it into an explicit overrideMpg for this
    // team's rows here, at save time, so what gets written matches what's on screen.
    const bakedKeys = new Set(dirtyKeys);
    const bakedEdits = new Map(edited);
    for (const r of teamRows) {
      const k = keyOf(r);
      const live = preview.get(k);
      if (!live) continue;
      const cur = bakedEdits.get(k) ?? blankEdit(r);
      if (cur.tier === "cut" || sameOverride(cur.overrideMpg, live.mpg)) continue;
      bakedEdits.set(k, { ...cur, overrideMpg: live.mpg });
      bakedKeys.add(k);
    }
    const edits = [...bakedKeys].map((k) => {
      const [t, ...rest] = k.split("||");
      const e = bakedEdits.get(k)!;
      return {
        team: t, player: rest.join("||"), tier: e.tier, injury: e.injury,
        overrideGames: e.overrideGames, overrideMpg: e.overrideMpg,
      };
    });
    const catEdits = [...catDirtyTeams].map((t) => ({ team: t, category: catEdited.get(t)! }));
    const rcEdits = [...rcDirtyKeys].map((k) => {
      const [t, ...rest] = k.split("||");
      return { team: t, player: rest.join("||"), tier: rcEdited.get(k)! };
    });
    setSaving(true); setError(""); setStatus("");
    try {
      const [res, catRes, rcRes] = await Promise.all([
        fetch("/api/admin/depth-chart", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ edits, mode }),
        }),
        fetch("/api/admin/team-category", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ edits: catEdits, mode }),
        }),
        fetch("/api/admin/role-context", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ edits: rcEdits, mode }),
        }),
      ]);
      const d = await res.json();
      const c = await catRes.json();
      const rc = await rcRes.json();
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`);
      if (!catRes.ok || c.error) throw new Error(c.error || `HTTP ${catRes.status}`);
      if (!rcRes.ok || rc.error) throw new Error(rc.error || `HTTP ${rcRes.status}`);
      ingest(d);
      ingestCategories(c);
      ingestRoleContext(rc);
      const changed = d.changed + c.changed + rc.changed;
      setStatus(mode === "publish"
        ? `Published ${changed} change(s) to the canonical CSVs. Draft cleared.`
        : `Saved ${changed} change(s) to the WIP draft.`);
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
      const [res, catRes, rcRes] = await Promise.all([
        fetch("/api/admin/depth-chart", { method: "DELETE" }),
        fetch("/api/admin/team-category", { method: "DELETE" }),
        fetch("/api/admin/role-context", { method: "DELETE" }),
      ]);
      const d = await res.json();
      const c = await catRes.json();
      const rc = await rcRes.json();
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`);
      if (!catRes.ok || c.error) throw new Error(c.error || `HTTP ${catRes.status}`);
      if (!rcRes.ok || rc.error) throw new Error(rc.error || `HTTP ${rcRes.status}`);
      ingest(d);
      ingestCategories(c);
      ingestRoleContext(rc);
      setStatus("Draft discarded — reverted to canonical.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="dc-root"><p className="dc-muted" style={{ padding: 24 }}>Loading roster…</p><Style /></div>;

  return (
    <div className="dc-root">
      <header className="dc-head">
        <div>
          <h1>Depth Chart Adjuster</h1>
          <p className="dc-muted">
            {rows.length} players · {totalDirty} unsaved change{totalDirty === 1 ? "" : "s"}
            {rcApplied.total > 0 && (
              <span className="dc-applied-pill" title="Non-default role-context usage factors currently set league-wide">
                {rcApplied.total} usage factor{rcApplied.total === 1 ? "" : "s"} applied
                <span className="dc-applied-split"> ({rcApplied.up}↑ {rcApplied.down}↓)</span>
              </span>
            )}
            {rcConflicts.total > 0 && (
              <span className="dc-conflict-pill"
                title="Applied factor's direction disagrees with the flagger's current badge (e.g. you set a reduction where the badge now says expand)">
                ⚠ {rcConflicts.total} conflict{rcConflicts.total === 1 ? "" : "s"}
              </span>
            )}
            {(isDraft || catIsDraft || rcIsDraft) && <span className="dc-pill dc-pill-draft">WIP draft</span>}
          </p>
        </div>
      </header>

      {error && <div className="dc-banner dc-err">{error}</div>}
      {status && <div className="dc-banner dc-ok">{status}</div>}

      <section className="dc-teams">
        {teams.map((t) => {
          const n = dirtyByTeam.get(t) ?? 0;
          return (
            <button key={t} className={"dc-team" + (t === team ? " on" : "")} onClick={() => setTeam(t)}>
              {t}
              {n > 0 && <span className="dc-dot">{n}</span>}
            </button>
          );
        })}
      </section>

      {!team && <p className="dc-muted dc-hint">Select a team.</p>}

      {team && (
        <div className="dc-body">
          <TeamCategoryBar
            team={team}
            value={catEdited.get(team) ?? "unset"}
            note={catNotes.get(team) ?? ""}
            options={categories}
            dirty={catDirtyTeams.has(team)}
            onChange={(v) => setCategory(team, v)}
          />
          <TeamLoadChip load={teamTotals.load} locked={teamTotals.locked} free={teamTotals.free} />
          <TeamFlagsBar tf={roleFlags?.teams[team]}
            applied={rcApplied.byTeam.get(team) ?? { up: 0, down: 0 }}
            conflicts={rcConflicts.byTeam.get(team) ?? 0}
            generatedAt={roleFlags?.generatedAt} />
          <Legend />
          <div className="dc-scroll">
            <table className="dc-table">
              <thead>
                <tr>
                  <th className="dc-name-col">Player</th>
                  <th>Pos</th>
                  <th>MPG</th>
                  <th>G</th>
                  <th>Live MPG</th>
                  <th>Adj. G</th>
                  <th>USG</th>
                  <th>Live USG</th>
                  <th>2026-27</th>
                  <th>2027-28</th>
                  <th>Tier</th>
                  <th>Injury</th>
                  <th>Usage role</th>
                  <th>Ovr G</th>
                  <th>Ovr MPG</th>
                </tr>
              </thead>
              <tbody>
                {TIER_ORDER.map((tierVal) => {
                  const list = grouped.get(tierVal) ?? [];
                  const meta = tiers.find((t) => t.value === tierVal);
                  return (
                    <TierGroup key={tierVal} label={meta?.label ?? tierVal} hint={meta?.hint ?? ""} cols={15}>
                      {list.map((r) => {
                        const k = keyOf(r);
                        const tierEdit = edited.get(k) ?? blankEdit(r);
                        const dirty = dirtyKeys.has(k);
                        const live = preview.get(k);
                        const hasOverride = tierEdit.overrideGames != null || tierEdit.overrideMpg != null;
                        const reduction = injuryReduction[tierEdit.tier]?.[tierEdit.injury] ?? 0;
                        // Live usage preview: projected USG% x the selected role's usage factor.
                        // Directionally exact; the model's Stage 3 does a small (<1%) team-total
                        // reconcile on the real run, so this slightly overstates -- a preview,
                        // exactly like Live MPG approximates the Python projections adjuster.
                        const rcTier = rcEdited.get(k) ?? RC_DEFAULT_TIER;
                        const usgMult = USG_MULT[rcTier] ?? 1;
                        const liveUsg = r.usg != null && usgMult !== 1 ? r.usg * usgMult : null;
                        const rcConflict = rcConflicts.keys.has(k);
                        return (
                          <tr key={k} className={(dirty ? "dc-dirty" : "") + (hasOverride ? " dc-overridden" : "")
                            + (rcConflict ? " dc-rc-conflict-row" : "")}>
                            <td className="dc-name-col">
                              <span className="dc-name-text" title={r.player}>{r.player}</span>
                              {roleFlags?.players[k] && <PlayerBadge flag={roleFlags.players[k]} />}
                            </td>
                            <td className="dc-dim">{r.pos}</td>
                            <td className="dc-num">{r.projMpg ?? "—"}</td>
                            <td className="dc-num">{r.projGames ?? "—"}</td>
                            <td className={"dc-num" + (live ? " dc-live" : "")}>
                              {live ? live.mpg : "—"}
                            </td>
                            <td className="dc-num dc-adj">
                              {tierEdit.injury !== "none" && r.projGames != null
                                ? Math.round(r.projGames * (1 - reduction))
                                : "—"}
                            </td>
                            <td className="dc-num dc-usg" style={{ background: usgTint(r.usg) }}>{r.usg ?? "—"}</td>
                            <td className={"dc-num" + (liveUsg != null ? " dc-live-usg" : "")}
                              title={liveUsg != null ? `projected USG ${r.usg} × ${usgMult.toFixed(2)} (${rcTier})` : undefined}>
                              {liveUsg != null ? liveUsg.toFixed(1) : "—"}
                            </td>
                            <td><SalaryCell amount={r.salaryNow} status={r.statusNow} /></td>
                            <td><SalaryCell amount={r.salaryNext} status={r.statusNext} /></td>
                            <td>
                              <select
                                className={"dc-select" + (tierEdit.tier === "cut" ? " dc-select-injured" : "")}
                                value={tierEdit.tier}
                                onChange={(e) => setTier(r, e.target.value)}
                              >
                                {tiers.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                              </select>
                            </td>
                            <td>
                              <select
                                className={"dc-select" + (tierEdit.injury !== "none" ? " dc-select-injured" : "")}
                                value={tierEdit.injury}
                                onChange={(e) => setInjury(r, e.target.value)}
                              >
                                {injuries.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                              </select>
                            </td>
                            <td className="dc-rc-cell">
                              <select
                                className={"dc-select"
                                  + (rcDirtyKeys.has(k) ? " dc-rc-dirty" : "")
                                  + (rcTier !== RC_DEFAULT_TIER ? " dc-rc-active" : "")
                                  + (rcConflict ? " dc-rc-select-conflict" : "")}
                                value={rcTier}
                                onChange={(e) => setRcTier(r, e.target.value)}
                              >
                                {rcTierOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                              </select>
                              {usgMult !== 1 && (
                                <span className="dc-rc-mult" title="usage-rate factor the model applies to this player">
                                  ×{usgMult.toFixed(2)}
                                </span>
                              )}
                              {rcConflict && (
                                <span className="dc-rc-conflict-mark"
                                  title={`Conflict: you set ${rcTier} (${rcIsUp(rcTier) ? "usage ↑" : "usage ↓"}) but the `
                                    + `flagger's current badge for this player is the opposite direction — worth a re-check.`}>
                                  ⚠
                                </span>
                              )}
                              {rcTier !== RC_DEFAULT_TIER && (
                                <button type="button" className="dc-rc-revert"
                                  title="Revert this player's usage role to No change"
                                  onClick={() => setRcTier(r, RC_DEFAULT_TIER)}>↺</button>
                              )}
                            </td>
                            <td>
                              <input
                                type="number" min={0} max={82} placeholder="—"
                                title="Full override: the exact games total (e.g. 65), not an adjustment to the model's number"
                                className={"dc-ovr-input" + (tierEdit.overrideGames != null ? " dc-ovr-active" : "")}
                                value={tierEdit.overrideGames ?? ""}
                                onChange={(e) => setOverrideGames(r, e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="number" min={0} max={48} step={0.1} placeholder="—"
                                title="Full override: the exact MPG (e.g. 28.0), not an adjustment to the model's number"
                                className={"dc-ovr-input" + (tierEdit.overrideMpg != null ? " dc-ovr-active" : "")}
                                value={tierEdit.overrideMpg ?? ""}
                                onChange={(e) => setOverrideMpg(r, e.target.value)}
                              />
                            </td>
                          </tr>
                        );
                      })}
                      {list.length === 0 && (
                        <tr><td colSpan={15} className="dc-empty">no players in this tier</td></tr>
                      )}
                    </TierGroup>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <footer className="dc-actions">
        {confirmMode === "publish" ? (
          <>
            <div className="dc-actioninfo dc-confirmtext">
              Publish {totalDirty} change{totalDirty === 1 ? "" : "s"} to the canonical CSVs?
            </div>
            <button className="dc-btn dc-ghost" disabled={saving} onClick={() => setConfirmMode(null)}>Cancel</button>
            <button className="dc-btn dc-pub" disabled={saving} onClick={() => send("publish")}>Yes, publish</button>
          </>
        ) : confirmMode === "discard" ? (
          <>
            <div className="dc-actioninfo dc-confirmtext">Discard the WIP draft and revert to canonical?</div>
            <button className="dc-btn dc-ghost" disabled={saving} onClick={() => setConfirmMode(null)}>Keep</button>
            <button className="dc-btn dc-danger" disabled={saving} onClick={discard}>Discard</button>
          </>
        ) : (
          <>
            <div className="dc-actioninfo">
              {totalDirty > 0 ? `${totalDirty} change${totalDirty === 1 ? "" : "s"}` : "no changes"}
            </div>
            {(isDraft || catIsDraft || rcIsDraft) && (
              <button className="dc-btn dc-ghost" disabled={saving} onClick={() => setConfirmMode("discard")}>Discard</button>
            )}
            <button className="dc-btn dc-wip" disabled={saving || totalDirty === 0} onClick={() => send("wip")}>Save WIP</button>
            <button className="dc-btn dc-pub" disabled={saving || totalDirty === 0} onClick={() => setConfirmMode("publish")}>Publish</button>
          </>
        )}
      </footer>

      <Style />
    </div>
  );
}

function TierGroup({ label, hint, cols, children }: { label: string; hint: string; cols: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="dc-grouphead">
        <td colSpan={cols}>
          <span className="dc-groupname">{label}</span>
          <span className="dc-grouphint">{hint}</span>
        </td>
      </tr>
      {children}
    </>
  );
}

function Style() {
  return (
    <style>{`
      .dc-root { width: 100%; height: 100%; margin: 0 auto; padding: 16px 20px 120px; color: var(--rt-ink);
        background: var(--rt-canvas); font-family: var(--rt-font-sans); -webkit-tap-highlight-color: transparent;
        box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; }
      .dc-head, .dc-teams, .dc-hint, .dc-banner { flex: 0 0 auto; }
      .dc-head h1 { font-size: 20px; margin: 0; color: var(--rt-body-strong); font-weight: 700; }
      .dc-muted { color: var(--rt-muted); font-size: 13px; margin: 4px 0 0; }
      .dc-hint { padding: 20px 4px; }
      .dc-pill { font-size: 11px; padding: 2px 7px; border-radius: 999px; margin-left: 8px; font-weight: 600;
        background: color-mix(in srgb, var(--rt-primary) 20%, transparent); color: var(--rt-primary); }
      .dc-banner { margin: 12px 0; padding: 10px 12px; border-radius: 10px; font-size: 13px; }
      .dc-err { background: color-mix(in srgb, var(--rt-down) 16%, transparent); color: var(--rt-down); }
      .dc-ok { background: color-mix(in srgb, var(--rt-up) 16%, transparent); color: var(--rt-up); }

      .dc-teams { display: grid; grid-template-columns: repeat(10, 1fr); gap: 6px; margin: 14px 0; max-width: 900px; }
      .dc-team { position: relative; padding: 10px 0; border: 1px solid var(--rt-hairline); background: var(--rt-surface-soft);
        color: var(--rt-body); border-radius: 10px; font-weight: 700; font-size: 13px; cursor: pointer;
        font-family: var(--rt-font-sans); }
      .dc-team.on { background: var(--rt-primary); border-color: var(--rt-primary); color: var(--rt-on-primary); }
      .dc-dot { position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; padding: 0 4px;
        background: var(--rt-primary); color: var(--rt-on-primary); border-radius: 999px; font-size: 11px;
        line-height: 18px; font-weight: 800; }

      .dc-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }

      .dc-legend { flex: 0 0 auto; display: flex; flex-wrap: wrap; gap: 14px; margin: 4px 0 12px; }
      .dc-legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--rt-muted); }
      .dc-legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

      .dc-catbar { flex: 0 0 auto; display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin: 4px 0 14px;
        padding: 10px 14px; border: 1px solid var(--rt-hairline); border-radius: 10px;
        background: var(--rt-surface-soft); max-width: 100%; }
      .dc-catbar-dirty { border-color: var(--rt-primary); background: color-mix(in srgb, var(--rt-primary) 8%, transparent); }
      .dc-catbar-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
        color: var(--rt-muted); }
      .dc-catbar-select { min-width: 150px; }
      .dc-catbar-hint { font-size: 12px; color: var(--rt-muted); }
      .dc-catbar-note { font-size: 12px; color: var(--rt-primary); font-style: italic; }

      .dc-loadbar { flex: 0 0 auto; display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; margin: 0 0 14px;
        padding: 10px 14px; border: 1px solid var(--rt-up); border-radius: 10px;
        background: color-mix(in srgb, var(--rt-up) 10%, transparent); max-width: 100%; }
      .dc-loadbar-off { border-color: var(--rt-down); background: color-mix(in srgb, var(--rt-down) 10%, transparent); }
      .dc-loadbar-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
        color: var(--rt-muted); }
      .dc-loadbar-value { font-size: 18px; font-weight: 800; font-family: var(--rt-font-mono);
        color: var(--rt-up); }
      .dc-loadbar-off .dc-loadbar-value { color: var(--rt-down); }
      .dc-loadbar-target { font-size: 12px; color: var(--rt-muted); }
      .dc-loadbar-diff { font-size: 12px; font-weight: 700; font-family: var(--rt-font-mono); color: var(--rt-down); }
      .dc-loadbar-free { font-size: 12px; color: var(--rt-muted); margin-left: auto; }

      .dc-flagbar { flex: 0 0 auto; display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px 14px;
        margin: 0 0 14px; padding: 10px 14px; border: 1px solid var(--rt-hairline); border-radius: 10px;
        background: var(--rt-surface-soft); max-width: 100%; }
      .dc-flagbar-on { border-color: #a78bfa; background: color-mix(in srgb, #a78bfa 8%, transparent); }
      .dc-flagbar-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
        color: var(--rt-muted); }
      .dc-flagbar-net { font-size: 13px; font-weight: 700; font-family: var(--rt-font-mono); color: var(--rt-body-strong); }
      .dc-flagbar-dir { font-size: 11px; font-weight: 600; color: var(--rt-muted); margin-left: 6px;
        font-family: var(--rt-font-sans); }
      .dc-flagbar-list { margin: 0; padding: 0; list-style: none; flex: 1 1 100%; display: flex;
        flex-direction: column; gap: 4px; }
      .dc-flagbar-list li { font-size: 12px; color: var(--rt-body); cursor: help; }
      .dc-flagbar-clear { font-size: 12px; color: var(--rt-muted); font-style: italic; }

      .dc-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; border: 1px solid var(--rt-hairline);
        border-radius: 12px; max-width: 100%; }
      .dc-table { border-collapse: collapse; width: 100%; min-width: 780px; font-size: 13px; background: var(--rt-surface-soft); }
      .dc-table th { text-align: left; font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
        color: var(--rt-muted); padding: 10px 6px; border-bottom: 1px solid var(--rt-hairline); position: sticky;
        top: 0; z-index: 2; background: var(--rt-surface-soft); font-family: var(--rt-font-sans); white-space: nowrap; }
      .dc-table td { padding: 8px 6px; border-bottom: 1px solid var(--rt-hairline-soft); vertical-align: middle; }
      .dc-name-col { font-weight: 600; color: var(--rt-body-strong); white-space: nowrap; }
      .dc-name-text { display: inline-block; max-width: 130px; overflow: hidden; text-overflow: ellipsis;
        white-space: nowrap; vertical-align: middle; }
      .dc-badge { display: inline-flex; align-items: center; gap: 3px; margin-left: 6px; padding: 1px 6px;
        font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em;
        border: 1px solid; border-radius: 999px; vertical-align: middle; cursor: help;
        background: color-mix(in srgb, currentColor 10%, transparent); white-space: nowrap; }
      .dc-badge-glyph { font-size: 11px; line-height: 1; }
      .dc-dim { color: var(--rt-muted); }
      .dc-num { font-variant-numeric: tabular-nums; font-family: var(--rt-font-mono); color: var(--rt-body); }
      .dc-usg { font-weight: 700; }
      .dc-adj { color: var(--rt-down); font-weight: 700; }
      .dc-live { color: var(--rt-up); font-weight: 700; }
      .dc-live-usg { color: #a78bfa; font-weight: 700; }
      .dc-dirty td { background: color-mix(in srgb, var(--rt-primary) 8%, transparent); }
      .dc-overridden td { background: color-mix(in srgb, var(--rt-up) 6%, transparent); }
      .dc-rc-conflict-row td { background: color-mix(in srgb, #f59e0b 7%, transparent); }

      .dc-ovr-input { width: 62px; padding: 8px 8px; font-size: 13px; font-weight: 600;
        color: var(--rt-body-strong); background: var(--rt-canvas); border: 1px solid var(--rt-hairline);
        border-radius: 8px; font-family: var(--rt-font-mono); text-align: right; }
      .dc-ovr-active { border-color: var(--rt-up); color: var(--rt-up); }

      .dc-grouphead td { background: var(--rt-surface-strong); padding: 8px 12px; border-bottom: 1px solid var(--rt-hairline); }
      .dc-groupname { font-weight: 800; text-transform: uppercase; letter-spacing: .05em; font-size: 12px; color: var(--rt-primary); }
      .dc-grouphint { margin-left: 10px; font-size: 12px; color: var(--rt-muted); font-weight: 400; text-transform: none; letter-spacing: 0; }
      .dc-empty { color: var(--rt-muted-soft); font-style: italic; font-size: 12px; }

      .dc-sal { font-variant-numeric: tabular-nums; font-family: var(--rt-font-mono); color: var(--rt-body);
        display: inline-block; min-width: 52px; }

      .dc-select { padding: 6px 6px; font-size: 12px; font-weight: 600; color: var(--rt-body-strong);
        background: var(--rt-canvas); border: 1px solid var(--rt-hairline); border-radius: 8px; font-family: var(--rt-font-sans);
        width: 108px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dc-select-injured { border-color: var(--rt-down); color: var(--rt-down); }

      .dc-rc-cell { white-space: nowrap; }
      .dc-rc-active { border-color: #a78bfa; color: #a78bfa; }
      .dc-rc-dirty { border-color: var(--rt-primary); box-shadow: 0 0 0 1px var(--rt-primary) inset; }
      .dc-rc-mult { margin-left: 6px; font-size: 11px; font-weight: 700; font-family: var(--rt-font-mono);
        color: #a78bfa; }
      .dc-rc-revert { margin-left: 5px; padding: 2px 6px; font-size: 12px; line-height: 1; cursor: pointer;
        color: var(--rt-muted); background: transparent; border: 1px solid var(--rt-hairline);
        border-radius: 6px; font-family: var(--rt-font-sans); }
      .dc-rc-revert:hover { color: #a78bfa; border-color: #a78bfa; }
      .dc-rc-select-conflict { border-color: #f59e0b !important; }
      .dc-rc-conflict-mark { margin-left: 5px; font-size: 12px; color: #f59e0b; cursor: help; }

      .dc-applied-pill { margin-left: 8px; padding: 2px 8px; border-radius: 999px; font-size: 11px;
        font-weight: 700; background: color-mix(in srgb, #a78bfa 18%, transparent); color: #a78bfa; }
      .dc-applied-split { font-weight: 600; opacity: .8; }
      .dc-conflict-pill { margin-left: 8px; padding: 2px 8px; border-radius: 999px; font-size: 11px;
        font-weight: 700; background: color-mix(in srgb, #f59e0b 18%, transparent); color: #f59e0b; }
      .dc-flagbar-snap { flex: 1 1 100%; font-size: 11px; color: var(--rt-muted); cursor: help; }

      .dc-actions { position: fixed; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 8px;
        padding: 12px 14px calc(12px + env(safe-area-inset-bottom));
        background: color-mix(in srgb, var(--rt-canvas) 92%, transparent);
        backdrop-filter: blur(8px); border-top: 1px solid var(--rt-hairline); }
      .dc-actioninfo { flex: 1; font-size: 13px; color: var(--rt-muted); }
      .dc-btn { padding: 11px 16px; border-radius: 10px; font-weight: 700; font-size: 14px; border: none;
        cursor: pointer; color: var(--rt-on-primary); font-family: var(--rt-font-sans); }
      .dc-btn:disabled { opacity: .4; cursor: default; }
      .dc-ghost { background: transparent; border: 1px solid var(--rt-hairline); color: var(--rt-body); }
      .dc-wip { background: var(--rt-surface-strong); color: var(--rt-body-strong); }
      .dc-pub { background: var(--rt-up); }
      .dc-danger { background: var(--rt-down); }
      .dc-confirmtext { color: var(--rt-primary); font-weight: 600; }
    `}</style>
  );
}
