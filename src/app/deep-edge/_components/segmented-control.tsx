"use client";

/** Black-pill segmented control — Scoring format / League type / Salary mode /
 *  Cap type / Waiver type all use this exact pattern in the design. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabledOptions,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  /** Options rendered but not clickable — e.g. "Points" when the league is
   *  categories-mode, since Fantrax's points-vs-categories split is a real
   *  immutable fact, not a user choice. */
  disabledOptions?: T[];
}) {
  return (
    <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999, flexWrap: "wrap" }}>
      {options.map((opt) => {
        const active = opt.value === value;
        const disabled = disabledOptions?.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => !disabled && onChange(opt.value)}
            style={{
              padding: "8px 16px", border: "none", borderRadius: 999, fontSize: 13, fontWeight: 700,
              cursor: disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap",
              background: active ? "var(--rt-ink)" : "transparent",
              color: active ? "var(--rt-canvas)" : disabled ? "var(--rt-muted)" : "var(--rt-body)",
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
