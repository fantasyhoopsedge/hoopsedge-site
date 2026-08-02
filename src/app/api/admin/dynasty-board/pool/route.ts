import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { isRbAdmin } from "@/lib/dynasty-board-store";
import { buildAddablePool } from "@/lib/dynasty-board-seed";

/**
 * "+ Add player" picker data for the Dynasty Board editor: every ecosystem
 * player (nba_roster) NOT already on the FBI-HE consensus baseline. Same
 * auth gate as the main dynasty-board route.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const IS_DEV = process.env.NODE_ENV !== "production";

async function authorize(): Promise<NextResponse | null> {
  if (IS_DEV) return null; // localhost is trusted
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!(await isRbAdmin(user.email))) {
    return NextResponse.json({ error: "Your account isn't an authorized board editor." }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const denied = await authorize();
  if (denied) return denied;
  try {
    const pool = await buildAddablePool();
    return NextResponse.json({ pool });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
