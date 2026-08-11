"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { LeagueAnalysis } from "@/lib/fantrax/analyze";
import { CATEGORY_LABEL, FHE_CATEGORIES, type FantraxLeague, type FheCategory } from "@/lib/fantrax/league";
import {
  DEFAULT_ADVANCED_SETTINGS, DEFAULT_GAMES_CAP_SETTINGS, DEFAULT_LEAGUE_TAGS, STANDARD_POSITION_SLOTS,
  type LeagueFormat, type LeagueType, type SalaryFormat,
} from "@/lib/fantrax/league-tags";
import type { SavedLeague } from "@/lib/fantrax/store";
import { HubShell } from "../../_components/hub-shell";
import { ToggleSwitch } from "../../_components/toggle-switch";
import { SegmentedControl } from "../../_components/segmented-control";
import { Stepper } from "../../_components/stepper";
import { IconChevronLeft } from "../../_components/icons";
import { useSavedLeagues } from "../../_lib/use-saved-leagues";

/** Extra Fantrax-style categories the "Add category" picker offers —
 *  informational only, FHE's engine has no z-score model for any of these
 *  (see SavedLeagueSettings.additionalCategories in store.ts). */
const EXTRA_CATEGORIES: { code: string; label: string }[] = [
  { code: "DD", label: "Double-doubles (DD)" },
  { code: "TD", label: "Triple-doubles (TD)" },
  { code: "A/TO", label: "Assist / turnover ratio (A/TO)" },
  { code: "MPG", label: "Minutes per game (MPG)" },
  { code: "TREB", label: "Total rebounds (TREB)" },
  { code: "FGM", label: "Field goals made (FGM)" },
  { code: "FTM", label: "Free throws made (FTM)" },
  { code: "PF", label: "Personal fouls (PF)" },
  { code: "TF", label: "Technical fouls (TF)" },
  { code: "GP", label: "Games played (GP)" },
  { code: "OREB", label: "Offensive rebounds (OREB)" },
  { code: "DREB", label: "Defensive rebounds (DREB)" },
];

