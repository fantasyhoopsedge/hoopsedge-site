import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { generateGameDraft } from "@/lib/generate-game";

/**
 * Autonomous agent worker — proposes a new Prediction Arena game.
 *
 * Trigger from a scheduled job (e.g. Vercel Cron) with the shared secret:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * The generation/validation/insert/Discord logic lives in
 * `@/lib/generate-game` so the Skip action can reuse it. This route only
 * adds the CRON_SECRET gate and HTTP response mapping.
 */

// Must run per-request on the Node runtime — the service-role key (used inside
// generateGameDraft) must never hit the edge cache or a client bundle.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Constant-time bearer-token check against CRON_SECRET. */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch — guard first.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized — missing or invalid CRON_SECRET." },
      { status: 401 },
    );
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    new URL(request.url).origin;

  const result = await generateGameDraft({ siteUrl });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: result.status },
    );
  }

  return NextResponse.json({
    status: "draft_created",
    game_id: result.gameId,
    review_url: result.reviewUrl,
    webhook_delivered: result.webhookDelivered,
  });
}
