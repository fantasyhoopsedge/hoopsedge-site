/** Decorative search-bar mockup for product-UI preview cards — not a live control. */
export function SearchPill({ label = "Search players, picks, teams" }: { label?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 44,
        padding: "0 20px",
        marginBottom: 8,
        background: "var(--rt-surface-strong)",
        borderRadius: 100,
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--rt-muted)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <span style={{ fontFamily: "var(--rt-font-sans)", fontSize: 15, color: "var(--rt-muted)" }}>{label}</span>
    </div>
  );
}
