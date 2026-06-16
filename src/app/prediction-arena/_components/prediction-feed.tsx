"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import type { PredictionGame, UserPrediction } from "@/types/supabase";
import { PredictionCard } from "./prediction-card";

const TIER_ORDER: Record<PredictionGame["tier"], number> = {
  nightly: 0,
  monthly: 1,
  seasonal: 2,
};

const TIER_META: Record<PredictionGame["tier"], { label: string; color: string; bg: string }> = {
  nightly: { label: "TIER 1 · NIGHTLY", color: "var(--blueprint-glow)", bg: "rgba(37, 99, 235, 0.12)" },
  monthly: { label: "TIER 2 · MONTHLY", color: "var(--edge-orange)", bg: "rgba(255, 107, 43, 0.12)" },
  seasonal: { label: "TIER 3 · SEASONAL", color: "var(--dynasty-gold)", bg: "rgba(240, 192, 64, 0.12)" },
};

/**
 * Authenticated dashboard feed: every `status = 'active'` game, ordered by
 * deadline (soonest lock first), with the user's own submissions overlaid so
 * already-answered games render locked.
 */
export function PredictionFeed() {
  const { user, supabase } = useAuth();
  const [games, setGames] = useState<PredictionGame[] | null>(null);
  const [myPredictions, setMyPredictions] = useState<Map<string, UserPrediction>>(new Map());
  const [feedError, setFeedError] = useState<string | null>(null);

  const loadFeed = useCallback(async () => {
    if (!supabase || !user) return;
    setFeedError(null);

    const [gamesRes, mineRes] = await Promise.all([
      supabase
        .from("prediction_games")
        .select("*")
        .eq("status", "active")
        .order("deadline", { ascending: true }),
      // RLS already scopes this to auth.uid(); the eq() is belt-and-braces.
      supabase.from("user_predictions").select("*").eq("user_id", user.id),
    ]);

    if (gamesRes.error) {
      setFeedError(gamesRes.error.message);
      setGames([]);
      return;
    }

    const sorted = [...(gamesRes.data ?? [])].sort(
      (a, b) =>
        TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
        new Date(a.deadline).getTime() - new Date(b.deadline).getTime(),
    );
    setGames(sorted);

    if (!mineRes.error) {
      setMyPredictions(new Map((mineRes.data ?? []).map((p) => [p.game_id, p])));
    }
  }, [supabase, user]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  // A submission landed (or the server told us one already existed):
  // record it so the card flips to its locked state.
  const handleSubmitted = useCallback((prediction: UserPrediction) => {
    setMyPredictions((prev) => {
      const next = new Map(prev);
      next.set(prediction.game_id, prediction);
      return next;
    });
  }, []);

  if (games === null) {
    return (
      <div className="pa-feed" aria-busy="true">
        {[0, 1].map((i) => (
          <div key={i} className="pa-card" style={{ textAlign: "left" }}>
            <div className="pa-skel pa-skel-chip" />
            <div className="pa-skel pa-skel-line-lg" />
            <div className="pa-skel pa-skel-line" />
            <div className="pa-skel pa-skel-pill" />
          </div>
        ))}
      </div>
    );
  }

  if (feedError) {
    return (
      <div className="pa-placeholder">
        <p className="pa-error" role="alert">Couldn&apos;t load the board: {feedError}</p>
        <button type="button" className="pa-signout" onClick={() => void loadFeed()}>
          Retry
        </button>
      </div>
    );
  }

  // No active games — render nothing rather than an empty placeholder, so the
  // Arena reads as Draft-Night-only until the prediction feed is launched.
  if (games.length === 0) {
    return null;
  }

  return (
    <div className="pa-feed">
      {games.map((game) => (
        <PredictionCard
          key={game.id}
          game={game}
          tierMeta={TIER_META[game.tier]}
          existing={myPredictions.get(game.id) ?? null}
          onSubmitted={handleSubmitted}
        />
      ))}
    </div>
  );
}
