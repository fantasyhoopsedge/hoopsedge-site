"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FANTRAX_SECRET_ID_HELP_URL, fetchUserLeagues, isLeagueId,
  type FxLeagueSummary,
} from "@/lib/fantrax/api";
import {
  MIN_SAMPLE_GAMES, type CategoryEdge, type LeagueAnalysis, type PointsStandingRow,
  type PointsTradeSuggestion, type ResolvedPlayer, type RotoStandingRow, type TeamStatTotals,
  type TradeSuggestion,
} from "@/lib/fantrax/analyze";
import {
  CATEGORY_LABEL, FANTRAX_DATASETS, FHE_CATEGORIES, scoringTypeLabel,
  type FantraxDatasetKey, type FheCategory, type PointsStat,
} from "@/lib/fantrax/league";
import { DEFAULT_LEAGUE_TAGS, type LeagueFormat, type LeagueType, type SalaryFormat } from "@/lib/fantrax/league-tags";
import type { SavedLeague } from "@/lib/fantrax/store";
import { TAG_META, type TrendTag } from "@/app/team-rosters/_components/trend-insight";

/**
 * The Fantrax league connector.
 *
 * ── Where the Secret ID lives ─────────────────────────────────────────────────
 * sessionStorage, and nowhere else. fetchUserLeagues() runs HERE, in the
 * browser, straight against fantrax.com — never through an FHE route. That is a
 * published commitment (/privacy §4: "never transmitted to, stored on, or logged
 * by any FantasyHoopsEdge server at any point"), so any change that posts the
 * secret to our own API breaks the privacy policy, not just a preference. The
 * server is only ever told a league id, which every Fantrax league endpoint
 * accepts without credentials.
 *
 * sessionStorage (not localStorage) is what makes "clears when you close the
 * tab" true.
 */

const SECRET_KEY = "fhe.fantrax.secretId";
const USER_KEY = "fhe.fantrax.username";

type Tab = "team" | "standings" | "waivers" | "edge" | "settings";

const fmtV = (v: number | null | undefined): string =>
  v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`;

const fmtMoney = (v: number | null): string =>
  v === null ? "—" : v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${Math.round(v / 1000)}K`;

const fmtRank = (v: number | null | undefined): string => (v == null ? "—" : `#${v}`);
const f1 = (v: number | null | undefined): string => (v == null ? "—" : v.toFixed(1));
const fInt = (v: number | null | undefined): string => (v == null ? "—" : String(Math.round(v)));
const fPct = (v: number | null | undefined): string => (v == null ? "—" : v.toFixed(3).replace(/^0(?=\.)/, ""));

/** Diverging background anchored to a z-score-ish value — positive green, negative
 *  red, magnitude-scaled. Same formula/anchors as /seasonal-rankings' vBg(). */
function vBg(v: number | null | undefined, posAnchor = 2.0, negAnchor = 2.0): string {
  if (v == null || !Number.isFinite(v)) return "transparent";
  if (v >= 0) {
    const t = Math.min(v / posAnchor, 1);
    return `rgba(34, 197, 94, ${(t * 0.34).toFixed(3)})`;
  }
  const t = Math.min(-v / negAnchor, 1);
  return `rgba(239, 68, 68, ${(t * 0.34).toFixed(3)})`;
}

/** CatV flavors the roster table can rank/display by, and their rank-mode key
 *  on ResolvedPlayer.catV / catVRank. */
type CatMode = "nineCatV" | "minus1V" | "eightCatV";
const CAT_MODE_LABEL: Record<CatMode, string> = { nineCatV: "9CatV", minus1V: "Minus1V", eightCatV: "8CatV" };
const CAT_MODE_RANK_LABEL: Record<CatMode, string> = { nineCatV: "9CatRank", minus1V: "Minus1Rank", eightCatV: "8CatRank" };

type PlayerSortKey = "name" | "leagueV" | "pointsValue" | "catV" | "catVRank" | FheCategory;

/** Trend badge — emoji + label from the site's existing tone system (see
 *  team-rosters/_components/trend-insight.ts TAG_META), so a Fantrax roster
 *  reads the exact same signal /team-rosters already uses. */
function TrendBadge({ tag }: { tag: TrendTag | null | undefined }) {
  if (!tag) return <span className="fx-trend-none">—</span>;
  const meta = TAG_META[tag];
  return (
    <span className="fx-trend" style={{ color: meta.color }} title={meta.label}>
      {meta.emoji} {meta.label}
    </span>
  );
}

