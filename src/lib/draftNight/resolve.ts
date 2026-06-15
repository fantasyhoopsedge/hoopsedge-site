/**
 * Draft Night resolution (handoff §2 / §4).
 *
 * Runs once when the official draft order is known. The analyst fills
 * dn_results.picks ({ slug: actual_pick } for picks 1..60) via the Supabase
 * table editor, then triggers this — it grades every prediction with the pure
 * grader and writes scores back, then flips the game to `resolved`.
 *
 * Service-role only (RLS bypass) — see scripts/resolve-draft-night.ts for the
 * runnable entrypoint.
 */
import { createAdminClient } from "@/utils/supabase/admin";
import {
  gradeMiniGame,
  isCalledIt,
  type MiniGameConfig,
  type ResultsPicks,
} from "@/lib/draftNight/grader";

export interface ResolveSummary {
  gameSlug: string;
  miniGames: number;
  graded: number;
}

export async function resolveDraftNight(gameSlug: string): Promise<ResolveSummary> {
  const admin = createAdminClient();

  const { data: game, error: gameErr } = await admin
    .from("dn_games")
    .select("id, status")
    .eq("slug", gameSlug)
    .single();
  if (gameErr || !game) throw gameErr ?? new Error(`game not found: ${gameSlug}`);

  const { data: result, error: resErr } = await admin
    .from("dn_results")
    .select("picks")
    .eq("game_id", game.id)
    .single();
  if (resErr || !result) {
    throw resErr ?? new Error("no dn_results row — enter the official picks first");
  }
  const picks = result.picks as ResultsPicks;

  const { data: minis, error: miniErr } = await admin
    .from("dn_mini_games")
    .select("id, config")
    .eq("game_id", game.id);
  if (miniErr || !minis) throw miniErr ?? new Error("no mini games for game");

  let graded = 0;
  for (const mini of minis) {
    const config = mini.config as unknown as MiniGameConfig;
    const { data: preds, error: predErr } = await admin
      .from("dn_predictions")
      .select("id, payload")
      .eq("mini_game_id", mini.id);
    if (predErr) throw predErr;

    for (const pred of preds ?? []) {
      const payload = (pred.payload as string[]) ?? [];
      const score = gradeMiniGame(config, payload, picks);
      const called_it = isCalledIt(config, payload, picks);
      const { error: updErr } = await admin
        .from("dn_predictions")
        .update({ score, called_it })
        .eq("id", pred.id);
      if (updErr) throw updErr;
      graded++;
    }
  }

  const { error: statusErr } = await admin
    .from("dn_games")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", game.id);
  if (statusErr) throw statusErr;

  return { gameSlug, miniGames: minis.length, graded };
}
