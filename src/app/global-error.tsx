"use client"; // Error boundaries must be Client Components

/**
 * Last-resort boundary for errors in the root layout itself. It replaces the
 * root layout, so it must ship its own <html>/<body> and inline styles (the
 * app's global CSS isn't available here).
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0b0e14", color: "#cbd5e1", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
          <div style={{
            maxWidth: 440, width: "100%", textAlign: "center",
            background: "#141414", border: "1px solid #2a2a30", borderRadius: 16, padding: "40px 32px",
          }}>
            <div style={{ fontSize: 34, marginBottom: 14 }}>⚠️</div>
            <h1 style={{ fontSize: 22, color: "#fff", margin: "0 0 10px", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: 14, lineHeight: 1.6, margin: "0 0 24px" }}>
              The site hit an unexpected error. Reloading usually clears it.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "#f97316", color: "#1a0e00", fontWeight: 700, border: "none",
                borderRadius: 8, padding: "10px 18px", cursor: "pointer", fontSize: 14,
              }}
            >
              Reload page
            </button>
            {error?.digest && (
              <p style={{ marginTop: 20, fontSize: 11, color: "#64748b" }}>Ref: {error.digest}</p>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}
