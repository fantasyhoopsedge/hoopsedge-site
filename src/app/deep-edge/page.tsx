import { redirect } from "next/navigation";
import { authorizeDeepEdge } from "@/lib/deep-edge/guard";
import { listLeagues } from "@/lib/fantrax/store";

/**
 * `/deep-edge` is a router, not a screen.
 *
 * It used to render a "Connect your fantasy league / Explore without
 * connecting" welcome card. That made sense when this subtree was reached by
 * typing the URL, but the launch gateway now sends admins straight here, and
 * a choice screen between them and the tool is one click of nothing: an admin
 * arriving has already decided to enter. So this resolves where they actually
 * belong and sends them there.
 *
 *   league already connected  → /deep-edge/home   (the tool)
 *   none yet                  → /deep-edge/providers (connect Fantrax, which
 *                               pushes to /deep-edge/home on success)
 *
 * Only admins ever execute this file: src/app/deep-edge/layout.tsx serves the
 * Launching soon screen to a signed-in non-admin and bounces the signed-out,
 * so the authorize call below is defensive rather than the real gate.
 *
 * The old card's "Explore without connecting" affordance pointed at
 * /deep-edge/home?explore=1, which still works — it simply has no link into it
 * any more. Worth restoring somewhere deliberate if sample-data browsing
 * becomes a selling point again after launch.
 */
export const dynamic = "force-dynamic";

export default async function DeepEdgeEntryPage() {
  const auth = await authorizeDeepEdge();
  // Unreachable in practice (the layout gates first), so rather than render a
  // second "Restricted" surface, hand back to the one place that knows how to
  // start a session.
  if (!auth.ok) redirect("/?signin=deep-edge");

  let hasLeague = false;
  try {
    hasLeague = (await listLeagues(auth.access.owner)).length > 0;
  } catch {
    // A saved-leagues outage must not become a dead end. Connecting is the
    // safe default: /deep-edge/providers renders fine either way, whereas
    // sending someone to an empty hub looks like their leagues vanished.
  }

  // Outside the try on purpose — redirect() signals by throwing, and catching
  // it here would swallow the navigation and render nothing.
  redirect(hasLeague ? "/deep-edge/home" : "/deep-edge/providers");
}
