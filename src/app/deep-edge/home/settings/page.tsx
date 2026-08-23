"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { LeagueAnalysis } from "@/lib/fantrax/analyze";
import { CATEGORY_LABEL, FHE_CATEGORIES, type FantraxLeague, type FheCategory } from "@/lib/fantrax/league";
import {
  DEFAULT_ADVANCED_SETTINGS, DEFAULT_GAMES_CAP_SETTINGS, DEFAULT_LEAGUE_TAGS, EXTRA_CATEGORIES, STANDARD_POSITION_SLOTS,
  type ContractRule, type ContractRuleKind, type LeagueFormat, type LeagueType, type RookieSalaryTier, type SalaryFormat,
} from "@/lib/fantrax/league-tags";
import type { SavedLeague } from "@/lib/fantrax/store";
import { HubShell } from "../../_components/hub-shell";
import { ToggleSwitch } from "../../_components/toggle-switch";
import { SegmentedControl } from "../../_components/segmented-control";
import { Stepper } from "../../_components/stepper";
import { IconChevronLeft } from "../../_components/icons";
import { useActiveLeague } from "../../_lib/use-saved-leagues";

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
  contractRules: ContractRule[];
  rookieSalaryScale: RookieSalaryTier[];
  realSalaryEfficiencyWeight: number;
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
    contractRules: s.contractRules ?? DEFAULT_ADVANCED_SETTINGS.contractRules,
    rookieSalaryScale: s.rookieSalaryScale ?? DEFAULT_ADVANCED_SETTINGS.rookieSalaryScale,
    realSalaryEfficiencyWeight: s.realSalaryEfficiencyWeight ?? DEFAULT_ADVANCED_SETTINGS.realSalaryEfficiencyWeight,
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

/** Position-slot color coding for the Roster & positions card only — light
 *  green for starters (any active slot), grey for Bench, red for IR, amber
 *  for Minors (Ash's own scheme, 2026-08-18). Passed to Stepper's own
 *  `tint` prop; every other Stepper on this page (Teams, Max contract
 *  length, Rookie draft rounds) keeps the neutral default background. */
function slotAccent(slot: string): string {
  const s = slot.toLowerCase();
  if (s === "ir") return "rgba(219,43,57,0.16)";
  if (s === "minors" || s === "min") return "rgba(245,158,11,0.16)";
  if (s === "bench" || s === "be" || s === "res" || s === "na" || s === "taxi") return "rgba(148,163,184,0.18)";
  return "rgba(22,160,106,0.14)";
}

