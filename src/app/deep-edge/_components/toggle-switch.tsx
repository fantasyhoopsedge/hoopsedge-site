"use client";

/**
 * A true single-thumb 44×26px toggle switch — nothing like this existed
 * anywhere in the app before The Deep Edge; every prior "toggle" in the
 * codebase (the theme switcher, .fx-tab/.fx-pill in admin/fantrax) is
 * actually a two-button segmented pill, not a binary switch. Built on the
 * shared .rt-shell token set (--rt-primary/--rt-hairline/--rt-surface-strong)
 * so it drops into any .rt-shell-wrapped screen unchanged.
 */
export function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 44,
        height: 26,
        borderRadius: 100,
        border: "none",
        padding: 3,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        background: checked ? "var(--rt-primary)" : "var(--rt-surface-strong)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background 0.15s ease",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#ffffff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          transition: "transform 0.15s ease",
        }}
      />
    </button>
  );
}
