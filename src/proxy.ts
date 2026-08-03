import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts` — this file is the
 * middleware. It runs on every matched request to:
 *
 *  1. Refresh the Supabase auth token (getUser() revalidates the JWT against
 *     the auth server and rotates cookies when needed).
 *  2. Guard protected route prefixes.
 *
 * `/prediction-arena` is intentionally NOT in PROTECTED_PREFIXES: it renders
 * its own signed-out landing page. Add member-only segments here as they ship.
 */
const PROTECTED_PREFIXES: string[] = [
  // "/account",
  "/admin", // analyst-only review panel; the page also re-checks authorization
];

export async function proxy(request: NextRequest) {
  // These admin tools are "localhost trusted" per their own page.tsx (dev
  // convenience; production still gates on rb_admins) — never bounce them
  // through the auth gate on localhost.
  const DEV_TRUSTED_ADMIN_PREFIXES = ["/admin/rookie-board", "/admin/depth-chart", "/admin/role-context", "/admin/dynasty-board", "/admin/fantrax"];
  if (
    process.env.NODE_ENV !== "production" &&
    DEV_TRUSTED_ADMIN_PREFIXES.some((prefix) =>
      request.nextUrl.pathname.startsWith(prefix),
    )
  ) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Don't take the whole site down if Supabase isn't configured yet
  // (e.g. preview deployments without env vars).
  if (!url || !anonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // IMPORTANT: do not run code between createServerClient and getUser() —
  // and always use getUser() here, never getSession(): getUser() validates
  // the token server-side; getSession() trusts the (spoofable) cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (!user && isProtected) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/prediction-arena";
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Return supabaseResponse as-is so refreshed auth cookies reach the browser.
  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Run on everything except static assets and metadata files —
     * the auth token must refresh no matter which page loads first.
     */
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|csv|json)$).*)",
  ],
};
