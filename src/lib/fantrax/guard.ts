import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { isDeepEdgeAdmin } from "@/lib/deep-edge/admin-cache";
import { LOCAL_OWNER } from "./store";

/**
 * Access gate for the Fantrax league connector.
 *
 * The connector ships admin-only on purpose: it is the first feature that talks
 * to a third-party account, and it goes to every FHE user only once it has been
 * exercised against a real league. The gate matches the rookie/dynasty board
 * tools — localhost is trusted in dev; in production the signed-in user's email
 * must be in rb_admins.
 *
 * To graduate the feature to all signed-in users, drop the isRbAdmin() check
 * here and keep the getUser() one — nothing else in src/lib/fantrax or
 * src/app/api/fantrax assumes admin.
 */

export interface FantraxAccess {
  /** Row owner for the saved-league store: the user's email, or LOCAL_OWNER in dev. */
  owner: string;
}

export async function authorizeFantrax(): Promise<
  { ok: true; access: FantraxAccess } | { ok: false; response: NextResponse }
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
      response: NextResponse.json(
        { error: "The Fantrax connector is in limited testing." },
        { status: 403 },
      ),
    };
  }
  return { ok: true, access: { owner: user.email! } };
}
