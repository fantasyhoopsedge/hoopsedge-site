"use client"; // Error boundaries must be Client Components
import { useEffect } from "react";

/**
 * Route-level error boundary. Wraps the page tree (incl. the nav), so a client
 * or render error degrades to this friendly fallback instead of a blank page.
 * "Try again" re-renders the segment; "Reload" does a full reload, which also
 * pulls the latest build if a tab was left open across a deploy.
 */
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry?: () => void;
}) {
  useEffect(() => {
    console.error("Page error:", error);
  }, [error]);

  const retry = unstable_retry ?? (() => window.location.reload());

  return (
    <main style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      padding: "32px", background: "var(--blueprint, #0b0e14)",
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <div style={{
        maxWidth: 460, width: "100%", textAlign: "center",
        background: "var(--bg-surface, #141414)", border: "1px solid var(--border-main, #2a2a30)",
        borderRadius: 16, padding: "40px 32px", boxShadow: "0 16px 50px rgba(0,0,0,0.4)",
      }}>
        <div style={{ fontSize: 34, marginBottom: 14 }}>⚠️</div>
        <h1 style={{
          fontFamily: "'Oswald', sans-serif", fontSize: 24, color: "#fff", margin: "0 0 10px",
          textTransform: "uppercase", letterSpacing: 0.5,
        }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary, #cbd5e1)", margin: "0 0 24px" }}>
          This page hit a snag. Trying again usually clears it — a full reload pulls the latest version of the site.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={() => retry()} style={btn("primary")}>Try again</button>
          <button onClick={() => window.location.reload()} style={btn("ghost")}>Reload page</button>
          <a href="/" style={{ ...btn("ghost"), textDecoration: "none", lineHeight: "20px" }}>Back to home</a>
        </div>
        {error?.digest && (
          <p style={{ marginTop: 20, fontSize: 11, color: "var(--text-muted, #64748b)", fontFamily: "'JetBrains Mono', monospace" }}>
            Ref: {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}

function btn(kind: "primary" | "ghost"): React.CSSProperties {
  const base: React.CSSProperties = {
    fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: 0.5, textTransform: "uppercase",
    borderRadius: 8, padding: "10px 16px", cursor: "pointer", border: "1px solid transparent",
  };
  if (kind === "primary") return { ...base, background: "var(--edge-orange, #f97316)", color: "#1a0e00", fontWeight: 700 };
  return { ...base, background: "transparent", borderColor: "var(--border-main, #334155)", color: "var(--text-secondary, #cbd5e1)" };
}