export function FantraxConnector() {
  // ── connection (browser-only credentials) ────────────────────────────────
  const [secretId, setSecretId] = useState("");
  const [username, setUsername] = useState("");
  const [connected, setConnected] = useState(false);
  const [leagues, setLeagues] = useState<FxLeagueSummary[] | null>(null);
  const [connecting, setConnecting] = useState(false);

  // ── league code entry ─────────────────────────────────────────────────────
  const [codeInput, setCodeInput] = useState("");

  // ── loaded league ─────────────────────────────────────────────────────────
  const [analysis, setAnalysis] = useState<LeagueAnalysis | null>(null);
  const [dataset, setDataset] = useState<FantraxDatasetKey>(DEFAULT_LEAGUE_TAGS.defaultDataset);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<SavedLeague[]>([]);
  const [savingLeague, setSavingLeague] = useState(false);
  const [tab, setTab] = useState<Tab>("team");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  // ── user-set league tags (League settings tab) — Fantrax's API exposes none
  // of these; they default per DEFAULT_LEAGUE_TAGS and persist via the saved-
  // league store once a league is imported. `leagueType` also drives the Edge
  // tool's dynasty-consensus weighting server-side.
  const [leagueType, setLeagueType] = useState<LeagueType>(DEFAULT_LEAGUE_TAGS.leagueType);
  const [format, setFormat] = useState<LeagueFormat>(DEFAULT_LEAGUE_TAGS.format);
  const [salaryFormat, setSalaryFormat] = useState<SalaryFormat>(DEFAULT_LEAGUE_TAGS.salaryFormat);
  // Fantrax's API can't tell roto from head-to-head-categories (verified live
  // 2026-08-09 against real leagues of each — both report the same
  // scoringType). `format` therefore defaults to "roto" with no signal it was
  // ever actually checked; this tracks whether the USER has confirmed it, so
  // Standings/Edge can require that confirmation instead of silently scoring
  // an unconfirmed league as roto.
  const [formatConfirmed, setFormatConfirmed] = useState(false);

  // Restore the session's credentials on mount. sessionStorage is per-tab, so
  // a fresh tab correctly starts disconnected.
  useEffect(() => {
    const s = sessionStorage.getItem(SECRET_KEY) ?? "";
    const u = sessionStorage.getItem(USER_KEY) ?? "";
    if (s) { setSecretId(s); setConnected(true); }
    if (u) setUsername(u);
  }, []);

  useEffect(() => {
    fetch("/api/fantrax/saved")
      .then((r) => r.json())
      .then((d) => { if (d.leagues) setSaved(d.leagues); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  async function connect() {
    const trimmed = secretId.trim();
    if (!trimmed) { setError("Enter your Fantrax Secret ID."); return; }
    setConnecting(true);
    setError("");
    try {
      // Direct browser → fantrax.com. Deliberately not proxied. See the file header.
      const list = await fetchUserLeagues(trimmed);
      sessionStorage.setItem(SECRET_KEY, trimmed);
      sessionStorage.setItem(USER_KEY, username.trim());
      setConnected(true);
      setLeagues(list);
      if (list.length === 0) setError("Fantrax returned no NBA leagues for that Secret ID.");
    } catch (err) {
      setError(`Couldn't reach Fantrax with that Secret ID. ${(err as Error).message}`);
    } finally {
      setConnecting(false);
    }
  }

  function disconnect() {
    sessionStorage.removeItem(SECRET_KEY);
    sessionStorage.removeItem(USER_KEY);
    setSecretId("");
    setConnected(false);
    setLeagues(null);
    setToast("Secret ID cleared from this tab.");
  }

  const loadLeague = useCallback(
    async (leagueId: string, teamId: string | null, ds: FantraxDatasetKey, lt: LeagueType) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ leagueId, dataset: ds, leagueType: lt });
        if (teamId) params.set("teamId", teamId);
        const res = await fetch(`/api/fantrax/league?${params}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
        setAnalysis(data as LeagueAnalysis);
        setTab("team");
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  /** Loads a league the user picked from the Fantrax account list or the
   *  saved-leagues list, seeding the tag state from any prior save so the
   *  league opens on the user's own defaults rather than resetting them. */
  function loadFromEntry(leagueId: string, teamId: string | null) {
    const prior = saved.find((l) => l.leagueId === leagueId)?.settings;
    const ds = prior?.defaultDataset ?? dataset;
    const lt = prior?.leagueType ?? DEFAULT_LEAGUE_TAGS.leagueType;
    setDataset(ds);
    setLeagueType(lt);
    setFormat(prior?.format ?? DEFAULT_LEAGUE_TAGS.format);
    setSalaryFormat(prior?.salaryFormat ?? DEFAULT_LEAGUE_TAGS.salaryFormat);
    setFormatConfirmed(prior?.formatConfirmed ?? false);
    void loadLeague(leagueId, teamId, ds, lt);
  }

  function importByCode() {
    const code = codeInput.trim();
    if (!isLeagueId(code)) {
      setError("A Fantrax league ID is 16 letters and numbers, e.g. l2ftp82kmo6w41ci.");
      return;
    }
    loadFromEntry(code, null);
  }

  function changeDataset(next: FantraxDatasetKey) {
    setDataset(next);
    if (analysis) void loadLeague(analysis.league.leagueId, analysis.myTeamId, next, leagueType);
  }

  function selectMyTeam(teamId: string) {
    if (analysis) void loadLeague(analysis.league.leagueId, teamId, dataset, leagueType);
  }

  function changeLeagueType(next: LeagueType) {
    setLeagueType(next);
    if (analysis) void loadLeague(analysis.league.leagueId, analysis.myTeamId, dataset, next);
    void persistSettings({ leagueType: next });
  }

  /** Explicit user choice of Roto/H2H — from either the blocking first-connect
   *  prompt or the League Settings dropdown. Both count as confirmation. */
  function confirmFormat(next: LeagueFormat) {
    setFormat(next);
    setFormatConfirmed(true);
    void persistSettings({ format: next, formatConfirmed: true });
  }

  /** Upserts the saved-league record with whatever settings overrides are
   *  passed, merged onto the currently-imported league's auto-detected
   *  settings plus the current tag state — used by the explicit Save button
   *  AND by every League Settings control (auto-saves on change). */
  async function persistSettings(overrides: Partial<SavedLeague["settings"]> = {}) {
    if (!analysis) return;
    setSavingLeague(true);
    try {
      const { league, myTeamId } = analysis;
      const res = await fetch("/api/fantrax/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId: league.leagueId,
          leagueName: league.name,
          teamId: myTeamId,
          teamName: league.teams.find((t) => t.id === myTeamId)?.name ?? null,
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
            format,
            formatConfirmed,
            leagueType,
            salaryFormat,
            defaultDataset: dataset,
            ...overrides,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setSaved((prev) => [data.league, ...prev.filter((l) => l.leagueId !== data.league.leagueId)]);
      setToast(`Saved ${data.league.leagueName}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingLeague(false);
    }
  }

  async function unlink(leagueId: string) {
    const res = await fetch(`/api/fantrax/saved?leagueId=${leagueId}`, { method: "DELETE" });
    const data = await res.json();
    if (res.ok) { setSaved(data.leagues ?? []); setToast("League unlinked."); }
    else setError(data.error ?? "Unlink failed");
  }

  const myTeam = useMemo(
    () => analysis?.rosters.find((r) => r.teamId === analysis.myTeamId) ?? null,
    [analysis],
  );
  const myStanding = useMemo(
    () => analysis?.standings.find((s) => s.teamId === analysis.myTeamId) ?? null,
    [analysis],
  );
  const isSaved = analysis ? saved.some((l) => l.leagueId === analysis.league.leagueId) : false;
  const pointsMode = analysis?.league.scoringMode === "points";
  // Points leagues don't have a roto/H2H question at all — only categories
  // leagues need the confirmation gate.
  const needsFormatConfirm = !pointsMode && !formatConfirmed;

  return (
    <div className="fx-shell">
      <header className="fx-head">
        <div>
          <div className="fx-eyebrow">ADMIN · LIMITED TESTING</div>
          <h1 className="fx-title">Fantrax League Connector</h1>
          <p className="fx-sub">
            Link a Fantrax league and anchor FHE&apos;s category values to the rules you actually play.
          </p>
        </div>
        {analysis && (
          <div className="fx-head-actions">
            <select
              className="fx-select"
              value={dataset}
              onChange={(e) => changeDataset(e.target.value as FantraxDatasetKey)}
            >
              {FANTRAX_DATASETS.map((d) => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </select>
            <button className="fx-btn ghost" onClick={() => setAnalysis(null)}>Change league</button>
            <button className="fx-btn primary" disabled={savingLeague} onClick={() => void persistSettings()}>
              {savingLeague ? "Saving…" : isSaved ? "Update saved league" : "Save league"}
            </button>
          </div>
        )}
      </header>

      {error && <div className="fx-warn">{error}</div>}

      {!analysis && (
        <div className="fx-setup">
          {/* ── Connect with a Secret ID ──────────────────────────────────── */}
          <section className="fx-card">
            <h2 className="fx-card-title">Connect your Fantrax account</h2>
            <p className="fx-card-note">
              Your Secret ID is on your{" "}
              <a href={FANTRAX_SECRET_ID_HELP_URL} target="_blank" rel="noopener noreferrer">Fantrax user profile</a>.
              It stays in this browser tab only — FantasyHoopsEdge never receives or stores it, and it&apos;s
              cleared when you close the tab.
            </p>
            {connected ? (
              <div className="fx-connected">
                <span className="fx-ok">Fantrax is authorized{username ? ` (${username})` : ""}</span>
                <div className="fx-row">
                  <button className="fx-btn" disabled={connecting} onClick={connect}>
                    {connecting ? "Loading…" : "Refresh my leagues"}
                  </button>
                  <button className="fx-btn ghost" onClick={disconnect}>Clear Secret ID</button>
                </div>
              </div>
            ) : (
              <div className="fx-form">
                <label className="fx-label">
                  Username <span className="fx-optional">(label only)</span>
                  <input className="fx-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ashhuggo" />
                </label>
                <label className="fx-label">
                  Fantrax Secret ID
                  <input
                    className="fx-input"
                    value={secretId}
                    onChange={(e) => setSecretId(e.target.value)}
                    placeholder="16-character Secret ID"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <button className="fx-btn primary" disabled={connecting} onClick={connect}>
                  {connecting ? "Authenticating…" : "Authenticate Fantrax"}
                </button>
              </div>
            )}

            {leagues && leagues.length > 0 && (
              <div className="fx-league-list">
                <div className="fx-list-head">{leagues.length} NBA leagues</div>
                {leagues.map((l) => (
                  <button
                    key={l.leagueId}
                    className="fx-league-row"
                    onClick={() => loadFromEntry(l.leagueId, l.teamId)}
                  >
                    <span className="fx-league-name">{l.leagueName}</span>
                    <span className="fx-league-team">{l.teamName}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* ── Or paste a league code ────────────────────────────────────── */}
          <section className="fx-card">
            <h2 className="fx-card-title">Add a league by code</h2>
            <p className="fx-card-note">
              Any Fantrax league ID works on its own — no account link needed. It&apos;s the last part of the
              league URL, e.g. fantrax.com/fantasy/league/<b>l2ftp82kmo6w41ci</b>.
            </p>
            <div className="fx-row">
              <input
                className="fx-input mono"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="l2ftp82kmo6w41ci"
                spellCheck={false}
                onKeyDown={(e) => { if (e.key === "Enter") importByCode(); }}
              />
              <button className="fx-btn primary" disabled={loading} onClick={importByCode}>
                {loading ? "Importing…" : "Import settings"}
              </button>
            </div>

            {saved.length > 0 && (
              <div className="fx-league-list">
                <div className="fx-list-head">Saved leagues</div>
                {saved.map((l) => (
                  <div key={l.leagueId} className="fx-saved-row">
                    <button className="fx-league-row flat" onClick={() => loadFromEntry(l.leagueId, l.teamId)}>
                      <span className="fx-league-name">{l.leagueName}</span>
                      <span className="fx-league-team">
                        {l.teamName ?? "no team selected"} · {l.settings?.categories?.length ?? 0}-cat ·{" "}
                        {l.settings?.teamCount ?? "?"} teams
                      </span>
                    </button>
                    <button className="fx-btn ghost sm" onClick={() => void unlink(l.leagueId)}>Unlink</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {loading && !analysis && <div className="fx-loading">Importing league from Fantrax…</div>}

      {analysis && (
        <>
          <LeagueSummary analysis={analysis} onSelectTeam={selectMyTeam} />

          {/* Deliberately a div, not a <nav>: globals.css styles the bare `nav`
              element as the sitewide fixed top bar (position: fixed; top: 0),
              which yanks any <nav> out of flow and over the page header. */}
          <div className="fx-tabs" role="tablist">
            {([
              ["team", myTeam ? myTeam.teamName : "My team"],
              ["standings", "Projected standings"],
              ["waivers", "Best available"],
              ["edge", "F Hoops Edge"],
              ["settings", "League settings"],
            ] as [Tab, string][]).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                className={`fx-tab${tab === key ? " on" : ""}`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "team" && (
            myTeam ? (
              <MyTeam
                players={myTeam.players}
                edges={analysis.edges}
                teamCount={analysis.league.teamCount}
                starters={analysis.league.maxActivePlayers}
                totalValue={myStanding?.totalPoints ?? null}
                rank={myStanding?.projectedRank ?? null}
                hasSalaries={analysis.league.hasSalaries}
                scored={pointsMode ? FHE_CATEGORIES : analysis.league.categories.scored}
                pointsMode={pointsMode}
              />
            ) : (
              <div className="fx-empty">Pick your team above to see its category profile.</div>
            )
          )}

          {tab === "standings" && (
            needsFormatConfirm ? (
              <FormatConfirmPrompt onConfirm={confirmFormat} />
            ) : pointsMode ? (
              <PointsStandings standings={analysis.standings as PointsStandingRow[]} myTeamId={analysis.myTeamId} />
            ) : (
              <Standings analysis={analysis} scored={analysis.league.categories.scored} />
            )
          )}

          {tab === "waivers" && (
            <WaiverBoard
              players={analysis.waiverBoard}
              scored={pointsMode ? FHE_CATEGORIES : analysis.league.categories.scored}
              pointsMode={pointsMode}
            />
          )}

          {tab === "edge" && (
            needsFormatConfirm ? (
              <FormatConfirmPrompt onConfirm={confirmFormat} />
            ) : !myTeam ? (
              <div className="fx-empty">Pick your team above to get trade-target suggestions.</div>
            ) : pointsMode ? (
              <PointsEdgeTool
                suggestions={analysis.tradeSuggestions as PointsTradeSuggestion[]}
                isDynasty={leagueType === "dynasty"}
              />
            ) : (
              <EdgeTool
                suggestions={analysis.tradeSuggestions as TradeSuggestion[]}
                edges={analysis.edges}
                teamCount={analysis.league.teamCount}
                isDynasty={leagueType === "dynasty"}
              />
            )
          )}

          {tab === "settings" && (
            <SettingsPanel
              analysis={analysis}
              format={format}
              leagueType={leagueType}
              salaryFormat={salaryFormat}
              onFormatChange={confirmFormat}
              onLeagueTypeChange={changeLeagueType}
              onSalaryFormatChange={(v) => { setSalaryFormat(v); void persistSettings({ salaryFormat: v }); }}
              onSetDefaultDataset={() => void persistSettings({ defaultDataset: dataset })}
            />
          )}
        </>
      )}

      {toast && <div className="fx-toast">{toast}</div>}
      <style>{STYLES}</style>
    </div>
  );
}

// ── league header ───────────────────────────────────────────────────────────

function LeagueSummary({
  analysis, onSelectTeam,
}: { analysis: LeagueAnalysis; onSelectTeam: (id: string) => void }) {
  const { league, dataset, coverage } = analysis;
  const pointsMode = league.scoringMode === "points";
  return (
    <section className="fx-summary">
      <div className="fx-summary-main">
        <h2 className="fx-league-title">{league.name}</h2>
        <div className="fx-facts">
          <span>{scoringTypeLabel(league.scoringType)}</span>
          {!pointsMode && <span>{league.categories.scored.length}-cat</span>}
          <span>{league.teamCount} teams</span>
          <span>{league.maxTotalPlayers}-man rosters · {league.maxActivePlayers} starters</span>
          {league.hasSalaries && <span>salary cap</span>}
          <span>valued vs {dataset.label}</span>
        </div>
        <div className="fx-cats">
          {pointsMode ? (
            <>
              {league.pointsFormula && Object.entries(league.pointsFormula.weights).map(([stat, w]) => (
                <span key={stat} className="fx-cat-chip">{stat} {w as number > 0 ? "+" : ""}{w}</span>
              ))}
              {league.pointsFormula?.unmodelled.map((c) => (
                <span key={c} className="fx-cat-chip off" title="FHE doesn't model this stat">{c}</span>
              ))}
            </>
          ) : (
            <>
              {league.categories.scored.map((c) => (
                <span key={c} className="fx-cat-chip">{CATEGORY_LABEL[c]}</span>
              ))}
              {league.categories.unmodelled.map((c) => (
                <span key={c} className="fx-cat-chip off" title="FHE doesn't model this category">{c}</span>
              ))}
            </>
          )}
        </div>
      </div>
      <div className="fx-summary-side">
        <label className="fx-label">
          Your team
          <select
            className="fx-select"
            value={analysis.myTeamId ?? ""}
            onChange={(e) => onSelectTeam(e.target.value)}
          >
            <option value="">Select…</option>
            {league.teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <div className="fx-coverage">
          {coverage.matched}/{coverage.rostered} rostered players matched to FHE data
          {coverage.unmatched.length > 0 && (
            <span title={coverage.unmatched.join(", ")}> · {coverage.unmatched.length} unknown</span>
          )}
          {coverage.ambiguous.length > 0 && (
            <span title={coverage.ambiguous.join(", ")}> · {coverage.ambiguous.length} duplicate names</span>
          )}
        </div>
      </div>
    </section>
  );
}

// ── my team ─────────────────────────────────────────────────────────────────

function MyTeam({
  players, edges, teamCount, starters, totalValue, rank, hasSalaries, scored, pointsMode,
}: {
  players: ResolvedPlayer[];
  edges: CategoryEdge[];
  teamCount: number;
  starters: number;
  totalValue: number | null;
  rank: number | null;
  hasSalaries: boolean;
  scored: readonly FheCategory[];
  pointsMode: boolean;
}) {
  const starterIds = new Set(
    players
      .filter((p) => (pointsMode ? p.pointsValue !== null : p.leagueV !== null))
      .slice(0, Math.max(1, starters))
      .map((p) => p.fantraxId),
  );

  return (
    <>
      <div className="fx-kpis">
        <div className="fx-kpi">
          <div className="fx-kpi-label">Projected finish</div>
          <div className="fx-kpi-value">{rank ? `${rank} of ${teamCount}` : "—"}</div>
        </div>
        <div className="fx-kpi">
          <div className="fx-kpi-label">{pointsMode ? "Projected season points" : "Projected roto points"}</div>
          <div className="fx-kpi-value">{totalValue === null ? "—" : totalValue.toFixed(1)}</div>
        </div>
        {!pointsMode && (
          <>
            <div className="fx-kpi">
              <div className="fx-kpi-label">Strongest category</div>
              <div className="fx-kpi-value">{edges[0] ? `${CATEGORY_LABEL[edges[0].category]} (${edges[0].rank})` : "—"}</div>
            </div>
            <div className="fx-kpi">
              <div className="fx-kpi-label">Weakest category</div>
              <div className="fx-kpi-value">
                {edges.length ? `${CATEGORY_LABEL[edges[edges.length - 1].category]} (${edges[edges.length - 1].rank})` : "—"}
              </div>
            </div>
          </>
        )}
      </div>

      {edges.length > 0 && (
        <section className="fx-panel">
          <h3 className="fx-panel-title">
            Category profile <span className="fx-panel-note">your top {starters} by LeagueV, vs the field</span>
          </h3>
          <div className="fx-edges">
            {edges.map((e) => {
              const delta = e.total - e.leagueMean;
              const strong = e.rank <= Math.ceil(teamCount / 3);
              const weak = e.rank > Math.ceil((teamCount * 2) / 3);
              return (
                <div key={e.category} className={`fx-edge${strong ? " strong" : weak ? " weak" : ""}`}>
                  <div className="fx-edge-cat">{CATEGORY_LABEL[e.category]}</div>
                  <div className="fx-edge-rank">{e.rank}<span>/{teamCount}</span></div>
                  <div className="fx-edge-delta">{fmtV(delta)} vs avg</div>
                  <div className="fx-edge-pts">{e.points.toFixed(1)} pts</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="fx-panel">
        <h3 className="fx-panel-title">
          Roster{" "}
          <span className="fx-panel-note">
            {pointsMode
              ? "Pts/G = weighted fantasy points under this league's formula"
              : "LeagueV = FHE z-scores averaged over this league's categories"}
          </span>
        </h3>
        <PlayerTable players={players} scored={scored} hasSalaries={hasSalaries} starterIds={starterIds} pointsMode={pointsMode} />
      </section>
    </>
  );
}

/** One category's raw counting/rate cell, per-game or totals, colored by the
 *  matching per-game/totals z-score (never re-derived — same number the rest
 *  of FHE would color that cell with). */
function StatCell({
  cat, player, perGame,
}: { cat: FheCategory; player: ResolvedPlayer; perGame: boolean }) {
  const g = player.gamesPlayed ?? 0;
  const raw = player.statLine;
  const z = (perGame ? player.cats : player.catsTotals)[cat];
  if (!raw) return <td className="num cat" style={{ background: vBg(z) }}>—</td>;
  let display: string;
  switch (cat) {
    case "PTS": display = perGame ? f1(raw.pts) : fInt((raw.pts ?? 0) * g); break;
    case "FG3": display = perGame ? f1(raw.fg3m) : fInt((raw.fg3m ?? 0) * g); break;
    case "REB": display = perGame ? f1(raw.reb) : fInt((raw.reb ?? 0) * g); break;
    case "AST": display = perGame ? f1(raw.ast) : fInt((raw.ast ?? 0) * g); break;
    case "STL": display = perGame ? f1(raw.stl) : fInt((raw.stl ?? 0) * g); break;
    case "BLK": display = perGame ? f1(raw.blk) : fInt((raw.blk ?? 0) * g); break;
    case "TO": display = perGame ? f1(raw.tov) : fInt((raw.tov ?? 0) * g); break;
    case "FG": display = fPct(raw.fg_pct); break;
    case "FT": display = fPct(raw.ft_pct); break;
    default: display = "—";
  }
  return <td className="num cat" style={{ background: vBg(z) }}>{display}</td>;
}

/** Sortable numeric header cell — click toggles asc/desc, clicking a new
 *  column resets to that column's natural direction. Generic over whichever
 *  sort-key union the table it's used in needs (PlayerSortKey, StandingsSortKey). */
function SortTh<K extends string>({
  label, sortKey, sort, onSort, title,
}: {
  label: string;
  sortKey: K;
  sort: { key: K; dir: "asc" | "desc" };
  onSort: (k: K) => void;
  title?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className={`num cat fx-th-sortable${active ? " fx-th-active" : ""}`}
      onClick={() => onSort(sortKey)}
      title={title}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label}<span className="fx-sort-arrow">{active ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}</span>
    </th>
  );
}

function PlayerTable({
  players, scored, hasSalaries, starterIds, pointsMode = false,
}: {
  players: ResolvedPlayer[];
  scored: readonly FheCategory[];
  hasSalaries: boolean;
  starterIds?: Set<string>;
  pointsMode?: boolean;
}) {
  const [perGame, setPerGame] = useState(true);
  const [catMode, setCatMode] = useState<CatMode>("nineCatV");
  const [sort, setSort] = useState<{ key: PlayerSortKey; dir: "asc" | "desc" }>(
    { key: pointsMode ? "pointsValue" : "leagueV", dir: "desc" },
  );

  const onSort = (key: PlayerSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  const mode = perGame ? "perGame" : "totals";
  const sorted = useMemo(() => {
    const valueOf = (p: ResolvedPlayer): number | null => {
      switch (sort.key) {
        case "name": return null; // handled separately below
        case "leagueV": return p.leagueV;
        case "pointsValue": return p.pointsValue;
        case "catV": return p.catV?.[mode][catMode] ?? null;
        case "catVRank": return p.catVRank?.[mode][catMode] ?? null;
        default: return (perGame ? p.cats : p.catsTotals)[sort.key] ?? null;
      }
    };
    if (sort.key === "name") {
      const rows = [...players].sort((a, b) => a.name.localeCompare(b.name));
      return sort.dir === "desc" ? rows.reverse() : rows;
    }
    return [...players].sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return sort.dir === "asc" ? av - bv : bv - av;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, sort, perGame, catMode]);

  return (
    <>
      <div className="fx-table-controls">
        <div className="fx-pill-row">
          <button type="button" className={`fx-pill${perGame ? " on" : ""}`} onClick={() => setPerGame(true)}>Per Game</button>
          <button type="button" className={`fx-pill${!perGame ? " on" : ""}`} onClick={() => setPerGame(false)}>Totals</button>
        </div>
        {!pointsMode && (
          <div className="fx-pill-row">
            {(["nineCatV", "eightCatV", "minus1V"] as CatMode[]).map((m) => (
              <button key={m} type="button" className={`fx-pill${catMode === m ? " on" : ""}`} onClick={() => setCatMode(m)}>
                {CAT_MODE_LABEL[m]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="fx-table-wrap">
        <table className="fx-table">
          <thead>
            <tr>
              <th className="l fx-th-sortable" onClick={() => onSort("name")}>Player</th>
              <th>Pos</th>
              <th>NBA</th>
              {hasSalaries && <th>Salary</th>}
              <th>Status</th>
              {pointsMode ? (
                <SortTh label="Pts/G" sortKey="pointsValue" sort={sort} onSort={onSort} title="Weighted fantasy points under this league's own formula" />
              ) : (
                <>
                  <SortTh label="LeagueV" sortKey="leagueV" sort={sort} onSort={onSort} title="This league's own scoring — mean z across the categories it scores, per-game" />
                  <SortTh label={CAT_MODE_LABEL[catMode]} sortKey="catV" sort={sort} onSort={onSort} />
                  <SortTh label={CAT_MODE_RANK_LABEL[catMode]} sortKey="catVRank" sort={sort} onSort={onSort} title="Rank within the full FHE baseline pool" />
                </>
              )}
              <th>Trend</th>
              {scored.map((c) => <SortTh key={c} label={CATEGORY_LABEL[c]} sortKey={c} sort={sort} onSort={onSort} />)}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.fantraxId} className={starterIds?.has(p.fantraxId) ? "starter" : undefined}>
                <td className="l">
                  {p.name}
                  {p.ambiguousName ? (
                    <span className="fx-nodata warn" title="Another player in this league's pool has the same name — FHE data withheld rather than risk attaching the wrong player's">
                      same name
                    </span>
                  ) : p.playerId === null ? (
                    <span className="fx-nodata" title="No FHE data for this player">no data</span>
                  ) : null}
                  {p.source === "regular" && <span className="fx-src" title="Fell back to 2025-26 actuals">25-26</span>}
                  {p.smallSample && (
                    <span className="fx-src warn" title={`Fewer than ${MIN_SAMPLE_GAMES} games — small-sample rates`}>
                      {p.gamesPlayed}g
                    </span>
                  )}
                </td>
                <td>{p.eligible.filter((e) => e !== "Flx").join("/") || "—"}</td>
                <td className="dim">{p.nbaTeam === "(N/A)" ? "—" : p.nbaTeam}</td>
                {hasSalaries && <td className="dim">{fmtMoney(p.salary)}</td>}
                <td className="dim">{p.status.replace("INJURED_RESERVE", "IR").replace("_", " ")}</td>
                {pointsMode ? (
                  <td className="num strong">{f1(perGame ? p.pointsValue : (p.pointsValue ?? 0) * (p.gamesPlayed ?? 0))}</td>
                ) : (
                  <>
                    <td className="num strong">{fmtV(p.leagueV)}</td>
                    <td className="num strong" style={{ background: vBg(p.catV?.[mode][catMode] ?? null, 1.0, 0.6) }}>
                      {fmtV(p.catV?.[mode][catMode])}
                    </td>
                    <td className="num dim">{fmtRank(p.catVRank?.[mode][catMode])}</td>
                  </>
                )}
                <td className="dim"><TrendBadge tag={p.trendTags?.[catMode]} /></td>
                {scored.map((c) => <StatCell key={c} cat={c} player={p} perGame={perGame} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── projected standings ─────────────────────────────────────────────────────

type StandingsView = "points" | "totals";
type StandingsSortKey = "rank" | "team" | "primary" | FheCategory;

/** Which TeamStatTotals field a category's raw-number column reads. */
function statTotalValue(st: TeamStatTotals, cat: FheCategory): number | null {
  switch (cat) {
    case "PTS": return st.pts;
    case "FG3": return st.fg3m;
    case "REB": return st.reb;
    case "AST": return st.ast;
    case "STL": return st.stl;
    case "BLK": return st.blk;
    case "TO": return st.tov;
    case "FG": return st.fg_pct;
    case "FT": return st.ft_pct;
    default: return null;
  }
}

function statTotalDisplay(st: TeamStatTotals, cat: FheCategory): string {
  if (cat === "FG" || cat === "FT") return fPct(statTotalValue(st, cat));
  return fInt(statTotalValue(st, cat));
}

function Standings({ analysis, scored }: { analysis: LeagueAnalysis; scored: readonly FheCategory[] }) {
  const [view, setView] = useState<StandingsView>("points");
  const [sort, setSort] = useState<{ key: StandingsSortKey; dir: "asc" | "desc" }>({ key: "rank", dir: "asc" });

  const onSort = (key: StandingsSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "rank" || key === "team" ? "asc" : "desc" }));

  const rows = useMemo(() => {
    const statTotalsByTeam = new Map(analysis.profiles.map((p) => [p.teamId, p.statTotals]));
    // Safe: this component only ever renders for a categories-mode league
    // (the caller branches on league.scoringMode before choosing Standings
    // vs. PointsStandings), so analysis.standings is always RotoStandingRow[]
    // here even though LeagueAnalysis types it as a union.
    const standings = analysis.standings as RotoStandingRow[];
    return standings.map((s) => ({ ...s, statTotals: statTotalsByTeam.get(s.teamId)! }));
  }, [analysis]);

  const sorted = useMemo(() => {
    const valueOf = (r: (typeof rows)[number]): number | string => {
      switch (sort.key) {
        case "rank": return r.projectedRank;
        case "team": return r.teamName;
        case "primary": return view === "points" ? r.totalPoints : r.statTotals.gamesPlayed;
        default: return view === "points" ? (r.points[sort.key] ?? 0) : (statTotalValue(r.statTotals, sort.key) ?? 0);
      }
    };
    return [...rows].sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      const cmp = typeof av === "string" || typeof bv === "string"
        ? String(av).localeCompare(String(bv))
        : av - bv;
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, sort, view]);

  return (
    <section className="fx-panel">
      <h3 className="fx-panel-title">
        Projected standings
        <span className="fx-panel-note">
          each team&apos;s top {analysis.league.maxActivePlayers} by LeagueV, scored the way roto scores
        </span>
      </h3>
      <div className="fx-table-controls">
        <div className="fx-pill-row">
          <button type="button" className={`fx-pill${view === "points" ? " on" : ""}`} onClick={() => setView("points")}>Roto Points</button>
          <button type="button" className={`fx-pill${view === "totals" ? " on" : ""}`} onClick={() => setView("totals")}>Stat Totals</button>
        </div>
      </div>
      <div className="fx-table-wrap">
        <table className="fx-table">
          <thead>
            <tr>
              <SortTh label="#" sortKey="rank" sort={sort} onSort={onSort} />
              <th className="l fx-th-sortable" onClick={() => onSort("team")}>Team</th>
              <SortTh label={view === "points" ? "Roto pts" : "GP"} sortKey="primary" sort={sort} onSort={onSort} />
              {scored.map((c) => <SortTh key={c} label={CATEGORY_LABEL[c]} sortKey={c} sort={sort} onSort={onSort} />)}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.teamId} className={s.teamId === analysis.myTeamId ? "mine" : undefined}>
                <td className="num dim">{s.projectedRank}</td>
                <td className="l">{s.teamName}</td>
                <td className="num strong">{view === "points" ? s.totalPoints.toFixed(1) : s.statTotals.gamesPlayed}</td>
                {scored.map((c) => (
                  <td key={c} className="num cat dim" title={view === "points" ? `rank ${s.ranks[c] ?? "—"}` : undefined}>
                    {view === "points" ? (s.points[c] ?? 0).toFixed(0) : statTotalDisplay(s.statTotals, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Points-league standings: no category dimension to break out (see Standings
 * above) — just each team's projected season point total, ranked.
 */
function PointsStandings({
  standings, myTeamId,
}: { standings: PointsStandingRow[]; myTeamId: string | null }) {
  return (
    <section className="fx-panel">
      <h3 className="fx-panel-title">
        Projected standings
        <span className="fx-panel-note">each team&apos;s starters, ranked by projected season points</span>
      </h3>
      <div className="fx-table-wrap">
        <table className="fx-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th className="l">Team</th>
              <th className="num">Points</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s) => (
              <tr key={s.teamId} className={s.teamId === myTeamId ? "mine" : undefined}>
                <td className="num dim">{s.projectedRank}</td>
                <td className="l">{s.teamName}</td>
                <td className="num strong">{s.totalPoints.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── waiver board ────────────────────────────────────────────────────────────

function WaiverBoard({
  players, scored, pointsMode = false,
}: { players: ResolvedPlayer[]; scored: readonly FheCategory[]; pointsMode?: boolean }) {
  if (players.length === 0) {
    return <div className="fx-empty">No available players matched FHE data.</div>;
  }
  return (
    <section className="fx-panel">
      <h3 className="fx-panel-title">
        Best available{" "}
        <span className="fx-panel-note">
          free agents and waiver claims, ranked by {pointsMode ? "this league's points formula" : "this league's categories"} ·{" "}
          {MIN_SAMPLE_GAMES}-game minimum on last-season lines
        </span>
      </h3>
      <PlayerTable players={players} scored={scored} hasSalaries={false} pointsMode={pointsMode} />
    </section>
  );
}

// ── F Hoops Edge: trade-target suggestions ──────────────────────────────────

function EdgeTool({
  suggestions, edges, teamCount, isDynasty,
}: {
  suggestions: TradeSuggestion[];
  edges: CategoryEdge[];
  teamCount: number;
  isDynasty: boolean;
}) {
  const weak = edges.filter((e) => e.rank > Math.ceil((teamCount * 2) / 3));

  if (weak.length === 0) {
    return (
      <div className="fx-empty">
        No clear weak categories to target — this roster is well-balanced across every category this league scores.
      </div>
    );
  }
  if (suggestions.length === 0) {
    return (
      <div className="fx-empty">
        No rostered player on another team clearly fills {weak.map((e) => CATEGORY_LABEL[e.category]).join("/")} right now.
      </div>
    );
  }

  return (
    <section className="fx-panel">
      <h3 className="fx-panel-title">
        Trade targets
        <span className="fx-panel-note">
          rostered players elsewhere in the league who&apos;d fill your {weak.map((e) => CATEGORY_LABEL[e.category]).join("/")}
          {isDynasty ? " · dynasty consensus lightly tie-breaks these" : ""}
        </span>
      </h3>
      <div className="fx-edge-list">
        {suggestions.map((s) => (
          <div key={s.target.fantraxId} className="fx-edge-card">
            <div className="fx-edge-card-main">
              <div className="fx-edge-card-name">
                {s.target.name}
                <span className="fx-edge-card-team">{s.targetTeamName}</span>
              </div>
              <div className="fx-edge-card-helps">
                Helps {s.helps.length ? s.helps.map((c) => CATEGORY_LABEL[c]).join(", ") : "your weak categories"}
              </div>
              <div className="fx-edge-card-meta">
                <span>LeagueV {fmtV(s.target.leagueV)}</span>
                <span>Consensus {s.target.consensusRank ?? "—"}</span>
                <TrendBadge tag={s.target.trendTags?.nineCatV} />
              </div>
            </div>
            <div className="fx-edge-card-fit">
              <div className="fx-edge-fit-label">Fit</div>
              <div className="fx-edge-fit-value">{fmtV(s.fitScore)}</div>
            </div>
            {s.suggestedGiveUp && (
              <div className="fx-edge-card-give">
                <div className="fx-edge-give-label">Realistic ask</div>
                <div className="fx-edge-give-name">{s.suggestedGiveUp.name}</div>
                <div className="fx-edge-give-note">similar LeagueV ({fmtV(s.suggestedGiveUp.leagueV)}) — surplus in what you have</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Points-league sibling of EdgeTool — no category dimension to target, so
 * candidates are simply the best available pointsValue upgrades elsewhere in
 * the league (see suggestPointsTradeTargets).
 */
function PointsEdgeTool({
  suggestions, isDynasty,
}: { suggestions: PointsTradeSuggestion[]; isDynasty: boolean }) {
  if (suggestions.length === 0) {
    return <div className="fx-empty">No clear upgrade on another roster right now.</div>;
  }
  return (
    <section className="fx-panel">
      <h3 className="fx-panel-title">
        Trade targets
        <span className="fx-panel-note">
          rostered players elsewhere in the league who&apos;d raise your points-per-game
          {isDynasty ? " · dynasty consensus lightly tie-breaks these" : ""}
        </span>
      </h3>
      <div className="fx-edge-list">
        {suggestions.map((s) => (
          <div key={s.target.fantraxId} className="fx-edge-card">
            <div className="fx-edge-card-main">
              <div className="fx-edge-card-name">
                {s.target.name}
                <span className="fx-edge-card-team">{s.targetTeamName}</span>
              </div>
              <div className="fx-edge-card-meta">
                <span>Pts/G {f1(s.target.pointsValue)}</span>
                <span>Consensus {s.target.consensusRank ?? "—"}</span>
                <TrendBadge tag={s.target.trendTags?.nineCatV} />
              </div>
            </div>
            <div className="fx-edge-card-fit">
              <div className="fx-edge-fit-label">Fit</div>
              <div className="fx-edge-fit-value">{f1(s.fitScore)}</div>
            </div>
            {s.suggestedGiveUp && (
              <div className="fx-edge-card-give">
                <div className="fx-edge-give-label">Realistic ask</div>
                <div className="fx-edge-give-name">{s.suggestedGiveUp.name}</div>
                <div className="fx-edge-give-note">similar Pts/G ({f1(s.suggestedGiveUp.pointsValue)})</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Blocks Standings/Edge for a categories-mode league until the user has
 * explicitly confirmed Roto vs. Head-to-head — Fantrax's API can't tell the
 * two apart (verified live 2026-08-09), so silently assuming roto would score
 * a real H2H league wrong with no indication anything was assumed at all.
 */
function FormatConfirmPrompt({ onConfirm }: { onConfirm: (v: LeagueFormat) => void }) {
  return (
    <div className="fx-empty fx-format-confirm">
      <p>
        Fantrax doesn&apos;t tell us whether this league is scored Rotisserie or Head-to-head — which is it?
      </p>
      <div className="fx-row" style={{ justifyContent: "center" }}>
        <button type="button" className="fx-btn primary" onClick={() => onConfirm("roto")}>Rotisserie</button>
        <button type="button" className="fx-btn primary" onClick={() => onConfirm("h2h")}>Head-to-head</button>
      </div>
    </div>
  );
}

// ── settings ────────────────────────────────────────────────────────────────

function SettingsPanel({
  analysis, format, leagueType, salaryFormat, onFormatChange, onLeagueTypeChange, onSalaryFormatChange, onSetDefaultDataset,
}: {
  analysis: LeagueAnalysis;
  format: LeagueFormat;
  leagueType: LeagueType;
  salaryFormat: SalaryFormat;
  onFormatChange: (v: LeagueFormat) => void;
  onLeagueTypeChange: (v: LeagueType) => void;
  onSalaryFormatChange: (v: SalaryFormat) => void;
  onSetDefaultDataset: () => void;
}) {
  const { league, dataset } = analysis;
  const pointsMode = league.scoringMode === "points";
  const rows: [string, string][] = [
    ["League ID", league.leagueId],
    ["Season", String(league.seasonYear)],
    ["Scoring", scoringTypeLabel(league.scoringType)],
    ...(pointsMode
      ? ([
          [
            "Points formula",
            league.pointsFormula
              ? (Object.entries(league.pointsFormula.weights) as [PointsStat, number][])
                  .map(([stat, w]) => `${stat} ${w > 0 ? "+" : ""}${w}`)
                  .join(", ")
              : "—",
          ],
          ["Not modelled by FHE", league.pointsFormula?.unmodelled.join(", ") || "none"],
        ] as [string, string][])
      : ([
          ["Categories", league.categories.scored.map((c) => CATEGORY_LABEL[c]).join(", ")],
          ["Not modelled by FHE", league.categories.unmodelled.join(", ") || "none"],
        ] as [string, string][])),
    ["Teams", String(league.teamCount)],
    ["Roster", `${league.maxTotalPlayers} total · ${league.maxActivePlayers} active`],
    ["Starting slots", Object.entries(league.positionSlots).map(([p, n]) => `${p}×${n}`).join(", ") || "—"],
    ["Salary cap league", league.hasSalaries ? "yes" : "no"],
    [
      "Baseline pool",
      `top ${league.poolSize} players${league.poolClamped ? ` (capped — ${league.teamCount}×${league.maxTotalPlayers} rostered exceeds the deepest precomputed pool)` : ""}`,
    ],
    league.draft
      ? ["Draft", `${league.draft.picksMade}/${league.draft.totalPicks} picks made${league.draft.date ? ` · ${new Date(league.draft.date).toLocaleDateString()}` : ""}`]
      : ["Draft", "not started"],
    ["Imported", new Date(league.fetchedAt).toLocaleString()],
  ];

  return (
    <>
      <section className="fx-panel">
        <h3 className="fx-panel-title">
          League settings <span className="fx-panel-note">Fantrax doesn&apos;t expose these — set them yourself; they persist with the saved league</span>
        </h3>
        <div className="fx-tagrow">
          {!pointsMode && (
            <label className="fx-label">
              Scoring format
              <select className="fx-select" value={format} onChange={(e) => onFormatChange(e.target.value as LeagueFormat)}>
                <option value="roto">Rotisserie</option>
                <option value="h2h">Head-to-head</option>
              </select>
            </label>
          )}
          <label className="fx-label">
            League type
            <select className="fx-select" value={leagueType} onChange={(e) => onLeagueTypeChange(e.target.value as LeagueType)}>
              <option value="redraft">Redraft</option>
              <option value="keeper">Keeper</option>
              <option value="dynasty">Dynasty</option>
            </select>
          </label>
          <label className="fx-label">
            Salary format
            <select className="fx-select" value={salaryFormat} onChange={(e) => onSalaryFormatChange(e.target.value as SalaryFormat)}>
              <option value="none">Non-salary</option>
              <option value="real">Real salary</option>
              <option value="custom">Custom salary</option>
            </select>
          </label>
          <label className="fx-label">
            Default value driver
            <div className="fx-row">
              <span className="fx-setting-current">{dataset.label}</span>
              <button type="button" className="fx-btn ghost sm" onClick={onSetDefaultDataset}>
                Make default
              </button>
            </div>
          </label>
        </div>
        {leagueType === "dynasty" && (
          <p className="fx-card-note">
            Dynasty leagues get a small dynasty-consensus tie-break on the F Hoops Edge trade tool, on top of the
            category fit that always drives it.
          </p>
        )}
      </section>

      <section className="fx-panel">
      <h3 className="fx-panel-title">Imported settings</h3>
      <dl className="fx-settings">
        {rows.map(([k, v]) => (
          <div key={k} className="fx-setting">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {analysis.coverage.unmatched.length > 0 && (
        <>
          <h3 className="fx-panel-title">Players with no FHE data</h3>
          <p className="fx-card-note">
            {analysis.coverage.unmatched.join(", ")}. These sit outside every FHE dataset — usually an unsigned
            free agent or a player who missed last season entirely. They score as blanks, never as zeroes.
          </p>
        </>
      )}
      {analysis.coverage.ambiguous.length > 0 && (
        <>
          <h3 className="fx-panel-title">Duplicate names in this league&apos;s player pool</h3>
          <p className="fx-card-note">
            {analysis.coverage.ambiguous.join(", ")}. Another player in the pool shares each of these names, so
            FHE data is withheld rather than risk attaching the wrong player&apos;s numbers.
          </p>
        </>
      )}
      </section>
    </>
  );
}

const STYLES = `
  .fx-shell { height: 100%; overflow-y: auto; background: var(--rt-canvas); color: var(--rt-body);
    font-family: var(--rt-font-sans); padding: 28px 32px 80px; }
  @media (max-width: 767px) { .fx-shell { padding: 24px 18px 80px; } }

  .fx-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
    flex-wrap: wrap; margin-bottom: 18px; }
  .fx-eyebrow { font-family: var(--rt-font-mono); font-size: 10px; letter-spacing: 3px;
    color: var(--rt-primary); margin-bottom: 6px; }
  .fx-title { font-weight: 700; font-size: 28px; color: var(--rt-body-strong); margin: 0; letter-spacing: -.3px; }
  .fx-sub { font-size: 13px; color: var(--rt-muted); margin-top: 6px; max-width: 640px; }
  .fx-head-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

  .fx-btn { font-family: var(--rt-font-sans); font-size: 13px; font-weight: 600; border-radius: 8px;
    padding: 9px 14px; cursor: pointer; border: 1px solid var(--rt-hairline);
    background: var(--rt-surface-soft); color: var(--rt-body-strong); transition: opacity .12s, border-color .12s; }
  .fx-btn:disabled { opacity: .45; cursor: not-allowed; }
  .fx-btn.ghost { background: transparent; }
  .fx-btn.ghost:hover:not(:disabled) { border-color: var(--rt-primary); }
  .fx-btn.sm { padding: 6px 10px; font-size: 12px; }
  .fx-btn.primary { background: var(--rt-primary); color: var(--rt-on-primary); border-color: var(--rt-primary); }
  .fx-btn.primary:hover:not(:disabled) { background: var(--rt-primary-active); }

  .fx-warn { background: rgba(219,43,57,.1); border: 1px solid rgba(219,43,57,.35); border-radius: 10px;
    padding: 10px 14px; font-size: 13px; color: var(--rt-body); margin-bottom: 14px; }
  .fx-loading, .fx-empty { padding: 48px; text-align: center; color: var(--rt-muted); font-size: 14px; }
  .fx-format-confirm p { margin: 0 0 14px; color: var(--rt-body-strong); font-size: 14px; }

  .fx-setup { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; }
  .fx-card { border: 1px solid var(--rt-hairline); border-radius: 12px; background: var(--rt-surface-soft); padding: 20px; }
  .fx-card-title { font-size: 15px; font-weight: 700; color: var(--rt-body-strong); margin: 0 0 8px; }
  .fx-card-note { font-size: 12.5px; color: var(--rt-muted); line-height: 1.55; margin: 0 0 14px; }
  .fx-card-note a { color: var(--rt-primary); }
  .fx-card-note b { color: var(--rt-body-strong); font-family: var(--rt-font-mono); font-weight: 600; }

  .fx-form { display: flex; flex-direction: column; gap: 12px; }
  .fx-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .fx-label { display: flex; flex-direction: column; gap: 5px; font-size: 11px; font-weight: 600;
    letter-spacing: .4px; text-transform: uppercase; color: var(--rt-muted); }
  .fx-optional { text-transform: none; letter-spacing: 0; font-weight: 400; color: var(--rt-muted-soft); }
  .fx-input, .fx-select { font-family: var(--rt-font-sans); font-size: 13px; border-radius: 8px;
    border: 1px solid var(--rt-hairline); background: var(--rt-canvas); color: var(--rt-body-strong);
    padding: 9px 11px; min-width: 0; }
  .fx-input { flex: 1 1 220px; }
  .fx-input.mono { font-family: var(--rt-font-mono); letter-spacing: .5px; }

  .fx-connected { display: flex; flex-direction: column; gap: 12px; }
  .fx-ok { font-size: 13px; font-weight: 600; color: var(--rt-up);
    background: rgba(22,160,106,.12); border: 1px solid rgba(22,160,106,.3);
    border-radius: 8px; padding: 9px 12px; }

  .fx-league-list { margin-top: 16px; border-top: 1px solid var(--rt-hairline); padding-top: 12px;
    max-height: 340px; overflow-y: auto; }
  .fx-list-head { font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase;
    color: var(--rt-muted-soft); margin-bottom: 8px; }
  .fx-league-row { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%;
    text-align: left; padding: 8px 10px; border-radius: 8px; border: 1px solid transparent;
    background: transparent; cursor: pointer; }
  .fx-league-row:hover { background: var(--rt-surface-strong); border-color: var(--rt-hairline); }
  .fx-league-name { font-size: 13px; font-weight: 600; color: var(--rt-body-strong); }
  .fx-league-team { font-size: 11.5px; color: var(--rt-muted); }
  .fx-saved-row { display: flex; align-items: center; gap: 8px; }
  .fx-saved-row .fx-league-row.flat { flex: 1; }

  .fx-summary { display: flex; justify-content: space-between; gap: 24px; flex-wrap: wrap;
    border: 1px solid var(--rt-hairline); border-radius: 12px; background: var(--rt-surface-soft);
    padding: 18px 20px; margin-bottom: 16px; }
  .fx-league-title { font-size: 20px; font-weight: 700; color: var(--rt-body-strong); margin: 0 0 8px; }
  .fx-facts { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12.5px; color: var(--rt-muted); }
  .fx-facts span:not(:last-child)::after { content: " ·"; color: var(--rt-muted-soft); }
  .fx-cats { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 12px; }
  .fx-cat-chip { font-family: var(--rt-font-mono); font-size: 10.5px; font-weight: 600; padding: 3px 8px;
    border-radius: 999px; background: rgba(250,70,22,.12); color: var(--rt-primary); }
  .fx-cat-chip.off { background: var(--rt-surface-strong); color: var(--rt-muted-soft); }
  .fx-summary-side { display: flex; flex-direction: column; gap: 8px; min-width: 220px; }
  .fx-coverage { font-size: 11.5px; color: var(--rt-muted-soft); }

  .fx-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
  .fx-tab { font-size: 12.5px; font-weight: 600; padding: 7px 14px; border-radius: 999px; cursor: pointer;
    border: 1px solid var(--rt-hairline); background: var(--rt-surface-soft); color: var(--rt-body); }
  .fx-tab.on { background: var(--rt-primary); border-color: var(--rt-primary); color: var(--rt-on-primary); }

  .fx-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .fx-kpi { border: 1px solid var(--rt-hairline); border-radius: 12px; background: var(--rt-surface-soft); padding: 14px 16px; }
  .fx-kpi-label { font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase; color: var(--rt-muted-soft); }
  .fx-kpi-value { font-size: 22px; font-weight: 700; color: var(--rt-body-strong); margin-top: 4px; }

  .fx-panel { border: 1px solid var(--rt-hairline); border-radius: 12px; background: var(--rt-surface-soft);
    padding: 18px 20px; margin-bottom: 16px; }
  .fx-panel-title { font-size: 14px; font-weight: 700; color: var(--rt-body-strong); margin: 0 0 12px;
    display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .fx-panel-note { font-size: 11.5px; font-weight: 400; color: var(--rt-muted); }

  .fx-edges { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
  .fx-edge { border: 1px solid var(--rt-hairline); border-radius: 10px; padding: 10px; text-align: center;
    background: var(--rt-canvas); }
  .fx-edge.strong { border-color: rgba(22,160,106,.4); background: rgba(22,160,106,.08); }
  .fx-edge.weak { border-color: rgba(219,43,57,.35); background: rgba(219,43,57,.07); }
  .fx-edge-cat { font-family: var(--rt-font-mono); font-size: 11px; color: var(--rt-muted); }
  .fx-edge-rank { font-size: 20px; font-weight: 700; color: var(--rt-body-strong); }
  .fx-edge-rank span { font-size: 11px; font-weight: 400; color: var(--rt-muted-soft); }
  .fx-edge-delta { font-size: 11px; color: var(--rt-muted); }
  .fx-edge-pts { font-size: 10.5px; color: var(--rt-muted-soft); margin-top: 2px; }

  .fx-table-wrap { overflow-x: auto; border: 1px solid var(--rt-hairline); border-radius: 10px; }
  .fx-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .fx-table th { position: sticky; top: 0; background: var(--rt-surface-strong); color: var(--rt-muted);
    font-size: 10px; letter-spacing: .8px; text-transform: uppercase; font-weight: 700;
    padding: 8px 10px; text-align: center; white-space: nowrap; }
  .fx-table th.l, .fx-table td.l { text-align: left; }
  .fx-table td { padding: 7px 10px; text-align: center; border-top: 1px solid var(--rt-hairline);
    color: var(--rt-body); white-space: nowrap; }
  .fx-table tr.starter td { background: rgba(250,70,22,.05); }
  .fx-table tr.mine td { background: rgba(250,70,22,.1); font-weight: 600; }
  .fx-table td.num { font-family: var(--rt-font-mono); }
  .fx-table td.strong { color: var(--rt-body-strong); font-weight: 700; }
  .fx-table td.dim { color: var(--rt-muted); }
  .fx-table td.cat.pos { color: var(--rt-up); }
  .fx-table td.cat.neg { color: var(--rt-down); }
  .fx-nodata, .fx-src { font-size: 9px; margin-left: 6px; padding: 1px 5px; border-radius: 4px;
    background: var(--rt-surface-strong); color: var(--rt-muted-soft); text-transform: uppercase; letter-spacing: .5px; }
  .fx-nodata.warn, .fx-src.warn { background: rgba(219,43,57,.14); color: var(--rt-down); }

  .fx-settings { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px 24px; margin: 0 0 8px; }
  .fx-setting { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--rt-hairline); padding: 7px 0; }
  .fx-setting dt { font-size: 12px; color: var(--rt-muted); }
  .fx-setting dd { font-size: 12.5px; color: var(--rt-body-strong); margin: 0; text-align: right; }

  .fx-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: var(--rt-surface-strong); border: 1px solid var(--rt-hairline); border-radius: 10px;
    padding: 10px 18px; font-size: 13px; color: var(--rt-body-strong); z-index: 50; }

  .fx-table-controls { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
  .fx-pill-row { display: flex; gap: 6px; flex-wrap: wrap; }
  .fx-pill { font-family: var(--rt-font-sans); font-size: 11.5px; font-weight: 600; padding: 5px 11px;
    border-radius: 999px; cursor: pointer; border: 1px solid var(--rt-hairline);
    background: var(--rt-surface-soft); color: var(--rt-muted); }
  .fx-pill.on { background: var(--rt-primary); border-color: var(--rt-primary); color: var(--rt-on-primary); }

  .fx-th-sortable { cursor: pointer; user-select: none; }
  .fx-th-sortable:hover { color: var(--rt-body-strong); }
  .fx-th-active { color: var(--rt-primary) !important; }
  .fx-sort-arrow { font-size: 9px; }

  .fx-trend { font-size: 11px; font-weight: 600; white-space: nowrap; }
  .fx-trend-none { color: var(--rt-muted-soft); }

  .fx-tagrow { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
  .fx-setting-current { font-size: 12.5px; color: var(--rt-body-strong); }

  .fx-edge-list { display: flex; flex-direction: column; gap: 10px; }
  .fx-edge-card { display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    border: 1px solid var(--rt-hairline); border-radius: 10px; padding: 12px 14px; background: var(--rt-canvas); }
  .fx-edge-card-main { flex: 1 1 260px; min-width: 0; }
  .fx-edge-card-name { font-size: 13.5px; font-weight: 700; color: var(--rt-body-strong); }
  .fx-edge-card-team { font-size: 11.5px; font-weight: 400; color: var(--rt-muted); margin-left: 8px; }
  .fx-edge-card-helps { font-size: 11.5px; color: var(--rt-primary); margin-top: 3px; }
  .fx-edge-card-meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--rt-muted);
    margin-top: 5px; font-family: var(--rt-font-mono); }
  .fx-edge-card-fit { text-align: center; padding: 0 12px; border-left: 1px solid var(--rt-hairline);
    border-right: 1px solid var(--rt-hairline); }
  .fx-edge-fit-label { font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: var(--rt-muted-soft); }
  .fx-edge-fit-value { font-size: 16px; font-weight: 700; color: var(--rt-up); font-family: var(--rt-font-mono); }
  .fx-edge-card-give { text-align: right; min-width: 140px; }
  .fx-edge-give-label { font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: var(--rt-muted-soft); }
  .fx-edge-give-name { font-size: 13px; font-weight: 700; color: var(--rt-body-strong); }
  .fx-edge-give-note { font-size: 10.5px; color: var(--rt-muted); max-width: 160px; }
`;
