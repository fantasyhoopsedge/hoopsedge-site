"use client";

export type WdlResult = "win" | "loss" | "draw";

const RESULT_META: Record<WdlResult, { label: string; color: string; bg: string }> = {
  win: { label: "W", color: "var(--rt-up)", bg: "rgba(22,160,106,0.14)" },
  loss: { label: "L", color: "var(--rt-down)", bg: "rgba(219,43,57,0.14)" },
  draw: { label: "D", color: "var(--rt-muted)", bg: "var(--rt-surface-strong)" },
};

/**
 * 22px colored result circle — no H2H standings concept existed anywhere in
 * the app before Power Rankings, so this had no prior art to reuse.
 */
export function WdlBadge({ result, title }: { result: WdlResult; title?: string }) {
  const meta = RESULT_META[result];
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: "50%",
        background: meta.bg,
        color: meta.color,
        fontFamily: "var(--rt-font-mono)",
        fontSize: 11,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {meta.label}
    </span>
  );
}
