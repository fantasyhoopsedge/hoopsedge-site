"use client";

/** Horizontal strength/percentage bar — 8px pill track, filled width = ratio. */
export function StrengthBar({ ratio, title, color }: { ratio: number; title?: string; color?: string }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div
      title={title}
      style={{
        width: "100%",
        minWidth: 80,
        height: 8,
        borderRadius: 100,
        background: "var(--rt-surface-strong)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: 100,
          background: color ?? "var(--rt-ink)",
        }}
      />
    </div>
  );
}
