"use client";

import { useState } from "react";
import { FANTRAX_SECRET_ID_HELP_URL, fetchUserLeagues, type FxLeagueSummary } from "@/lib/fantrax/api";
import { writeFantraxSession } from "../_lib/fantrax-session";
import { Modal } from "./modal";
import { IconClose } from "./icons";

/**
 * Connect Fantrax — same browser-only Secret ID pattern as
 * admin/fantrax/_connector.tsx's connect(): fetchUserLeagues() runs here, in
 * the browser, straight against fantrax.com. Never proxied through an FHE
 * route — see api.ts's file header for why that's a hard privacy commitment,
 * not just a preference.
 */
export function FantraxConnectModal({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: (leagues: FxLeagueSummary[]) => void;
}) {
  const [username, setUsername] = useState("");
  const [secretId, setSecretId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  async function authenticate() {
    const trimmed = secretId.trim();
    if (!trimmed || !username.trim()) return;
    setConnecting(true);
    setError("");
    try {
      const leagues = await fetchUserLeagues(trimmed);
      writeFantraxSession(trimmed, username.trim());
      onConnected(leagues);
    } catch (err) {
      setError(`Couldn't reach Fantrax with that Secret ID. ${(err as Error).message}`);
    } finally {
      setConnecting(false);
    }
  }

  const canSubmit = username.trim().length > 0 && secretId.trim().length > 0 && !connecting;

  return (
    <Modal onClose={onClose} width={440}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 30, height: 30, borderRadius: 8, background: "#0c0d0e", color: "#fff",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontFamily: "var(--rt-font-mono)", fontWeight: 700, fontSize: 13,
            }}
          >
            Fx
          </span>
          <h2 style={{ fontSize: 19, fontWeight: 700, margin: 0 }}>Connect Fantrax</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ background: "none", border: "none", color: "var(--rt-muted)", cursor: "pointer", padding: 4 }}
        >
          <IconClose size={16} />
        </button>
      </div>

      <p style={{ fontSize: 13.5, color: "var(--rt-body)", lineHeight: 1.5, margin: "0 0 20px" }}>
        Enter your Fantrax credentials. We use them once to import your leagues — your Secret ID is encrypted in
        transit and never stored, transmitted to, or logged by any Fantasy Hoops Edge server.
      </p>

      <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
        Username
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="your-fantrax-username"
          style={{
            display: "block", width: "100%", marginTop: 6, height: 40, padding: "0 12px",
            borderRadius: 10, border: "1px solid var(--rt-hairline)", background: "var(--rt-surface-soft)",
            color: "var(--rt-ink)", fontSize: 14,
          }}
        />
      </label>

      <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginTop: 14 }}>
        Secret ID
        <input
          type="password"
          value={secretId}
          onChange={(e) => setSecretId(e.target.value)}
          placeholder="paste your Fantrax Secret ID"
          style={{
            display: "block", width: "100%", marginTop: 6, height: 40, padding: "0 12px",
            borderRadius: 10, border: "1px solid var(--rt-hairline)", background: "var(--rt-surface-soft)",
            color: "var(--rt-ink)", fontSize: 14,
          }}
        />
        <a
          href={FANTRAX_SECRET_ID_HELP_URL}
          target="_blank"
          rel="noreferrer"
          style={{ display: "block", marginTop: 6, fontSize: 12, color: "var(--rt-muted)" }}
        >
          Fantrax → Account → API access → Secret ID
        </a>
      </label>

      {error && <p style={{ color: "var(--rt-down)", fontSize: 13, marginTop: 14 }}>{error}</p>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
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
          onClick={authenticate}
          disabled={!canSubmit}
          style={{
            height: 40, padding: "0 18px", borderRadius: 100, border: "none",
            background: canSubmit ? "var(--rt-primary)" : "var(--rt-surface-strong)",
            color: canSubmit ? "#fff" : "var(--rt-muted)", fontWeight: 700, fontSize: 13.5,
            cursor: canSubmit ? "pointer" : "default",
          }}
        >
          {connecting ? "Authenticating…" : "Authenticate"}
        </button>
      </div>
    </Modal>
  );
}
