"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import type { Json, PredictionGame, UserPrediction } from "@/types/supabase";

type TierMeta = { label: string; color: string; bg: string };

/** Postgres error codes the insert can surface through PostgREST. */
const UNIQUE_VIOLATION = "23505"; // duplicate (user_id, game_id) — already submitted
const RLS_VIOLATION = "42501"; // policy rejected — deadline passed or game locked

function parseOptions(game: PredictionGame): string[] {
  if (Array.isArray(game.options) && game.options.length > 0) {
    return game.options.map((o) => String(o));
  }
  return game.question_type === "boolean" ? ["Yes", "No"] : [];
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "Locked";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "< 1m";
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

/** Human-readable echo of a stored prediction_selection payload. */
function describeSelection(selection: Json): string {
  if (selection === null || typeof selection !== "object") return String(selection);
  const obj = selection as Record<string, Json | undefined>;
  if (typeof obj.choice === "string") return obj.choice;
  if (Array.isArray(obj.choices)) return obj.choices.map(String).join(", ");
  if (Array.isArray(obj.ranking)) return obj.ranking.map((r, i) => `${i + 1}. ${String(r)}`).join("  ·  ");
  return JSON.stringify(selection);
}

export function PredictionCard({
  game,
  tierMeta,
  existing,
  onSubmitted,
}: {
  game: PredictionGame;
  tierMeta: TierMeta;
  existing: UserPrediction | null;
  onSubmitted: (prediction: UserPrediction) => void;
}) {
  const { user, supabase } = useAuth();

  // Selection state per answer type
  const options = useMemo(() => parseOptions(game), [game]);
  const [choice, setChoice] = useState<string | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [ranking, setRanking] = useState<string[]>(options);
  const [submitting, setSubmitting] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  // UX countdown off the local clock — display + early disable only.
  // The database clock inside the RLS policy is the actual enforcement;
  // the submit handler below catches the rejection if a skewed local
  // clock lets a late submit through.
  const deadlineMs = useMemo(() => new Date(game.deadline).getTime(), [game.deadline]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const remaining = deadlineMs - now;
  const locallyExpired = remaining <= 0;

  const submitted = existing !== null;
  const disabled = submitted || locallyExpired || submitting;

  const buildSelection = (): Json | null => {
    switch (game.question_type) {
      case "boolean":
      case "single_choice":
        return choice !== null ? { choice } : null;
      case "multi_choice":
        return choices.length > 0 ? { choices } : null;
      case "ranking":
        return ranking.length > 0 ? { ranking } : null;
      default:
        return null;
    }
  };

  const handleSubmit = async () => {
    if (!supabase || !user || disabled) return;
    const selection = buildSelection();
    if (selection === null) {
      setCardError("Make a selection first.");
      return;
    }

    setSubmitting(true);
    setCardError(null);

    const { data, error } = await supabase
      .from("user_predictions")
      .insert({ user_id: user.id, game_id: game.id, prediction_selection: selection })
      .select()
      .single();

    setSubmitting(false);

    if (!error && data) {
      onSubmitted(data);
      return;
    }

    if (error?.code === UNIQUE_VIOLATION) {
      // Another tab/device beat us to it — fetch the existing row and lock.
      const { data: mine } = await supabase
        .from("user_predictions")
        .select("*")
        .eq("user_id", user.id)
        .eq("game_id", game.id)
        .single();
      if (mine) {
        onSubmitted(mine);
        return;
      }
      setCardError("You've already made this call.");
    } else if (error?.code === RLS_VIOLATION || error?.code === "P0001") {
      // Server clock says the window is shut, regardless of what the local
      // countdown believed. Force the locked state.
      setNow(deadlineMs + 1);
      setCardError("This game's deadline has passed — your call wasn't recorded.");
    } else {
      setCardError(error?.message ?? "Submission failed. Please try again.");
    }
  };

  const moveRank = (index: number, dir: -1 | 1) => {
    setRanking((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const toggleChoice = (opt: string) => {
    setChoices((prev) => (prev.includes(opt) ? prev.filter((c) => c !== opt) : [...prev, opt]));
  };

  return (
    <article className="pa-card pa-game-card" style={{ borderLeft: `3px solid ${tierMeta.color}` }}>
      <div className="pa-card-head">
        <span className="pa-chip" style={{ background: tierMeta.bg, color: tierMeta.color }}>
          {tierMeta.label}
        </span>
        <span
          className="pa-deadline"
          style={{ color: locallyExpired ? "var(--red-severe)" : "var(--text-muted)" }}
          title={new Date(game.deadline).toLocaleString()}
        >
          {locallyExpired ? "🔒 Locked" : `⏱ Locks in ${formatRemaining(remaining)}`}
        </span>
      </div>

      <h3 className="pa-card-title">{game.title}</h3>
      {game.description ? <p className="pa-card-blurb">{game.description}</p> : null}

      {submitted ? (
        <div className="pa-submitted" role="status">
          <span className="pa-chip" style={{ background: "var(--tag-live-bg)", color: "var(--tag-live-text)" }}>
            ✓ CALL LOCKED IN
          </span>
          <p className="pa-submitted-echo">{describeSelection(existing.prediction_selection)}</p>
          <p className="pa-reward-detail">
            Submitted {new Date(existing.submitted_at).toLocaleString()} — predictions can&apos;t be changed.
          </p>
        </div>
      ) : (
        <>
          {(game.question_type === "boolean" || game.question_type === "single_choice") && (
            <div className="pa-options" role="radiogroup" aria-label={game.title}>
              {options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  role="radio"
                  aria-checked={choice === opt}
                  className={`pa-option-btn${choice === opt ? " pa-option-active" : ""}`}
                  disabled={disabled}
                  onClick={() => setChoice(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          {game.question_type === "multi_choice" && (
            <div className="pa-options" aria-label={game.title}>
              {options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={choices.includes(opt)}
                  className={`pa-option-btn${choices.includes(opt) ? " pa-option-active" : ""}`}
                  disabled={disabled}
                  onClick={() => toggleChoice(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          {game.question_type === "ranking" && (
            <ol className="pa-ranking" aria-label={`Rank: ${game.title}`}>
              {ranking.map((opt, i) => (
                <li key={opt} className="pa-rank-row">
                  <span className="pa-rank-num">{i + 1}</span>
                  <span className="pa-rank-name">{opt}</span>
                  <span className="pa-rank-controls">
                    <button type="button" aria-label={`Move ${opt} up`} disabled={disabled || i === 0} onClick={() => moveRank(i, -1)}>▲</button>
                    <button type="button" aria-label={`Move ${opt} down`} disabled={disabled || i === ranking.length - 1} onClick={() => moveRank(i, 1)}>▼</button>
                  </span>
                </li>
              ))}
            </ol>
          )}

          <div className="pa-submit-row">
            <button
              type="button"
              className="pa-submit-btn"
              disabled={disabled}
              onClick={() => void handleSubmit()}
            >
              {locallyExpired ? "Locked" : submitting ? "Locking in…" : "Lock in my call"}
            </button>
            {cardError ? <p className="pa-error" role="alert">{cardError}</p> : null}
          </div>
        </>
      )}
    </article>
  );
}
