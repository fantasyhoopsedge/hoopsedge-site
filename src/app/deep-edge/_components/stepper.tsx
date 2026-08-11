"use client";

/** −/value/+ stepper — Teams, Roster & positions, Max contract length,
 *  Rookie draft rounds all use this exact pattern in the design. */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const btn: React.CSSProperties = {
    width: 26, height: 26, borderRadius: "50%", border: "none", background: "var(--rt-surface-strong)",
    color: "var(--rt-ink)", fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex",
    alignItems: "center", justifyContent: "center", lineHeight: 1,
  };
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "4px 6px", borderRadius: 100, background: "var(--rt-surface-soft)" }}>
      <button type="button" onClick={() => onChange(clamp(value - 1))} style={btn} aria-label="Decrease">
        −
      </button>
      <span style={{ minWidth: 28, textAlign: "center", fontFamily: "var(--rt-font-mono)", fontSize: 14, fontWeight: 700 }}>
        {value}
        {suffix ? <span style={{ fontWeight: 400, color: "var(--rt-muted)", marginLeft: 3 }}>{suffix}</span> : null}
      </span>
      <button type="button" onClick={() => onChange(clamp(value + 1))} style={btn} aria-label="Increase">
        +
      </button>
    </div>
  );
}
