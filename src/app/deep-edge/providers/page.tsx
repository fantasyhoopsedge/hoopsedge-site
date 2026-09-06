"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OnboardingShell } from "../_components/onboarding-shell";
import { FantraxConnectModal } from "../_components/fantrax-connect-modal";
import { PlaceholderConnectModal } from "../_components/placeholder-connect-modal";
import { IconChevronLeft } from "../_components/icons";
import { readFantraxSession } from "../_lib/fantrax-session";

type Platform = "fantrax" | "yahoo" | "espn" | "sleeper";

const PLATFORMS: { id: Platform; name: string; promoted?: boolean }[] = [
  { id: "fantrax", name: "Fantrax", promoted: true },
  { id: "yahoo", name: "Yahoo" },
  { id: "espn", name: "ESPN" },
  { id: "sleeper", name: "Sleeper" },
];

export default function DeepEdgeProvidersPage() {
  const router = useRouter();
  const [modal, setModal] = useState<Platform | null>(null);
  const [connected, setConnected] = useState<Record<Platform, boolean>>({
    fantrax: false, yahoo: false, espn: false, sleeper: false,
  });

  // Sync from sessionStorage after mount, not during initial render — reading
  // it eagerly (e.g. via a useState initializer) would return the real value
  // on the client but not the server, causing a hydration mismatch. Same
  // pattern as admin/fantrax/_connector.tsx's own session restore.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external-system read (sessionStorage), not derived from props/state; see comment above
    if (readFantraxSession().connected) setConnected((c) => ({ ...c, fantrax: true }));
  }, []);

  function onFantraxConnected() {
    setConnected((c) => ({ ...c, fantrax: true }));
    setModal(null);
    router.push("/deep-edge/home");
  }

  return (
    <OnboardingShell>
      <div style={{ padding: "24px 32px" }}>
        {/* Points at the hub, NOT /deep-edge: that route is now a redirect
            that sends anyone without a connected league straight back here,
            so "Go back" pointing at it would trap you in a loop on exactly
            the screen you were trying to leave. /deep-edge/home renders
            either way — it degrades to a locked grid when no league is
            connected — so it is safe with or without one. */}
        <Link href="/deep-edge/home" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--rt-muted)", fontSize: 13.5, textDecoration: "none" }}>
          <IconChevronLeft size={14} /> Go back
        </Link>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 24px 80px" }}>
        <h1 style={{ fontSize: 36, fontWeight: 700, margin: "0 0 10px", textAlign: "center" }}>Connect your league</h1>
        <p style={{ color: "var(--rt-body)", fontSize: 15, margin: "0 0 40px", textAlign: "center" }}>
          Pick your platform — we import everything automatically.
        </p>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center", maxWidth: 900 }}>
          {PLATFORMS.map((p) => (
            <div
              key={p.id}
              style={{
                flex: "1 1 190px", maxWidth: 210, padding: 22, borderRadius: 20, textAlign: "center",
                background: "var(--rt-surface-dark)",
                border: p.promoted ? "1px solid var(--rt-primary)" : "1px solid var(--rt-hairline)",
              }}
            >
              <div
                style={{
                  width: 44, height: 44, borderRadius: 12, margin: "0 auto 14px", display: "flex",
                  alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16,
                  fontFamily: "var(--rt-font-mono)", background: "var(--rt-surface-dark-elevated)", color: "var(--rt-ink)",
                }}
              >
                {p.name[0]}
              </div>
              <h3 style={{ fontSize: 15.5, fontWeight: 700, margin: "0 0 14px" }}>{p.name}</h3>
              <button
                type="button"
                onClick={() => setModal(p.id)}
                style={{
                  width: "100%", height: 38, borderRadius: 100, fontWeight: 700, fontSize: 13, cursor: "pointer",
                  background: p.promoted ? "var(--rt-primary)" : "transparent",
                  color: p.promoted ? "#fff" : "var(--rt-ink)",
                  border: p.promoted ? "none" : "1px solid var(--rt-hairline)",
                }}
              >
                {connected[p.id] ? "Connected" : "Connect"}
              </button>
            </div>
          ))}
        </div>
      </div>

      {modal === "fantrax" && (
        <FantraxConnectModal onClose={() => setModal(null)} onConnected={onFantraxConnected} />
      )}
      {modal && modal !== "fantrax" && (
        <PlaceholderConnectModal
          platform={PLATFORMS.find((p) => p.id === modal)!.name}
          onClose={() => setModal(null)}
        />
      )}
    </OnboardingShell>
  );
}
