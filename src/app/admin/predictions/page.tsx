import { redirect } from "next/navigation";
import { SiteNav } from "@/components/site-nav";
import { createClient } from "@/utils/supabase/server";
import type { PredictionGame } from "@/types/database";
import { GameReviewCard } from "./game-review-card";
import { adminStyles } from "./admin-styles";

// Auth-gated, draft-data view — always render per request, never prerender.
export const dynamic = "force-dynamic";

export default async function AdminPredictionsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/prediction-arena");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, analyst_badge")
    .eq("id", user.id)
    .single();

  const isAnalyst = Boolean(profile?.analyst_badge);

  if (!isAnalyst) {
    return (
      <main className="adm-main">
        <SiteNav />
        <div className="adm-wrap">
          <span className="adm-eyebrow">FHE ADMIN</span>
          <h1 className="adm-h1">Restricted</h1>
          <p className="adm-lede">
            The agent review panel is limited to analysts. Earn the analyst badge
            to help curate the Prediction Arena.
          </p>
        </div>
        <style>{adminStyles}</style>
      </main>
    );
  }

  const { data: drafts } = await supabase
    .from("prediction_games")
    .select("*")
    .eq("status", "draft")
    .order("created_at", { ascending: false });

  const games = (drafts ?? []) as PredictionGame[];

  return (
    <main className="adm-main">
      <SiteNav />
      <div className="adm-wrap">
        <span className="adm-eyebrow">FHE ADMIN · AGENT REVIEW</span>
        <h1 className="adm-h1">
          Pending games{" "}
          <span className="adm-count">{games.length}</span>
        </h1>
        <p className="adm-lede">
          Each card is a prediction game proposed by the Opus 4.8 content agent.
          Review it, then post it live for players.
        </p>

        {games.length === 0 ? (
          <div className="adm-empty">
            <p>No games waiting. The agent hasn&apos;t proposed anything new.</p>
          </div>
        ) : (
          <div className="adm-grid">
            {games.map((game) => (
              <GameReviewCard key={game.id} game={game} />
            ))}
          </div>
        )}
      </div>
      <style>{adminStyles}</style>
    </main>
  );
}
