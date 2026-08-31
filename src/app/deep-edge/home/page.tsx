"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DEFAULT_LEAGUE_TAGS } from "@/lib/fantrax/league-tags";
import type { CustomValuationsDoc } from "@/lib/fantrax/custom-valuations-store";
import { HubShell } from "../_components/hub-shell";
import { GoDeepGrid } from "../_components/go-deep-grid";
import { AddLeagueModal } from "../_components/add-league-modal";
import { Modal } from "../_components/modal";
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
  const leagueType = league?.settings.leagueType ?? DEFAULT_LEAGUE_TAGS.leagueType;
  const salaryFormat = league?.settings.salaryFormat ?? DEFAULT_LEAGUE_TAGS.salaryFormat;
  const isCustomSalaryLeague = salaryFormat === "custom";
  const isRedraft = leagueType === "redraft";

  // One unified generator (Ash, 2026-08-25 redesign) — a single "generate
  // asset values" action per league, dispatching internally to whichever
  // ledger mode is actually right for this league: a custom-salary league
  // gets the FULL ledger (players + FAs + picks, against its own salary/
  // contract rules); every other non-redraft league (standard dynasty,
  // keeper, real-salary) gets the PICKS-ONLY ledger (players stay on
  // standard/real values, only draft picks get individually priced at real
  // dynasty consensus per slot). Redraft has no long-lived asset ledger
  // worth generating at all — no prompt, no button, no reset, ever.
  // `valuationMode` is the single ground-truth read for "has this league's
  // generator been run, and which flavor" — a real generated doc wins over
  // the settings flag alone, same reasoning as the original single-block
  // version (Ash, 2026-08-24: "it is not clear to the user that custom
  // asset values are used").
  const valuationMode: "full" | "picksOnly" | null =
    ledgerDoc?.mode ?? (league?.settings.useCustomValuations ? "full" : league?.settings.useGeneratedPickValues ? "picksOnly" : null);
  const hasGeneratedValues = valuationMode != null;

  // The auto-popup fires once per league — the first time Home loads for a
  // connected, not-yet-prompted, not-yet-valued league, any type except
  // redraft (Ash, 2026-08-25: "auto-popup once per league... for redraft
  // there is no action to take"). customValuationsPromptedAt is set on
  // EITHER answer (yes or no), never just yes, so declining also permanently
  // dismisses it — same "ask once" convention the original dynasty-only
  // prompt used, just widened to every non-redraft league type.
  const showGeneratorPrompt =
    Boolean(league) && !isRedraft && !league!.settings.customValuationsPromptedAt && !hasGeneratedValues;
  // The same modal reopens manually from the persistent "Assets not valued"
  // card's own button once the auto-popup has already been dismissed once
  // (customValuationsPromptedAt set) — a declined league still needs a way
  // back into the generator without waiting for a fresh league connect.
  const [manualGeneratorOpen, setManualGeneratorOpen] = useState(false);
  const generatorModalOpen = Boolean(league) && !isRedraft && (showGeneratorPrompt || manualGeneratorOpen);
  // Two-step "are you sure" INSIDE the same popup (Ash: "provide the user
  // with some feedback as he/she clicks yes... are you sure?") — local UI
  // state only, reset whenever the modal itself stops showing.
  const [confirmingGenerate, setConfirmingGenerate] = useState(false);
  useEffect(() => {
    if (!generatorModalOpen) setConfirmingGenerate(false);
  }, [generatorModalOpen]);
  function closeGeneratorModal() {
    setManualGeneratorOpen(false);
    if (showGeneratorPrompt) respondToGeneratorPrompt(false);
  }

  // League-type-aware popup copy (Ash: custom-salary -> "generate custom
  // asset values"; standard dynasty/real-salary -> "run default FHE asset
  // values for that particular league type"; keeper -> "standard dynasty
  // consensus").
  function generatorCopy(): { body: string; areYouSure: string } {
    if (isCustomSalaryLeague) {
      return {
        body: "This is a custom-salary league. Generate custom asset values to price every player, free agent, and draft pick against your league's own salary and contract rules?",
        areYouSure: "You are about to generate custom asset values for this league. Are you sure?",
      };
    }
    if (leagueType === "keeper") {
      return {
        body: "Generate standard dynasty consensus asset values for this keeper league — draft picks priced individually at real dynasty consensus per slot; players stay on standard values.",
        areYouSure: "You are about to generate standard dynasty consensus asset values for this league. Are you sure?",
      };
    }
    const flavor = salaryFormat === "real" ? "real-salary" : "standard dynasty";
    return {
      body: `Run FHE's default ${flavor} asset values for this league — draft picks priced individually at each current-year slot; players stay on standard values.`,
      areYouSure: `You are about to generate default FHE ${flavor} asset values for this league. Are you sure?`,
    };
  }

  // "Which rankings are driving trade value right now" (Ash: "display on
  // the home screen which rankings are driving the trade value") — a custom
  // full ledger always wins; otherwise players price off whichever base the
  // league itself uses (real salary vs. standard consensus dynasty), and
  // redraft leagues have no long-lived basis at all. This intentionally
  // doesn't replicate trade-verdict.ts's keeper-blend-weight threshold — a
  // nuance for the FULL League Rankings page's own basis tabs, not this
  // one-line home-screen summary.
  function drivingBasisLabel(): string {
    if (isRedraft) return "Redraft (FHE projections)";
    if (valuationMode === "full") return "Custom generated";
    return salaryFormat === "real" ? "Real salary" : "Consensus dynasty";
  }

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

  // "Generate draft pick values" — computes the picksOnly ledger immediately,
  // then flips useGeneratedPickValues so Trade Edge starts reading it. The
  // unified generator's "yes" action for every non-custom-salary league type.
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
            settings: { ...league.settings, useGeneratedPickValues: true, customValuationsPromptedAt: new Date().toISOString() },
          }),
        });
        await refresh();
      })
      .catch((err) => setPickValuesError(String(err)))
      .finally(() => setPickValuesBusy(false));
  }

  // Single dispatch point for the popup's "Yes, generate" confirm step
  // (isCustomSalaryLeague -> full ledger, via the existing asset-values
  // page flow so rookie-scale setup isn't skipped; everything else ->
  // picksOnly, generated inline) and for "Not now" / decline (mark
  // customValuationsPromptedAt so the popup never reappears for this
  // league, no generation).
  function respondToGeneratorPrompt(yes: boolean) {
    if (!league || promptBusy) return;
    if (!yes) {
      setPromptBusy(true);
      fetch("/api/fantrax/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId: league.leagueId, leagueName: league.leagueName, teamId: league.teamId, teamName: league.teamName,
          settings: { ...league.settings, customValuationsPromptedAt: new Date().toISOString() },
        }),
      })
        .then(() => refresh())
        .finally(() => setPromptBusy(false));
      return;
    }
    if (isCustomSalaryLeague) {
      setPromptBusy(true);
      fetch("/api/fantrax/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId: league.leagueId, leagueName: league.leagueName, teamId: league.teamId, teamName: league.teamName,
          settings: { ...league.settings, customValuationsPromptedAt: new Date().toISOString(), useCustomValuations: true },
        }),
      })
        .then(async () => {
          await refresh();
          const needsScale = (league.settings.rookieSalaryScale ?? []).length === 0;
          router.push(needsScale
            ? `/deep-edge/home/settings?league=${encodeURIComponent(league.leagueId)}`
            : `/deep-edge/home/trade-edge/asset-values?league=${encodeURIComponent(league.leagueId)}`);
        })
        .finally(() => setPromptBusy(false));
      return;
    }
    generatePickValues();
  }

  // "Reset" — clears the cached ledger AND flips the matching settings flag
  // back off, so the league falls back to standard values everywhere and
  // reads as "not generated" again, not as "generated but ignored" (Ash,
  // 2026-08-25: "user can run, reset or run again at any point and user will
  // always know what is active"). Always shown once valued, but now gated
  // behind its own warning popup first (Ash: "if user clicks reset, launch
  // a pop up to warn that trading will not function properly without the
  // assets valued").
  const [resetBusy, setResetBusy] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  function resetGeneratedValues() {
    if (!league || resetBusy || !valuationMode) return;
    const flag = valuationMode === "full" ? "useCustomValuations" : "useGeneratedPickValues";
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
      .finally(() => {
        setResetBusy(false);
        setConfirmingReset(false);
      });
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
            {/* Live Fantrax data freshness — DISTINCT from "Settings imported"
             *  above (that's this league's saved CONNECTION row; this is the
             *  last time we actually fetched rosters/standings/free agents
             *  from Fantrax itself — fx_league_syncs, written once per real
             *  fetch by league-cache.ts, never on a 60s-cache hit). Null
             *  until any Deep Edge tool page has loaded this league at least
             *  once (Home itself never triggers a Fantrax fetch — see this
             *  page's own header). */}
            {league.lastSyncedAt && (
              <span style={{ fontSize: 12, color: "var(--rt-muted)" }}>
                Synced {relativeTime(league.lastSyncedAt)}
              </span>
            )}
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

          {/* Unified asset-value status — red until the generator has run at
              all (any type except redraft), green once it has, always
              showing which basis is driving real trade value and whether
              draft assets specifically are valued (Ash, 2026-08-25: "mark
              red on the home screen that assets are not valued... display
              which rankings are driving the trade value... display if
              draft assets have been valued"). Redraft leagues get none of
              this — there's no long-lived ledger for them to run. */}
          {!isRedraft && (
            <div style={{ marginTop: 18, padding: "14px 18px", borderRadius: 14, background: "var(--rt-surface-soft)", border: "1px solid var(--rt-hairline)", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              {hasGeneratedValues ? (
                <>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: ledgerStale ? "var(--rt-down)" : "var(--rt-up)" }}>
                    ● Asset values active
                  </span>
                  <span style={{ fontSize: 12.5, color: ledgerStale ? "var(--rt-down)" : "var(--rt-muted)" }}>
                    {ledgerStale && "⚠ May be stale — "}
                    Driving trade value: <strong style={{ color: "var(--rt-ink)" }}>{drivingBasisLabel()}</strong>
                    {" · "}Draft assets valued: <strong style={{ color: "var(--rt-ink)" }}>Yes</strong>
                    {ledgerDoc && ` · Last refreshed ${relativeTime(ledgerDoc.generatedAt)}`}
                  </span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <Link
                      href={`/deep-edge/home/trade-edge/asset-values?league=${encodeURIComponent(league.leagueId)}`}
                      style={{
                        height: 32, padding: "0 16px", borderRadius: 100, border: "none",
                        background: "var(--rt-primary)", color: "#fff", fontWeight: 700, fontSize: 12.5,
                        display: "inline-flex", alignItems: "center", textDecoration: "none", whiteSpace: "nowrap",
                      }}
                    >
                      View & regenerate
                    </Link>
                    <button
                      type="button"
                      disabled={resetBusy}
                      onClick={() => setConfirmingReset(true)}
                      style={{
                        height: 32, padding: "0 16px", borderRadius: 100, border: "1px solid var(--rt-hairline)",
                        background: "transparent", color: "var(--rt-down)", fontWeight: 700, fontSize: 12.5,
                        cursor: resetBusy ? "default" : "pointer", whiteSpace: "nowrap",
                      }}
                    >
                      Reset
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "var(--rt-down)" }}>
                    ● Assets not valued
                  </span>
                  <span style={{ fontSize: 12.5, color: "var(--rt-muted)" }}>
                    Trade value will not work properly until you generate asset values for this league.
                  </span>
                  <button
                    type="button"
                    disabled={pickValuesBusy || promptBusy}
                    onClick={() => setManualGeneratorOpen(true)}
                    style={{
                      marginLeft: "auto", height: 32, padding: "0 16px", borderRadius: 100, border: "none",
                      background: "var(--rt-primary)", color: "#fff", fontWeight: 700, fontSize: 12.5,
                      cursor: pickValuesBusy || promptBusy ? "default" : "pointer", whiteSpace: "nowrap",
                    }}
                  >
                    {pickValuesBusy ? "Generating…" : "Generate asset values"}
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

      {/* Auto-popup — fires once per league, the first time Home loads for a
          connected, not-yet-valued, non-redraft league (Ash: "prompt the
          user to generate league asset trade values with a pop up"), and
          reopens manually from the "Assets not valued" card's own button
          once already dismissed once. Backdrop click and "Not now" both
          route through closeGeneratorModal — a single, predictable dismiss
          path that only writes customValuationsPromptedAt the first time
          (the auto-popup case), not on every manual reopen/cancel. */}
      {league && generatorModalOpen && (
        <Modal onClose={closeGeneratorModal} width={480}>
          {!confirmingGenerate ? (
            <>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 10px" }}>Generate league asset trade values?</h2>
              <p style={{ fontSize: 13, color: "var(--rt-muted)", margin: "0 0 20px" }}>{generatorCopy().body}</p>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setConfirmingGenerate(true)}
                  style={{ height: 36, padding: "0 18px", borderRadius: 100, border: "none", background: "var(--rt-primary)", color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}
                >
                  Yes, generate
                </button>
                <button
                  type="button"
                  disabled={promptBusy}
                  onClick={closeGeneratorModal}
                  style={{ height: 36, padding: "0 18px", borderRadius: 100, border: "1px solid var(--rt-hairline)", background: "transparent", color: "var(--rt-ink)", fontWeight: 600, fontSize: 12.5, cursor: promptBusy ? "default" : "pointer" }}
                >
                  Not now
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 10px" }}>Are you sure?</h2>
              <p style={{ fontSize: 13, color: "var(--rt-muted)", margin: "0 0 20px" }}>{generatorCopy().areYouSure}</p>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  disabled={promptBusy || pickValuesBusy}
                  onClick={() => { setManualGeneratorOpen(false); respondToGeneratorPrompt(true); }}
                  style={{ height: 36, padding: "0 18px", borderRadius: 100, border: "none", background: "var(--rt-primary)", color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: promptBusy || pickValuesBusy ? "default" : "pointer" }}
                >
                  {promptBusy || pickValuesBusy ? "Generating…" : "Confirm — generate now"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingGenerate(false)}
                  style={{ height: 36, padding: "0 18px", borderRadius: 100, border: "1px solid var(--rt-hairline)", background: "transparent", color: "var(--rt-ink)", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* Reset warning — always a confirm step, never a bare action (Ash:
          "if user clicks reset, launch a pop up to warn that trading will
          not function properly without the assets valued"). */}
      {confirmingReset && (
        <Modal onClose={() => setConfirmingReset(false)} width={440}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 10px" }}>Reset asset values?</h2>
          <p style={{ fontSize: 13, color: "var(--rt-muted)", margin: "0 0 20px" }}>
            Trading will not function properly until you generate asset values again for this league.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              disabled={resetBusy}
              onClick={resetGeneratedValues}
              style={{ height: 36, padding: "0 18px", borderRadius: 100, border: "none", background: "var(--rt-down)", color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: resetBusy ? "default" : "pointer" }}
            >
              {resetBusy ? "Resetting…" : "Confirm — reset"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingReset(false)}
              style={{ height: 36, padding: "0 18px", borderRadius: 100, border: "1px solid var(--rt-hairline)", background: "transparent", color: "var(--rt-ink)", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </Modal>
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
