/**
 * Runnable entrypoint for Draft Night resolution (handoff §4).
 *
 * Prerequisite: fill dn_results.picks with the official order ({ slug: pick }
 * for picks 1..60) via the Supabase table editor first.
 *
 *   npx tsx scripts/resolve-draft-night.ts            # resolves draft-night-2026
 *   npx tsx scripts/resolve-draft-night.ts <gameSlug> # resolves another game
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment.
 */
import { resolveDraftNight } from "../src/lib/draftNight/resolve";
import { GAME_SLUG } from "../src/lib/draftNight/config";

const slug = process.argv[2] ?? GAME_SLUG;

resolveDraftNight(slug)
  .then((summary) => {
    console.log(
      `Resolved ${summary.gameSlug}: graded ${summary.graded} prediction(s) across ${summary.miniGames} mini-games.`,
    );
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
