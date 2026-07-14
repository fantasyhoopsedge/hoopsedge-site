import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary-light" | "outline-on-dark" | "tertiary";
type ButtonSize = "sm" | "md" | "lg";

const SIZES: Record<ButtonSize, { height: number; padding: string; font: string }> = {
  sm: { height: 36, padding: "0 16px", font: "14px" },
  md: { height: 44, padding: "0 20px", font: "16px" },
  lg: { height: 56, padding: "0 32px", font: "16px" },
};

const VARIANTS: Record<ButtonVariant, CSSProperties> = {
  primary: { background: "var(--rt-primary)", color: "var(--rt-on-primary)", border: "none" },
  "secondary-light": { background: "var(--rt-surface-strong)", color: "var(--rt-ink)", border: "none" },
  "outline-on-dark": { background: "transparent", color: "var(--rt-on-dark)", border: "1px solid rgba(255,255,255,0.45)" },
  tertiary: { background: "transparent", color: "var(--rt-primary)", border: "none", padding: "0 4px" },
};

type SharedProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  style?: CSSProperties;
  children: ReactNode;
};

type LinkButtonProps = SharedProps & { href: string } & Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    "href" | "style" | "children"
  >;

type NativeButtonProps = SharedProps & { href?: undefined } & Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "style" | "children"
  >;

export function Button(props: LinkButtonProps | NativeButtonProps) {
  const { variant = "primary", size = "md", style, children } = props;
  const s = SIZES[size];
  const disabled = "disabled" in props && props.disabled;
  const baseStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: s.height,
    padding: s.padding,
    fontFamily: "var(--rt-font-sans)",
    fontSize: s.font,
    fontWeight: 600,
    lineHeight: 1.15,
    borderRadius: 100,
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    textDecoration: "none",
    transition: "background 120ms ease, opacity 120ms ease",
    opacity: disabled ? 0.4 : 1,
    ...VARIANTS[variant],
    ...style,
  };

  if (props.href) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit from `rest`
    const { href, variant: _v, size: _s, style: _st, children: _ch, ...rest } = props;
    return (
      <Link href={href} style={baseStyle} {...rest}>
        {children}
      </Link>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit from `rest`
  const { variant: _v, size: _s, style: _st, children: _ch, href: _h, type, ...rest } = props as NativeButtonProps;
  return (
    <button type={type ?? "button"} style={baseStyle} {...rest}>
      {children}
    </button>
  );
}
