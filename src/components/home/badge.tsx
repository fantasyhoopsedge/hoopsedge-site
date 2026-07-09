import type { CSSProperties, ReactNode } from "react";

type BadgeTone = "neutral" | "brand" | "dark";

const TONES: Record<BadgeTone, CSSProperties> = {
  neutral: { background: "var(--rt-surface-strong)", color: "var(--rt-ink)" },
  brand: { background: "var(--rt-surface-strong)", color: "var(--rt-primary)" },
  dark: { background: "rgba(255,255,255,0.10)", color: "var(--rt-on-dark)" },
};

export function Badge({
  tone = "neutral",
  style,
  children,
}: {
  tone?: BadgeTone;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "5px 12px",
        fontFamily: "var(--rt-font-sans)",
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        borderRadius: 100,
        ...TONES[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}
