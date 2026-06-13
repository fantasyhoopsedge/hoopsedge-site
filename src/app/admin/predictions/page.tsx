import { redirect } from "next/navigation";
import { SiteNav } from "@/components/site-nav";
import { createClient } from "@/utils/supabase/server";
import type { PredictionGame } from "@/types/database";
import { ApproveButton } from "./approve-button";
import { adminStyles } from "./admin-styles";

// Auth-gated, draft-data view — always render per request, never prerender.
export const dynamic = "force-dynamic";

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

/** prediction_games.options is jsonb — coerce defensively to string[]. */
function toOptions(value: PredictionGame["options"]): string[] {
  return Array.isArray(value) ? value.map((o) => String(o)) : [];
}

export default async function AdminPredictionsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/prediction-arena");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, analyst_badge, is_admin")
    .eq("id", user.id)
    .single();

  const isAnalyst = Boolean(profile?.analyst_badge || profile?.is_admin);

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
          Pending drafts{" "}
          <span className="adm-count">{games.length}</span>
        </h1>
        <p className="adm-lede">
          Each card is a prediction game proposed by the Opus 4.8 content agent.
          Review the structure, then post it live for players.
        </p>

        {games.length === 0 ? (
          <div className="adm-empty">
            <p>No drafts waiting. The agent hasn&apos;t pitched anything new.</p>
          </div>
        ) : (
          <div className="adm-grid">
            {games.map((game) => {
              const options = toOptions(game.options);
              const deadline = new Date(game.deadline);
              return (
                <article key={game.id} className="adm-card">
                  <div className="adm-card-head">
                    <span className="adm-chip">
                      {TIER_LABEL[game.tier] ?? game.tier.toUpperCase()}
                    </span>
                    <span className="adm-qtype">
                      {Q_TYPE_LABEL[game.question_type] ?? game.question_type}
                    </span>
                  </div>

                  <h2 className="adm-card-title">{game.title}</h2>

                  {game.description ? (
                    <p className="adm-pitch">
                      <span className="adm-pitch-label">AGENT PITCH</span>
                      {game.description}
                    </p>
                  ) : null}

                  <div className="adm-analysis">
                    <span className="adm-analysis-label">
                      OPTIONS ({options.length})
                    </span>
                    <ol className="adm-options">
                      {options.map((opt, i) => (
                        <li key={`${game.id}-${i}`}>{opt}</li>
                      ))}
                    </ol>
                  </div>

                  <div className="adm-meta">
                    <span className="adm-meta-label">LOCKS</span>
                    <time dateTime={game.deadline}>
                      {Number.isNaN(deadline.getTime())
                        ? game.deadline
                        : deadline.toLocaleString()}
                    </time>
                  </div>

                  <ApproveButton gameId={game.id} />
                </article>
              );
            })}
          </div>
        )}
      </div>
      <style>{adminStyles}</style>
    </main>
  );
}
