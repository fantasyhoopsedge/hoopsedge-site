"use client";

/**
 * sessionStorage for in-progress Draft Night picks. This is the live site, so
 * web storage is fine (unlike Claude artifacts). Two keys:
 *   held    — autosaved draft payload per mini-game (survives the OAuth redirect)
 *   pending — mini-game keys the user pressed "Lock" on while signed out, so we
 *             can persist them to the DB on return with no loss (handoff §6.4).
 */
const HELD_KEY = "dn:draft-night-2026:held";
const PENDING_KEY = "dn:draft-night-2026:pending";

export type Held = Record<string, string[]>;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full / disabled — non-fatal
  }
}

export function loadHeld(): Held {
  return read<Held>(HELD_KEY, {});
}

export function saveHeldKey(key: string, payload: string[]): void {
  const held = loadHeld();
  held[key] = payload;
  write(HELD_KEY, held);
}

export function removeHeldKey(key: string): void {
  const held = loadHeld();
  delete held[key];
  write(HELD_KEY, held);
}

export function loadPending(): string[] {
  return read<string[]>(PENDING_KEY, []);
}

export function addPending(key: string): void {
  const pending = new Set(loadPending());
  pending.add(key);
  write(PENDING_KEY, [...pending]);
}

export function clearPending(): void {
  write(PENDING_KEY, []);
}
