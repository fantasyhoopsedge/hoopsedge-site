"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { DEFAULT_LEAGUE_TAGS } from "@/lib/fantrax/league-tags";
import { HubShell } from "../_components/hub-shell";
import { GoDeepGrid } from "../_components/go-deep-grid";
import { AddLeagueModal } from "../_components/add-league-modal";
import { useActiveLeague } from "../_lib/use-saved-leagues";

function HomeHubContent() {
  // Shows only the currently-active league's card (matches the sidebar's
  // dropdown switcher) — with 15+ leagues connected, stacking every one's
  // full card here was the actual bug report, not a design choice.
  const { leagues, saved: league, loading, refresh } = useActiveLeague();
  const [showAddLeague, setShowAddLeague] = useState(false);

  const hasLeague = Boolean(league);

  return (
    <HubShell
      hasLeague={hasLeague}
      breadcrumb={
        leagues.length > 1
          ? `${leagues.length} leagues connected`
          : league
            ? `${league.leagueName} · ${league.settings.teamCount} teams`
            : "The Deep Edge"
      }
    >
      <h1 style={{ fontSize: 30, fontWeight: 700, margin: "0 0 6px" }}>Welcome to the deep edge.</h1>
      <p style={{ color: "var(--rt-muted)", fontSize: 14.5, margin: "0 0 28px" }}>
        This is home base. Add a league, then go deep on it.
      </p>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h2 style={{ fontFamily: "var(--rt-font-mono)", fontSize: 11.5, letterSpacing: "0.06em", color: "var(--rt-muted)", margin: 0 }}>
          YOUR LEAGUES
        </h2>
        <button
          type="button"
          onClick={() => setShowAddLeague(true)}
          style={{
            height: 32, padding: "0 14px", borderRadius: 100, border: "1px solid var(--rt-hairline)",
            background: "transparent", color: "var(--rt-ink)", fontWeight: 600, fontSize: 12.5, cursor: "pointer",
          }}
        >
          + Add a league
        </button>
      </div>

      {loading ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>Loading…</p>
      ) : league ? (
        <div style={{ padding: 22, borderRadius: 24, border: "1px solid var(--rt-hairline)", marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <span
              style={{
                width: 32, height: 32, borderRadius: 8, background: "#0c0d0e", color: "#fff",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontFamily: "var(--rt-font-mono)", fontWeight: 700, fontSize: 13,
              }}
            >
              Fx
            </span>
            <span style={{ fontSize: 17, fontWeight: 700 }}>{league.leagueName}</span>
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600,
                color: "var(--rt-up)",
              }}
            >
              ● Settings imported
            </span>
          </div>
          <p style={{ fontSize: 13, color: "var(--rt-muted)", margin: "0 0 18px" }}>
            {league.settings.teamCount}-team · {(league.settings.salaryFormat ?? DEFAULT_LEAGUE_TAGS.salaryFormat) === "real" ? "real salary" : "non-salary"}{" "}
            {(league.settings.format ?? DEFAULT_LEAGUE_TAGS.format) === "h2h" ? "H2H" : "roto"} · via Fantrax
          </p>
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <Link
              href={`/deep-edge/home/rankings?league=${encodeURIComponent(league.leagueId)}`}
              style={{
                height: 40, padding: "0 20px", borderRadius: 100, background: "var(--rt-primary)", color: "#fff",
                fontWeight: 700, fontSize: 13.5, display: "inline-flex", alignItems: "center", textDecoration: "none",
              }}
            >
              Go deep
            </Link>
            <Link
              href={`/deep-edge/home/settings?league=${encodeURIComponent(league.leagueId)}`}
              style={{
                height: 40, padding: "0 20px", borderRadius: 100, border: "1px solid var(--rt-hairline)",
                color: "var(--rt-ink)", fontWeight: 700, fontSize: 13.5, display: "inline-flex", alignItems: "center",
                textDecoration: "none",
              }}
            >
              Review settings
            </Link>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              `${league.settings.teamCount} teams`,
              `Roto · 9-CAT`,
              `${(league.settings.salaryFormat ?? DEFAULT_LEAGUE_TAGS.salaryFormat) === "real" ? "Real salary" : "No salary"} cap`,
              `${(league.settings.leagueType ?? DEFAULT_LEAGUE_TAGS.leagueType)}`,
              `${league.settings.maxTotalPlayers}-man roster`,
            ].map((fact) => (
              <span
                key={fact}
                style={{
                  padding: "7px 12px", borderRadius: 10, background: "var(--rt-surface-soft)",
                  fontSize: 12, color: "var(--rt-body)",
                }}
              >
                {fact}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ padding: 22, borderRadius: 24, border: "1px dashed var(--rt-hairline)", marginBottom: 32, textAlign: "center", color: "var(--rt-muted)", fontSize: 13.5 }}>
          No league connected yet — add one to unlock every tool below.
        </div>
      )}

      <h2 style={{ fontFamily: "var(--rt-font-mono)", fontSize: 11.5, letterSpacing: "0.06em", color: "var(--rt-muted)", marginBottom: 16 }}>
        GO DEEP
      </h2>
      <GoDeepGrid unlocked={hasLeague} leagueId={league?.leagueId} />

      {showAddLeague && (
        <AddLeagueModal
          savedLeagues={leagues}
          onClose={() => setShowAddLeague(false)}
          onImported={() => {
            setShowAddLeague(false);
            void refresh();
          }}
        />
      )}
    </HubShell>
  );
}

export default function DeepEdgeHomePage() {
  return (
    <Suspense fallback={null}>
      <HomeHubContent />
    </Suspense>
  );
}
