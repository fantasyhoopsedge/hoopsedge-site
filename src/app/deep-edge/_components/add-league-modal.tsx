"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchUserLeagues, type FxLeagueSummary } from "@/lib/fantrax/api";
import { DEFAULT_ADVANCED_SETTINGS, DEFAULT_GAMES_CAP_SETTINGS, DEFAULT_LEAGUE_TAGS } from "@/lib/fantrax/league-tags";
import { FANTRAX_DATASETS, type FantraxDatasetKey } from "@/lib/fantrax/league";
import type { LeagueAnalysis } from "@/lib/fantrax/analyze";
import type { SavedLeague } from "@/lib/fantrax/store";
import { readFantraxSession } from "../_lib/fantrax-session";
import { Modal } from "./modal";
import { IconClose } from "./icons";

/**
 * Opened from the Home hub's "+ Add a league" CTA. Two states: no platform
 * connected yet (send back to Providers), or a connected platform's league
 * list to import from. Enforces the one-free-league rule client-side (no
 * server-side entitlement exists yet — that's the whole payment workstream)
 * per Ash's freemium spec: the first league is free with full access; a
 * second import attempt shows the season-pass placeholder instead of calling
 * the import endpoint.
 */
export function AddLeagueModal({
  savedLeagues,
  onClose,
  onImported,
}: {
  savedLeagues: SavedLeague[];
  onClose: () => void;
  onImported: () => void;
}) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [leagues, setLeagues] = useState<FxLeagueSummary[] | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showPaywall, setShowPaywall] = useState(false);

  useEffect(() => {
    const session = readFantraxSession();
    setConnected(session.connected);
    if (!session.connected) return;
    fetchUserLeagues(session.secretId)
      .then(setLeagues)
      .catch((err) => setError((err as Error).message));
  }, []);

  async function importLeague(entry: FxLeagueSummary) {
    if (savedLeagues.length >= 1) {
      setShowPaywall(true);
      return;
    }
    setImporting(entry.leagueId);
    setError("");
    try {
      const dataset: FantraxDatasetKey = FANTRAX_DATASETS[0].key;
      const params = new URLSearchParams({ leagueId: entry.leagueId, teamId: entry.teamId, dataset, leagueType: DEFAULT_LEAGUE_TAGS.leagueType });
      const res = await fetch(`/api/fantrax/league?${params}`);
      const analysis: LeagueAnalysis = await res.json();
      if (!res.ok) throw new Error((analysis as unknown as { error?: string }).error ?? `Request failed (${res.status})`);

      const { league } = analysis;
      const saveRes = await fetch("/api/fantrax/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId: league.leagueId,
          leagueName: league.name,
          teamId: entry.teamId,
          teamName: entry.teamName,
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
            ...DEFAULT_LEAGUE_TAGS,
            // Best-guess auto-population from what Fantrax actually told us —
            // the Settings screen's "N fields need a quick confirm" count is
            // exactly the fields that CAN'T be inferred this way (salary cap
            // total, max contract length): see store.ts's SavedLeagueSettings.
            salaryFormat: league.hasSalaries ? "real" : DEFAULT_LEAGUE_TAGS.salaryFormat,
            scoredCategoriesOverride: league.categories.scored,
            positionSlotsOverride: league.positionSlots,
            ...DEFAULT_GAMES_CAP_SETTINGS,
            ...DEFAULT_ADVANCED_SETTINGS,
          },
        }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData.error ?? "Save failed");
      onImported();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(null);
    }
  }

  return (
    <Modal onClose={onClose} width={480}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, margin: 0 }}>Add a league</h2>
        <button
          type="button"
          onClick={onClose}
          style={{ background: "none", border: "none", color: "var(--rt-muted)", cursor: "pointer", padding: 4 }}
        >
          <IconClose size={16} />
        </button>
      </div>

      {showPaywall ? (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <p style={{ fontSize: 14.5, color: "var(--rt-body)", lineHeight: 1.5, margin: "0 0 20px" }}>
            Your first league is free with full access to every Deep Edge tool. Connecting a second league needs a
            season pass — pricing coming soon.
          </p>
          <button
            type="button"
            onClick={() => setShowPaywall(false)}
            style={{
              height: 40, padding: "0 20px", borderRadius: 100, border: "1px solid var(--rt-hairline)",
              background: "transparent", color: "var(--rt-ink)", fontWeight: 600, fontSize: 13.5, cursor: "pointer",
            }}
          >
            Back
          </button>
        </div>
      ) : !connected ? (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <p style={{ fontSize: 14.5, color: "var(--rt-body)", lineHeight: 1.5, margin: "0 0 20px" }}>
            No platform is connected yet. Connect one to import a real league and self-render its settings.
          </p>
          <button
            type="button"
            onClick={() => router.push("/deep-edge/providers")}
            style={{
              height: 40, padding: "0 20px", borderRadius: 100, border: "none",
              background: "var(--rt-primary)", color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer",
            }}
          >
            Connect a platform
          </button>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 13.5, color: "var(--rt-body)", margin: "0 0 16px" }}>
            Leagues found on your connected platforms. Import to self-render settings.
          </p>
          {error && <p style={{ color: "var(--rt-down)", fontSize: 13, marginBottom: 12 }}>{error}</p>}
          {leagues === null ? (
            <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>Loading your leagues…</p>
          ) : leagues.length === 0 ? (
            <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>No NBA leagues found on this Fantrax account.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 10.5, letterSpacing: "0.06em", color: "var(--rt-muted)" }}>
                FANTRAX
              </div>
              {leagues.map((l) => (
                <div
                  key={l.leagueId}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                    padding: "12px 14px", borderRadius: 12, border: "1px solid var(--rt-hairline)",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{l.leagueName}</div>
                    <div style={{ fontSize: 12, color: "var(--rt-muted)" }}>{l.teamName}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => importLeague(l)}
                    disabled={importing !== null}
                    style={{
                      height: 34, padding: "0 16px", borderRadius: 100, border: "none",
                      background: "var(--rt-primary)", color: "#fff", fontWeight: 700, fontSize: 12.5,
                      cursor: importing ? "default" : "pointer", flexShrink: 0,
                      opacity: importing && importing !== l.leagueId ? 0.5 : 1,
                    }}
                  >
                    {importing === l.leagueId ? "Importing…" : "Import"}
                  </button>
                </div>
              ))}
            </div>
          )}
          <p style={{ marginTop: 16, fontSize: 12, color: "var(--rt-muted)" }}>
            + Connect Yahoo, ESPN or Sleeper to import more.
          </p>
        </>
      )}
    </Modal>
  );
}
