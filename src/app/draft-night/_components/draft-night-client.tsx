"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import type { ProspectLite } from "@/lib/prospects";
import type {
  DnGame,
  DnMiniGame,
  DnMiniGameKey,
  DnPrediction,
  DnLeaderboardRow,
  DnMiniLeaderboardRow,
  DnResult,
} from "@/types/database";
import type {
  DraftedHigherConfig,
  FirstRoundConfig,
  GuardOrderConfig,
  MockLotteryConfig,
} from "@/lib/draftNight/grader";
import { MINI_META } from "./meta";
import { DraftedHigher, FirstRound, GuardOrder, MockLottery } from "./mini-games";
import { ResultsView } from "./results-view";
import { ResolvedHub } from "./resolved-hub";
import { dnStyles } from "./dn-styles";
import {
  addPending,
  clearPending,
  loadHeld,
  loadPending,
  removeHeldKey,
  saveHeldKey,
} from "./storage";

const NEXT_PATH = "/draft-night";
const RLS_VIOLATION = "42501";
const LOCK_DISPLAY = "7:50 PM ET · Mon June 23";

type ProspectMap = Record<string, ProspectLite>;
type Held = Record<string, string[]>;

function defaultPayload(mini: DnMiniGame): string[] {
  if (mini.key === "guard_order") {
    return [...(mini.config as unknown as GuardOrderConfig).pool];
  }
  return [];
}

function isComplete(mini: DnMiniGame, payload: string[]): boolean {
  switch (mini.key) {
    case "drafted_higher": {
      const c = mini.config as unknown as DraftedHigherConfig;
      return payload.length === c.pairs.length && payload.every(Boolean);
    }
    case "mock_lottery":
      return payload.length === (mini.config as unknown as MockLotteryConfig).slots;
    case "guard_order":
      return payload.length === (mini.config as unknown as GuardOrderConfig).pool.length;
    case "first_round":
      return true;
  }
}

function incompleteHint(mini: DnMiniGame, payload: string[]): string {
  switch (mini.key) {
    case "drafted_higher":
      return "Pick a winner in all 5 match-ups.";
    case "mock_lottery":
      return `Fill all ${(mini.config as unknown as MockLotteryConfig).slots} slots (${payload.length} placed).`;
    default:
      return "Finish your picks first.";
  }
}

// ── Rules pane (desktop right col default) ───────────────────────────────────
function RulesPane() {
  return (
    <div className="dn-rules-pane">
      <span className="dn-rules-eyebrow">HOW IT WORKS</span>
      <ol className="dn-rules-list">
        <li>
          <span className="dn-rule-n">1</span>
          <span>Select a game from the left and make your picks.</span>
        </li>
        <li>
          <span className="dn-rule-n">2</span>
          <span>
            Submit and <strong>come back to change your picks</strong> as many times as you like —
            right up until the lock.
          </span>
        </li>
        <li>
          <span className="dn-rule-n">3</span>
          <span>
            All four games score independently on <strong>one combined leaderboard</strong>. The
            higher your accuracy across every game, the higher you rank.
          </span>
        </li>
        <li>
          <span className="dn-rule-n">4</span>
          <span>Results post after the draft. No edits, no take-backs once locked.</span>
        </li>
      </ol>
      <div className="dn-lock-callout">
        <span className="dn-lock-callout-label">🔒 PICKS LOCK</span>
        <span className="dn-lock-callout-time">{LOCK_DISPLAY}</span>
        <span className="dn-lock-callout-note">10 minutes before the NBA Draft begins</span>
      </div>
    </div>
  );
}

