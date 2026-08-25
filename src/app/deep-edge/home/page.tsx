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
  const [pickValuesBusy, setPickValuesBusy] = useState(false);
  const [pickValuesError, setPickValuesError] = useState("");
  const router = useRouter();

  const hasLeague = Boolean(league);

  // Whether this league is actually using custom values — a real, already-
  // generated ledger is the ground truth (a user can generate one straight
  // from the asset-values page, bypassing this prompt entirely), not just
  // the settings flag the onboarding prompt itself sets on "Yes, customize"
  // (Ash, 2026-08-24: "it is not clear to the user that custom asset values
  // are used" — the status pill below used to be gated on that flag alone,
  // so a league with a real generated ledger but an unanswered prompt showed
  // neither the pill nor an accurate state, just the onboarding question).
  const usingCustomValuations = Boolean(ledgerDoc) || Boolean(league?.settings.useCustomValuations);

  // The standard-league counterpart to usingCustomValuations above — a
  // league that generated ONLY draft-pick values (Ash, 2026-08-25: "a new
  // button on the home screen... for leagues that apply the standard base
  // asset values"), never the full player/FA revaluation. Same ground-truth
  // convention: a real generated doc of that mode wins over the settings
  // flag alone. Mutually exclusive with usingCustomValuations in the UI
  // below — a league already doing full custom valuations has no use for
  // this separate flow, its picks are already priced.
  const isDynastyOrKeeper = league?.settings.leagueType === "dynasty" || league?.settings.leagueType === "keeper";
  const usingGeneratedPickValues = ledgerDoc?.mode === "picksOnly" || Boolean(league?.settings.useGeneratedPickValues);

  // The "would you like to customize the value of your league assets?"
  // onboarding prompt only ever fires for dynasty leagues (redraft/keeper
  // have no long-lived asset ledger worth customizing) and only once per
  // league — customValuationsPromptedAt is set on either answer, never just
  // on "yes" (Ash's own asset-values plan, 2026-08-23). Also suppressed once
  // a ledger already exists, regardless of that flag — asking "would you
  // like to customize?" makes no sense once the league is already doing it.
  const showCustomValuationsPrompt =
    Boolean(league) && league!.settings.leagueType === "dynasty" && !league!.settings.customValuationsPromptedAt && !usingCustomValuations;
  const recommendCustomValuations = league?.settings.salaryFormat === "real" || league?.settings.salaryFormat === "custom";

  useEffect(() => {
    if (!league) {
      setLedgerDoc(null);
      return;
    }
    fetch(`/api/fantrax/custom-valuations?leagueId=${encodeURIComponent(league.leagueId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setLedgerDoc(d.doc ?? null))
      .catch(() => setLedgerDoc(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on the stable leagueId, not the whole league object (which changes identity on every /api/fantrax/saved refresh, e.g. after answering the prompt below) — re-keying on identity would refetch the ledger on every settings save instead of only on an actual league switch.
  }, [league?.leagueId]);

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

  // "Generate draft pick values" — the standard-league counterpart to
  // respondToCustomValuationsPrompt(true) above, but a direct action rather
  // than a yes/no prompt (Ash's own framing was "a new button... to
  // generate," not another onboarding question). Computes the picksOnly
  // ledger immediately, then flips useGeneratedPickValues so Trade Edge
  // starts reading it, mirroring the full-custom flow's own settings write.
  function generatePickValues() {
    if (!league || pickValuesBusy) return;
    setPickValuesBusy(true);
    setPickValuesError("");
    fetch("/api/fantrax/custom-valuations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leagueId: league.leagueId,
        teamId: league.teamId,
        dataset: league.settings.defaultDataset ?? "2027:projection",
        settings: league.settings,
        mode: "picksOnly",
      }),
    })
      .then((r) => r.json())
      .then(async (d) => {
        if (d.error) { setPickValuesError(d.error); return; }
        setLedgerDoc(d.doc ?? null);
        await fetch("/api/fantrax/saved", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leagueId: league.leagueId, leagueName: league.leagueName, teamId: league.teamId, teamName: league.teamName,
            settings: { ...league.settings, useGeneratedPickValues: true },
          }),
        });
        await refresh();
      })
      .catch((err) => setPickValuesError(String(err)))
      .finally(() => setPickValuesBusy(false));
  }

  // "Reset" — clears the cached ledger AND flips the matching settings flag
  // back off, so the league falls back to standard values everywhere and
  // reads as "not generated" again, not as "generated but ignored" (Ash,
  // 2026-08-25: "user can run, reset or run again at any point and user will
  // always know what is active"). `flag` names which opt-in this reset is
  // for — resetting one never touches the other, since a league only ever
  // has one of the two active at a time (see isDynastyOrKeeper block's own
  // doc on why they're mutually exclusive in the UI).
  const [resetBusy, setResetBusy] = useState(false);
  function resetGeneratedValues(flag: "useCustomValuations" | "useGeneratedPickValues") {
    if (!league || resetBusy) return;
    setResetBusy(true);
    fetch(`/api/fantrax/custom-valuations?leagueId=${encodeURIComponent(league.leagueId)}`, { method: "DELETE" })
      .then(() => fetch("/api/fantrax/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId: league.leagueId, leagueName: league.leagueName, teamId: league.teamId, teamName: league.teamName,
          settings: { ...league.settings, [flag]: false },
        }),
      }))
      .then(async () => {
        setLedgerDoc(null);
        await refresh();
      })
      .finally(() => setResetBusy(false));
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

          {usingCustomValuations && (
            <div style={{ marginTop: 18, padding: "14px 18px", borderRadius: 14, background: "var(--rt-surface-soft)", border: "1px solid var(--rt-hairline)", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <span
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700,
                  color: ledgerDoc && !ledgerStale ? "var(--rt-up)" : "var(--rt-down)",
                }}
              >
                ● Custom asset values active
              </span>
              {ledgerDoc ? (
                <span style={{ fontSize: 12.5, color: ledgerStale ? "var(--rt-down)" : "var(--rt-muted)" }}>
                  {ledgerStale && "⚠ May be stale — "}
                  Last refreshed {relativeTime(ledgerDoc.generatedAt)}
                </span>
              ) : (
                <span style={{ fontSize: 12.5, color: "var(--rt-down)" }}>⚠ Not generated yet — this league is still showing standard values</span>
              )}
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <Link
                  href={`/deep-edge/home/trade-edge/asset-values?league=${encodeURIComponent(league.leagueId)}`}
                  style={{
                    height: 32, padding: "0 16px", borderRadius: 100, border: "none",
                    background: "var(--rt-primary)", color: "#fff", fontWeight: 700, fontSize: 12.5,
                    display: "inline-flex", alignItems: "center", textDecoration: "none", whiteSpace: "nowrap",
                  }}
                >
                  {ledgerDoc ? "View & regenerate" : "Generate now"}
                </Link>
                {ledgerDoc && (
                  <button
                    type="button"
                    disabled={resetBusy}
                    onClick={() => resetGeneratedValues("useCustomValuations")}
                    style={{
                      height: 32, padding: "0 16px", borderRadius: 100, border: "1px solid var(--rt-hairline)",
                      background: "transparent", color: "var(--rt-down)", fontWeight: 700, fontSize: 12.5,
                      cursor: resetBusy ? "default" : "pointer", whiteSpace: "nowrap",
                    }}
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Standard-league counterpart to the custom-valuations block
              above — draft-pick values alone, real dynasty-consensus (or
              real-salary) rank per current-year slot, for a dynasty/keeper
              league that hasn't opted into full custom asset valuations
              (Ash, 2026-08-25: "a new button on the home screen... to
              generate the value of draft pick assets for dynasty and keeper
              leagues... used for leagues that apply the standard base asset
              values"). Hidden once a league IS doing full custom
              valuations — its picks are already priced there, this would
              just be a redundant second control. */}
          {isDynastyOrKeeper && !usingCustomValuations && (
            <div style={{ marginTop: 18, padding: "14px 18px", borderRadius: 14, background: "var(--rt-surface-soft)", border: "1px solid var(--rt-hairline)", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              {usingGeneratedPickValues ? (
                <>
                  <span
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700,
                      color: ledgerDoc && !ledgerStale ? "var(--rt-up)" : "var(--rt-down)",
                    }}
                  >
                    ● Generated draft pick values active
                  </span>
                  {ledgerDoc ? (
                    <span style={{ fontSize: 12.5, color: ledgerStale ? "var(--rt-down)" : "var(--rt-muted)" }}>
                      {ledgerStale && "⚠ May be stale — "}
                      Last refreshed {relativeTime(ledgerDoc.generatedAt)}
                    </span>
                  ) : (
                    <span style={{ fontSize: 12.5, color: "var(--rt-down)" }}>⚠ Not generated yet</span>
                  )}
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <Link
                      href={`/deep-edge/home/trade-edge/asset-values?league=${encodeURIComponent(league.leagueId)}`}
                      style={{
                        height: 32, padding: "0 16px", borderRadius: 100, border: "none",
                        background: "var(--rt-primary)", color: "#fff", fontWeight: 700, fontSize: 12.5,
                        display: "inline-flex", alignItems: "center", textDecoration: "none", whiteSpace: "nowrap",
                      }}
                    >
                      {ledgerDoc ? "View & regenerate" : "Generate now"}
                    </Link>
                    {ledgerDoc && (
                      <button
                        type="button"
                        disabled={resetBusy}
                        onClick={() => resetGeneratedValues("useGeneratedPickValues")}
                        style={{
                          height: 32, padding: "0 16px", borderRadius: 100, border: "1px solid var(--rt-hairline)",
                          background: "transparent", color: "var(--rt-down)", fontWeight: 700, fontSize: 12.5,
                          cursor: resetBusy ? "default" : "pointer", whiteSpace: "nowrap",
                        }}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 12.5, color: "var(--rt-muted)" }}>
                    Price every draft pick individually — real dynasty consensus at each current-year slot — instead
                    of the generic bracket estimate. Players stay on standard values.
                  </span>
                  <button
                    type="button"
                    disabled={pickValuesBusy}
                    onClick={generatePickValues}
                    style={{
                      marginLeft: "auto", height: 32, padding: "0 16px", borderRadius: 100, border: "none",
                      background: "var(--rt-primary)", color: "#fff", fontWeight: 700, fontSize: 12.5,
                      cursor: pickValuesBusy ? "default" : "pointer", whiteSpace: "nowrap",
                    }}
                  >
                    {pickValuesBusy ? "Generating…" : "Generate draft pick values"}
                  </button>
                </>
              )}
              {pickValuesError && <p style={{ width: "100%", margin: 0, fontSize: 12, color: "var(--rt-down)" }}>{pickValuesError}</p>}
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
