"use client";

/**
 * Same sessionStorage keys admin/fantrax/_connector.tsx uses for the Secret
 * ID — deliberately the same constants so a Secret ID entered on one surface
 * in this tab is recognized by the other. sessionStorage (not localStorage)
 * is what keeps the "clears when you close the tab" privacy guarantee true;
 * see api.ts's file header for the full commitment.
 */
const SECRET_KEY = "fhe.fantrax.secretId";
const USER_KEY = "fhe.fantrax.username";

export function readFantraxSession(): { secretId: string; username: string; connected: boolean } {
  if (typeof window === "undefined") return { secretId: "", username: "", connected: false };
  const secretId = sessionStorage.getItem(SECRET_KEY) ?? "";
  const username = sessionStorage.getItem(USER_KEY) ?? "";
  return { secretId, username, connected: Boolean(secretId) };
}

export function writeFantraxSession(secretId: string, username: string): void {
  sessionStorage.setItem(SECRET_KEY, secretId);
  sessionStorage.setItem(USER_KEY, username);
}

export function clearFantraxSession(): void {
  sessionStorage.removeItem(SECRET_KEY);
  sessionStorage.removeItem(USER_KEY);
}
