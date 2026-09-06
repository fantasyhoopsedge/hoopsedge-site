"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

/**
 * The launch gateway — the two-door front page, shown over `/` on desktop and
 * tablet only.
 *
 * Why an overlay on `/` rather than its own route with the marketing page
 * moved to `/home`: `/` is the canonical, sitemap-listed, JSON-LD'd marketing
 * page (src/app/layout.tsx), and moving that content off the root would be a
 * real SEO regression for a purely presentational change. Rendering the
 * gateway as a fixed overlay ABOVE the untouched homepage keeps every word of
 * that page in `/`'s HTML for crawlers while a human sees the two doors.
 *
 * Phones never see it — `.fhe-gate` is display:none below 768px in
 * globals.css, so mobile lands on the existing launch page exactly as before.
 * That is a CSS-only decision on purpose: no UA sniffing in src/proxy.ts, no
 * viewport-dependent JS, and therefore no flash and nothing to get wrong when
 * a crawler renders at an arbitrary width.
 *
 * Dismissal is per SESSION (sessionStorage "fhe-gate"), not per visit: a front
 * door that reappears every time you navigate home would be a nuisance, and
 * "after sign up, return to the Fantasy Hoops Edge launch page" has to land on
 * the marketing page rather than back on the gate. `?enter=1` is how the Deep
 * Edge screens ask for exactly that. The matching pre-paint script lives in
 * src/app/layout.tsx next to the theme init — same class of problem, same fix.
 */

const MARK = (
  /* eslint-disable-next-line @next/next/no-img-element -- brand SVG lockup, no next/image config needed */
  <img src="/brand/logo-mark.svg" alt="" width={36} height={36} aria-hidden />
);

function ArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function Lock() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="10.5" width="16" height="10.5" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

const CHIP: React.CSSProperties = {
  alignSelf: "flex-start",
  padding: "4px 10px",
  borderRadius: 100,
  fontFamily: "var(--rt-font-mono)",
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const CTA: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  height: 48,
  padding: "0 24px",
  borderRadius: 100,
  fontFamily: "var(--rt-font-sans)",
  fontSize: 14.5,
  fontWeight: 700,
  cursor: "pointer",
};

