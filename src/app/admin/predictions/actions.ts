"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export type ApproveResult = { ok: true } | { ok: false; error: string };

/**
 * Flip an agent-proposed draft game to 'active', making it live for players.
 *
 * Server Actions are reachable by direct POST, not just through our UI — so we
 * re-verify auth + analyst authorization HERE, every time, rather than trusting
 * the page that rendered the button. The actual write uses the service-role
 * client because prediction_games is admin/service-role-only at the RLS layer.
 */
export async function approveGame(gameId: string): Promise<ApproveResult> {
  if (!gameId) return { ok: false, error: "Missing game id." };

  // 1. Authenticate (getUser validates the JWT server-side; never getSession).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // 2. Authorize — analysts (or admins) only.
  const { data: profile } = await supabase
    .from("profiles")
    .select("analyst_badge")
    .eq("id", user.id)
    .single();
  if (!profile?.analyst_badge) {
    return { ok: false, error: "Analyst badge required." };
  }

  // 3. Mutate. The `.eq("status", "draft")` guard makes this idempotent and
  //    prevents re-activating an already-live or resolved game.
  const admin = createAdminClient();
  const { error } = await admin
    .from("prediction_games")
    .update({ status: "active" })
    .eq("id", gameId)
    .eq("status", "draft");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/predictions");
  return { ok: true };
}
