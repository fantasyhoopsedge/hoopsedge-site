"use client";

import { SiteNav } from "@/components/site-nav";
import { useAuth } from "@/context/AuthContext";
import { PredictionFeed } from "./_components/prediction-feed";
import { EmailAuthForm } from "./_components/email-auth-form";
import { paStyles } from "./_components/arena-styles";

// ── Reward tier definitions ──────────────────────────────────────────────────
const TIERS = [
  {
    n: 1,
    cadence: "NIGHTLY",
    title: "Quick Calls",
    blurb: "Fast boolean and pick'em questions on tonight's slate. Locked at tip-off, scored by sunrise.",
    reward: "FHE Edge Points",
    rewardDetail: "Stack points every night you call it right.",
    accent: "var(--blueprint)",
    badgeBg: "rgba(37, 99, 235, 0.12)",
    icon: "⚡",
  },
  {
    n: 2,
    cadence: "MONTHLY",
    title: "Trend Lines",
    blurb: "Single and multi-choice calls on monthly leaders, breakouts, and fades. Higher stakes, bigger swings.",
    reward: "Analyst Badges",
    rewardDetail: "Top monthly accuracy earns the badge on your profile.",
    accent: "var(--edge-orange)",
    badgeBg: "rgba(255, 107, 43, 0.12)",
    icon: "📈",
  },
  {
    n: 3,
    cadence: "SEASONAL",
    title: "The Long Game",
    blurb: "Ranking-style predictions on awards, standings, and dynasty risers — settled when the season is.",
    reward: '"Called It" Cards',
    rewardDetail: "Permanent, timestamped proof you saw it coming.",
    accent: "var(--dynasty-gold)",
    badgeBg: "rgba(240, 192, 64, 0.12)",
    icon: "🏆",
  },
] as const;

// ── Featured live game: Draft Night Challenge ────────────────────────────────
function DraftNightFeature() {
  return (
    <a
      href="/draft-night"
      style={{
        display: "block",
        textDecoration: "none",
        background: "linear-gradient(135deg, rgba(240,192,64,0.14), var(--bg-card))",
        border: "1px solid var(--dynasty-gold)",
        borderRadius: "16px",
        padding: "24px 28px",
        marginBottom: "32px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <span className="pa-chip" style={{ background: "rgba(240,192,64,0.15)", color: "var(--dynasty-gold)" }}>
            🏆 LIVE NOW · DRAFT NIGHT
          </span>
          <h2 style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 800, fontSize: "1.8rem", textTransform: "uppercase", margin: "10px 0 6px", color: "var(--text-primary)" }}>
            The Draft Night Challenge
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "15px", maxWidth: 560, margin: 0, lineHeight: 1.5 }}>
            Four fast mini-games on the 2026 NBA Draft. Mock the lottery, call the head-to-heads, and lock your picks before tip-off.
          </p>
        </div>
        <span
          style={{
            background: "var(--edge-orange)", color: "#fff",
            fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: "14px",
            letterSpacing: "1.5px", textTransform: "uppercase",
            padding: "14px 26px", borderRadius: "10px", whiteSpace: "nowrap",
          }}
        >
          Play now →
        </span>
      </div>
    </a>
  );
}

// ── Skeleton (loading) state ─────────────────────────────────────────────────
function ArenaSkeleton() {
  return (
    <div className="pa-wrap" aria-busy="true" aria-label="Loading Prediction Arena">
      <div className="pa-skel pa-skel-badge" />
      <div className="pa-skel pa-skel-title" />
      <div className="pa-skel pa-skel-sub" />
      <div className="pa-tier-grid">
        {[0, 1, 2].map((i) => (
          <div key={i} className="pa-card">
            <div className="pa-skel pa-skel-chip" />
            <div className="pa-skel pa-skel-line-lg" />
            <div className="pa-skel pa-skel-line" />
            <div className="pa-skel pa-skel-line" style={{ width: "70%" }} />
            <div className="pa-skel pa-skel-pill" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Signed-out landing state ─────────────────────────────────────────────────
function ArenaLanding({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="pa-wrap">
      <span className="pa-eyebrow">FHE PREDICTION ARENA</span>
      <h1 className="pa-h1">
        Make the call. <span style={{ color: "var(--edge-orange)" }}>Earn the edge.</span>
      </h1>
      <p className="pa-lede">
        Three tiers of NBA prediction games. Every question locks on a hard deadline,
        every result is scored on the record — no edits, no take-backs, no revisionist history.
      </p>

      <DraftNightFeature />

      <div className="pa-tier-grid">
        {TIERS.map((t) => (
          <div key={t.n} className="pa-card" style={{ borderTop: `3px solid ${t.accent}` }}>
            <div className="pa-card-head">
              <span className="pa-chip" style={{ background: t.badgeBg, color: t.accent }}>
                TIER {t.n} · {t.cadence}
              </span>
              <span className="pa-icon" aria-hidden>{t.icon}</span>
            </div>
            <h2 className="pa-card-title">{t.title}</h2>
            <p className="pa-card-blurb">{t.blurb}</p>
            <div className="pa-reward">
              <span className="pa-reward-label">REWARD</span>
              <span className="pa-reward-name" style={{ color: t.accent }}>{t.reward}</span>
              <span className="pa-reward-detail">{t.rewardDetail}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="pa-cta-zone">
        <EmailAuthForm />
        <div className="pa-divider"><span>or</span></div>
        <button type="button" className="pa-google-btn" onClick={onSignIn}>
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          Continue with Google
        </button>
        <p className="pa-cta-note">
          Free to play. Your prediction record starts the moment you make your first call.
        </p>
      </div>
    </div>
  );
}

// ── Signed-in dashboard state ────────────────────────────────────────────────
function ArenaDashboard() {
  const { user, profile, signOut } = useAuth();
  const displayName =
    profile?.username ?? user?.user_metadata?.full_name ?? "Analyst";

  return (
    <div className="pa-wrap">
      <div className="pa-welcome">
        <div className="pa-welcome-id">
          {profile?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatar_url} alt="" className="pa-avatar" referrerPolicy="no-referrer" />
          ) : (
            <div className="pa-avatar pa-avatar-fallback" aria-hidden>
              {displayName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <span className="pa-eyebrow">WELCOME BACK</span>
            <h1 className="pa-h1" style={{ margin: 0, fontSize: "1.8rem" }}>{displayName}</h1>
          </div>
        </div>

        <div className="pa-stats">
          <div className="pa-stat">
            <span className="pa-stat-value" style={{ color: "var(--edge-orange)" }}>
              {(profile?.edge_points ?? 0).toLocaleString()}
            </span>
            <span className="pa-stat-label">EDGE POINTS</span>
          </div>
          <div className="pa-stat">
            <span
              className="pa-stat-value"
              style={{ color: profile?.analyst_badge ? "var(--dynasty-gold)" : "var(--text-muted)" }}
            >
              {profile?.analyst_badge ? "🏅 EARNED" : "—"}
            </span>
            <span className="pa-stat-label">ANALYST BADGE</span>
          </div>
          <button type="button" className="pa-signout" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>

      <DraftNightFeature />

      <PredictionFeed />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function PredictionArenaPage() {
  const { user, loading, signInWithGoogle } = useAuth();

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg-body)", color: "var(--text-primary)" }}>
      <SiteNav />
      {loading ? (
        <ArenaSkeleton />
      ) : user ? (
        <ArenaDashboard />
      ) : (
        <ArenaLanding onSignIn={() => void signInWithGoogle()} />
      )}
      <style>{paStyles}</style>
    </main>
  );
}
