import "server-only";
import { unstable_cache } from "next/cache";
import { isRbAdmin } from "@/lib/rookie-board-store";

/**
 * Cached admin-allowlist check shared by all three Deep Edge auth gates:
 * src/app/deep-edge/layout.tsx (force-dynamic by design, so it can never
 * skip its own check — see that file's comment), src/lib/deep-edge/guard.ts,
 * and src/lib/fantrax/guard.ts. Every one of those runs independently on
 * every request (the layout can't be statically optimized, and each Deep
 * Edge tool's API route re-checks itself too), so a single page load/tool
 * switch was paying an uncached rb_admins DB round trip up to three times
 * (Ash, 2026-08-19 — reported prod lag, investigated alongside the
 * lineup-solver freeze in lib/fantrax/lineup.ts). rb_admins is a small,
 * manually-maintained allowlist that changes rarely, so a short cache is a
 * safe trade: unstable_cache sidesteps the route-segment fetchCache
 * heuristic entirely (same reasoning as league-cache.ts's
 * getCachedLeagueAnalysis), so this works even under the layout's
 * force-dynamic export.
 */
export const isDeepEdgeAdmin = unstable_cache(
  isRbAdmin,
  ["deep-edge-is-rb-admin"],
  { revalidate: 300 },
);