export function LaunchGateway() {
  const router = useRouter();
  const { user, loading, openSignUp } = useAuth();
  const [open, setOpen] = useState(true);
  // Refs, not state: nothing renders from either, so making them state would
  // only mean setting state inside effects (react-hooks/set-state-in-effect)
  // for no benefit. `wantsDeepEdge` means "this visitor asked for The Deep
  // Edge and hasn't arrived yet" — set by the door, by the ?signin redirect
  // the /deep-edge gate sends signed-out visitors back with, and by a click
  // that outran the initial session fetch. `signInPrompted` keeps the effect
  // below from re-opening a modal that is already open.
  const wantsDeepEdge = useRef(false);
  const signInPrompted = useRef(false);

  const dismiss = useCallback(() => {
    try {
      sessionStorage.setItem("fhe-gate", "off");
    } catch {
      // Private mode / storage disabled: the gate simply shows again next time.
    }
    document.documentElement.setAttribute("data-fhe-gate", "off");
    setOpen(false);
  }, []);

  // Whether this visitor already came through the gate this session. The
  // pre-paint script in src/app/layout.tsx has ALREADY decided this and marked
  // the root, so read its answer rather than recomputing one — that keeps the
  // CSS (which is what actually prevents the flash) and this component from
  // ever disagreeing, and means nothing here has to set state during an
  // effect just to re-derive what the document already says.
  const cameThroughRef = useRef(false);

  useEffect(() => {
    cameThroughRef.current = document.documentElement.getAttribute("data-fhe-gate") === "off";

    const params = new URLSearchParams(window.location.search);

    if (params.has("signin")) {
      // Sent here by the /deep-edge gate when a signed-out visitor asked for it.
      wantsDeepEdge.current = true;
      signInPrompted.current = true;
      openSignUp("/deep-edge", "login");
    }

    // Tidy the URL so `/` is what the visitor sees and shares. The params are
    // one-shot instructions to this component, not state worth keeping.
    if (params.has("enter") || params.has("signin")) {
      params.delete("enter");
      params.delete("signin");
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `/?${qs}` : "/");
    }
  }, [openSignUp]);

  // Carry an outstanding Deep Edge request to its destination once auth
  // settles: straight there if they are signed in, otherwise open the modal
  // once. This is what makes a single click enough for a visitor who pressed
  // the door before the initial session fetch finished, and what sends someone
  // onward after they sign in rather than leaving them on the gateway.
  useEffect(() => {
    if (!wantsDeepEdge.current || loading) return;
    if (user) {
      wantsDeepEdge.current = false;
      router.push("/deep-edge");
    } else if (!signInPrompted.current) {
      signInPrompted.current = true;
      openSignUp("/deep-edge", "login");
    }
  }, [loading, user, router, openSignUp]);

  // Lock the page behind the overlay. Scoped to >=768px in globals.css so the
  // class is inert on the phones that never render the gate. Also skipped for
  // a visitor the pre-paint script already hid the gate from — it is still in
  // the DOM for them (display:none, harmless), and locking the page behind an
  // invisible overlay would leave the homepage unscrollable.
  useEffect(() => {
    const root = document.documentElement;
    if (open && !cameThroughRef.current) root.classList.add("fhe-gate-open");
    else root.classList.remove("fhe-gate-open");
    return () => root.classList.remove("fhe-gate-open");
  }, [open]);

  if (!open) return null;

  const enterDeepEdge = () => {
    wantsDeepEdge.current = true;
    if (loading) return; // the effect above picks it up when auth settles
    if (user) {
      wantsDeepEdge.current = false;
      router.push("/deep-edge");
      return;
    }
    signInPrompted.current = true;
    openSignUp("/deep-edge", "login");
  };

  const signedIn = Boolean(user) && !loading;
  const signedOut = !user && !loading;

  return (
    <div className="fhe-gate" data-theme="dark" role="dialog" aria-label="Choose where to go">
      <div className="fhe-gate-inner">
        <header className="fhe-gate-header">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            {MARK}
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.2px", color: "var(--rt-ink)" }}>
              HOOPS <span style={{ color: "var(--rt-primary)" }}>EDGE</span>
            </span>
          </span>

          {signedIn ? (
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 8, height: 32, padding: "0 14px",
                borderRadius: 100, background: "var(--rt-surface-strong)", fontSize: 13, fontWeight: 500,
                color: "var(--rt-body)",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: 100, background: "var(--rt-primary)" }} />
              Signed in
            </span>
          ) : (
            <button
              type="button"
              onClick={() => openSignUp("/deep-edge", "login")}
              style={{
                background: "none", border: "none", padding: 0, cursor: "pointer",
                fontFamily: "var(--rt-font-sans)", fontSize: 14, fontWeight: 500, color: "var(--rt-muted)",
                visibility: loading ? "hidden" : "visible",
              }}
            >
              Sign in
            </button>
          )}
        </header>

        <div className="fhe-gate-body">
          <span
            style={{
              display: "inline-flex", alignItems: "center", padding: "6px 16px", marginBottom: 28,
              borderRadius: 100, background: "var(--rt-surface-soft)", border: "1px solid var(--rt-hairline)",
              fontFamily: "var(--rt-font-mono)", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
              textTransform: "uppercase", color: "var(--rt-muted)",
            }}
          >
            Two ways in
          </span>

          <h1 className="fhe-gate-h1">Choose your edge.</h1>

          <p className="fhe-gate-lede">
            The full dynasty toolkit, open to everyone. Or go deep — with your own league wired into every ranking,
            trade tool and projection.
          </p>

          <div className="fhe-gate-cards">
            {/* Door 1 — the existing launch page, free, no account */}
            <div className="fhe-gate-card" style={{ background: "var(--rt-surface-dark)", border: "1px solid var(--rt-hairline)" }}>
              <span style={{ ...CHIP, background: "var(--rt-surface-strong)", color: "var(--rt-muted)" }}>
                Free · no sign-up
              </span>
              <h2 className="fhe-gate-card-title">Fantasy Hoops Edge</h2>
              <p className="fhe-gate-card-body">
                Top 450 dynasty consensus, the rookie draft board, player category values, real-salary rankings and all
                30 NBA rosters.
              </p>
              <div style={{ flexGrow: 1, minHeight: 24 }} />
              <button
                type="button"
                onClick={dismiss}
                className="fhe-gate-ghost"
                style={{ ...CTA, background: "transparent", border: "1px solid var(--rt-hairline)", color: "var(--rt-ink)" }}
              >
                Enter Fantasy Hoops Edge
                <ArrowRight />
              </button>
              <p className="fhe-gate-note">No account needed. Free to use.</p>
            </div>

            {/* Door 2 — The Deep Edge */}
            <div className="fhe-gate-card" style={{ background: "var(--rt-surface-dark-elevated)", border: "1px solid var(--rt-primary)" }}>
              <span style={{ ...CHIP, background: "rgba(250,70,22,0.16)", color: "var(--rt-primary)" }}>
                Launching soon
              </span>
              <h2 className="fhe-gate-card-title">The Deep Edge</h2>
              <p className="fhe-gate-card-body">
                Connect your league and every ranking, trade tool and projection will re-score to your actual scoring
                format, roster settings and category weights.
              </p>
              <div style={{ flexGrow: 1, minHeight: 24 }} />
              <button
                type="button"
                onClick={enterDeepEdge}
                className="rt-hover-primary"
                style={{ ...CTA, background: "var(--rt-primary)", border: "none", color: "#fff" }}
              >
                {signedOut ? <Lock /> : null}
                {signedOut ? "Sign in to enter" : "Enter The Deep Edge"}
                {signedOut ? null : <ArrowRight />}
              </button>
              <p className="fhe-gate-note">
                {signedOut
                  ? "Sign-in required — you'll need a Fantasy Hoops Edge account."
                  : "Season pass required — founding-price discount inside."}
              </p>
            </div>
          </div>

          <p className="fhe-gate-foot">
            Fantasy Hoops Edge stays free. The Deep Edge will be a paid season pass.
          </p>
        </div>
      </div>
    </div>
  );
}
