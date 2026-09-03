"use client";

/** Black-pill segmented control — Scoring format / League type / Salary mode /
 *  Cap type / Waiver type all use this exact pattern in the design. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabledOptions,
  mutedInactive,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  /** Options rendered but not clickable — e.g. "Points" when the league is
   *  categories-mode, since Fantrax's points-vs-categories split is a real
   *  immutable fact, not a user choice. */
  disabledOptions?: T[];
  /** Renders every non-selected option in muted grey instead of full body
   *  color — still clickable (this stays a real in-page preview, e.g. Trade
   *  Edge's own "Previewing X · league set to Y"), just visually de-emphasized
   *  since the selected option is the league's REAL setting and the others
   *  are only a what-if (Ash, 2026-08-23: League type / Value basis / Scoring
   *  format specifically, not every control this component renders). */
  mutedInactive?: boolean;
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
              color: active ? "var(--rt-canvas)" : disabled || mutedInactive ? "var(--rt-muted)" : "var(--rt-body)",
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
