import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/utils/supabase/admin";
import { GAME_SLUG } from "@/lib/draftNight/config";
import { calledItBonus } from "@/lib/draftNight/grader";
import { MINI_META } from "../../_components/meta";
import type { DnMiniGameKey } from "@/types/database";

type Props = { params: Promise<{ userId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { userId } = await params;
  const ogUrl = `/draft-night/card/${userId}/og`;
  return {
    title: "Called It Card — FHE Draft Night Challenge",
    openGraph: {
      title: "FHE Draft Night Challenge — Called It",
      images: [{ url: ogUrl, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", images: [ogUrl] },
  };
}

export default async function CalledItCardPage({ params }: Props) {
  const { userId } = await params;

  let name = "Analyst";
  let score = 0;
  let rank: number | null = null;
  let pct: number | null = null;
  let calledItMinis: DnMiniGameKey[] = [];
  let calledItCards = 0;
  let resolved = false;

  try {
    const admin = createAdminClient();

    const { data: game } = await admin
      .from("dn_games")
      .select("id, status")
      .eq("slug", GAME_SLUG)
      .single();

    if (game && game.status === "resolved") {
      resolved = true;

      const { data: lb } = await admin
        .from("dn_leaderboard")
        .select("score, rank, percentile, username, called_it_cards")
        .eq("game_id", game.id)
        .eq("user_id", userId)
        .maybeSingle();

      if (lb) {
        score = lb.score;
        rank = lb.rank;
        pct = Math.round(lb.percentile * 100);
        calledItCards = lb.called_it_cards;
        if (lb.username) name = lb.username;
      }

      const { data: minis } = await admin
        .from("dn_mini_games")
        .select("id, key")
        .eq("game_id", game.id);
      const keyById = new Map((minis ?? []).map((m) => [m.id, m.key as DnMiniGameKey]));

      const { data: preds } = await admin
        .from("dn_predictions")
        .select("mini_game_id, called_it")
        .eq("user_id", userId);

      calledItMinis = (preds ?? [])
        .filter((p) => p.called_it)
        .map((p) => keyById.get(p.mini_game_id))
        .filter((k): k is DnMiniGameKey => k != null);
    }
  } catch {
    // env / schema not applied yet — fall through to the not-ready state
  }

  const bonus = calledItBonus(calledItCards);
  const topPct = pct !== null ? Math.max(1, 100 - pct) : null;

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg-body)", color: "var(--text-primary)" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "104px 24px 96px" }}>

        <span style={{
          fontFamily: "'Oswald', sans-serif", fontSize: 12, fontWeight: 600,
          letterSpacing: 4, textTransform: "uppercase" as const, color: "var(--edge-orange)",
          display: "block", marginBottom: 14,
        }}>
          FHE DRAFT NIGHT CHALLENGE · 2026
        </span>

        {!resolved ? (
          <>
            <h1 style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 800, fontSize: 40, textTransform: "uppercase" as const, lineHeight: 1.05, marginBottom: 16 }}>
              Results pending
            </h1>
            <p style={{ fontSize: 16, color: "var(--text-secondary)", marginBottom: 32 }}>
              Called It cards are awarded after the draft is graded. Check back once picks lock on June 23.
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 800, fontSize: 40, textTransform: "uppercase" as const, lineHeight: 1.05, marginBottom: 24 }}>
              {name}&apos;s{" "}
              <span style={{ color: "var(--edge-orange)" }}>Called It</span> Card
            </h1>

            {/* Score hero */}
            <div style={{
              display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" as const,
              background: "var(--bg-card)", border: "1px solid var(--border-main)",
              borderRadius: 18, padding: "28px 32px", marginBottom: 32,
            }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "'Oswald', sans-serif", letterSpacing: 2, marginBottom: 4 }}>DRAFT NIGHT SCORE</div>
                <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 800, fontSize: 72, lineHeight: 1, color: "var(--dynasty-gold)" }}>
                  {score.toLocaleString()}
                </div>
              </div>
              {rank && (
                <div style={{ borderLeft: "1px solid var(--border-main)", paddingLeft: 28 }}>
                  <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: 22, textTransform: "uppercase" as const, color: "var(--text-primary)" }}>
                    RANK #{rank}
                  </div>
                  {topPct !== null && (
                    <div style={{ fontSize: 14, color: "var(--green-elite)", fontWeight: 600, marginTop: 4 }}>
                      Top {topPct}%
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Called It cards */}
            {calledItMinis.length > 0 ? (
              <>
                <h2 style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: 1, textTransform: "uppercase" as const, marginBottom: 14 }}>
                  Called It
                </h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
                  {calledItMinis.map((key) => {
                    const meta = MINI_META[key];
                    return (
                      <div key={key} style={{
                        display: "flex", alignItems: "center", gap: 12,
                        background: "var(--bg-card)", border: "1px solid var(--border-main)",
                        borderLeft: `4px solid ${meta.accent}`, borderRadius: 12, padding: "14px 16px",
                      }}>
                        <span style={{ fontSize: 24 }} aria-hidden>{meta.icon}</span>
                        <span>
                          <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 14, textTransform: "uppercase" as const, letterSpacing: 0.5, color: "var(--text-primary)" }}>
                            {meta.title}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--green-elite)", fontWeight: 600, marginTop: 2 }}>
                            Perfect ✓
                          </div>
                        </span>
                      </div>
                    );
                  })}
                </div>
                {bonus > 0 ? (
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 32,
                    background: "rgba(240,192,64,0.10)", border: "1px solid rgba(240,192,64,0.30)",
                    borderRadius: 10, padding: "10px 16px", fontSize: 13,
                    fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: "var(--dynasty-gold)",
                  }}>
                    ⭐ {calledItCards} Called It cards · +{bonus} bonus included in score
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 32 }}>
                    1 Called It card — get 2+ perfect games for a score bonus
                  </p>
                )}
              </>
            ) : (
              <div style={{
                background: "var(--bg-card)", border: "1px solid var(--border-main)",
                borderRadius: 14, padding: "24px 28px", marginBottom: 32,
              }}>
                <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: 16, textTransform: "uppercase" as const, marginBottom: 8 }}>
                  No Called It cards this year
                </div>
                <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                  A Called It card is awarded for a perfect score in any single mini-game. See you at the next draft.
                </p>
              </div>
            )}
          </>
        )}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" as const }}>
          <Link
            href="/draft-night"
            style={{
              display: "inline-block", background: "var(--bg-card)",
              border: "1px solid var(--border-main)", color: "var(--text-primary)",
              fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 14,
              letterSpacing: 1, textTransform: "uppercase" as const,
              padding: "14px 24px", borderRadius: 10, textDecoration: "none",
            }}
          >
            ← Draft Night
          </Link>
        </div>

      </div>
    </main>
  );
}
