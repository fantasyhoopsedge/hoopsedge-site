import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createClient } from "@/utils/supabase/server";
import { hasDeepEdgeAccess } from "@/lib/deep-edge/access-cache";
import {
  FOUNDING_DISCOUNT_PCT,
  FOUNDING_OFFER_END_LABEL,
  FOUNDING_PRICE_USD,
  SEASON_PASS_USD,
  foundingOfferIsOpen,
} from "@/lib/deep-edge/offer";
import { findEligibleDiscount } from "@/lib/deep-edge/waitlist";
import { LaunchingSoon } from "./_components/launching-soon";

// Deep Edge is genuinely multi-route (Welcome/Home/Settings/Category
// Edge/Power Rankings all read naturally as distinct URLs), so the gate
// lives once here rather than copy-pasted into every page.tsx the way
// admin/fantrax's single-page shell does it. Allowlist-gated for now — full
// admins (rb_admins) plus the pre-launch tester cohort (de_testers), which is
// a SEPARATE list precisely so a tester gets this product and no admin rights;
// see src/lib/deep-edge/access-cache.ts. The real one-free-league-then-pay
// entitlement replaces both once billing exists (src/lib/deep-edge/guard.ts).
//
// The launch gateway (src/components/home/launch-gateway.tsx) now sends real
// visitors at this door, so the two non-admin outcomes changed from dead ends
// to real destinations: signed-out goes back to the gateway with the sign-in
// modal open, and signed-in-non-admin gets the Launching soon capture screen.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The Deep Edge · Fantasy Hoops Edge",
  robots: { index: false, follow: false },
};

async function launchingSoon(userId: string | null, userEmail: string | null, signedIn: boolean) {
  // A registration failing to load must not present as "never registered" —
  // that would show the form to someone already on the list and invite a
  // duplicate submit. Falling back to null is still the safest of the two
  // wrong answers (the capture is idempotent, so a re-submit is harmless),
  // but it is worth knowing it happened.
  let registeredEmail: string | null = null;
  try {
    registeredEmail = (await findEligibleDiscount(userId, userEmail))?.email ?? null;
  } catch (err) {
    console.error("[deep-edge] waitlist lookup failed:", err);
  }

  return (
    <LaunchingSoon
      seasonPassUsd={SEASON_PASS_USD}
      discountPct={FOUNDING_DISCOUNT_PCT}
      foundingPriceUsd={FOUNDING_PRICE_USD}
      offerOpen={foundingOfferIsOpen()}
      offerEndLabel={FOUNDING_OFFER_END_LABEL}
      registeredEmail={registeredEmail}
      signedIn={signedIn}
    />
  );
}

export default async function DeepEdgeLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV !== "production") {
    // Localhost is trusted, which also means the non-admin path is otherwise
    // unreachable in dev — set DEEP_EDGE_FORCE_SOON=1 in .env.local to see the
    // Launching soon screen without deploying or removing yourself from
    // rb_admins. Dev-only: production never reads this.
    if (process.env.DEEP_EDGE_FORCE_SOON === "1") return launchingSoon(null, null, false);
    return <>{children}</>;
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Signed out gets the placeholder, not a redirect. Someone who asked for The
  // Deep Edge should be told what it is and when it opens — with a way back to
  // the main site — rather than being bounced to a sign-in wall for a feature
  // they did not ask about. The screen offers sign-in itself, for claiming the
  // founding price, which is the only thing here that actually needs an
  // account.
  if (!user) return launchingSoon(null, null, false);

  if (!(await hasDeepEdgeAccess(user.email))) return launchingSoon(user.id, user.email ?? null, true);

  return <>{children}</>;
}
