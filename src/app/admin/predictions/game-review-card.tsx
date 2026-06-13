"use client";

import { useState, useTransition } from "react";
import type { PredictionGame } from "@/types/database";
import { approveGame, skipGame } from "./actions";

const TIER_LABEL: Record<string, string> = {
  nightly: "TIER 1 · NIGHTLY",
  monthly: "TIER 2 · MONTHLY",
  seasonal: "TIER 3 · SEASONAL",
};

const Q_TYPE_LABEL: Record<string, string> = {
  boolean: "Yes / No",
  single_choice: "Single choice",
  multi_choice: "Multi choice",
  ranking: "Ranking",
};

function toOptions(value: PredictionGame["options"]): string[] {
  return Array.isArray(value) ? value.map((o) => String(o)) : [];
}

/**
 * Editable review card for one agent-proposed game. The boss can rewrite the
 * title/description and add/remove/edit player options, then either Approve &
 * Post Live (persists edits + goes active) or Skip (archives it). All writes go
 * through re-authorized server actions.
 */
export function GameReviewCard({ game }: { game: PredictionGame }) {
  const [title, setTitle] = useState(game.title);
  const [description, setDescription] = useState(game.description ?? "");
  const [options, setOptions] = useState<string[]>(toOptions(game.options));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const setOption = (i: number, v: string) =>
    setOptions((prev) => prev.map((o, j) => (j === i ? v : o)));
  const removeOption = (i: number) =>
    setOptions((prev) => prev.filter((_, j) => j !== i));
  const addOption = () => setOptions((prev) => [...prev, ""]);

  const deadline = new Date(game.deadline);

  const onApprove = () =>
    startTransition(async () => {
      setError(null);
      const r = await approveGame(game.id, { title, description, options });
      if (!r.ok) setError(r.error);
    });

  const onSkip = () =>
    startTransition(async () => {
      setError(null);
      const r = await skipGame(game.id);
      if (!r.ok) setError(r.error);
    });

  return (
    <article className="adm-card">
      <div className="adm-card-head">
        <span className="adm-chip">{TIER_LABEL[game.tier] ?? game.tier.toUpperCase()}</span>
        <span className="adm-qtype">{Q_TYPE_LABEL[game.question_type] ?? game.question_type}</span>
      </div>

      <label className="adm-field-label" htmlFor={`title-${game.id}`}>
        TITLE
      </label>
      <input
        id={`title-${game.id}`}
        className="adm-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={pending}
      />

      <label className="adm-field-label" htmlFor={`desc-${game.id}`}>
        DESCRIPTION (shown to players)
      </label>
      <textarea
        id={`desc-${game.id}`}
        className="adm-textarea"
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={pending}
      />

      <span className="adm-field-label">PLAYER OPTIONS</span>
      <div className="adm-opts">
        {options.map((opt, i) => (
          <div className="adm-opt-row" key={i}>
            <span className="adm-opt-num">{i + 1}</span>
            <input
              className="adm-input"
              value={opt}
              onChange={(e) => setOption(i, e.target.value)}
              disabled={pending}
              aria-label={`Option ${i + 1}`}
            />
            <button
              type="button"
              className="adm-opt-remove"
              onClick={() => removeOption(i)}
              disabled={pending}
              aria-label={`Remove option ${i + 1}`}
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="adm-add" onClick={addOption} disabled={pending}>
          + Add player
        </button>
      </div>

      <div className="adm-meta">
        <span className="adm-meta-label">LOCKS</span>
        <time dateTime={game.deadline}>
          {Number.isNaN(deadline.getTime()) ? game.deadline : deadline.toLocaleString()}
        </time>
      </div>

      <div className="adm-actions">
        <button type="button" className="adm-approve" onClick={onApprove} disabled={pending}>
          {pending ? "Working…" : "Approve & Post Live"}
        </button>
        <button type="button" className="adm-skip" onClick={onSkip} disabled={pending}>
          Skip
        </button>
      </div>
      {error ? (
        <p className="adm-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