// ── Mobile wizard: one game at a time ────────────────────────────────────────
function MobileWizard({
  sorted,
  minisByKey,
  prospects,
  held,
  submitted,
  isLive,
  busyKey,
  panelError,
  setPanelError,
  updateHeld,
  onLockFn,
}: {
  sorted: DnMiniGame[];
  minisByKey: Partial<Record<DnMiniGameKey, DnMiniGame>>;
  prospects: ProspectMap;
  held: Held;
  submitted: Record<string, DnPrediction>;
  isLive: boolean;
  busyKey: DnMiniGameKey | null;
  panelError: string | null;
  setPanelError: (e: string | null) => void;
  updateHeld: (key: DnMiniGameKey, payload: string[]) => void;
  onLockFn: (key: DnMiniGameKey, onSuccess?: () => void) => Promise<void>;
}) {
  const [wizardIdx, setWizardIdx] = useState(0);
  const [justLocked, setJustLocked] = useState(false);
  // Tracks when user has navigated FROM the completion screen to edit a game.
  const [editMode, setEditMode] = useState(false);

  const doneCount = sorted.filter((m) => submitted[m.id] != null).length;
  const allDone = doneCount === sorted.length;
  // Only show the done screen when all locked, no advance button showing, and not editing.
  const showDone = allDone && !justLocked && !editMode;
  const current = sorted[wizardIdx];

  const goTo = (idx: number) => {
    setPanelError(null);
    setJustLocked(false);
    setWizardIdx(idx);
  };

  return (
    <div className="dn-wizard">
      {/* Progress dots */}
      <div className="dn-wiz-dots">
        {sorted.map((m, i) => {
          const done = submitted[m.id] != null;
          const active = i === wizardIdx;
          const meta = MINI_META[m.key];
          return (
            <button
              key={m.id}
              type="button"
              className={`dn-wdot${active ? " dn-wdot--active" : ""}${done ? " dn-wdot--done" : ""}`}
              style={{ borderColor: active || done ? meta.accent : undefined }}
              onClick={() => { if (allDone) setEditMode(true); goTo(i); }}
              aria-label={meta.title}
            >
              {done ? "✓" : meta.icon}
            </button>
          );
        })}
      </div>
      <p className="dn-wiz-meta">
        {doneCount} of {sorted.length} locked
        {isLive ? ` · lock ${LOCK_DISPLAY}` : " · picks locked"}
      </p>

      {showDone ? (
        /* Completion state */
        <div className="dn-wiz-done">
          <div className="dn-wiz-done-trophy">🏆</div>
          <h2 className="dn-wiz-done-h">All picks locked!</h2>
          <p className="dn-wiz-done-sub">
            You can still update any pick before <strong>{LOCK_DISPLAY}</strong>.
          </p>
          <div className="dn-wiz-done-list">
            {sorted.map((m, i) => {
              const meta = MINI_META[m.key];
              return (
                <button
                  key={m.id}
                  type="button"
                  className="dn-wiz-done-row"
                  style={{ borderLeftColor: meta.accent }}
                  onClick={() => { setEditMode(true); goTo(i); }}
                >
                  <span className="dn-wiz-done-name">{meta.icon} {meta.title}</span>
                  <span className="dn-wiz-done-edit">Edit ›</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          <ActivePanel
            mini={current}
            prospects={prospects}
            value={held[current.key] ?? []}
            onChange={(v) => updateHeld(current.key, v)}
            submitted={
              Object.values(submitted).find(
                (p) => p.mini_game_id === minisByKey[current.key]!.id,
              ) ?? null
            }
            locked={!isLive}
            busy={busyKey === current.key}
            error={panelError}
            onLock={() => void onLockFn(current.key, () => setJustLocked(true))}
          />

          {/* Post-lock advance */}
          {justLocked && (
            <div className="dn-wiz-advance">
              {wizardIdx < sorted.length - 1 ? (
                <button
                  type="button"
                  className="dn-wiz-advance-btn"
                  onClick={() => goTo(wizardIdx + 1)}
                >
                  Next: {MINI_META[sorted[wizardIdx + 1].key].icon}{" "}
                  {MINI_META[sorted[wizardIdx + 1].key].title} →
                </button>
              ) : (
                <button
                  type="button"
                  className="dn-wiz-advance-btn dn-wiz-advance-btn--done"
                  onClick={() => { setEditMode(false); setJustLocked(false); }}
                >
                  🎉 All done — view picks
                </button>
              )}
            </div>
          )}

          {/* Back / skip row */}
          <div className="dn-wiz-footer">
            {wizardIdx > 0 ? (
              <button type="button" className="dn-wiz-nav" onClick={() => goTo(wizardIdx - 1)}>
                ← {MINI_META[sorted[wizardIdx - 1].key].title}
              </button>
            ) : (
              <span />
            )}
            {wizardIdx < sorted.length - 1 && !justLocked && (
              <button type="button" className="dn-wiz-nav" onClick={() => goTo(wizardIdx + 1)}>
                Skip →
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function DraftNightClient({
  game,
  minis,
  result,
  prospects,
}: {
  game: DnGame | null;
  minis: DnMiniGame[];
  result: DnResult | null;
  prospects: ProspectMap;
}) {
  const { user, profile, supabase, openSignUp } = useAuth();

  const [held, setHeld] = useState<Held>(() => {
    const base: Held = {};
    for (const m of minis) base[m.key] = defaultPayload(m);
    return { ...base, ...loadHeld() };
  });
  const [activeKey, setActiveKey] = useState<DnMiniGameKey | null>(null);
  const [submitted, setSubmitted] = useState<Record<string, DnPrediction>>({});
  const [leaderboard, setLeaderboard] = useState<DnLeaderboardRow[]>([]);
  const [miniLeaderboard, setMiniLeaderboard] = useState<DnMiniLeaderboardRow[]>([]);
  const [busyKey, setBusyKey] = useState<DnMiniGameKey | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);

  const minisByKey = useMemo(() => {
    const m: Partial<Record<DnMiniGameKey, DnMiniGame>> = {};
    for (const mg of minis) m[mg.key] = mg;
    return m;
  }, [minis]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const isResolved = game?.status === "resolved";
  const isLive = game?.status === "live" && now < new Date(game.lock_at).getTime();

  // On mobile, scroll panel into view when a sidebar card is clicked.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activeKey || !panelRef.current) return;
    if (typeof window !== "undefined" && window.innerWidth <= 820) {
      setTimeout(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    }
  }, [activeKey]);

  const updateHeld = useCallback((key: DnMiniGameKey, payload: string[]) => {
    setHeld((prev) => ({ ...prev, [key]: payload }));
    saveHeldKey(key, payload);
  }, []);

  // Sync submitted payloads back into held so re-opened games show saved picks.
  useEffect(() => {
    if (Object.keys(submitted).length === 0) return;
    setHeld((prev) => {
      const next = { ...prev };
      for (const mini of minis) {
        const pred = submitted[mini.id];
        if (pred) next[mini.key] = pred.payload as string[];
      }
      return next;
    });
  }, [submitted, minis]);

  // UPSERT so players can update picks until lock_at.
  const submitMini = useCallback(
    async (key: DnMiniGameKey, payload: string[]): Promise<boolean> => {
      const mini = minisByKey[key];
      if (!supabase || !user || !mini) return false;

      const { data, error } = await supabase
        .from("dn_predictions")
        .upsert(
          { user_id: user.id, mini_game_id: mini.id, payload, locked: true },
          { onConflict: "user_id,mini_game_id" },
        )
        .select()
        .single();

      if (!error && data) {
        setSubmitted((prev) => ({ ...prev, [mini.id]: data }));
        removeHeldKey(key);
        return true;
      }
      if (error?.code === RLS_VIOLATION || error?.code === "P0001") {
        setPanelError("Picks are locked — the draft has started.");
      } else if (error) {
        setPanelError(error.message);
      }
      return false;
    },
    [supabase, user, minisByKey],
  );

  // Fetch existing predictions + flush pre-auth pending picks on sign-in.
  useEffect(() => {
    if (!supabase || !user || minis.length === 0) return;
    let cancelled = false;

    (async () => {
      const ids = minis.map((m) => m.id);
      const { data } = await supabase
        .from("dn_predictions")
        .select("*")
        .eq("user_id", user.id)
        .in("mini_game_id", ids);
      if (cancelled) return;

      const map: Record<string, DnPrediction> = {};
      for (const row of data ?? []) map[row.mini_game_id] = row;
      setSubmitted(map);

      const pending = loadPending();
      const submittedKeys = new Set(
        (data ?? []).map((r) => minis.find((m) => m.id === r.mini_game_id)?.key),
      );
      const stored = loadHeld();
      for (const key of pending) {
        if (submittedKeys.has(key as DnMiniGameKey)) continue;
        const payload = stored[key];
        const mini = minis.find((m) => m.key === key);
        if (payload && mini && isComplete(mini, payload)) {
          await submitMini(key as DnMiniGameKey, payload);
        }
      }
      clearPending();
    })();

    return () => { cancelled = true; };
  }, [supabase, user, minis, submitMini]);

  // Leaderboards once resolved.
  useEffect(() => {
    if (!supabase || !game || !isResolved) return;
    let cancelled = false;
    (async () => {
      const [{ data: lb }, { data: mlb }] = await Promise.all([
        supabase
          .from("dn_leaderboard")
          .select("*")
          .eq("game_id", game.id)
          .order("rank", { ascending: true }),
        supabase
          .from("dn_mini_leaderboard")
          .select("*")
          .eq("game_id", game.id),
      ]);
      if (!cancelled) {
        setLeaderboard(lb ?? []);
        setMiniLeaderboard((mlb ?? []) as DnMiniLeaderboardRow[]);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, game, isResolved]);

  // onSuccess callback lets MobileWizard advance instead of closing activeKey.
  const onLock = useCallback(
    async (key: DnMiniGameKey, onSuccess?: () => void) => {
      const mini = minisByKey[key];
      if (!mini) return;
      const payload = held[key] ?? [];
      setPanelError(null);

      if (!isComplete(mini, payload)) {
        setPanelError(incompleteHint(mini, payload));
        return;
      }
      saveHeldKey(key, payload);

      if (!user) {
        addPending(key);
        setActiveKey(null);
        openSignUp(NEXT_PATH);
        return;
      }

      setBusyKey(key);
      const ok = await submitMini(key, payload);
      setBusyKey(null);
      if (ok) {
        if (onSuccess) onSuccess();
        else setActiveKey(null);
      }
    },
    [held, user, minisByKey, submitMini, openSignUp],
  );

  const displayName = profile?.username ?? user?.user_metadata?.full_name ?? "Analyst";

  // ── Render branches ────────────────────────────────────────────────────────
  if (!game) {
    return (
      <div className="dn-wrap">
        <span className="dn-eyebrow">FHE DRAFT NIGHT CHALLENGE</span>
        <h1 className="dn-h1">Coming soon</h1>
        <p className="dn-lede">The Draft Night Challenge isn&apos;t live yet. Check back before the first round.</p>
        <style>{dnStyles}</style>
      </div>
    );
  }

  if (isResolved) {
    return (
      <div className="dn-wrap">
        {user ? (
          showResults ? (
            <>
              <button
                type="button"
                className="dn-back-btn"
                onClick={() => setShowResults(false)}
              >
                ← Back to overview
              </button>
              <ResultsView
                minis={minis}
                predictions={submitted}
                leaderboard={leaderboard}
                miniLeaderboard={miniLeaderboard}
                userId={user.id}
                displayName={displayName}
              />
            </>
          ) : (
            <ResolvedHub
              minis={minis}
              predictions={submitted}
              leaderboard={leaderboard}
              miniLeaderboard={miniLeaderboard}
              userId={user.id}
              displayName={displayName}
              onViewResults={() => setShowResults(true)}
            />
          )
        ) : (
          <div className="dn-results">
            <span className="dn-eyebrow">RESULTS ARE IN</span>
            <h1 className="dn-h1">The draft is graded</h1>
            <p className="dn-lede">Sign in to see your Draft Night Score and your &quot;Called It&quot; card.</p>
            <button type="button" className="dn-google-btn" onClick={() => openSignUp(NEXT_PATH)}>
              Sign in to see your score
            </button>
            <h2 className="dn-section-h">Leaderboard</h2>
            <ol className="dn-leaderboard">
              {leaderboard.slice(0, 25).map((row) => (
                <li className="dn-lb-row" key={row.user_id}>
                  <span className="dn-lb-rank">{row.rank}</span>
                  <span className="dn-lb-name">{row.username ?? "Analyst"}</span>
                  <span className="dn-lb-score">{row.score.toLocaleString()}</span>
                </li>
              ))}
              {leaderboard.length === 0 && <li className="dn-lb-empty">Scores posting soon…</li>}
            </ol>
          </div>
        )}
        <style>{dnStyles}</style>
      </div>
    );
  }

  // ── Live / accepting picks ─────────────────────────────────────────────────
  const sorted = [...minis].sort((a, b) => a.sort - b.sort);

  return (
    <div className="dn-wrap">
      <span className="dn-eyebrow">FHE DRAFT NIGHT CHALLENGE</span>
      <h1 className="dn-h1">
        Call the draft.{" "}
        <span style={{ color: "var(--edge-orange)" }}>Prove you saw it coming.</span>
      </h1>
      <p className="dn-lede">
        {isLive
          ? "Four mini-games. Make your picks, change them any time, then lock in before the draft."
          : "Picks are locked — results post after the draft."}
      </p>

      {/* ── Desktop: sidebar + panel ── */}
      <div className="dn-shell">
        <div className="dn-sidebar">
          {sorted.map((mini) => {
            const meta = MINI_META[mini.key];
            const done = submitted[mini.id] != null;
            const isActive = activeKey === mini.key;
            return (
              <button
                type="button"
                key={mini.id}
                className={`dn-scard${isActive ? " dn-scard--active" : ""}${done ? " dn-scard--done" : ""}`}
                style={{ borderLeftColor: meta.accent }}
                onClick={() => {
                  setPanelError(null);
                  setActiveKey(isActive ? null : mini.key);
                }}
              >
                <span className="dn-scard-icon" aria-hidden>{meta.icon}</span>
                <span className="dn-scard-body">
                  <span className="dn-scard-title">{meta.title}</span>
                  <span className="dn-scard-sub">{meta.short} · {meta.ceiling}</span>
                </span>
                <span
                  className="dn-scard-status"
                  style={{ color: done ? "var(--green-elite)" : isLive ? meta.accent : "var(--text-muted)" }}
                >
                  {done ? "✓" : isLive ? "›" : "🔒"}
                </span>
              </button>
            );
          })}
        </div>

        <div className="dn-panel-col" ref={panelRef}>
          {activeKey ? (
            <ActivePanel
              mini={minisByKey[activeKey]!}
              prospects={prospects}
              value={held[activeKey] ?? []}
              onChange={(v) => updateHeld(activeKey, v)}
              submitted={
                Object.values(submitted).find(
                  (p) => p.mini_game_id === minisByKey[activeKey]!.id,
                ) ?? null
              }
              locked={!isLive}
              busy={busyKey === activeKey}
              error={panelError}
              onLock={() => void onLock(activeKey)}
              onClose={() => setActiveKey(null)}
            />
          ) : (
            <RulesPane />
          )}
        </div>
      </div>

      {/* ── Mobile: wizard ── */}
      <MobileWizard
        sorted={sorted}
        minisByKey={minisByKey}
        prospects={prospects}
        held={held}
        submitted={submitted}
        isLive={isLive}
        busyKey={busyKey}
        panelError={panelError}
        setPanelError={setPanelError}
        updateHeld={updateHeld}
        onLockFn={onLock}
      />

      <style>{dnStyles}</style>
    </div>
  );
}

// ── Active mini-game panel ────────────────────────────────────────────────────
function ActivePanel({
  mini,
  prospects,
  value,
  onChange,
  submitted,
  locked,
  busy,
  error,
  onLock,
  onClose,
}: {
  mini: DnMiniGame;
  prospects: ProspectMap;
  value: string[];
  onChange: (v: string[]) => void;
  submitted: DnPrediction | null;
  locked: boolean;
  busy: boolean;
  error: string | null;
  onLock: () => void;
  onClose?: () => void;
}) {
  const meta = MINI_META[mini.key];
  const disabled = locked || busy;

  return (
    <section className="dn-panel" style={{ borderTop: `3px solid ${meta.accent}` }} aria-label={meta.title}>
      <div className="dn-panel-head">
        <h2 className="dn-panel-title">{meta.icon} {meta.title}</h2>
        {onClose && (
          <button type="button" className="dn-panel-close" onClick={onClose} aria-label="Close">✕</button>
        )}
      </div>

      {submitted && !locked ? (
        <p className="dn-edit-note">✓ Saved — update below any time before {LOCK_DISPLAY}.</p>
      ) : submitted && locked ? (
        <p className="dn-locked-note">✓ Locked in. Results post after the draft.</p>
      ) : (
        <p className="dn-panel-blurb">{meta.blurb} · ceiling {meta.ceiling}</p>
      )}

      {mini.key === "drafted_higher" && (
        <DraftedHigher config={mini.config as unknown as DraftedHigherConfig} prospects={prospects} value={value} onChange={onChange} disabled={disabled} />
      )}
      {mini.key === "first_round" && (
        <FirstRound config={mini.config as unknown as FirstRoundConfig} prospects={prospects} value={value} onChange={onChange} disabled={disabled} />
      )}
      {mini.key === "guard_order" && (
        <GuardOrder config={mini.config as unknown as GuardOrderConfig} prospects={prospects} value={value} onChange={onChange} disabled={disabled} />
      )}
      {mini.key === "mock_lottery" && (
        <MockLottery config={mini.config as unknown as MockLotteryConfig} prospects={prospects} value={value} onChange={onChange} disabled={disabled} />
      )}

      {!locked && (
        <div className="dn-lock-row">
          <button type="button" className="dn-lock-btn" disabled={busy} onClick={onLock}>
            {busy ? "Saving…" : submitted ? "Update picks" : "Lock these picks"}
          </button>
          {error && <p className="dn-error" role="alert">{error}</p>}
        </div>
      )}
    </section>
  );
}
