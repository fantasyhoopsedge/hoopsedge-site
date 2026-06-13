import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

/**
 * Google OAuth (PKCE) callback. Supabase redirects here with a one-time
 * `?code=`; we exchange it for a session (set as httpOnly cookies) and
 * forward the user to the arena with a clean URL — no auth params leak
 * into the address bar.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // Only allow same-origin relative redirect targets — never absolute URLs.
  const rawNext = searchParams.get("next") ?? "/prediction-arena";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//")
    ? rawNext
    : "/prediction-arena";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/prediction-arena?auth_error=oauth_failed`);
}
