import "server-only";
import { unstable_cache } from "next/cache";
import { isRbAdmin } from "@/lib/rookie-board-store";
import { isDeepEdgeTester } from "@/lib/deep-edge/testers";

/**
 * Cached access check shared by all three Deep Edge gates:
 * src/app/deep-edge/layout.tsx (force-dynamic by design, so it can never
 * skip its own check — see that file's comment), src/lib/deep-edge/guard.ts,
 * and src/lib/fantrax/guard.ts. Every one of those runs independently on
 * every request (the layout can't be statically optimized, and each Deep
 * Edge tool's API route re-checks itself too), so a single page load/tool
 * switch was paying an uncached DB round trip up to three times (Ash,
 * 2026-08-19 — reported prod lag, investigated alongside the lineup-solver
 * freeze in lib/fantrax/lineup.ts). Both allowlists are small, manually
 * maintained and change rarely, so a short cache is a safe trade:
 * unstable_cache sidesteps the route-segment fetchCache heuristic entirely
 * (same reasoning as league-cache.ts's getCachedLeagueAnalysis), so this
 * works even under the layout's force-dynamic export.
 *
 * TWO allowlists, one answer:
 *   rb_admins  — full admin. Also gates every /admin/* surface, including
 *                publish rights on the live public dynasty/rookie boards.
 *   de_testers — Deep Edge ONLY. Confers no admin rights whatsoever.
 *
 * Deep Edge accepts either; /admin/* accepts only the first and does not go
 * through this file. That asymmetry is the entire reason de_testers exists —
 * see the migration header — so when adding a pre-launch tester, add them to
 * de_testers, never to rb_admins.
 *
 * Revoking a tester takes up to `revalidate` seconds to take effect. If you
 * ever need an instant revoke, delete the row AND redeploy (a new build
 * invalidates the cache).
 */
export const hasDeepEdgeAccess = unstable_cache(
  // Admin first: an admin never pays the second query, and the tester list
  // is the shorter path for everyone else.
  async (email: string | null | undefined) =>
    (await isRbAdmin(email)) || (await isDeepEdgeTester(email)),
  ["deep-edge-has-access"],
  { revalidate: 300 },
);
