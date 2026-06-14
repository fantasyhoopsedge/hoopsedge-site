"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import type { ProspectLite } from "@/lib/prospects";
import type {
  DnGame,
  DnMiniGame,
  DnMiniGameKey,
  DnPrediction,
  DnLeaderboardRow,
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
const UNIQUE_VIOLATION = "23505";
const RLS_VIOLATION = "42501";

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
      return true; // any subset (incl. fading all) is a valid entry
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
    // loadHeld() guards SSR (returns {} when window is undefined); on the client
    // this hydrates picks saved before an OAuth redirect.
    return { ...base, ...loadHeld() };
  });
  const [activeKey, setActiveKey] = useState<DnMiniGameKey | null>(null);
  const [submitted, setSubmitted] = useState<Record<string, DnPrediction>>({});
  const [leaderboard, setLeaderboard] = useState<DnLeaderboardRow[]>([]);
  const [busyKey, setBusyKey] = useState<DnMiniGameKey | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);

  const minisByKey = useMemo(() => {
    const m: Partial<Record<DnMiniGameKey, DnMiniGame>> = {};
    for (const mg of minis) m[mg.key] = mg;
    return m;
  }, [minis]);

  // Clock in state via a lazy initializer (calling Date.now() in the render body
  // is impure); the interval updates it. The DB clock in the RLS policy is the
  // actual lock enforcement — this only drives the UI.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const isResolved = game?.status === "resolved";
  const isLive =
    game?.status === "live" && now < new Date(game.lock_at).getTime();

  const updateHeld = useCallback((key: DnMiniGameKey, payload: string[]) => {
    setHeld((prev) => ({ ...prev, [key]: payload }));
    saveHeldKey(key, payload);
  }, []);

  // Persist one mini-game to the DB (the actual gate-at-submit write).
  const submitMini = useCallback(
    async (key: DnMiniGameKey, payload: string[]): Promise<boolean> => {
      const mini = minisByKey[key];
      if (!supabase || !user || !mini) return false;

      const { data, error } = await supabase
        .from("dn_predictions")
        .insert({ user_id: user.id, mini_game_id: mini.id, payload, locked: true })
        .select()
        .single();

      if (!error && data) {
        setSubmitted((prev) => ({ ...prev, [mini.id]: data }));
        removeHeldKey(key);
        return true;
      }
      if (error?.code === UNIQUE_VIOLATION) {
        // Already submitted elsewhere — adopt the stored row.
        const { data: mine } = await supabase
          .from("dn_predictions")
          .select("*")
          .eq("user_id", user.id)
          .eq("mini_game_id", mini.id)
          .single();
        if (mine) {
          setSubmitted((prev) => ({ ...prev, [mini.id]: mine }));
          removeHeldKey(key);
          return true;
        }
      } else if (error?.code === RLS_VIOLATION || error?.code === "P0001") {
        setPanelError("Picks are locked — the draft has started.");
      } else if (error) {
        setPanelError(error.message);
      }
      return false;
    },
    [supabase, user, minisByKey],
  );

  // Fetch the signed-in user's existing predictions, then flush any pending
  // gate-at-submit picks captured before sign-in (handoff §6.4 — no loss).
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

      // Flush pending submits captured pre-auth.
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

    return () => {
      cancelled = true;
    };
  }, [supabase, user, minis, submitMini]);

  // Leaderboard (public) once the game is resolved.
  useEffect(() => {
    if (!supabase || !game || !isResolved) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("dn_leaderboard")
        .select("*")
        .eq("game_id", game.id)
        .order("rank", { ascending: true });
      if (!cancelled) setLeaderboard(data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, game, isResolved]);

  const onLock = useCallback(
    async (key: DnMiniGameKey) => {
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
        addPending(key); // flushed on return from auth (see the predictions effect)
        setActiveKey(null);
        openSignUp(NEXT_PATH); // shared modal: Google + email/password
        return;
      }

      setBusyKey(key);
      await submitMini(key, payload);
      setBusyKey(null);
      setActiveKey(null);
    },
    [held, user, minisByKey, submitMini, openSignUp],
  );

  const displayName =
    profile?.username ?? user?.user_metadata?.full_name ?? "Analyst";

  // ── Render branches ────────────────────────────────────────────────────────
  if (!game) {
    return (
      <div className="dn-wrap">
        <span className="dn-eyebrow">FHE DRAFT NIGHT CHALLENGE</span>
        <h1 className="dn-h1">Coming soon</h1>
        <p className="dn-lede">
          The Draft Night Challenge isn&apos;t live yet. Check back before the first round.
        </p>
        <style>{dnStyles}</style>
      </div>
    );
  }

  if (isResolved) {
    return (
      <div className="dn-wrap">
        {user ? (
          <ResultsView
            minis={minis}
            predictions={submitted}
            leaderboard={leaderboard}
            userId={user.id}
            displayName={displayName}
          />
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
              {leaderboard.length === 0 ? <li className="dn-lb-empty">Scores posting soon…</li> : null}
            </ol>
          </div>
        )}
        <style>{dnStyles}</style>
        {result ? null /* official picks already drive scores server-side */ : null}
      </div>
    );
  }

  // Live / locked play UI
  const sorted = [...minis].sort((a, b) => a.sort - b.sort);

  return (
    <div className="dn-wrap">
      <span className="dn-eyebrow">FHE DRAFT NIGHT CHALLENGE</span>
      <h1 className="dn-h1">
        Call the draft. <span style={{ color: "var(--edge-orange)" }}>Prove you saw it coming.</span>
      </h1>
      <p className="dn-lede">
        Four fast mini-games. Play free, lock your picks, and climb one combined leaderboard.
        {isLive ? null : " Picks are locked — results post after the draft."}
      </p>

      <div className="dn-card-grid">
        {sorted.map((mini) => {
          const meta = MINI_META[mini.key];
          const done = submitted[mini.id] != null;
          const marquee = mini.key === "mock_lottery";
          return (
            <button
              type="button"
              key={mini.id}
              className={`dn-card${marquee ? " dn-card-marquee" : ""}${done ? " dn-card-done" : ""}`}
              style={{ borderTop: `3px solid ${meta.accent}` }}
              onClick={() => {
                setPanelError(null);
                setActiveKey(activeKey === mini.key ? null : mini.key);
              }}
            >
              <span className="dn-card-head">
                <span className="dn-chip" style={{ color: meta.accent }}>{meta.short.toUpperCase()}</span>
                <span className="dn-card-icon" aria-hidden>{meta.icon}</span>
              </span>
              <span className="dn-card-title">{meta.title}</span>
              <span className="dn-card-blurb">{meta.blurb}</span>
              <span className="dn-card-foot">
                {done ? "✓ LOCKED IN" : isLive ? "Tap to play →" : "🔒 Locked"}
              </span>
            </button>
          );
        })}
      </div>

      {activeKey ? (
        <ActivePanel
          mini={minisByKey[activeKey]!}
          prospects={prospects}
          value={held[activeKey] ?? []}
          onChange={(v) => updateHeld(activeKey, v)}
          submitted={
            Object.values(submitted).find((p) => p.mini_game_id === minisByKey[activeKey]!.id) ?? null
          }
          locked={!isLive}
          busy={busyKey === activeKey}
          error={panelError}
          onLock={() => void onLock(activeKey)}
          onClose={() => setActiveKey(null)}
        />
      ) : null}

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
  onClose: () => void;
}) {
  const meta = MINI_META[mini.key];
  const disabled = locked || submitted != null || busy;

  return (
    <section className="dn-panel" style={{ borderTop: `3px solid ${meta.accent}` }} aria-label={meta.title}>
      <div className="dn-panel-head">
        <h2 className="dn-panel-title">{meta.icon} {meta.title}</h2>
        <button type="button" className="dn-panel-close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      {submitted ? (
        <p className="dn-locked-note">✓ Locked in. Results post after the draft — no take-backs.</p>
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

      {!submitted ? (
        <div className="dn-lock-row">
          <button type="button" className="dn-lock-btn" disabled={disabled} onClick={onLock}>
            {locked ? "Locked" : busy ? "Locking in…" : "Lock these picks"}
          </button>
          {error ? <p className="dn-error" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

