import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { isPlausibleEmail, joinWaitlist } from "@/lib/deep-edge/waitlist";

/**
 * POST — join The Deep Edge founding-price waitlist: { email }.
 *
 * Sign-in required, matching where the form actually lives: the Launching soon
 * screen only renders for a signed-in non-admin (src/app/deep-edge/layout.tsx).
 * That is not just symmetry — it is the whole rate limit. An unauthenticated
 * capture endpoint on a public marketing page is a free mailing-list poisoner,
 * whereas an account is enough friction to make bulk submission uninteresting.
 *
 * Deliberately NOT gated on authorizeDeepEdge(): that guard is the admin
 * allowlist, and every legitimate caller here is by definition a non-admin.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in to claim the founding price." }, { status: 401 });
  }

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!isPlausibleEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  try {
    await joinWaitlist(email, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // The row is a price promise, so a failed write must never present as
    // success — the visitor has to know their discount was not recorded.
    console.error("[deep-edge/waitlist] write failed:", err);
    return NextResponse.json(
      { error: "We could not save that just now. Please try again in a moment." },
      { status: 503 },
    );
  }
}
