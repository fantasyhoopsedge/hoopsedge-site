import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { openSeasonPassCheckout } from "@/lib/deep-edge/season-pass-checkout";

/**
 * POST — open (or reopen) a Deep Edge season-pass checkout for the signed-in
 * user. Responds { transactionId } for Paddle.Checkout.open({ transactionId }).
 *
 * All the rules live in src/lib/deep-edge/season-pass-checkout.ts; this route
 * only maps its outcomes to HTTP.
 *
 * Deliberately NOT gated on authorizeDeepEdge(): that guard admits people who
 * already have access, and a buyer by definition doesn't.
 *
 * Refuses (503) until this deployment has NEXT_PUBLIC_PADDLE_ENV,
 * PADDLE_API_KEY and a price id for its environment in season_pass_config, so
 * merging this route opens no checkout anywhere by itself.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in to buy a season pass." }, { status: 401 });
  }

  try {
    const result = await openSeasonPassCheckout({ id: user.id, email: user.email ?? null });

    switch (result.kind) {
      case "ready":
        return NextResponse.json({ transactionId: result.transactionId });
      case "already_owned":
        return NextResponse.json(
          { error: `You already have a season pass for ${result.season}.`, code: "already_owned" },
          { status: 409 },
        );
      case "processing":
        return NextResponse.json(
          {
            error: "Your payment is still being processed. Give it a minute, then refresh.",
            code: "processing",
          },
          { status: 409 },
        );
      case "unavailable":
        console.error("[deep-edge/checkout] unavailable:", result.reason);
        return NextResponse.json({ error: "Checkout isn't available right now." }, { status: 503 });
    }
  } catch (err) {
    console.error("[deep-edge/checkout] failed:", err);
    return NextResponse.json({ error: "Checkout isn't available right now." }, { status: 503 });
  }
}
