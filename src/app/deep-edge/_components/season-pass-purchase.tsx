"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckoutEventNames, initializePaddle, type Paddle } from "@paddle/paddle-js";
import { useAuth } from "@/context/AuthContext";
import { OnboardingShell } from "./onboarding-shell";

/**
 * What a visitor WITHOUT access sees once the season pass is on sale —
 * src/app/deep-edge/layout.tsx renders it in place of the tool, exactly where
 * Launching soon rendered before checkout was configured.
 *
 * Nothing about price is decided here. The layout resolves what to DISPLAY
 * (this user's founding discount, if any), and the checkout route independently
 * decides what to CHARGE and attaches it to the Paddle transaction. This screen
 * only asks for that transaction and opens Paddle's overlay on it.
 *
 * Access is never granted from the browser either. After payment, the screen
 * just keeps refreshing the layout until the webhook has recorded the pass.
 */

type Status = "idle" | "opening" | "confirming" | "slow";

const REFRESH_EVERY_MS = 3000;
const REFRESH_ATTEMPTS = 20;

export function SeasonPassPurchase({
  season,
  fullPriceUsd,
  discountPct,
  claimablePct,
  offerEndLabel,
  signedIn,
  paddleEnvironment,
  clientToken,
}: {
  season: string;
  fullPriceUsd: number;
  /** This user's unspent founding discount, resolved on the server; null for none. */
  discountPct: number | null;
  /** The founding discount a signed-in user could still claim before paying; null when closed or already held. */
  claimablePct: number | null;
  offerEndLabel: string;
  signedIn: boolean;
  paddleEnvironment: "sandbox" | "production";
  clientToken: string;
}) {
  const router = useRouter();
  const { user, openSignUp } = useAuth();
  const paddleRef = useRef<Paddle | null>(null);
  const [paddleReady, setPaddleReady] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceUsd = discountPct ? Math.round(fullPriceUsd * (1 - discountPct / 100)) : fullPriceUsd;

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    initializePaddle({
      token: clientToken,
      environment: paddleEnvironment,
      eventCallback: (event) => {
        if (event.name === CheckoutEventNames.CHECKOUT_COMPLETED) setStatus("confirming");
      },
    })
      .then((paddle) => {
        if (cancelled || !paddle) return;
        paddleRef.current = paddle;
        setPaddleReady(true);
      })
      .catch(() => {
        if (!cancelled) setError("Checkout couldn't load. Refresh the page to try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, clientToken, paddleEnvironment]);

  // After payment the pass arrives by webhook, usually within seconds. Re-render
  // the layout until it lets this user in — which unmounts this screen — and
  // stop asking after a minute rather than refreshing forever.
  useEffect(() => {
    if (status !== "confirming") return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      router.refresh();
      if (attempts >= REFRESH_ATTEMPTS) {
        window.clearInterval(timer);
        setStatus("slow");
      }
    }, REFRESH_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [status, router]);

  const buy = async () => {
    const paddle = paddleRef.current;
    if (!paddle) return;
    setStatus("opening");
    setError(null);
    try {
      const res = await fetch("/api/deep-edge/checkout", { method: "POST" });
      const payload = (await res.json().catch(() => ({}))) as { transactionId?: string; error?: string; code?: string };

      if (res.ok && payload.transactionId) {
        paddle.Checkout.open({ transactionId: payload.transactionId, settings: { variant: "one-page" } });
        setStatus("idle");
        return;
      }
      // Already paid — in this tab or another. Either way the answer is to wait
      // for the pass, not to open a second checkout.
      if (payload.code === "already_owned" || payload.code === "processing") {
        setStatus("confirming");
        return;
      }
      setError(payload.error ?? "Checkout isn't available right now.");
      setStatus("idle");
    } catch {
      setError("We could not reach the server. Please try again.");
      setStatus("idle");
    }
  };

  const claim = async () => {
    if (!user?.email) return;
    setClaiming(true);
    setError(null);
    try {
      const res = await fetch("/api/deep-edge/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "We could not save that just now.");
        return;
      }
      // The layout re-reads the waitlist and passes the discount back down.
      router.refresh();
    } catch {
      setError("We could not reach the server. Please try again.");
    } finally {
      setClaiming(false);
    }
  };

  const waiting = status === "confirming" || status === "slow";

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
          {waiting ? "Unlocking" : "Season pass"}
        </h1>

        <p style={{ margin: "18px 0 0", maxWidth: 540, fontSize: 16.5, lineHeight: 1.55, color: "var(--rt-body)" }}>
          {waiting
            ? "Your payment went through. We're switching The Deep Edge on for your account."
            : "Your league, wired into every ranking, trade tool and projection."}
        </p>

        <div
          style={{
            width: "100%", maxWidth: 500, marginTop: 36, padding: 26, borderRadius: 20,
            background: "var(--rt-surface-dark)", border: "1px solid var(--rt-hairline)", textAlign: "left",
          }}
        >
          {waiting ? (
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "var(--rt-body)" }}>
              {status === "confirming"
                ? "This usually takes a few seconds — this page will open the tool by itself."
                : "It's taking longer than usual. Your payment is safe; refresh this page in a minute. If it still doesn't open, reply to your Paddle receipt and we'll sort it out."}
            </p>
          ) : (
            <>
              <span
                style={{
                  display: "inline-block", padding: "4px 10px", borderRadius: 100,
                  background: discountPct ? "rgba(250,70,22,0.16)" : "var(--rt-surface-strong)",
                  color: discountPct ? "var(--rt-primary)" : "var(--rt-muted)",
                  fontFamily: "var(--rt-font-mono)", fontSize: 10.5, fontWeight: 700,
                  letterSpacing: "0.06em", textTransform: "uppercase",
                }}
              >
                {discountPct ? `Founding price · ${discountPct}% off` : "Season pass"}
              </span>

              <div style={{ marginTop: 13, fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>
                USD ${priceUsd}{" "}
                {discountPct ? (
                  <span style={{ color: "var(--rt-muted)", fontWeight: 500, textDecoration: "line-through" }}>
                    ${fullPriceUsd}
                  </span>
                ) : null}{" "}
                for the {season} season
              </div>
              <p style={{ margin: "7px 0 0", fontSize: 13.5, lineHeight: 1.5, color: "var(--rt-muted)" }}>
                One payment covers you through to the end of the {season} season — a season pass, not a
                subscription.
              </p>

              {!signedIn ? (
                <>
                  <button
                    type="button"
                    onClick={() => openSignUp("/deep-edge", "signup")}
                    className="rt-hover-primary"
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      height: 48, marginTop: 18, padding: "0 24px", borderRadius: 100,
                      background: "var(--rt-primary)", border: "none", color: "#fff",
                      fontFamily: "var(--rt-font-sans)", fontSize: 14.5, fontWeight: 700, cursor: "pointer",
                    }}
                  >
                    Sign in to buy
                  </button>
                  <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--rt-muted-soft)" }}>
                    The pass is tied to a free Fantasy Hoops Edge account.
                  </p>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void buy()}
                    disabled={!paddleReady || status === "opening"}
                    className="rt-hover-primary"
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      height: 48, marginTop: 18, padding: "0 24px", borderRadius: 100,
                      background: "var(--rt-primary)", border: "none", color: "#fff",
                      fontFamily: "var(--rt-font-sans)", fontSize: 14.5, fontWeight: 700,
                      cursor: !paddleReady || status === "opening" ? "not-allowed" : "pointer",
                      opacity: !paddleReady || status === "opening" ? 0.6 : 1,
                    }}
                  >
                    {status === "opening" ? "Opening checkout…" : `Buy for USD $${priceUsd}`}
                  </button>

                  {claimablePct ? (
                    <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--rt-muted)" }}>
                      Not on the founding list?{" "}
                      <button
                        type="button"
                        onClick={() => void claim()}
                        disabled={claiming}
                        style={{
                          padding: 0, border: "none", background: "none", color: "var(--rt-primary)",
                          fontFamily: "inherit", fontSize: "inherit", fontWeight: 600,
                          cursor: claiming ? "not-allowed" : "pointer",
                        }}
                      >
                        {claiming ? "Claiming…" : `Claim ${claimablePct}% off first`}
                      </button>{" "}
                      — open until {offerEndLabel}.
                    </p>
                  ) : null}
                </>
              )}
            </>
          )}

          {error ? <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--rt-down)" }}>{error}</p> : null}
        </div>

        <p style={{ marginTop: 26, fontSize: 12.5, color: "var(--rt-muted-soft)" }}>
          Checkout is handled by Paddle, our payment provider. Fantasy Hoops Edge stays free.
        </p>
      </div>
    </OnboardingShell>
  );
}
