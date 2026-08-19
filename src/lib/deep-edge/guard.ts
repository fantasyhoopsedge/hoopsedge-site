import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { isDeepEdgeAdmin } from "@/lib/deep-edge/admin-cache";
import { LOCAL_OWNER } from "@/lib/fantrax/store";

/**
 * Access gate for The Deep Edge — API-route shape, structurally identical to
 * src/lib/fantrax/guard.ts's authorizeFantrax(). Kept as its own file (not a
 * re-export of authorizeFantrax) so it can be graduated to the real
 * one-free-league-then-paywall check independently of the Fantrax connector's
 * own admin gate — see that file's comment for the same graduation pattern:
 * drop the isRbAdmin() check here, nothing else assumes admin.
 *
 * Localhost is trusted in dev; production requires a signed-in user in
 * rb_admins, same allowlist the other admin tools share. The whole
 * /deep-edge subtree is gated once, centrally, in src/app/deep-edge/layout.tsx
 * — unlike /admin/fantrax's single page, Deep Edge is genuinely multi-route.
 */

export interface DeepEdgeAccess {
  /** Row owner for the saved-league store (shared with the Fantrax connector):
   *  the user's email, or LOCAL_OWNER in dev. */
  owner: string;
}

export async function authorizeDeepEdge(): Promise<
  { ok: true; access: DeepEdgeAccess } | { ok: false; response: NextResponse }
> {
  if (process.env.NODE_ENV !== "production") {
    return { ok: true, access: { owner: LOCAL_OWNER } }; // localhost is trusted
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Sign in required." }, { status: 401 }) };
  }
  if (!(await isDeepEdgeAdmin(user.email))) {
    return {
      ok: false,
      response: NextResponse.json({ error: "The Deep Edge is in limited testing." }, { status: 403 }),
    };
  }
  return { ok: true, access: { owner: user.email! } };
}
