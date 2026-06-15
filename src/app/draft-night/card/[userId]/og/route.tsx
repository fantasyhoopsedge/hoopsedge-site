import { ImageResponse } from "next/og";
import { createAdminClient } from "@/utils/supabase/admin";
import { GAME_SLUG } from "@/lib/draftNight/config";
import { combinedScore, calledItBonus } from "@/lib/draftNight/grader";
import { MINI_META } from "../../../_components/meta";
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
 * The auto-generated "Called It" share card OG image (handoff §5).
 * Served at /draft-night/card/[userId]/og so it can coexist with the
 * in-browser page at /draft-night/card/[userId].
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
        .select("mini_game_id, score, called_it")
        .eq("user_id", userId);

      const scored = (preds ?? []).filter((p) => typeof p.score === "number");
      if (scored.length) {
        const calledItCount = scored.filter((p) => p.called_it).length;
        if (!combined) combined = combinedScore(scored.map((p) => p.score as number), calledItCount);

        if (calledItCount >= 2) {
          const bonus = calledItBonus(calledItCount);
          const names = scored
            .filter((p) => p.called_it)
            .map((p) => { const k = keyById.get(p.mini_game_id); return k ? MINI_META[k].title : ""; })
            .filter(Boolean)
            .join("  ·  ");
          flex = `${names}  ·  +${bonus} Called It bonus`;
        } else if (calledItCount === 1) {
          const cp = scored.find((p) => p.called_it);
          const k = cp ? keyById.get(cp.mini_game_id) : null;
          flex = k ? `Called It: ${MINI_META[k].title}` : "Called It!";
        } else {
          const best = scored.reduce((a, b) => ((b.score as number) > (a.score as number) ? b : a));
          const bestKey = keyById.get(best.mini_game_id);
          if (bestKey && (best.score as number) > 0) flex = `${MINI_META[bestKey].title}: +${best.score}`;
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
