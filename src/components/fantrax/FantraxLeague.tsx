"use client";

import { useState, useEffect, useMemo } from "react";
import { SiteNav } from "@/components/site-nav";
import { DYNASTY_RANKINGS } from "@/lib/dynasty-rankings";

// ——— Types ———

type Screen = "auth" | "picker" | "dashboard";
type DashTab = "teams" | "standings" | "targets" | "draft";

interface FtxLeague {
  leagueId: string;
  name: string;
  sport: string;
  numOfTeams?: number;
  teamCount?: number;
  scoring?: string;
  currentPeriod?: number;
}

// From getLeagueInfo
interface LeagueInfo {
  leagueName: string;
  seasonYear: number;
  startDate: string;
  endDate: string;
  draftType: string;
  teamInfo: Record<string, { name: string; id: string }>;
  playerInfo: Record<string, { eligiblePos: string; status: "FA" | "T" | string }>;
  scoringSystem: { type: string; scoringCategories: Record<string, Record<string, Record<string, string>>> };
  matchups: unknown[];
  rosterInfo: { maxTotalPlayers?: number; maxTotalActivePlayers?: number };
}

// From getStandings
interface FtxStanding {
  teamId: string;
  teamName: string;
  rank?: number;
  wins?: number;
  losses?: number;
  ties?: number;
  winPercentage?: number;
  gamesBack?: number;
  points?: string;
}

// From getDraftResults
interface DraftResults {
  draftOrder: string[];
  draftPicks: Array<{ round: number; pick: number; teamId: string; pickInRound: number; time: number }>;
  draftState: string;
  draftSettings: { draftType: string };
}

const TIER_STYLE: Record<number, [bg: string, text: string]> = {
  1: ["rgba(34,197,94,0.18)", "#22c55e"],
  2: ["rgba(96,165,250,0.18)", "#60a5fa"],
  3: ["rgba(167,139,250,0.18)", "#a78bfa"],
  4: ["rgba(251,191,36,0.18)", "#fbbf24"],
  5: ["rgba(251,146,60,0.18)", "#fb923c"],
  6: ["rgba(248,113,113,0.18)", "#f87171"],
  7: ["rgba(148,163,184,0.18)", "#94a3b8"],
  8: ["rgba(100,116,139,0.15)", "#64748b"],
};

function isBball(lg: FtxLeague): boolean {
  const sp = (lg.sport ?? "").toLowerCase();
  const nm = (lg.name ?? "").toLowerCase();
  return (
    sp.includes("nba") ||
    sp.includes("basketball") ||
    sp.includes("bball") ||
    nm.includes("dynasty") ||
    nm.includes("nba") ||
    nm.includes("fbi") ||
    nm.includes("dmd") ||
    nm.includes("basketball") ||
    nm.includes("ball")
  );
}

// ——— Shared styles ———

const INPUT_S: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  background: "var(--modal-input-bg)",
  border: "1px solid var(--modal-input-border)",
  borderRadius: "6px",
  color: "var(--text-primary)",
  fontSize: "14px",
  outline: "none",
  fontFamily: "inherit",
};

const BTN_PRIMARY: React.CSSProperties = {
  padding: "10px 28px",
  background: "var(--edge-orange)",
  border: "none",
  borderRadius: "6px",
  color: "#fff",
  fontFamily: "'Oswald', sans-serif",
  fontWeight: 600,
  fontSize: "14px",
  letterSpacing: "0.5px",
  cursor: "pointer",
  textTransform: "uppercase" as const,
  flexShrink: 0,
};

const BTN_GHOST: React.CSSProperties = {
  padding: "6px 14px",
  background: "transparent",
  border: "1px solid var(--border-main)",
  borderRadius: "6px",
  color: "var(--text-secondary)",
  fontSize: "13px",
  cursor: "pointer",
  fontFamily: "inherit",
  flexShrink: 0,
};