function DeepEdgeSettingsContent() {
  const { saved, loading: loadingSaved, refresh } = useActiveLeague();
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
            contractRules: draft.contractRules,
            rookieSalaryScale: draft.rookieSalaryScale,
            realSalaryEfficiencyWeight: draft.realSalaryEfficiencyWeight,
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
    // Guards together, then forwards together, then C, then the generic
    // active Flex slot, then reserves (Bench, IR, Minors) — Ash's own
    // ordering (2026-08-18), same left-to-right layout across every league's
    // position editor regardless of which slots that league happens to use.
    // UTIL is never shown — Fantrax has no UTIL slot type (Ash, 2026-08-18),
    // so it's excluded outright rather than just left off `order` (which
    // alone would only stop it from being re-sorted, not hide it).
    const order = ["PG", "SG", "G", "SF", "PF", "F", "C", "Flx", "Bench", "IR", "Minors"];
    const excluded = new Set(["util"]);
    const known = new Set(order.map((o) => o.toLowerCase()));
    const rest = Object.keys(draft.positionSlots).filter((k) => !known.has(k.toLowerCase()) && !excluded.has(k.toLowerCase()));
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

  function updateContractRule(i: number, patch: Partial<ContractRule>) {
    if (!draft) return;
    update("contractRules", draft.contractRules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addContractRule() {
    if (!draft) return;
    update("contractRules", [...draft.contractRules, { prefix: "", kind: "standard" as ContractRuleKind }]);
  }
  function removeContractRule(i: number) {
    if (!draft) return;
    update("contractRules", draft.contractRules.filter((_, idx) => idx !== i));
  }

  function updateRookieSalaryTier(i: number, patch: Partial<RookieSalaryTier>) {
    if (!draft) return;
    update("rookieSalaryScale", draft.rookieSalaryScale.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  function addRookieSalaryTier() {
    if (!draft) return;
    const last = draft.rookieSalaryScale[draft.rookieSalaryScale.length - 1];
    const minPick = last ? last.maxPick + 1 : 1;
    update("rookieSalaryScale", [...draft.rookieSalaryScale, { minPick, maxPick: minPick, salary: 1 }]);
  }
  function removeRookieSalaryTier(i: number) {
    if (!draft) return;
    update("rookieSalaryScale", draft.rookieSalaryScale.filter((_, idx) => idx !== i));
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
                      tint={slotAccent(slot)}
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
              {draft.salaryFormat === "custom" && (
                <>
                  {divider}
                  <div style={{ padding: "18px 0" }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 3 }}>Contract label rules</div>
                    <div style={{ fontSize: 12.5, color: "var(--rt-muted)", marginBottom: 12, maxWidth: 520 }}>
                      Teach Trade Edge what this league&apos;s own contract-label prefixes mean (Fantrax label &quot;E26-27&quot; has prefix &quot;E&quot;) —
                      a rookie-scale deal gets extra trade value credit, a fixed-length no-renewal contract gets discounted as its forced drop
                      approaches. Unmatched prefixes stay standard, unchanged.
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {draft.contractRules.map((rule, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <input
                            type="text"
                            value={rule.prefix}
                            onChange={(e) => updateContractRule(i, { prefix: e.target.value.toUpperCase().slice(0, 4) })}
                            placeholder="E"
                            style={{ ...numInputStyle, width: 56, textAlign: "center", fontFamily: "var(--rt-font-mono)" }}
                          />
                          <select
                            value={rule.kind}
                            onChange={(e) => updateContractRule(i, { kind: e.target.value as ContractRuleKind })}
                            style={{ ...selectStyle, flex: "1 1 220px" }}
                          >
                            <option value="standard">No special treatment</option>
                            <option value="rookieScale">Rookie-scale (value bump)</option>
                            <option value="expiring">Fixed-length, auto-drop (value discount)</option>
                          </select>
                          {rule.kind === "expiring" && (
                            <Stepper value={rule.maxYears ?? 2} onChange={(v) => updateContractRule(i, { maxYears: v })} min={1} max={5} suffix="yr max" />
                          )}
                          <button
                            type="button"
                            onClick={() => removeContractRule(i)}
                            style={{ height: 34, padding: "0 10px", borderRadius: 8, border: "1px solid var(--rt-hairline)", background: "transparent", color: "var(--rt-muted)", fontSize: 12.5, cursor: "pointer" }}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={addContractRule}
                      style={{ marginTop: 10, height: 34, padding: "0 14px", borderRadius: 8, border: "1px solid var(--rt-hairline)", background: "var(--rt-surface-soft)", color: "var(--rt-ink)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                    >
                      + Add rule
                    </button>
                  </div>
                  {divider}
                  <div style={{ padding: "18px 0" }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 3 }}>Rookie salary scale</div>
                    <div style={{ fontSize: 12.5, color: "var(--rt-muted)", marginBottom: 12, maxWidth: 520 }}>
                      This league&apos;s own rookie-scale salary by draft-pick range (e.g. pick 1 → $14, picks 31-60 → $1) —
                      used to price a draft pick as a trade asset when generating custom league values.
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {draft.rookieSalaryScale.map((tier, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 12.5, color: "var(--rt-muted)" }}>Picks</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={tier.minPick}
                            onChange={(e) => updateRookieSalaryTier(i, { minPick: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                            style={{ ...numInputStyle, width: 56, textAlign: "center" }}
                          />
                          <span style={{ fontSize: 12.5, color: "var(--rt-muted)" }}>–</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={tier.maxPick}
                            onChange={(e) => updateRookieSalaryTier(i, { maxPick: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                            style={{ ...numInputStyle, width: 56, textAlign: "center" }}
                          />
                          <span style={{ fontSize: 12.5, color: "var(--rt-muted)" }}>→ $</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={tier.salary}
                            onChange={(e) => updateRookieSalaryTier(i, { salary: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                            style={{ ...numInputStyle, width: 72, textAlign: "center" }}
                          />
                          <button
                            type="button"
                            onClick={() => removeRookieSalaryTier(i)}
                            style={{ height: 34, padding: "0 10px", borderRadius: 8, border: "1px solid var(--rt-hairline)", background: "transparent", color: "var(--rt-muted)", fontSize: 12.5, cursor: "pointer" }}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={addRookieSalaryTier}
                      style={{ marginTop: 10, height: 34, padding: "0 14px", borderRadius: 8, border: "1px solid var(--rt-hairline)", background: "var(--rt-surface-soft)", color: "var(--rt-ink)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                    >
                      + Add tier
                    </button>
                  </div>
                </>
              )}
              {draft.salaryFormat === "real" && (
                <>
                  {divider}
                  <div style={{ padding: "18px 0" }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 3 }}>Custom value blend</div>
                    <div style={{ fontSize: 12.5, color: "var(--rt-muted)", marginBottom: 14, maxWidth: 520 }}>
                      How much should generating custom league values weigh cheap, productive contracts against pure
                      dynasty consensus rank? Every real-salary league gets the same 30% default — a league with
                      unusually deep cap room or tight roster limits may need to lean harder toward cheap production
                      (or expensive contracts may need to matter less) than that default assumes.
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <span style={{ fontSize: 11.5, color: "var(--rt-muted)", whiteSpace: "nowrap" }}>Consensus-driven</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={Math.round(draft.realSalaryEfficiencyWeight * 100)}
                        onChange={(e) => update("realSalaryEfficiencyWeight", Number(e.target.value) / 100)}
                        style={{ flex: 1 }}
                      />
                      <span style={{ fontSize: 11.5, color: "var(--rt-muted)", whiteSpace: "nowrap" }}>Cheap production-driven</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--rt-font-mono)" }}>
                        {Math.round(draft.realSalaryEfficiencyWeight * 100)}% weight on cheap/production
                      </span>
                      {Math.round(draft.realSalaryEfficiencyWeight * 100) !== 30 && (
                        <button
                          type="button"
                          onClick={() => update("realSalaryEfficiencyWeight", 0.30)}
                          style={{ background: "none", border: "none", color: "var(--rt-primary)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                        >
                          Reset to default (30%)
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
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

export default function DeepEdgeSettingsPage() {
  return (
    <Suspense fallback={null}>
      <DeepEdgeSettingsContent />
    </Suspense>
  );
}
