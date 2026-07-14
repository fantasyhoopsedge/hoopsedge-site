import { PlatformSidebarNav } from "@/components/platform-sidebar-nav";
import { createClient } from "@/utils/supabase/server";
import { getProspectLiteMap } from "@/lib/prospects";
import { GAME_SLUG } from "@/lib/draftNight/config";
import type { DnGame, DnMiniGame, DnResult } from "@/types/database";
import { DraftNightClient } from "./_components/draft-night-client";

/**
 * Server entry: loads the static prospect display map (fs-backed CSV) plus the
 * game + mini-games (world-readable once status != 'draft'), then hands off to
 * the client orchestrator which owns auth, sessionStorage, and submit. Wrapped
 * in try/catch so a missing env / un-applied schema renders the
 * "not configured" state instead of crashing the route.
 */
export default async function DraftNightPage() {
  const prospects = getProspectLiteMap();

  let game: DnGame | null = null;
  let minis: DnMiniGame[] = [];
  let result: DnResult | null = null;

  try {
    const supabase = await createClient();
    const { data: g } = await supabase
      .from("dn_games")
      .select("*")
      .eq("slug", GAME_SLUG)
      .maybeSingle();

    if (g) {
      game = g;
      const { data: m } = await supabase
        .from("dn_mini_games")
        .select("*")
        .eq("game_id", g.id)
        .order("sort", { ascending: true });
      minis = m ?? [];

      if (g.status === "resolved") {
        const { data: r } = await supabase
          .from("dn_results")
          .select("*")
          .eq("game_id", g.id)
          .maybeSingle();
        result = r ?? null;
      }
    }
  } catch {
    // env not configured / schema not applied yet — fall through to the
    // not-configured state rendered by the client.
  }

  return (
    <main className="dn-page-shell" style={{ minHeight: "100vh", background: "var(--bg-body)", color: "var(--text-primary)" }}>
      <PlatformSidebarNav active="arena" />
      <DraftNightClient game={game} minis={minis} result={result} prospects={prospects} />
    </main>
  );
}