const CARD_S: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-main)",
  borderRadius: "12px",
  boxShadow: "var(--shadow-card)",
  padding: "32px",
};

// ——— Main component ———

export default function FantraxLeague() {
  const [screen, setScreen] = useState<Screen>("auth");
  const [username, setUsername] = useState("");
  const [secretId, setSecretId] = useState("");
  const [leagues, setLeagues] = useState<FtxLeague[]>([]);
  const [selLeague, setSelLeague] = useState<FtxLeague | null>(null);
  const [manualId, setManualId] = useState("");
  const [tab, setTab] = useState<DashTab>("teams");
  const [leagueInfo, setLeagueInfo] = useState<LeagueInfo | null>(null);
  const [standings, setStandings] = useState<FtxStanding[]>([]);
  const [draftResults, setDraftResults] = useState<DraftResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [dashLoading, setDashLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const u = sessionStorage.getItem("fhe-ftx-user");
    const s = sessionStorage.getItem("fhe-ftx-secret");
    if (u && s) {
      setUsername(u);
      setSecretId(s);
      void doFetchLeagues(u, s);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function doFetchLeagues(u: string, s: string) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/fantrax/league?action=getLeagues&username=${encodeURIComponent(u)}&secretId=${encodeURIComponent(s)}`
      );
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.error) throw new Error(String(data.error ?? `HTTP ${res.status}`));
      const raw = (
        data.leagues ??
        data.leagueList ??
        (data.data as Record<string, unknown> | undefined)?.leagues ??
        []
      ) as FtxLeague[];
      setLeagues(raw);
      sessionStorage.setItem("fhe-ftx-user", u);
      sessionStorage.setItem("fhe-ftx-secret", s);
      setScreen("picker");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed. Check your credentials.");
    } finally {
      setLoading(false);
    }
  }

  async function doLoadDashboard(leagueId: string) {
    setDashLoading(true);
    setError("");
    const s = sessionStorage.getItem("fhe-ftx-secret") ?? secretId;
    const base = `/api/fantrax/league?leagueId=${encodeURIComponent(leagueId)}&secretId=${encodeURIComponent(s)}`;

    try {
      const [r1, r2, r3] = await Promise.all([
        fetch(`${base}&action=getLeagueInfo`),
        fetch(`${base}&action=getStandings`),
        fetch(`${base}&action=getDraftResults`),
      ]);
      const [d1, d2, d3] = await Promise.all([r1.json(), r2.json(), r3.json()]);

      if (d1 && !d1.error) setLeagueInfo(d1 as LeagueInfo);
      if (d2 && !d2.error && Array.isArray(d2)) setStandings(d2 as FtxStanding[]);
      if (d3 && !d3.error) setDraftResults(d3 as DraftResults);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load league data");
    } finally {
      setDashLoading(false);
    }
  }

  function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    const u = username.trim();
    const s = secretId.trim();
    if (!u || !s) return;
    void doFetchLeagues(u, s);
  }

  function handleSelectLeague(lg: FtxLeague) {
    setSelLeague(lg);
    setTab("teams");
    setScreen("dashboard");
    void doLoadDashboard(lg.leagueId);
  }

  function handleManualLeague(e: React.FormEvent) {
    e.preventDefault();
    const lid = manualId.trim();
    if (!lid) return;
    handleSelectLeague({ leagueId: lid, name: lid, sport: "NBA" });
  }

  function handleSignOut() {
    sessionStorage.removeItem("fhe-ftx-user");
    sessionStorage.removeItem("fhe-ftx-secret");
    setScreen("auth");
    setUsername("");
    setSecretId("");
    setLeagues([]);
    setSelLeague(null);
    setLeagueInfo(null);
    setStandings([]);
    setDraftResults(null);
    setError("");
  }

  const bball = useMemo(() => leagues.filter(isBball), [leagues]);

  // ——— Auth screen ———
  if (screen === "auth") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-body)" }}>
        <SiteNav active="fantrax" />
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "80px 20px 40px" }}>
          <div style={CARD_S}>
            <h1
              style={{
                fontFamily: "'Oswald', sans-serif",
                fontSize: "22px",
                color: "var(--text-primary)",
                marginBottom: "6px",
                letterSpacing: "0.5px",
              }}
            >
              CONNECT YOUR FANTRAX LEAGUE
            </h1>
            <p
              style={{
                color: "var(--text-secondary)",
                fontSize: "13px",
                marginBottom: "28px",
                lineHeight: 1.6,
              }}
            >
              Enter your Fantrax username and Secret ID to load your dynasty leagues. Find your
              Secret ID in{" "}
              <span style={{ color: "var(--edge-orange)" }}>
                Fantrax → Profile → Account Settings
              </span>
              .
            </p>

            {error && (
              <div
                style={{
                  background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: "6px",
                  padding: "10px 14px",
                  marginBottom: "16px",
                  color: "#f87171",
                  fontSize: "13px",
                  lineHeight: 1.5,
                }}
              >
                {error}
              </div>
            )}

            <form onSubmit={handleConnect} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "11px",
                    color: "var(--text-muted)",
                    marginBottom: "6px",
                    letterSpacing: "0.6px",
                    textTransform: "uppercase",
                    fontFamily: "'Oswald', sans-serif",
                    fontWeight: 500,
                  }}
                >
                  Fantrax Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="your_username"
                  style={INPUT_S}
                  autoComplete="username"
                  required
                />
              </div>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "11px",
                    color: "var(--text-muted)",
                    marginBottom: "6px",
                    letterSpacing: "0.6px",
                    textTransform: "uppercase",
                    fontFamily: "'Oswald', sans-serif",
                    fontWeight: 500,
                  }}
                >
                  Secret ID
                </label>
                <input
                  type="text"
                  value={secretId}
                  onChange={(e) => setSecretId(e.target.value)}
                  placeholder="abcdef1234567890"
                  style={INPUT_S}
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </div>
              <button
                type="submit"
                style={{ ...BTN_PRIMARY, marginTop: "8px", width: "100%" }}
                disabled={loading}
              >
                {loading ? "Connecting…" : "Connect to Fantrax"}
              </button>
            </form>

            <p
              style={{
                marginTop: "20px",
                fontSize: "12px",
                color: "var(--text-muted)",
                lineHeight: 1.6,
                borderTop: "1px solid var(--border-light)",
                paddingTop: "16px",
              }}
            >
              Credentials stay in sessionStorage only — cleared when you close the tab. FHE never
              stores them server-side.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ——— League picker screen ———
  if (screen === "picker") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-body)" }}>
        <SiteNav active="fantrax" />
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "80px 20px 40px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: "24px",
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            <div>
              <h1
                style={{
                  fontFamily: "'Oswald', sans-serif",
                  fontSize: "22px",
                  color: "var(--text-primary)",
                  letterSpacing: "0.5px",
                }}
              >
                SELECT YOUR LEAGUE
              </h1>
              <p style={{ color: "var(--text-muted)", fontSize: "13px", marginTop: "4px" }}>
                Connected as{" "}
                <span style={{ color: "var(--text-secondary)" }}>{username}</span>
                {leagues.length > 0
                  ? ` — ${bball.length} basketball league${bball.length !== 1 ? "s" : ""} found`
                  : " — no leagues returned. Enter a league ID below."}
              </p>
            </div>
            <button type="button" style={BTN_GHOST} onClick={handleSignOut}>
              Sign out
            </button>
          </div>

          {error && (
            <div
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: "6px",
                padding: "10px 14px",
                marginBottom: "16px",
                color: "#f87171",
                fontSize: "13px",
              }}
            >
              {error}
            </div>
          )}

          {bball.length > 0 && (
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-main)",
                borderRadius: "10px",
                overflow: "hidden",
                marginBottom: "24px",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-main)", background: "var(--bg-surface)" }}>
                    {["League Name", "Sport", "Teams", "Scoring", ""].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "10px 14px",
                          textAlign: h === "Teams" || h === "" ? "center" : "left",
                          color: "var(--text-muted)",
                          fontFamily: "'Oswald', sans-serif",
                          fontWeight: 500,
                          fontSize: "11px",
                          letterSpacing: "0.6px",
                          textTransform: "uppercase",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bball.map((lg) => (
                    <tr
                      key={lg.leagueId}
                      style={{ borderBottom: "1px solid var(--border-light)", cursor: "pointer" }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLTableRowElement).style.background = "var(--bg-card-hover)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLTableRowElement).style.background = "";
                      }}
                      onClick={() => handleSelectLeague(lg)}
                    >
                      <td style={{ padding: "12px 14px", color: "var(--text-primary)", fontWeight: 500 }}>
                        {lg.name}
                      </td>
                      <td style={{ padding: "12px 14px", color: "var(--text-secondary)" }}>{lg.sport}</td>
                      <td style={{ padding: "12px 14px", color: "var(--text-secondary)", textAlign: "center" }}>
                        {lg.numOfTeams ?? lg.teamCount ?? "—"}
                      </td>
                      <td style={{ padding: "12px 14px", color: "var(--text-secondary)" }}>
                        {lg.scoring ?? "—"}
                      </td>
                      <td style={{ padding: "12px 14px", textAlign: "center" }}>
                        <button
                          type="button"
                          style={{ ...BTN_PRIMARY, padding: "6px 16px", fontSize: "12px" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectLeague(lg);
                          }}
                        >
                          Select
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {leagues.length > bball.length && (
            <p style={{ color: "var(--text-muted)", fontSize: "12px", marginBottom: "20px" }}>
              {leagues.length - bball.length} non-basketball league
              {leagues.length - bball.length !== 1 ? "s" : ""} hidden.
            </p>
          )}

          <div style={{ ...CARD_S, padding: "20px 24px" }}>
            <p style={{ color: "var(--text-secondary)", fontSize: "13px", marginBottom: "12px" }}>
              Don&apos;t see your league? Enter the league ID directly:
            </p>
            <form
              onSubmit={handleManualLeague}
              style={{ display: "flex", gap: "10px", alignItems: "center" }}
            >
              <input
                type="text"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="League ID (e.g. abc123xyz)"
                style={{ ...INPUT_S, flex: 1 }}
              />
              <button type="submit" style={BTN_PRIMARY}>
                Load
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ——— Dashboard ———

  const TABS: { key: DashTab; label: string }[] = [
    { key: "teams", label: "Teams" },
    { key: "standings", label: "Standings" },
    { key: "targets", label: "FHE Targets" },
    { key: "draft", label: "Draft Order" },
  ];

  const leagueName = leagueInfo?.leagueName ?? selLeague?.name ?? "My League";
  const teamCount = Object.keys(leagueInfo?.teamInfo ?? {}).length;
  const cats = leagueInfo
    ? Object.keys(leagueInfo.scoringSystem?.scoringCategories?.PLAYER ?? {}).join(" · ")
    : null;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-body)" }}>
      <SiteNav active="fantrax" />

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "72px 20px 0" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            paddingTop: "16px",
            marginBottom: "4px",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1
              style={{
                fontFamily: "'Oswald', sans-serif",
                fontSize: "22px",
                color: "var(--text-primary)",
                letterSpacing: "0.5px",
              }}
            >
              {leagueName}
            </h1>
            <p style={{ color: "var(--text-muted)", fontSize: "13px", marginTop: "3px" }}>
              {leagueInfo
                ? `${teamCount} teams · ${leagueInfo.scoringSystem.type.toUpperCase()} · ${cats} · Season ${leagueInfo.seasonYear}`
                : "Loading league data…"}
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" style={BTN_GHOST} onClick={() => setScreen("picker")}>
              ← Leagues
            </button>
            <button type="button" style={BTN_GHOST} onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid var(--border-main)",
            marginTop: "12px",
            marginBottom: "24px",
          }}
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: "10px 20px",
                background: "none",
                border: "none",
                borderBottom: tab === t.key ? "2px solid var(--edge-orange)" : "2px solid transparent",
                color: tab === t.key ? "var(--edge-orange)" : "var(--text-secondary)",
                fontFamily: "'Oswald', sans-serif",
                fontWeight: 500,
                fontSize: "14px",
                letterSpacing: "0.5px",
                cursor: "pointer",
                textTransform: "uppercase" as const,
                marginBottom: "-1px",
                transition: "color 0.15s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div
            style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: "6px",
              padding: "10px 14px",
              marginBottom: "16px",
              color: "#f87171",
              fontSize: "13px",
            }}
          >
            {error}
          </div>
        )}

        {dashLoading ? (
          <div
            style={{
              textAlign: "center",
              padding: "80px 0",
              color: "var(--text-muted)",
              fontSize: "14px",
            }}
          >
            Loading…
          </div>
        ) : (
          <>
            {tab === "teams" && (
              <TeamsView
                leagueInfo={leagueInfo}
                standings={standings}
                draftResults={draftResults}
              />
            )}
            {tab === "standings" && <StandingsView standings={standings} />}
            {tab === "targets" && (
              <TargetsView leagueInfo={leagueInfo} />
            )}
            {tab === "draft" && (
              <DraftView leagueInfo={leagueInfo} draftResults={draftResults} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ——— Teams tab ———

function TeamsView({
  leagueInfo,
  standings,
  draftResults,
}: {
  leagueInfo: LeagueInfo | null;
  standings: FtxStanding[];
  draftResults: DraftResults | null;
}) {
  if (!leagueInfo) return <Empty message="League data loading…" />;

  const teams = Object.values(leagueInfo.teamInfo ?? {});
  const standingsByTeamId = new Map(standings.map((s) => [s.teamId, s]));
  const draftSlotByTeamId = new Map(
    (draftResults?.draftOrder ?? []).map((id, i) => [id, i + 1])
  );

  const teamsWithData = teams.map((t) => ({
    ...t,
    standing: standingsByTeamId.get(t.id),
    draftSlot: draftSlotByTeamId.get(t.id),
  }));

  // Sort by standings rank if available
  teamsWithData.sort((a, b) => (a.standing?.rank ?? 999) - (b.standing?.rank ?? 999));

  const playerInfo = leagueInfo.playerInfo ?? {};
  const rosteredCount = Object.values(playerInfo).filter((p) => p.status === "T").length;
  const faCount = Object.values(playerInfo).filter((p) => p.status === "FA").length;
  const avgRoster = teams.length > 0 ? (rosteredCount / teams.length).toFixed(1) : "—";

  return (
    <div style={{ paddingBottom: "40px" }}>
      {/* Pool summary */}
      <div
        style={{
          display: "flex",
          gap: "16px",
          marginBottom: "20px",
          flexWrap: "wrap",
        }}
      >
        {[
          { label: "Teams", value: String(teams.length) },
          { label: "Avg Roster Size", value: avgRoster },
          { label: "Rostered Players", value: String(rosteredCount) },
          { label: "Free Agents", value: String(faCount) },
          { label: "Draft Type", value: leagueInfo.draftType.toUpperCase() },
        ].map(({ label, value }) => (
          <div
            key={label}
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-main)",
              borderRadius: "8px",
              padding: "12px 18px",
              minWidth: "110px",
            }}
          >
            <div style={{ fontSize: "18px", fontFamily: "'Oswald', sans-serif", fontWeight: 600, color: "var(--edge-orange)" }}>
              {value}
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px", textTransform: "uppercase", letterSpacing: "0.4px" }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Teams grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: "12px",
        }}
      >
        {teamsWithData.map((team) => {
          const s = team.standing;
          const slot = team.draftSlot;
          return (
            <div
              key={team.id}
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-main)",
                borderRadius: "10px",
                padding: "14px 16px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                <span
                  style={{
                    fontFamily: "'Oswald', sans-serif",
                    fontWeight: 600,
                    fontSize: "14px",
                    color: "var(--text-primary)",
                    lineHeight: 1.3,
                  }}
                >
                  {team.name}
                </span>
                {s?.rank != null && (
                  <span
                    style={{
                      fontSize: "11px",
                      fontFamily: "'Oswald', sans-serif",
                      fontWeight: 600,
                      color: s.rank <= 3 ? "#22c55e" : "var(--text-muted)",
                      letterSpacing: "0.3px",
                    }}
                  >
                    #{s.rank}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: "10px", fontSize: "12px", color: "var(--text-secondary)" }}>
                {s && (
                  <span>
                    {s.wins ?? 0}–{s.losses ?? 0}
                    {(s.ties ?? 0) > 0 ? `–${s.ties}` : ""}
                  </span>
                )}
                {slot != null && (
                  <span style={{ color: "var(--text-muted)" }}>
                    Draft slot {slot}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p
        style={{
          marginTop: "20px",
          fontSize: "12px",
          color: "var(--text-muted)",
          lineHeight: 1.6,
        }}
      >
        Individual player rosters are not available via the Fantrax Secret ID API. Use{" "}
        <strong style={{ color: "var(--text-secondary)" }}>FHE Targets</strong> tab to see dynasty
        rankings in the context of your league depth.
      </p>
    </div>
  );
}

// ——— Standings tab ———

function StandingsView({ standings }: { standings: FtxStanding[] }) {
  if (standings.length === 0) {
    return <Empty message="No standings data returned." />;
  }

  return (
    <div style={{ paddingBottom: "40px" }}>
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-main)",
          borderRadius: "10px",
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-main)", background: "var(--bg-surface)" }}>
              {(["Rank", "Team", "W", "L", "T", "PCT", "GB"] as const).map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "10px 14px",
                    textAlign: h === "Team" ? "left" : "center",
                    color: "var(--text-muted)",
                    fontFamily: "'Oswald', sans-serif",
                    fontWeight: 500,
                    fontSize: "11px",
                    letterSpacing: "0.6px",
                    textTransform: "uppercase",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {standings.map((s, i) => (
              <tr key={s.teamId ?? i} style={{ borderBottom: "1px solid var(--border-light)" }}>
                <td style={{ padding: "10px 14px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                  {s.rank ?? i + 1}
                </td>
                <td style={{ padding: "10px 14px", color: "var(--text-primary)", fontWeight: 500 }}>
                  {s.teamName}
                </td>
                <td style={{ padding: "10px 14px", textAlign: "center", color: "var(--text-secondary)" }}>
                  {s.wins ?? "—"}
                </td>
                <td style={{ padding: "10px 14px", textAlign: "center", color: "var(--text-secondary)" }}>
                  {s.losses ?? "—"}
                </td>
                <td style={{ padding: "10px 14px", textAlign: "center", color: "var(--text-secondary)" }}>
                  {s.ties ?? "—"}
                </td>
                <td style={{ padding: "10px 14px", textAlign: "center", color: "var(--text-secondary)" }}>
                  {s.winPercentage != null ? s.winPercentage.toFixed(3) : s.points ?? "—"}
                </td>
                <td style={{ padding: "10px 14px", textAlign: "center", color: "var(--text-muted)", fontSize: "12px" }}>
                  {s.gamesBack != null ? (s.gamesBack === 0 ? "—" : s.gamesBack) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ——— FHE Targets tab ———

function TargetsView({ leagueInfo }: { leagueInfo: LeagueInfo | null }) {
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState(0);

  const rosteredCount = leagueInfo
    ? Object.values(leagueInfo.playerInfo ?? {}).filter((p) => p.status === "T").length
    : 0;
  const teamCount = leagueInfo ? Object.keys(leagueInfo.teamInfo ?? {}).length : 0;

  const filtered = useMemo(() => {
    let rows = DYNASTY_RANKINGS;
    if (tierFilter > 0) rows = rows.filter((p) => p.tier === tierFilter);
    if (search) rows = rows.filter((p) => p.player.toLowerCase().includes(search.toLowerCase()));
    return rows;
  }, [tierFilter, search]);

  const TIER_LABELS = ["", "T1 Elite", "T2 Superstar", "T3 Star", "T4 Starter", "T5 Solid", "T6 Fringe", "T7 Deep", "T8 Stash"];

  return (
    <div style={{ paddingBottom: "40px" }}>
      {/* Context strip */}
      {leagueInfo && (
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-main)",
            borderRadius: "8px",
            padding: "12px 16px",
            marginBottom: "16px",
            fontSize: "13px",
            color: "var(--text-secondary)",
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: "var(--text-primary)" }}>League context: </strong>
          {teamCount} teams · {rosteredCount} players rostered · approx{" "}
          <strong style={{ color: "var(--edge-orange)" }}>
            top {rosteredCount} FHE-ranked players
          </strong>{" "}
          should all be on rosters. Players ranked {rosteredCount + 1}+ are potential trade targets
          and waiver wire adds.
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search player…"
          style={{ ...INPUT_S, maxWidth: "260px", flex: "none", width: "auto" }}
        />
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(Number(e.target.value))}
          style={{
            ...INPUT_S,
            width: "auto",
            paddingRight: "24px",
            cursor: "pointer",
          }}
        >
          <option value={0}>All tiers</option>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((t) => (
            <option key={t} value={t}>
              {TIER_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      {/* Rankings table */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-main)",
          borderRadius: "10px",
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-main)", background: "var(--bg-surface)" }}>
              {["#", "Player", "Team", "Pos", "Age", "Tier", "Avg Rk"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "9px 12px",
                    textAlign: h === "Player" || h === "Team" ? "left" : "center",
                    color: "var(--text-muted)",
                    fontFamily: "'Oswald', sans-serif",
                    fontWeight: 500,
                    fontSize: "11px",
                    letterSpacing: "0.6px",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 300).map((p) => {
              const tierSty = TIER_STYLE[p.tier];
              const isLikelyRostered = leagueInfo && p.consensusRank <= rosteredCount;
              return (
                <tr
                  key={p.player}
                  style={{ borderBottom: "1px solid var(--border-light)", opacity: isLikelyRostered ? 0.55 : 1 }}
                >
                  <td style={{ padding: "8px 12px", textAlign: "center", color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace", fontSize: "12px" }}>
                    {p.consensusRank}
                  </td>
                  <td style={{ padding: "8px 12px", color: "var(--text-primary)", fontWeight: 500, whiteSpace: "nowrap" }}>
                    {p.player}
                    {isLikelyRostered && (
                      <span style={{ marginLeft: "6px", fontSize: "10px", color: "var(--text-muted)" }}>rostered</span>
                    )}
                  </td>
                  <td style={{ padding: "8px 12px", color: "var(--text-secondary)", fontSize: "12px" }}>{p.team}</td>
                  <td style={{ padding: "8px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: "12px" }}>{p.position}</td>
                  <td style={{ padding: "8px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: "12px" }}>
                    {p.age ?? "—"}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "center" }}>
                    {tierSty && (
                      <span
                        style={{
                          background: tierSty[0],
                          color: tierSty[1],
                          fontSize: "10px",
                          fontWeight: 700,
                          fontFamily: "'Oswald', sans-serif",
                          padding: "2px 6px",
                          borderRadius: "3px",
                          letterSpacing: "0.5px",
                        }}
                      >
                        T{p.tier}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: "12px", fontFamily: "'JetBrains Mono', monospace" }}>
                    {p.avgRank.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > 300 && (
          <div style={{ padding: "10px 14px", color: "var(--text-muted)", fontSize: "12px", textAlign: "center", borderTop: "1px solid var(--border-light)" }}>
            Showing 300 of {filtered.length} — use search or tier filter to narrow down
          </div>
        )}
      </div>
    </div>
  );
}

// ——— Draft Order tab ———

function DraftView({
  leagueInfo,
  draftResults,
}: {
  leagueInfo: LeagueInfo | null;
  draftResults: DraftResults | null;
}) {
  if (!draftResults || !leagueInfo) {
    return <Empty message="Draft data loading…" />;
  }

  const teamNameById = new Map(
    Object.values(leagueInfo.teamInfo ?? {}).map((t) => [t.id, t.name])
  );

  const picks = draftResults.draftPicks ?? [];
  const rounds = [...new Set(picks.map((p) => p.round))].sort((a, b) => a - b);
  const totalTeams = draftResults.draftOrder?.length ?? 0;

  return (
    <div style={{ paddingBottom: "40px" }}>
      <div style={{ marginBottom: "16px", fontSize: "13px", color: "var(--text-muted)" }}>
        {draftResults.draftSettings?.draftType?.toUpperCase() ?? "SNAKE"} draft ·{" "}
        {rounds.length} round{rounds.length !== 1 ? "s" : ""} · {totalTeams} teams ·{" "}
        {picks.length} total picks
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "12px", minWidth: "100%" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-main)", background: "var(--bg-surface)" }}>
              <th
                style={{
                  padding: "8px 12px",
                  textAlign: "left",
                  color: "var(--text-muted)",
                  fontFamily: "'Oswald', sans-serif",
                  fontWeight: 500,
                  fontSize: "11px",
                  letterSpacing: "0.6px",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                  position: "sticky",
                  left: 0,
                  background: "var(--bg-surface)",
                }}
              >
                Team
              </th>
              {rounds.map((r) => (
                <th
                  key={r}
                  style={{
                    padding: "8px 12px",
                    textAlign: "center",
                    color: "var(--text-muted)",
                    fontFamily: "'Oswald', sans-serif",
                    fontWeight: 500,
                    fontSize: "11px",
                    letterSpacing: "0.6px",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                  }}
                >
                  Rd {r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(draftResults.draftOrder ?? []).map((teamId, slotIdx) => {
              const name = teamNameById.get(teamId) ?? teamId;
              const teamPicks = picks.filter((p) => p.teamId === teamId);
              return (
                <tr key={teamId} style={{ borderBottom: "1px solid var(--border-light)" }}>
                  <td
                    style={{
                      padding: "9px 12px",
                      color: "var(--text-primary)",
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      position: "sticky",
                      left: 0,
                      background: "var(--bg-card)",
                      borderRight: "1px solid var(--border-light)",
                    }}
                  >
                    <span style={{ color: "var(--text-muted)", fontSize: "11px", marginRight: "6px" }}>
                      {slotIdx + 1}.
                    </span>
                    {name}
                  </td>
                  {rounds.map((r) => {
                    const pick = teamPicks.find((p) => p.round === r);
                    return (
                      <td
                        key={r}
                        style={{
                          padding: "9px 12px",
                          textAlign: "center",
                          color: "var(--text-secondary)",
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        {pick ? `${r}.${String(pick.pickInRound).padStart(2, "0")}` : "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ——— Shared empty state ———

function Empty({ message }: { message: string }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "80px 20px",
        color: "var(--text-muted)",
        fontSize: "14px",
        lineHeight: 1.6,
        maxWidth: 480,
        margin: "0 auto",
      }}
    >
      {message}
    </div>
  );
}
