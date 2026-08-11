"use client";

import Link from "next/link";
import { OnboardingShell } from "./_components/onboarding-shell";
import { IconClose } from "./_components/icons";

export default function DeepEdgeWelcomePage() {
  return (
    <OnboardingShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 26, height: 26, borderRadius: 8, background: "var(--rt-primary)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontFamily: "var(--rt-font-mono)", fontWeight: 700, fontSize: 13,
            }}
          >
            F
          </span>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "0.02em" }}>
            THE DEEP <span style={{ color: "var(--rt-primary)" }}>EDGE</span>
          </span>
        </div>
        <Link
          href="/deep-edge/exit"
          style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--rt-muted)", fontSize: 13, textDecoration: "none" }}
        >
          <IconClose size={15} /> Exit
        </Link>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px 80px", textAlign: "center" }}>
        <span
          style={{
            display: "inline-block", padding: "6px 16px", borderRadius: 100,
            background: "var(--rt-surface-soft)", border: "1px solid var(--rt-hairline)",
            fontFamily: "var(--rt-font-mono)", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
            color: "var(--rt-muted)", textTransform: "uppercase", marginBottom: 28,
          }}
        >
          Welcome to the deep edge
        </span>

        <h1 style={{ fontSize: "clamp(40px, 6vw, 64px)", fontWeight: 700, lineHeight: 1.05, margin: 0, maxWidth: 760 }}>
          Go deep on your dynasty.
        </h1>
        <p style={{ marginTop: 18, fontSize: 17, color: "var(--rt-body)", maxWidth: 520 }}>
          Connect your league to get the most from your subscription. You can always explore first.
        </p>

        <div style={{ display: "flex", gap: 20, marginTop: 44, width: "100%", maxWidth: 760, flexWrap: "wrap", justifyContent: "center" }}>
          <div
            style={{
              flex: "1 1 320px", textAlign: "left", padding: 28, borderRadius: 24,
              background: "var(--rt-surface-dark-elevated)", border: "1px solid var(--rt-primary)",
            }}
          >
            <span
              style={{
                display: "inline-block", padding: "4px 10px", borderRadius: 100, marginBottom: 14,
                background: "rgba(250,70,22,0.16)", color: "var(--rt-primary)",
                fontFamily: "var(--rt-font-mono)", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em",
              }}
            >
              RECOMMENDED
            </span>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 10px" }}>Connect your fantasy league</h2>
            <p style={{ color: "var(--rt-body)", fontSize: 14.5, lineHeight: 1.5, margin: "0 0 22px" }}>
              Import your roster, scoring and settings so every ranking, trade and projection is tuned to{" "}
              <strong style={{ color: "var(--rt-ink)" }}>your</strong> league.
            </p>
            <Link
              href="/deep-edge/providers"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center", height: 44, padding: "0 22px",
                borderRadius: 100, background: "var(--rt-primary)", color: "#fff", fontWeight: 700, fontSize: 14.5,
                textDecoration: "none",
              }}
            >
              Connect your league
            </Link>
          </div>

          <div
            style={{
              flex: "1 1 320px", textAlign: "left", padding: 28, borderRadius: 24,
              background: "var(--rt-surface-dark)", border: "1px solid var(--rt-hairline)",
            }}
          >
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 10px" }}>Explore without connecting</h2>
            <p style={{ color: "var(--rt-body)", fontSize: 14.5, lineHeight: 1.5, margin: "0 0 22px" }}>
              Look around The Deep Edge&apos;s tools with sample data before you link a real league.
            </p>
            <Link
              href="/deep-edge/home?explore=1"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center", height: 44, padding: "0 22px",
                borderRadius: 100, background: "transparent", color: "var(--rt-ink)", fontWeight: 700, fontSize: 14.5,
                border: "1px solid var(--rt-hairline)", textDecoration: "none",
              }}
            >
              Explore the tool
            </Link>
          </div>
        </div>

        <p style={{ marginTop: 40, color: "var(--rt-muted)", fontSize: 12.5 }}>
          Included with your Fantasy Hoops Edge subscription.
        </p>
      </div>
    </OnboardingShell>
  );
}
