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
import { getCheckoutAvailability } from "@/lib/deep-edge/season-pass-checkout";
import { findEligibleDiscount } from "@/lib/deep-edge/waitlist";
import { LaunchingSoon } from "./_components/launching-soon";
import { SeasonPassPurchase } from "./_components/season-pass-purchase";

// Deep Edge is genuinely multi-route (Welcome/Home/Settings/Category
// Edge/Power Rankings all read naturally as distinct URLs), so the gate
// lives once here rather than copy-pasted into every page.tsx the way
// admin/fantrax's single-page shell does it. The whole section sits behind one
// entitlement — a season pass for the current season, with no per-league
// counting — and full admins (rb_admins) plus the pre-launch tester cohort
// (de_testers) get in without one. de_testers is a SEPARATE list precisely so
// a tester gets this product and no admin rights; see
// src/lib/deep-edge/access-cache.ts. This layout is not the only gate: the
// Deep Edge API routes don't pass through it, and re-check via
// src/lib/deep-edge/guard.ts and src/lib/fantrax/guard.ts.
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

/**
 * Everyone without access lands here: the buy screen once checkout is
 * configured on this deployment (getCheckoutAvailability), Launching soon until
 * then. Failing to tell which falls back to Launching soon — a screen with no
 * buy button is the safe wrong answer, a buy button that can only fail is not.
 */
async function noAccess(userId: string | null, userEmail: string | null, signedIn: boolean) {
  let availability = null;
  try {
    availability = await getCheckoutAvailability();
  } catch (err) {
    console.error("[deep-edge] checkout availability check failed:", err);
  }
  if (!availability) return launchingSoon(userId, userEmail, signedIn);

  // Display only — the checkout route re-reads the discount before charging, so
  // a failed lookup here can misstate the price shown but never the price paid.
  let discountPct: number | null = null;
  if (userId) {
    try {
      discountPct = (await findEligibleDiscount(userId, userEmail))?.discountPct ?? null;
    } catch (err) {
      console.error("[deep-edge] waitlist lookup failed:", err);
    }
  }

  return (
    <SeasonPassPurchase
      season={availability.season}
      fullPriceUsd={SEASON_PASS_USD}
      discountPct={discountPct}
      claimablePct={signedIn && !discountPct && foundingOfferIsOpen() ? FOUNDING_DISCOUNT_PCT : null}
      offerEndLabel={FOUNDING_OFFER_END_LABEL}
      signedIn={signedIn}
      paddleEnvironment={availability.environment}
      clientToken={availability.clientToken}
    />
  );
}

export default async function DeepEdgeLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV !== "production") {
    // Localhost is trusted, which also means the non-admin path is otherwise
    // unreachable in dev — set DEEP_EDGE_FORCE_SOON=1 in .env.local to see the
    // no-access screen (Launching soon, or the buy screen once checkout is
    // configured) without deploying or removing yourself from rb_admins.
    // Dev-only: production never reads this.
    if (process.env.DEEP_EDGE_FORCE_SOON === "1") return noAccess(null, null, false);
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
  if (!user) return noAccess(null, null, false);

  if (!(await hasDeepEdgeAccess(user.id, user.email))) return noAccess(user.id, user.email ?? null, true);

  return <>{children}</>;
}
