"use client";

import { Modal } from "./modal";
import { IconClose } from "./icons";

/** Yahoo/ESPN/Sleeper — placeholder auth screens per the design spec; only
 *  Fantrax has real copy/fields designed for this handoff. */
export function PlaceholderConnectModal({ platform, onClose }: { platform: string; onClose: () => void }) {
  return (
    <Modal onClose={onClose} width={400}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, margin: 0 }}>Authenticate {platform}</h2>
        <button
          type="button"
          onClick={onClose}
          style={{ background: "none", border: "none", color: "var(--rt-muted)", cursor: "pointer", padding: 4 }}
        >
          <IconClose size={16} />
        </button>
      </div>
      <p style={{ fontSize: 13.5, color: "var(--rt-body)", lineHeight: 1.5, margin: "0 0 22px" }}>
        You&apos;ll be redirected to {platform} to authorize THE DEEP EDGE. No password is stored.
      </p>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            height: 40, padding: "0 18px", borderRadius: 100, border: "1px solid var(--rt-hairline)",
            background: "transparent", color: "var(--rt-ink)", fontWeight: 600, fontSize: 13.5, cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled
          title="Placeholder — not wired up yet"
          style={{
            height: 40, padding: "0 18px", borderRadius: 100, border: "none",
            background: "var(--rt-surface-strong)", color: "var(--rt-muted)", fontWeight: 700, fontSize: 13.5,
            cursor: "default",
          }}
        >
          Continue to {platform}
        </button>
      </div>
    </Modal>
  );
}
