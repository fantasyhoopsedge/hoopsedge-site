import { ImageResponse } from "next/og";
import { createAdminClient } from "@/utils/supabase/admin";
import { GAME_SLUG } from "@/lib/draftNight/config";
import { combinedScore } from "@/lib/draftNight/grader";
import { MINI_META } from "../../_components/meta";
import type { DnMiniGameKey } from "@/types/database";

// Brand tokens (satori needs literal colors, not CSS vars).
const BLACK = "#0A0A0A";
const ORANGE = "#FF6B2B";
const GOLD = "#F0C040";
const BLUE = "#2563EB";
const WHITE = "#FFFFFF";
const MUTED = "#9a9aaa";

const SIZE = { width: 1200, height: 630 };

/**
 * The auto-generated "Called It" share card (handoff §5). Reads the resolved
 * score via the service role so a shared URL renders for anyone (not just the
 * owner, whose predictions are otherwise RLS-protected).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;

  let combined = 0;
  let name = "Analyst";
  let rank: number | null = null;
  let flex = "Locked in their picks";

  try {
    const admin = createAdminClient();

    const { data: game } = await admin
      .from("dn_games")
      .select("id")
      .eq("slug", GAME_SLUG)
      .single();

    if (game) {
      const { data: lb } = await admin
        .from("dn_leaderboard")
        .select("score, rank, username")
        .eq("game_id", game.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (lb) {
        combined = lb.score;
        rank = lb.rank;
        if (lb.username) name = lb.username;
      }

      const { data: minis } = await admin
        .from("dn_mini_games")
        .select("id, key")
        .eq("game_id", game.id);
      const keyById = new Map((minis ?? []).map((m) => [m.id, m.key as DnMiniGameKey]));

      const { data: preds } = await admin
        .from("dn_predictions")
        .select("mini_game_id, score")
        .eq("user_id", userId);

      const scored = (preds ?? []).filter((p) => typeof p.score === "number");
      if (scored.length) {
        if (!combined) combined = combinedScore(scored.map((p) => p.score as number));
        const best = scored.reduce((a, b) => ((b.score as number) > (a.score as number) ? b : a));
        const bestKey = keyById.get(best.mini_game_id);
        if (bestKey && (best.score as number) > 0) {
          flex = `${MINI_META[bestKey].title}: +${best.score}`;
        }
      }
    }
  } catch {
    // env / data missing — render the generic card below
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: `linear-gradient(135deg, ${BLACK} 0%, #0d1a3a 100%)`,
          padding: "64px 72px",
          color: WHITE,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, background: ORANGE, display: "flex" }} />
          <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: 4, color: MUTED }}>
            FHE DRAFT NIGHT CHALLENGE
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
          <span style={{ fontSize: 34, fontWeight: 600, color: WHITE }}>{name} called it.</span>
          <span style={{ display: "flex", fontSize: 200, fontWeight: 800, lineHeight: 1, color: GOLD }}>
            {combined.toLocaleString()}
          </span>
          <span style={{ fontSize: 32, fontWeight: 600, color: ORANGE, marginTop: 8 }}>
            Draft Night Score{rank ? `  ·  Rank #${rank}` : ""}
          </span>
          <span style={{ fontSize: 28, color: MUTED, marginTop: 18 }}>{flex}</span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "auto",
            paddingTop: 32,
            borderTop: `2px solid rgba(255,255,255,0.12)`,
          }}
        >
          <span style={{ fontSize: 26, fontWeight: 700, color: WHITE }}>
            Fantasy<span style={{ color: ORANGE }}>Hoops</span>Edge
          </span>
          <span style={{ fontSize: 24, color: BLUE, fontWeight: 600 }}>@FantasyHoopEdge</span>
        </div>
      </div>
    ),
    SIZE,
  );
}
