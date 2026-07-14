import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { ROSTER_TAG } from "@/app/team-rosters/_components/roster-live-data";
import { SEASONAL_TAG } from "@/lib/value/seasonal-data";

/**
 * On-demand cache bust for the 15-min unstable_cache data layers (team-rosters,
 * seasonal-rankings). Without this, a data refresh (nba:refresh, nba:salary,
 * roster ingest, seasonal:build) or a shape change to a cached query is only
 * visible after the revalidate window elapses.
 *
 *   POST /api/revalidate?tag=team-rosters
 *   POST /api/revalidate?tag=seasonal-rankings
 *
 * Open on localhost (dev convenience, same as /admin/rookie-board). In
 * production, requires the same shared secret as the agent worker:
 *   Authorization: Bearer <CRON_SECRET>
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KNOWN_TAGS = new Set([ROSTER_TAG, SEASONAL_TAG]);
const IS_DEV = process.env.NODE_ENV !== "production";

/** Constant-time bearer-token check against CRON_SECRET. */
function isAuthorized(request: NextRequest): boolean {
  if (IS_DEV) return true; // localhost is trusted, mirrors /admin/rookie-board

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

  const tag = request.nextUrl.searchParams.get("tag");
  if (!tag || !KNOWN_TAGS.has(tag)) {
    return NextResponse.json(
      { error: `?tag must be one of: ${[...KNOWN_TAGS].join(", ")}` },
      { status: 400 },
    );
  }

  // Second arg is Cache Components' stale-while-revalidate window (unused here
  // since cacheComponents isn't enabled — revalidateTag invalidates immediately
  // either way) but Next 16's type signature requires it regardless.
  revalidateTag(tag, "max");
  return NextResponse.json({ ok: true, tag, revalidatedAt: new Date().toISOString() });
}
