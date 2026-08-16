import Link from "next/link";
import { BRAND_LOGO_HEIGHT } from "@/lib/brand";

type FooterLink = { label: string; href: string };

const COLUMNS: { heading: string; links: FooterLink[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "Dynasty Consensus Rankings", href: "/dynasty-rankings" },
      { label: "Real Salary Rankings", href: "/real-salary-rankings" },
      { label: "Player value rankings", href: "/seasonal-rankings" },
      { label: "Rookie draft board", href: "/draft-board" },
      { label: "NBA team rosters", href: "/team-rosters" },
      { label: "Predictions Arena", href: "/prediction-arena" },
    ],
  },
  {
    heading: "Company",
    links: [{ label: "Contact", href: "/contact" }],
  },
];

export function Footer({ className }: { className?: string }) {
  return (
    <footer
      className={className}
      data-theme="light"
      style={{
        display: "block",
        padding: 0,
        gap: 0,
        background: "var(--rt-canvas)",
        borderTop: "1px solid var(--rt-ink)",
      }}
    >
      <div
        className="site-footer-grid"
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "64px 24px 32px",
          display: "grid",
          gap: 32,
        }}
      >
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element -- brand SVG lockup, no next/image config needed */}
          <img src="/brand/logo-wordmark.svg" alt="Fantasy Hoops Edge" style={{ height: BRAND_LOGO_HEIGHT, width: "auto" }} />
          <p
            style={{
              fontFamily: "var(--rt-font-sans)",
              fontSize: 13,
              color: "var(--rt-muted)",
              margin: "16px 0 0",
              maxWidth: 220,
              lineHeight: 1.5,
            }}
          >
            Dynasty intelligence for serious fantasy basketball managers.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.heading}>
            <div
              style={{
                fontFamily: "var(--rt-font-sans)",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--rt-ink)",
                marginBottom: 14,
              }}
            >
              {col.heading}
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link
                    href={l.href}
                    style={{ fontFamily: "var(--rt-font-sans)", fontSize: 14, color: "var(--rt-body)", textDecoration: "none" }}
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "24px 24px 40px",
          borderTop: "1px solid var(--rt-hairline)",
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <span style={{ fontFamily: "var(--rt-font-sans)", fontSize: 13, color: "var(--rt-muted)" }}>
          © {new Date().getFullYear()} Fantasy Hoops Edge. All rights reserved.
        </span>
        <div style={{ display: "flex", gap: 16 }}>
          <Link href="/privacy" style={{ fontFamily: "var(--rt-font-sans)", fontSize: 13, color: "var(--rt-muted)", textDecoration: "none" }}>
            Privacy
          </Link>
          <Link href="/terms" style={{ fontFamily: "var(--rt-font-sans)", fontSize: 13, color: "var(--rt-muted)", textDecoration: "none" }}>
            Terms
          </Link>
        </div>
      </div>
    </footer>
  );
}
