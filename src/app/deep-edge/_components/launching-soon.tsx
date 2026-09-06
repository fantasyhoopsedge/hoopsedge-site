"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { OnboardingShell } from "./onboarding-shell";

/**
 * What a signed-in NON-admin sees behind the launch gateway's Deep Edge door,
 * in place of the tool itself (src/app/deep-edge/layout.tsx renders this
 * instead of `children`). Replaces the bare "Restricted" block that stood here
 * while the gate was purely internal — now that the gateway sends real
 * visitors down this path, a dead end would be the wrong answer.
 *
 * The price/discount pair is duplicated as props rather than imported, because
 * src/lib/deep-edge/waitlist.ts is server-only ("server-only" import) and this
 * is a Client Component — the layout reads the constants and passes them down,
 * which also keeps what is DISPLAYED and what is STORED provably in sync.
 */
export function LaunchingSoon({
  seasonPassUsd,
  discountPct,
  foundingPriceUsd,
  offerOpen,
  offerEndLabel,
  registeredEmail,
}: {
  seasonPassUsd: number;
  discountPct: number;
  foundingPriceUsd: number;
  /** Resolved on the server and passed down, not computed here: this is a
   *  Client Component, and deciding it at render time would let the server and
   *  the hydrating client disagree across the deadline. The capture API is the
   *  real gate regardless — this only decides what is shown. */
  offerOpen: boolean;
  offerEndLabel: string;
  /** The address this visitor already has a claimable discount against, or
   *  null if they have never registered. Resolved on the server from the
   *  waitlist row, so a returning registrant sees the acknowledgement
   *  immediately rather than the form flashing first and correcting itself. */
  registeredEmail: string | null;
}) {
  const { user } = useAuth();
  const [email, setEmail] = useState(user?.email ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  // Registering in THIS session and arriving already registered are the same
  // screen — the only difference is where the address comes from. Anything
  // truthy here means "acknowledge, do not ask again".
  const confirmedEmail = status === "done" ? email.trim().toLowerCase() : registeredEmail;

  const claim = async () => {
    const value = email.trim();
    if (!value) {
      setError("Enter your email address.");
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch("/api/deep-edge/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "We could not save that just now.");
        setStatus("idle");
        return;
      }
      setStatus("done");
    } catch {
      setError("We could not reach the server. Please try again.");
      setStatus("idle");
    }
  };

  return (
    <OnboardingShell>
      <div style={{ padding: "24px 32px" }}>
        <Link
          href="/?enter=1"
          style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--rt-muted)", fontSize: 13, textDecoration: "none" }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H5" />
            <path d="m11 18-6-6 6-6" />
          </svg>
          Back to Fantasy Hoops Edge
        </Link>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px 24px 80px",
          textAlign: "center",
        }}
      >
        {confirmedEmail ? (
          <>
            <div
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 60, height: 60, borderRadius: 100,
                background: "rgba(22,160,106,0.12)", border: "1px solid rgba(22,160,106,0.4)",
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--rt-up)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h1 style={{ margin: "26px 0 0", fontSize: "clamp(32px, 4.5vw, 46px)", fontWeight: 700, lineHeight: 1.05, letterSpacing: "-1.2px" }}>
              You&apos;re on the list.
            </h1>
            <p style={{ margin: "18px 0 0", maxWidth: 520, fontSize: 16.5, lineHeight: 1.55, color: "var(--rt-body)" }}>
              {discountPct}% off your first season pass is locked to{" "}
              <strong style={{ color: "var(--rt-ink)", fontWeight: 600 }}>{confirmedEmail}</strong>. We&apos;ll
              email you the moment The Deep Edge opens.
            </p>
            <Link
              href="/?enter=1"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                height: 48, marginTop: 34, padding: "0 26px", borderRadius: 100,
                background: "var(--rt-primary)", color: "#fff", fontWeight: 700, fontSize: 14.5, textDecoration: "none",
              }}
              className="rt-hover-primary"
            >
              Back to Fantasy Hoops Edge
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12h14" />
                <path d="m13 6 6 6-6 6" />
              </svg>
            </Link>
          </>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- brand SVG mark, no next/image config needed */}
            <img src="/brand/logo-mark.svg" alt="" width={56} height={56} aria-hidden />

            <div
              style={{
                marginTop: 18,
                fontFamily: "var(--rt-font-mono)",
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.24em",
                textTransform: "uppercase",
                color: "var(--rt-ink)",
              }}
            >
              The Deep <span style={{ color: "var(--rt-primary)" }}>Edge</span>
            </div>

            <h1
              style={{
                margin: "26px 0 0",
                fontSize: "clamp(36px, 5.5vw, 54px)",
                fontWeight: 700,
                lineHeight: 1.02,
                letterSpacing: "-0.6px",
                textTransform: "uppercase",
              }}
            >
              Launching soon
            </h1>

            <p style={{ margin: "18px 0 0", maxWidth: 540, fontSize: 16.5, lineHeight: 1.55, color: "var(--rt-body)" }}>
              Your league, wired into every ranking, trade tool and projection. We&apos;re finishing it now
              {offerOpen ? " — leave your email and we'll hold the founding price for you." : "."}
            </p>

            {offerOpen ? (
            <div
              style={{
                width: "100%", maxWidth: 500, marginTop: 36, padding: 26, borderRadius: 20,
                background: "var(--rt-surface-dark)", border: "1px solid var(--rt-hairline)", textAlign: "left",
              }}
            >
              <span
                style={{
                  display: "inline-block", padding: "4px 10px", borderRadius: 100,
                  background: "rgba(250,70,22,0.16)", color: "var(--rt-primary)",
                  fontFamily: "var(--rt-font-mono)", fontSize: 10.5, fontWeight: 700,
                  letterSpacing: "0.06em", textTransform: "uppercase",
                }}
              >
                Founding price · ends {offerEndLabel}
              </span>

              <div style={{ marginTop: 13, fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>
                {discountPct}% off your first season pass
              </div>
              <p style={{ margin: "7px 0 0", fontSize: 13.5, lineHeight: 1.5, color: "var(--rt-muted)" }}>
                {/* The {" "} after an interpolation is load-bearing: JSX drops a plain space
                    between an expression and text that wraps to the next line, which shipped
                    "USD $35covers" the first time this sentence was written. */}
                The Deep Edge is a season pass, not a subscription: USD ${seasonPassUsd}{" "}
                covers you through to the end of the season. Register by {offerEndLabel} and it&apos;s{" "}
                <strong style={{ color: "var(--rt-ink)", fontWeight: 600 }}>USD ${foundingPriceUsd}</strong>. Leave your
                email and the discount is locked to it — one message when The Deep Edge opens, nothing else.
              </p>

              <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  disabled={status === "saving"}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void claim();
                  }}
                  aria-label="Email address"
                  style={{
                    flex: "1 1 220px", minWidth: 0, height: 48, boxSizing: "border-box", padding: "0 20px",
                    borderRadius: 100, background: "var(--rt-canvas)", border: "1px solid var(--rt-hairline)",
                    color: "var(--rt-ink)", fontFamily: "var(--rt-font-sans)", fontSize: 14.5, outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={() => void claim()}
                  disabled={status === "saving"}
                  className="rt-hover-primary"
                  style={{
                    height: 48, padding: "0 22px", borderRadius: 100, background: "var(--rt-primary)",
                    border: "none", color: "#fff", fontFamily: "var(--rt-font-sans)", fontSize: 14.5,
                    fontWeight: 700, whiteSpace: "nowrap",
                    cursor: status === "saving" ? "not-allowed" : "pointer",
                    opacity: status === "saving" ? 0.6 : 1,
                  }}
                >
                  {status === "saving" ? "Saving…" : `Claim ${discountPct}% off`}
                </button>
              </div>

              {error ? <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--rt-down)" }}>{error}</p> : null}
            </div>
            ) : (
            /* Past the deadline. The form is gone rather than disabled — an
               input you can type into but not submit is worse than no input —
               and the price shown is the real one, with no discount implied.
               Anyone who registered before the cutoff keeps their own row and
               its stored discount_pct; this only closes NEW registrations. */
            <div
              style={{
                width: "100%", maxWidth: 500, marginTop: 36, padding: 26, borderRadius: 20,
                background: "var(--rt-surface-dark)", border: "1px solid var(--rt-hairline)", textAlign: "left",
              }}
            >
              <span
                style={{
                  display: "inline-block", padding: "4px 10px", borderRadius: 100,
                  background: "var(--rt-surface-strong)", color: "var(--rt-muted)",
                  fontFamily: "var(--rt-font-mono)", fontSize: 10.5, fontWeight: 700,
                  letterSpacing: "0.06em", textTransform: "uppercase",
                }}
              >
                Season pass
              </span>

              <div style={{ marginTop: 13, fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>
                USD ${seasonPassUsd} for the season
              </div>
              <p style={{ margin: "7px 0 0", fontSize: 13.5, lineHeight: 1.5, color: "var(--rt-muted)" }}>
                The founding price closed on {offerEndLabel}. A season pass is a one-off payment that covers you
                through to the end of the season — no subscription.
              </p>
            </div>
            )}

            <p style={{ marginTop: 26, fontSize: 12.5, color: "var(--rt-muted-soft)" }}>
              Fantasy Hoops Edge stays free and open while you wait.
            </p>
          </>
        )}
      </div>
    </OnboardingShell>
  );
}
