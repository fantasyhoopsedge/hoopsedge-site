"use client";

import { useState, useTransition } from "react";
import { approveGame } from "./actions";

/**
 * Client button that invokes the approveGame Server Action. useTransition gives
 * us a pending state without a full form round-trip; the action itself
 * re-checks authorization server-side.
 */
export function ApproveButton({ gameId }: { gameId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        className="adm-approve"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await approveGame(gameId);
            if (!result.ok) setError(result.error);
            // On success the action revalidates the page and the row drops off.
          })
        }
      >
        {pending ? "Posting…" : "Approve & Post Live"}
      </button>
      {error ? (
        <p className="adm-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
