"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DEFAULT_LEAGUE_TAGS } from "@/lib/fantrax/league-tags";
import type { CustomValuationsDoc } from "@/lib/fantrax/custom-valuations-store";
import { HubShell } from "../_components/hub-shell";
import { GoDeepGrid } from "../_components/go-deep-grid";
import { AddLeagueModal } from "../_components/add-league-modal";
import { useActiveLeague } from "../_lib/use-saved-leagues";
import { CUSTOM_VALUATIONS_STALE_AFTER_MS, relativeTime, useNow } from "../_lib/relative-time";

function HomeHubContent() {
  // Shows only the currently-active league's card (matches the sidebar's
  // dropdown switcher) — with 15+ leagues connected, stacking every one's
  // full card here was the actual bug report, not a design choice.
  const { leagues, saved: league, loading, refresh } = useActiveLeague();
  const [showAddLeague, setShowAddLeague] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);
  const [ledgerDoc, setLedgerDoc] = useState<CustomValuationsDoc | null>(null);
  const router = useRouter();

  const hasLeague = Boolean(league);

  // The "would you like to customize the value of your league assets?"
  // onboarding prompt only ever fires for dynasty leagues (redraft/keeper
  // have no long-lived asset ledger worth customizing) and only once per
  // league — customValuationsPromptedAt is set on either answer, never just
  // on "yes" (Ash's own asset-values plan, 2026-08-23).
  const showCustomValuationsPrompt =
    Boolean(league) && league!.settings.leagueType === "dynasty" && !league!.settings.customValuationsPromptedAt;
  const recommendCustomValuations = league?.settings.salaryFormat === "real" || league?.settings.salaryFormat === "custom";

  useEffect(() => {
    if (!league?.settings.useCustomValuations) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting derived state when the league/toggle this effect depends on changes, not a plain render-time computation (same pattern as trade-edge/page.tsx's resetKey guards)
      setLedgerDoc(null);
      return;
    }
    fetch(`/api/fantrax/custom-valuations?leagueId=${encodeURIComponent(league.leagueId)}`)
      .then((r) => r.json())
      .then((d) => setLedgerDoc(d.doc ?? null))
      .catch(() => setLedgerDoc(null));
  }, [league?.leagueId, league?.settings.useCustomValuations]);

  const now = useNow();
  const ledgerStale = ledgerDoc && now != null ? now - new Date(ledgerDoc.generatedAt).getTime() > CUSTOM_VALUATIONS_STALE_AFTER_MS : false;

  function respondToCustomValuationsPrompt(yes: boolean) {
    if (!league || promptBusy) return;
    setPromptBusy(true);
    fetch("/api/fantrax/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leagueId: league.leagueId, leagueName: league.leagueName, teamId: league.teamId, teamName: league.teamName,
        settings: {
          ...league.settings,
          customValuationsPromptedAt: new Date().toISOString(),
          useCustomValuations: yes ? true : league.settings.useCustomValuations,
        },
      }),
    })
      .then(async () => {
        await refresh();
        if (yes) {
          const needsScale = league.settings.salaryFormat === "custom" && (league.settings.rookieSalaryScale ?? []).length === 0;
          router.push(needsScale
            ? `/deep-edge/home/settings?league=${encodeURIComponent(league.leagueId)}`
            : `/deep-edge/home/trade-edge/asset-values?league=${encodeURIComponent(league.leagueId)}`);
        }
      })
      .finally(() => setPromptBusy(false));
  }

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

          {showCustomValuationsPrompt && (
            <div style={{ marginTop: 18, padding: 16, borderRadius: 14, background: "var(--rt-surface-soft)", border: "1px solid var(--rt-hairline)" }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>Would you like to customize the value of your league assets?</div>
              <p style={{ fontSize: 12.5, color: "var(--rt-muted)", margin: "0 0 12px", maxWidth: 520 }}>
                Revalue every player, free agent, and draft pick against this league&apos;s own rules — real dynasty
                consensus at each pick slot, plus any house contract or rookie-scale rules you set.
                {recommendCustomValuations && " Highly recommended for a salary-cap dynasty league like this one."}
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  disabled={promptBusy}
                  onClick={() => respondToCustomValuationsPrompt(true)}
                  style={{ height: 36, padding: "0 18px", borderRadius: 100, border: "none", background: "var(--rt-primary)", color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: promptBusy ? "default" : "pointer" }}
                >
                  Yes, customize
                </button>
                <button
                  type="button"
                  disabled={promptBusy}
                  onClick={() => respondToCustomValuationsPrompt(false)}
                  style={{ height: 36, padding: "0 18px", borderRadius: 100, border: "1px solid var(--rt-hairline)", background: "transparent", color: "var(--rt-ink)", fontWeight: 600, fontSize: 12.5, cursor: promptBusy ? "default" : "pointer" }}
                >
                  No, use standard values
                </button>
              </div>
            </div>
          )}

          {league.settings.useCustomValuations && (
            <div style={{ marginTop: 18, padding: "10px 16px", borderRadius: 100, background: "var(--rt-surface-soft)", border: "1px solid var(--rt-hairline)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {ledgerDoc ? (
                <span style={{ fontSize: 12, color: ledgerStale ? "var(--rt-down)" : "var(--rt-muted)" }}>
                  {ledgerStale ? "⚠ Custom values may be stale — " : "Custom values · "}
                  generated {relativeTime(ledgerDoc.generatedAt)}
                </span>
              ) : (
                <span style={{ fontSize: 12, color: "var(--rt-muted)" }}>Custom values on — not generated yet</span>
              )}
              <Link
                href={`/deep-edge/home/trade-edge/asset-values?league=${encodeURIComponent(league.leagueId)}`}
                style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--rt-primary)", textDecoration: "none" }}
              >
                Regenerate
              </Link>
            </div>
          )}
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
