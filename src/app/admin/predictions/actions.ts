"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { generateGameDraft } from "@/lib/generate-game";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type GameEdits = {
  title: string;
  description: string;
  options: string[];
};

/**
 * Re-verify auth + analyst authorization. Server Actions are reachable by
 * direct POST, not just through our UI, so every action re-checks this rather
 * than trusting the page that rendered the button.
 */
async function requireAnalyst(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("analyst_badge")
    .eq("id", user.id)
    .single();
  if (!profile?.analyst_badge) return { ok: false, error: "Analyst badge required." };

  return { ok: true };
}

/**
 * Apply the analyst's edits and post the game live (draft → active) in one
 * write. Writes use the service-role client because prediction_games is
 * admin/service-role-only at the RLS layer. The `.eq("status","draft")` guard
 * keeps it idempotent and stops re-activating an already-live/skipped game.
 */
export async function approveGame(
  gameId: string,
  edits: GameEdits,
): Promise<ActionResult> {
  if (!gameId) return { ok: false, error: "Missing game id." };

  const auth = await requireAnalyst();
  if (!auth.ok) return auth;

  const title = edits.title?.trim();
  const description = edits.description?.trim();
  const options = (edits.options ?? []).map((o) => o.trim()).filter(Boolean);

  if (!title) return { ok: false, error: "Title can't be empty." };
  if (!description) return { ok: false, error: "Description can't be empty." };
  if (options.length < 2) return { ok: false, error: "Add at least 2 player options." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("prediction_games")
    .update({ title, description, options, status: "active" })
    .eq("id", gameId)
    .eq("status", "draft");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/predictions");
  return { ok: true };
}

/**
 * Archive an agent-proposed game (draft → skipped) — removes it from the queue
 * but keeps the record. No edits needed; the boss is rejecting it as-is.
 */
export async function skipGame(gameId: string): Promise<ActionResult> {
  if (!gameId) return { ok: false, error: "Missing game id." };

  const auth = await requireAnalyst();
  if (!auth.ok) return auth;

  const admin = createAdminClient();
  const { error } = await admin
    .from("prediction_games")
    .update({ status: "skipped" })
    .eq("id", gameId)
    .eq("status", "draft");

  if (error) return { ok: false, error: error.message };

  // Auto-replenish: immediately queue a fresh game so the boss always has one
  // to review after skipping. Best-effort — if generation fails (e.g. API
  // hiccup) the skip still stands; the queue just shows empty until the next
  // scheduled run. We await it so revalidatePath surfaces the new game at once.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "";
  await generateGameDraft({ siteUrl });

  revalidatePath("/admin/predictions");
  return { ok: true };
}
