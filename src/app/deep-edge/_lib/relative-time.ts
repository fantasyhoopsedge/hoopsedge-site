import { useEffect, useState } from "react";

/** The current timestamp, read once after mount rather than inline during
 *  render — `Date.now()` is impure, and calling it directly in a render body
 *  trips react-hooks/purity (and would also make SSR/hydration disagree with
 *  the client's real clock). Null until the effect runs, so a staleness
 *  check built on this should treat null as "not stale yet" — same
 *  after-mount-read convention hub-shell.tsx already uses for its
 *  localStorage theme read. */
export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external-clock read after mount, not derived from props/state (same pattern hub-shell.tsx uses for its localStorage theme read)
    setNow(Date.now());
  }, []);
  return now;
}

/** "3 days ago" / "just now" — shared by the asset-values page and Home's
 *  own staleness cue so the two "generated X ago" readouts can't drift. */
export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Past this age, the custom-valuations "generated X ago" cue switches to an
 *  amber "may be stale" tone (Ash, 2026-08-23: values drift through the
 *  season) — a passive visual nudge, not a proactive notification. */
export const CUSTOM_VALUATIONS_STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
