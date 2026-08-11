"use client";

import Link from "next/link";
import { OnboardingShell } from "../_components/onboarding-shell";

export default function DeepEdgeExitPage() {
  return (
    <OnboardingShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
        <span
          style={{
            width: 26, height: 26, borderRadius: 8, background: "var(--rt-primary)", marginBottom: 28,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontFamily: "var(--rt-font-mono)", fontWeight: 700, fontSize: 13,
          }}
        >
          F
        </span>
        <h1 style={{ fontSize: 32, fontWeight: 700, margin: "0 0 14px" }}>You&apos;ve left THE DEEP EDGE.</h1>
        <p style={{ color: "var(--rt-body)", fontSize: 15, maxWidth: 420, lineHeight: 1.5, margin: "0 0 32px" }}>
          Your subscription stays active — come back any time to pick up right where you left off.
        </p>
        <Link
          href="/deep-edge"
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center", height: 46, padding: "0 24px",
            borderRadius: 100, background: "var(--rt-primary)", color: "#fff", fontWeight: 700, fontSize: 14.5,
            textDecoration: "none",
          }}
        >
          Re-enter
        </Link>
      </div>
    </OnboardingShell>
  );
}