const KEEPER_OPTIONS = ["all", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1"];
const keeperLabel = (v: string) => (v === "all" ? "Keep all (dynasty)" : `${v} keeper${v === "1" ? "" : "s"}`);

interface Draft {
  leagueName: string;
  format: LeagueFormat;
  formatConfirmed: boolean;
  leagueType: LeagueType;
  salaryFormat: SalaryFormat;
  teamCount: number;
  scoredCategories: FheCategory[];
  additionalCategories: string[];
  positionSlots: Record<string, number>;
  lineupCadence: "daily" | "weekly";
  capPos: boolean;
  capPosN: number;
  capMatch: boolean;
  capMatchN: number;
  salaryCapTotal: number;
  salaryCapConfirmed: boolean;
  capType: "soft" | "hard";
  maxContractLengthEnabled: boolean;
  maxContractLength: number;
  keeperPolicy: string;
  rookieDraftRounds: number;
  taxiSquad: boolean;
  waiverType: "faab" | "rolling";
  faabBudget: number;
  tradeDeadline: string;
  conferencesEnabled: boolean;
  conferences: { name: string; teamIds: string[] }[];
}

/** Default conference split when the user first turns Standings on: real
 *  Fantrax division data (FantraxLeague.teams[].division) when the league
 *  actually has it, otherwise a simple alphabetical half/half starting
 *  point the user can freely reassign from. */
function deriveDefaultConferences(league: FantraxLeague | undefined): { name: string; teamIds: string[] }[] {
  if (!league || league.teams.length === 0) return [];
  const byDivision = new Map<string, string[]>();
  let anyDivision = false;
  for (const t of league.teams) {
    if (t.division) anyDivision = true;
    const key = t.division ?? "Unassigned";
    if (!byDivision.has(key)) byDivision.set(key, []);
    byDivision.get(key)!.push(t.id);
  }
  if (anyDivision) {
    return [...byDivision.entries()].map(([name, teamIds]) => ({ name, teamIds }));
  }
  const sorted = [...league.teams].sort((a, b) => a.name.localeCompare(b.name));
  const mid = Math.ceil(sorted.length / 2);
  return [
    { name: "Conference 1", teamIds: sorted.slice(0, mid).map((t) => t.id) },
    { name: "Conference 2", teamIds: sorted.slice(mid).map((t) => t.id) },
  ];
}

function buildDraft(saved: SavedLeague, analysis: LeagueAnalysis | null): Draft {
  const s = saved.settings;
  const league = analysis?.league;
  const salaryFormat = s.salaryFormat ?? (s.hasSalaries || league?.hasSalaries ? "real" : DEFAULT_LEAGUE_TAGS.salaryFormat);
  return {
    leagueName: saved.leagueName,
    format: s.format ?? DEFAULT_LEAGUE_TAGS.format,
    formatConfirmed: s.formatConfirmed ?? false,
    leagueType: s.leagueType ?? DEFAULT_LEAGUE_TAGS.leagueType,
    salaryFormat,
    teamCount: league?.teamCount ?? s.teamCount,
    scoredCategories: s.scoredCategoriesOverride ?? (league?.categories.scored ? [...league.categories.scored] : (s.categories as FheCategory[])),
    additionalCategories: s.additionalCategories ?? [],
    positionSlots: s.positionSlotsOverride ?? league?.positionSlots ?? STANDARD_POSITION_SLOTS,
    lineupCadence: s.lineupCadence ?? DEFAULT_GAMES_CAP_SETTINGS.lineupCadence,
    capPos: s.capPos ?? DEFAULT_GAMES_CAP_SETTINGS.capPos,
    capPosN: s.capPosN ?? DEFAULT_GAMES_CAP_SETTINGS.capPosN,
    capMatch: s.capMatch ?? DEFAULT_GAMES_CAP_SETTINGS.capMatch,
    capMatchN: s.capMatchN ?? DEFAULT_GAMES_CAP_SETTINGS.capMatchN,
    salaryCapTotal: s.salaryCapTotal ?? 0,
    salaryCapConfirmed: s.salaryCapConfirmed ?? false,
    capType: s.capType ?? DEFAULT_ADVANCED_SETTINGS.capType,
    // Max contract length is a real rule mostly in custom-salary leagues —
    // seed the toggle on for those, off otherwise, until the user overrides.
    maxContractLengthEnabled: s.maxContractLengthEnabled ?? (salaryFormat === "custom"),
    maxContractLength: Math.min(5, s.maxContractLength ?? DEFAULT_ADVANCED_SETTINGS.maxContractLength),
    keeperPolicy: s.keeperPolicy ?? DEFAULT_ADVANCED_SETTINGS.keeperPolicy,
    rookieDraftRounds: s.rookieDraftRounds ?? DEFAULT_ADVANCED_SETTINGS.rookieDraftRounds,
    taxiSquad: s.taxiSquad ?? DEFAULT_ADVANCED_SETTINGS.taxiSquad,
    waiverType: s.waiverType ?? DEFAULT_ADVANCED_SETTINGS.waiverType,
    faabBudget: s.faabBudget ?? DEFAULT_ADVANCED_SETTINGS.faabBudget,
    tradeDeadline: s.tradeDeadline ?? "",
    conferencesEnabled: s.conferencesEnabled ?? false,
    conferences: s.conferences ?? deriveDefaultConferences(league),
  };
}

function SettingsRow({ label, help, children }: { label: React.ReactNode; help?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "18px 0", flexWrap: "wrap" }}>
      <div style={{ maxWidth: 440 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700 }}>{label}</div>
        {help && <div style={{ fontSize: 12.5, color: "var(--rt-muted)", marginTop: 3 }}>{help}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function ConfirmBadge() {
  return (
    <span
      style={{
        fontFamily: "var(--rt-font-mono)", fontSize: 9.5, fontWeight: 700, padding: "2px 7px", borderRadius: 100,
        background: "rgba(250,70,22,0.15)", color: "var(--rt-primary)", marginLeft: 8, letterSpacing: "0.04em",
      }}
    >
      CONFIRM
    </span>
  );
}

function SettingsCard({
  title, note, tinted, children,
}: { title: string; note?: string; tinted?: boolean; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px" }}>
        {title}
        {note && <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 11, fontWeight: 400, color: tinted ? "var(--rt-primary)" : "var(--rt-muted)", marginLeft: 10, textTransform: "none" }}>{note}</span>}
      </h3>
      <div
        style={{
          border: `1px solid ${tinted ? "rgba(250,70,22,0.35)" : "var(--rt-hairline)"}`, borderRadius: 16, padding: "0 20px",
          background: tinted ? "rgba(250,70,22,0.04)" : "transparent",
        }}
      >
        {children}
      </div>
    </section>
  );
}

