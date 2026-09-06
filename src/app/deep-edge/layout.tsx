import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { isDeepEdgeAdmin } from "@/lib/deep-edge/admin-cache";
import { FOUNDING_DISCOUNT_PCT, FOUNDING_PRICE_USD, SEASON_PASS_USD } from "@/lib/deep-edge/waitlist";
import { LaunchingSoon } from "./_components/launching-soon";

// Deep Edge is genuinely multi-route (Welcome/Home/Settings/Category
// Edge/Power Rankings all read naturally as distinct URLs), so the gate
// lives once here rather than copy-pasted into every page.tsx the way
// admin/fantrax's single-page shell does it. Admin-gated for now — Ash is
// testing everything through this gate; the real one-free-league-then-pay
// entitlement replaces it once billing exists (see src/lib/deep-edge/guard.ts).
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

function launchingSoon() {
  return (
    <LaunchingSoon
      seasonPassUsd={SEASON_PASS_USD}
      discountPct={FOUNDING_DISCOUNT_PCT}
      foundingPriceUsd={FOUNDING_PRICE_USD}
    />
  );
}

export default async function DeepEdgeLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV !== "production") {
    // Localhost is trusted, which also means the non-admin path is otherwise
    // unreachable in dev — set DEEP_EDGE_FORCE_SOON=1 in .env.local to see the
    // Launching soon screen without deploying or removing yourself from
    // rb_admins. Dev-only: production never reads this.
    if (process.env.DEEP_EDGE_FORCE_SOON === "1") return launchingSoon();
    return <>{children}</>;
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Back to the gateway with the sign-in modal open, rather than to
  // /prediction-arena — that landing was the right answer when this gate was
  // internal-only, but it now drops a visitor who asked for The Deep Edge onto
  // an unrelated feature's signed-out page.
  if (!user) redirect("/?signin=deep-edge");

  if (!(await isDeepEdgeAdmin(user.email))) return launchingSoon();

  return <>{children}</>;
}
