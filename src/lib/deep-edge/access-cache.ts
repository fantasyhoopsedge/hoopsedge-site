import "server-only";
import { unstable_cache } from "next/cache";
import { isRbAdmin } from "@/lib/rookie-board-store";
import { isDeepEdgeTester } from "@/lib/deep-edge/testers";
import { hasActiveSeasonPass, paddleEnvironment, seasonPassTag } from "@/lib/deep-edge/season-pass";

/**
 * Cached access check shared by all three Deep Edge gates:
 * src/app/deep-edge/layout.tsx (force-dynamic by design, so it can never
 * skip its own check — see that file's comment), src/lib/deep-edge/guard.ts,
 * and src/lib/fantrax/guard.ts. Every one of those runs independently on
 * every request (the layout can't be statically optimized, and each Deep
 * Edge tool's API route re-checks itself too), so a single page load/tool
 * switch was paying an uncached DB round trip up to three times (Ash,
 * 2026-08-19 — reported prod lag, investigated alongside the lineup-solver
 * freeze in lib/fantrax/lineup.ts). unstable_cache sidesteps the
 * route-segment fetchCache heuristic entirely (same reasoning as
 * league-cache.ts's getCachedLeagueAnalysis), so this works even under the
 * layout's force-dynamic export.
 *
 * THREE ways in, one answer:
 *   rb_admins    — full admin. Also gates every /admin/* surface, including
 *                  publish rights on the live public dynasty/rookie boards.
 *   de_testers   — Deep Edge ONLY. Confers no admin rights whatsoever.
 *   season pass  — what everyone else buys (lib/deep-edge/season-pass.ts).
 *
 * Deep Edge accepts any; /admin/* accepts only the first and does not go
 * through this file. That asymmetry is the entire reason de_testers exists —
 * see the migration header — so when adding a pre-launch tester, add them to
 * de_testers, never to rb_admins.
 *
 * Revoking a tester takes up to `revalidate` seconds to take effect. If you
 * ever need an instant revoke, delete the row AND redeploy (a new build
 * invalidates the cache). A pass is different: it is cached per user under
 * seasonPassTag(), so the webhook that writes or refunds one expires it
 * immediately. A season rollover (updating season_pass_config) is not tagged
 * and takes up to `revalidate` seconds to reach everyone.
 */
const hasAllowlistAccess = unstable_cache(
  // Admin first: an admin never pays the second query, and the tester list
  // is the shorter path for everyone else.
  async (email: string | null | undefined) =>
    (await isRbAdmin(email)) || (await isDeepEdgeTester(email)),
  ["deep-edge-has-access"],
  { revalidate: 300 },
);

export async function hasDeepEdgeAccess(userId: string, email: string | null | undefined): Promise<boolean> {
  // The allowlists first, so admins and testers never depend on the pass
  // tables — they keep working before the migration is applied, and if
  // billing is ever misconfigured.
  if (await hasAllowlistAccess(email)) return true;

  try {
    return await unstable_cache(
      () => hasActiveSeasonPass(userId),
      // The environment is in the key because preview and production can share
      // one data cache while taking payments in different Paddle environments.
      ["deep-edge-season-pass", paddleEnvironment() ?? "none", userId],
      { tags: [seasonPassTag(userId)], revalidate: 300 },
    )();
  } catch (err) {
    // Not cached (a rejected lookup is never stored), so this denies one
    // request rather than the whole window.
    console.error("[deep-edge] season pass lookup failed:", err);
    return false;
  }
}
