"use client";

import { useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";

type CardVariant = "feature" | "product-light" | "product-dark" | "plain";

const VARIANTS: Record<CardVariant, CSSProperties> = {
  feature: { background: "var(--rt-canvas)", color: "var(--rt-ink)", border: "1px solid var(--rt-hairline)" },
  "product-light": { background: "var(--rt-canvas)", color: "var(--rt-ink)", border: "1px solid var(--rt-hairline)" },
  "product-dark": {
    background: "var(--rt-surface-dark-elevated)",
    color: "var(--rt-on-dark)",
    border: "1px solid rgba(255,255,255,0.06)",
  },
  plain: { background: "var(--rt-surface-soft)", color: "var(--rt-ink)" },
};

export function Card({
  variant = "feature",
  hover = false,
  padding = 32,
  style,
  children,
  ...rest
}: {
  variant?: CardVariant;
  hover?: boolean;
  padding?: number | string;
  style?: CSSProperties;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  const [over, setOver] = useState(false);
  return (
    <div
      onMouseEnter={() => setOver(true)}
      onMouseLeave={() => setOver(false)}
      style={{
        borderRadius: 24,
        padding,
        boxShadow: hover && over ? "0 4px 12px rgba(0,0,0,0.06)" : "none",
        transition: "box-shadow 140ms ease",
        ...VARIANTS[variant],
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
