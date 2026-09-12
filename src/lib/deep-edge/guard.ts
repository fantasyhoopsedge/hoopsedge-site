import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { hasDeepEdgeAccess } from "@/lib/deep-edge/access-cache";
import { LOCAL_OWNER } from "@/lib/fantrax/store";

/**
 * Access gate for The Deep Edge — API-route shape, structurally identical to
 * src/lib/fantrax/guard.ts's authorizeFantrax(). Kept as its own file (not a
 * re-export of authorizeFantrax) so the two can diverge if the connector is
 * ever opened up beyond The Deep Edge.
 *
 * Localhost is trusted in dev; production requires a signed-in user who holds
 * a season pass for the current season, or is in rb_admins (full admin) or
 * de_testers (Deep Edge only) — see lib/deep-edge/access-cache.ts. The
 * /deep-edge pages are gated once, centrally, in src/app/deep-edge/layout.tsx,
 * but a layout never runs for an API route, so every route re-checks here.
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
  if (!(await hasDeepEdgeAccess(user.id, user.email))) {
    return {
      ok: false,
      response: NextResponse.json({ error: "The Deep Edge needs a season pass." }, { status: 403 }),
    };
  }
  return { ok: true, access: { owner: user.email! } };
}