const divider = <div style={{ height: 1, background: "var(--rt-hairline)" }} />;
const numInputStyle: React.CSSProperties = {
  width: 76, height: 34, padding: "0 10px", borderRadius: 8, border: "1px solid var(--rt-hairline)",
  background: "var(--rt-surface-soft)", color: "var(--rt-ink)", fontFamily: "var(--rt-font-mono)", fontSize: 13.5, textAlign: "right",
};
const selectStyle: React.CSSProperties = {
  height: 36, borderRadius: 8, border: "1px solid var(--rt-hairline)", background: "var(--rt-surface-soft)",
  padding: "0 10px", fontSize: 13, color: "var(--rt-ink)",
};

export default function DeepEdgeSettingsPage() {
  const { leagues, loading: loadingSaved, refresh } = useSavedLeagues();
  const saved = leagues[0] ?? null;
  const [analysis, setAnalysis] = useState<LeagueAnalysis | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);

  function loadAnalysis(s: SavedLeague) {
    const params = new URLSearchParams({
      leagueId: s.leagueId,
      dataset: s.settings.defaultDataset ?? "2027:projection",
      leagueType: s.settings.leagueType ?? "redraft",
    });
    if (s.teamId) params.set("teamId", s.teamId);
    return fetch(`/api/fantrax/league?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return null; }
        setAnalysis(data);
        setSyncedAt(Date.now());
        return data as LeagueAnalysis;
      })
      .catch((err) => { setError(String(err)); return null; });
  }

  useEffect(() => {
    if (!saved) return;
    loadAnalysis(saved).then((a) => setDraft(buildDraft(saved, a)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved?.leagueId]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setDirty(true);
  }

  const pointsMode = analysis?.league.scoringMode === "points";
  const mappedPct = saved
    ? Math.round((saved.settings.categories.length / Math.max(1, saved.settings.categories.length + saved.settings.unmodelledCategories.length)) * 100)
    : 100;

  const confirmCount = draft
    ? (!pointsMode && !draft.formatConfirmed ? 1 : 0) +
      (draft.salaryFormat !== "none" && !draft.salaryCapConfirmed ? 1 : 0)
    : 0;

  async function handleReSync() {
    if (!saved) return;
    const fresh = await loadAnalysis(saved);
    if (!fresh || !draft) return;
    setDraft({
      ...draft,
      scoredCategories: [...fresh.league.categories.scored],
      positionSlots: { ...fresh.league.positionSlots },
      teamCount: fresh.league.teamCount,
    });
    setDirty(true);
  }

  async function handleSave() {
    if (!saved || !draft || !analysis) return;
    setSaving(true);
    try {
      const { league } = analysis;
      const res = await fetch("/api/fantrax/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId: saved.leagueId,
          leagueName: draft.leagueName,
          teamId: saved.teamId,
          teamName: saved.teamName,
          settings: {
            seasonYear: league.seasonYear,
            scoringType: league.scoringType,
            categories: league.categories.scored,
            unmodelledCategories: league.categories.unmodelled,
            teamCount: league.teamCount,
            maxTotalPlayers: league.maxTotalPlayers,
            maxActivePlayers: league.maxActivePlayers,
            hasSalaries: league.hasSalaries,
            poolSize: league.poolSize,
            defaultDataset: saved.settings.defaultDataset,
            format: draft.format,
            formatConfirmed: draft.formatConfirmed,
            leagueType: draft.leagueType,
            salaryFormat: draft.salaryFormat,
            scoredCategoriesOverride: draft.scoredCategories,
            additionalCategories: draft.additionalCategories,
            positionSlotsOverride: draft.positionSlots,
            lineupCadence: draft.lineupCadence,
            capPos: draft.capPos,
            capPosN: draft.capPosN,
            capMatch: draft.capMatch,
            capMatchN: draft.capMatchN,
            salaryCapTotal: draft.salaryCapTotal,
            salaryCapConfirmed: draft.salaryCapConfirmed,
            capType: draft.capType,
            maxContractLengthEnabled: draft.maxContractLengthEnabled,
            maxContractLength: draft.maxContractLength,
            keeperPolicy: draft.keeperPolicy,
            rookieDraftRounds: draft.rookieDraftRounds,
            taxiSquad: draft.taxiSquad,
            waiverType: draft.waiverType,
            faabBudget: draft.faabBudget,
            tradeDeadline: draft.tradeDeadline,
            conferencesEnabled: draft.conferencesEnabled,
            conferences: draft.conferences,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setDirty(false);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  const positionEntries = useMemo(() => {
    if (!draft) return [];
    const order = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL", "Bench", "IR", "Minors"];
    const known = new Set(order.map((o) => o.toLowerCase()));
    const rest = Object.keys(draft.positionSlots).filter((k) => !known.has(k.toLowerCase()));
    return [...order, ...rest].filter((slot, i, arr) => arr.indexOf(slot) === i);
  }, [draft]);

  // Reserve slots — never count toward the active/starting lineup. Mirrors
  // lineup.ts's RESERVE_SLOTS (the source of truth for the actual scoring
  // math); duplicated here as a plain name list purely for this display sum.
  const RESERVE = new Set(["bench", "be", "res", "ir", "na", "minors", "min", "taxi"]);
  const starterSlots = positionEntries.filter((s) => !RESERVE.has(s.toLowerCase()));
  const totalRoster = draft ? positionEntries.reduce((sum, s) => sum + (draft.positionSlots[s] ?? 0), 0) : 0;
  const starterCount = draft ? starterSlots.reduce((sum, s) => sum + (draft.positionSlots[s] ?? 0), 0) : 0;
  const benchCount = draft ? (draft.positionSlots["Bench"] ?? draft.positionSlots["BE"] ?? 0) : 0;
  const irCount = draft ? (draft.positionSlots["IR"] ?? 0) : 0;
  const minorsCount = draft ? (draft.positionSlots["Minors"] ?? 0) : 0;

  const teams = analysis?.league.teams ?? [];
  const unassignedTeams = draft ? teams.filter((t) => !draft.conferences.some((c) => c.teamIds.includes(t.id))) : [];

  function assignTeamToConference(teamId: string, confIndex: number) {
    if (!draft) return;
    update(
      "conferences",
      draft.conferences.map((c, i) => (i === confIndex ? { ...c, teamIds: [...c.teamIds, teamId] } : c)),
    );
  }
  function unassignTeam(confIndex: number, teamId: string) {
    if (!draft) return;
    update(
      "conferences",
      draft.conferences.map((c, i) => (i === confIndex ? { ...c, teamIds: c.teamIds.filter((id) => id !== teamId) } : c)),
    );
  }
  function renameConference(confIndex: number, name: string) {
    if (!draft) return;
    update("conferences", draft.conferences.map((c, i) => (i === confIndex ? { ...c, name } : c)));
  }
  function addConference() {
    if (!draft) return;
    update("conferences", [...draft.conferences, { name: `Conference ${draft.conferences.length + 1}`, teamIds: [] }]);
  }
  function removeConference(confIndex: number) {
    if (!draft || draft.conferences.length <= 1) return;
    update("conferences", draft.conferences.filter((_, i) => i !== confIndex));
  }

  return (
    <HubShell hasLeague={Boolean(saved)} breadcrumb={saved ? `${saved.leagueName} · Settings` : "Settings"}>
      <Link href="/deep-edge/home" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--rt-muted)", fontSize: 13, textDecoration: "none", marginBottom: 16 }}>
        <IconChevronLeft size={14} /> Back to home
      </Link>

      <h1 style={{ fontSize: 30, fontWeight: 700, margin: "0 0 8px" }}>Customise league settings</h1>

      {loadingSaved || (saved && !draft && !error) ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>Loading…</p>
      ) : error ? (
        <p style={{ color: "var(--rt-down)", fontSize: 13.5 }}>{error}</p>
      ) : !saved || !draft ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>No league connected yet — add one from Home to configure its settings.</p>
      ) : (
        <>
          <p style={{ color: "var(--rt-body)", fontSize: 14.5, margin: "0 0 20px", maxWidth: 680 }}>
            {saved.leagueName}, imported from Fantrax. Review what we captured and edit anything the import missed
            {confirmCount > 0 ? <> — <strong>{confirmCount} field{confirmCount === 1 ? "" : "s"} need{confirmCount === 1 ? "s" : ""} a quick confirm.</strong></> : "."}
          </p>

          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
              padding: "14px 18px", borderRadius: 14, background: "var(--rt-surface-soft)", marginBottom: 28,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              <span style={{ color: "var(--rt-up)" }}>●</span> Settings imported from Fantrax{" "}
              <span style={{ fontWeight: 400, color: "var(--rt-muted)" }}>
                · {syncedAt ? "synced just now" : "—"} · {mappedPct}% auto-mapped
              </span>
            </span>
            <button
              type="button"
              onClick={handleReSync}
              style={{
                height: 34, padding: "0 16px", borderRadius: 100, border: "1px solid var(--rt-hairline)",
                background: "var(--rt-canvas)", color: "var(--rt-ink)", fontWeight: 600, fontSize: 12.5, cursor: "pointer",
              }}
            >
              Re-sync from Fantrax
            </button>
          </div>

          {/* League basics */}
          <SettingsCard title="League basics">
            <SettingsRow label="League name">
              <input
                type="text"
                value={draft.leagueName}
                onChange={(e) => update("leagueName", e.target.value)}
                style={{ ...selectStyle, width: 220 }}
              />
            </SettingsRow>
            {divider}
            <SettingsRow label="Platform" help="Connected — can't be changed here">
              <span
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 100,
                  background: "var(--rt-surface-strong)", color: "var(--rt-muted)", fontSize: 12.5, fontWeight: 600,
                }}
              >
                Fx Fantrax 🔒
              </span>
            </SettingsRow>
            {divider}
            <SettingsRow label="Scoring format">
              <SegmentedControl
                value={pointsMode ? "points" : draft.format}
                onChange={(v) => { if (v !== "points") { update("format", v as LeagueFormat); update("formatConfirmed", true); } }}
                disabledOptions={pointsMode ? ["roto", "h2h"] : ["points"]}
                options={[{ value: "roto", label: "Roto" }, { value: "h2h", label: "H2H categories" }, { value: "points", label: "Points" }]}
              />
            </SettingsRow>
            {divider}
            <SettingsRow label="League type">
              <SegmentedControl
                value={draft.leagueType}
                onChange={(v) => update("leagueType", v)}
                options={[{ value: "redraft", label: "Redraft" }, { value: "keeper", label: "Keeper" }, { value: "dynasty", label: "Dynasty" }]}
              />
            </SettingsRow>
            {divider}
            <SettingsRow label="Salary mode" help="How player prices are valued">
              <SegmentedControl
                value={draft.salaryFormat}
                onChange={(v) => update("salaryFormat", v)}
                options={[{ value: "real", label: "Real salary" }, { value: "custom", label: "Custom salary" }, { value: "none", label: "Non-salary" }]}
              />
            </SettingsRow>
            {divider}
            <SettingsRow label="Teams">
              <Stepper value={draft.teamCount} onChange={(v) => update("teamCount", v)} min={2} max={40} />
            </SettingsRow>
            {divider}
            <SettingsRow label="Standings" help="Group teams into conferences for standings">
              <ToggleSwitch checked={draft.conferencesEnabled} onChange={(v) => update("conferencesEnabled", v)} ariaLabel="Conferences" />
            </SettingsRow>
            {draft.conferencesEnabled && (
              <div style={{ padding: "0 0 18px" }}>
                {draft.conferences.map((conf, ci) => (
                  <div key={ci} style={{ marginBottom: 12, padding: 14, borderRadius: 12, background: "var(--rt-surface-soft)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <input
                        type="text"
                        value={conf.name}
                        onChange={(e) => renameConference(ci, e.target.value)}
                        style={{ ...selectStyle, fontWeight: 700, flex: 1, maxWidth: 220 }}
                      />
                      {draft.conferences.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeConference(ci)}
                          style={{ background: "none", border: "none", color: "var(--rt-muted)", fontSize: 12, cursor: "pointer" }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {conf.teamIds.length === 0 && <span style={{ fontSize: 12.5, color: "var(--rt-muted)" }}>No teams yet</span>}
                      {conf.teamIds.map((id) => {
                        const team = teams.find((t) => t.id === id);
                        return (
                          <span
                            key={id}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 100,
                              background: "var(--rt-canvas)", border: "1px solid var(--rt-hairline)", fontSize: 12.5,
                            }}
                          >
                            {team?.name ?? id}
                            <button
                              type="button"
                              onClick={() => unassignTeam(ci, id)}
                              style={{ background: "none", border: "none", color: "var(--rt-muted)", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0 }}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addConference}
                  style={{
                    height: 32, padding: "0 14px", borderRadius: 100, border: "1px dashed var(--rt-hairline)",
                    background: "transparent", color: "var(--rt-ink)", fontWeight: 600, fontSize: 12.5, cursor: "pointer", marginBottom: unassignedTeams.length ? 14 : 0,
                  }}
                >
                  + Add conference
                </button>
                {unassignedTeams.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>Unassigned teams</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {unassignedTeams.map((team) => (
                        <div key={team.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <span style={{ fontSize: 13 }}>{team.name}</span>
                          <select
                            value=""
                            onChange={(e) => { if (e.target.value) assignTeamToConference(team.id, Number(e.target.value)); }}
                            style={selectStyle}
                          >
                            <option value="">Assign to…</option>
                            {draft.conferences.map((c, ci) => (
                              <option key={ci} value={ci}>{c.name}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </SettingsCard>

          {/* Scoring categories */}
          <SettingsCard title="Scoring categories" note={`${draft.scoredCategories.length}-CAT · tap to toggle`}>
            <div style={{ padding: "18px 0" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: draft.additionalCategories.length ? 14 : 0 }}>
                {FHE_CATEGORIES.map((cat) => {
                  const on = draft.scoredCategories.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        if (on && draft.scoredCategories.length <= 1) return; // keep at least one
                        update("scoredCategories", on ? draft.scoredCategories.filter((c) => c !== cat) : [...draft.scoredCategories, cat]);
                      }}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6, height: 36, padding: "0 16px", borderRadius: 100,
                        border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer",
                        background: on ? "var(--rt-ink)" : "var(--rt-surface-strong)",
                        color: on ? "var(--rt-canvas)" : "var(--rt-muted)",
                      }}
                    >
                      {CATEGORY_LABEL[cat]}
                      {cat === "TO" && (
                        <span style={{ fontSize: 9, fontFamily: "var(--rt-font-mono)", opacity: 0.7 }}>INV</span>
                      )}
                    </button>
                  );
                })}
                {draft.additionalCategories.map((code) => (
                  <button
                    key={code}
                    type="button"
                    title="Not modeled by FHE — informational only"
                    onClick={() => update("additionalCategories", draft.additionalCategories.filter((c) => c !== code))}
                    style={{
                      height: 36, padding: "0 16px", borderRadius: 100, cursor: "pointer",
                      border: "1px dashed var(--rt-hairline)", background: "transparent", color: "var(--rt-muted)",
                      fontSize: 13, fontWeight: 600,
                    }}
                  >
                    {code}
                  </button>
                ))}
              </div>
            </div>
            {divider}
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 0" }}>
              <span style={{ fontSize: 13, color: "var(--rt-muted)", fontWeight: 600 }}>Add category</span>
              <select
                value=""
                onChange={(e) => {
                  const code = e.target.value;
                  if (code && !draft.additionalCategories.includes(code)) update("additionalCategories", [...draft.additionalCategories, code]);
                }}
                style={{ ...selectStyle, minWidth: 220 }}
              >
                <option value="">Select a category to add…</option>
                {EXTRA_CATEGORIES.filter((c) => !draft.additionalCategories.includes(c.code)).map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
            </div>
          </SettingsCard>

          {/* Roster & positions */}
          <SettingsCard title="Roster & positions" note={`${totalRoster}-man roster · ${irCount} IR${minorsCount ? ` · ${minorsCount} Minors` : ""}`}>
            <div style={{ padding: "18px 0" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 20 }}>
                {positionEntries.map((slot) => (
                  <div key={slot}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>{slot}</div>
                    <Stepper
                      value={draft.positionSlots[slot] ?? 0}
                      onChange={(v) => update("positionSlots", { ...draft.positionSlots, [slot]: v })}
                      max={10}
                    />
                  </div>
                ))}
              </div>
            </div>
            {divider}
            <div style={{ padding: "14px 0", fontSize: 12.5, color: "var(--rt-muted)" }}>
              {starterCount} starters · {benchCount} bench · {irCount} IR{minorsCount ? ` · ${minorsCount} Minors` : ""} — {totalRoster}-man roster
            </div>
          </SettingsCard>

          {/* Games & lineups */}
          <SettingsCard title="Games & lineups" note="drives depth weighting in Power Rankings">
            <SettingsRow label="Lineup changes" help="How often you set your active roster">
              <SegmentedControl
                value={draft.lineupCadence}
                onChange={(v) => update("lineupCadence", v)}
                options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }]}
              />
            </SettingsRow>
            {divider}
            <SettingsRow label="Games cap per position" help="Season limit on games started at each position">
              {draft.capPos && (
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={draft.capPosN}
                    onChange={(e) => update("capPosN", Math.max(0, Math.min(500, Number(e.target.value.replace(/\D/g, "")) || 0)))}
                    style={numInputStyle}
                  />
                  <span style={{ fontSize: 12, color: "var(--rt-muted)" }}>/pos</span>
                </span>
              )}
              <ToggleSwitch checked={draft.capPos} onChange={(v) => update("capPos", v)} ariaLabel="Games cap per position" />
            </SettingsRow>
            {divider}
            <SettingsRow label="Games cap per matchup" help="H2H limit on total games started per matchup">
              {draft.capMatch && (
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={draft.capMatchN}
                    onChange={(e) => update("capMatchN", Math.max(0, Math.min(500, Number(e.target.value.replace(/\D/g, "")) || 0)))}
                    style={numInputStyle}
                  />
                  <span style={{ fontSize: 12, color: "var(--rt-muted)" }}>gms</span>
                </span>
              )}
              <ToggleSwitch checked={draft.capMatch} onChange={(v) => update("capMatch", v)} ariaLabel="Games cap per matchup" />
            </SettingsRow>
          </SettingsCard>

          {/* Salary cap */}
          {draft.salaryFormat !== "none" && (
            <SettingsCard
              title="Salary cap"
              note={`${draft.salaryFormat} salary${!draft.salaryCapConfirmed ? " · 1 to confirm" : ""}`}
              tinted={!draft.salaryCapConfirmed}
            >
              <SettingsRow label={<>Salary cap {!draft.salaryCapConfirmed && <ConfirmBadge />}</>} help="Imported from Fantrax — confirm the total cap">
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ color: "var(--rt-muted)" }}>$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={draft.salaryCapTotal.toLocaleString("en-US")}
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(/[^0-9]/g, "")) || 0;
                      setDraft((d) => (d ? { ...d, salaryCapTotal: n, salaryCapConfirmed: true } : d));
                      setDirty(true);
                    }}
                    style={{ ...numInputStyle, width: 140, borderColor: draft.salaryCapConfirmed ? "var(--rt-hairline)" : "var(--rt-primary)" }}
                  />
                </span>
              </SettingsRow>
              {divider}
              <SettingsRow label="Cap type">
                <SegmentedControl
                  value={draft.capType}
                  onChange={(v) => update("capType", v)}
                  options={[{ value: "soft", label: "Soft" }, { value: "hard", label: "Hard" }]}
                />
              </SettingsRow>
              {divider}
              <SettingsRow label="Max contract length" help="Typically only used in custom-salary leagues">
                {draft.maxContractLengthEnabled && (
                  <Stepper value={draft.maxContractLength} onChange={(v) => update("maxContractLength", v)} min={1} max={5} suffix="yrs" />
                )}
                <ToggleSwitch checked={draft.maxContractLengthEnabled} onChange={(v) => update("maxContractLengthEnabled", v)} ariaLabel="Max contract length" />
              </SettingsRow>
            </SettingsCard>
          )}

          {/* Keepers & contracts */}
          {(draft.leagueType === "dynasty" || draft.leagueType === "keeper") && (
            <SettingsCard title="Keepers & contracts">
              <SettingsRow label="Keeper policy" help="Full dynasty, or cap how many you keep (up to 10)">
                <select value={draft.keeperPolicy} onChange={(e) => update("keeperPolicy", e.target.value)} style={selectStyle}>
                  {KEEPER_OPTIONS.map((v) => (
                    <option key={v} value={v}>{keeperLabel(v)}</option>
                  ))}
                </select>
              </SettingsRow>
              {divider}
              <SettingsRow label="Rookie draft rounds">
                <Stepper value={draft.rookieDraftRounds} onChange={(v) => update("rookieDraftRounds", v)} min={0} max={10} />
              </SettingsRow>
              {divider}
              <SettingsRow label="Taxi / prospect squad">
                <ToggleSwitch checked={draft.taxiSquad} onChange={(v) => update("taxiSquad", v)} ariaLabel="Taxi / prospect squad" />
              </SettingsRow>
            </SettingsCard>
          )}

          {/* Waivers & trades */}
          <SettingsCard title="Waivers & trades">
            <SettingsRow label="Waiver type">
              <SegmentedControl
                value={draft.waiverType}
                onChange={(v) => update("waiverType", v)}
                options={[{ value: "faab", label: "FAAB" }, { value: "rolling", label: "Rolling" }]}
              />
            </SettingsRow>
            {draft.waiverType === "faab" && (
              <>
                {divider}
                <SettingsRow label="FAAB budget">
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ color: "var(--rt-muted)" }}>$</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={draft.faabBudget}
                      onChange={(e) => update("faabBudget", Number(e.target.value.replace(/\D/g, "")) || 0)}
                      style={numInputStyle}
                    />
                  </span>
                </SettingsRow>
              </>
            )}
            {divider}
            <SettingsRow label="Trade deadline">
              <input
                type="date"
                value={draft.tradeDeadline}
                onChange={(e) => update("tradeDeadline", e.target.value)}
                style={selectStyle}
              />
            </SettingsRow>
          </SettingsCard>

          {/* sticky save bar */}
          <div
            style={{
              position: "sticky", bottom: 0, marginTop: 8, marginLeft: -32, marginRight: -32, padding: "16px 32px",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
              background: "var(--rt-canvas)", borderTop: "1px solid var(--rt-hairline)",
            }}
          >
            <span style={{ fontSize: 12.5, color: confirmCount > 0 ? "var(--rt-primary)" : "var(--rt-muted)" }}>
              {confirmCount > 0 ? `● ${confirmCount} field${confirmCount === 1 ? "" : "s"} still need${confirmCount === 1 ? "s" : ""} confirming` : dirty ? "Unsaved changes" : "All settings saved"}
            </span>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              style={{
                height: 42, padding: "0 24px", borderRadius: 100, border: "none", fontWeight: 700, fontSize: 13.5,
                cursor: dirty && !saving ? "pointer" : "default",
                background: dirty ? "var(--rt-primary)" : "var(--rt-surface-strong)",
                color: dirty ? "#fff" : "var(--rt-muted)",
              }}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </>
      )}
    </HubShell>
  );
}
