"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SavedLeague } from "@/lib/fantrax/store";

export function useSavedLeagues() {
  const [leagues, setLeagues] = useState<SavedLeague[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    return fetch("/api/fantrax/saved")
      .then((r) => r.json())
      .then((d) => setLeagues(d.leagues ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Manually-triggered reload (e.g. after importing a league) — distinct
  // from `load` above so the mount effect never synchronously calls
  // setLoading(true) from its own body.
  const refresh = useCallback(() => {
    setLoading(true);
    return load();
  }, [load]);

  return { leagues, loading, refresh };
}

/**
 * The league a tool page should operate on: whichever saved league's id
 * matches the `?league=` query param, falling back to the first saved
 * league when the param is absent or stale (e.g. a league was removed).
 * Callers must render inside a <Suspense> boundary — useSearchParams()
 * requires it.
 */
export function useActiveLeague() {
  const { leagues, loading, refresh } = useSavedLeagues();
  const searchParams = useSearchParams();
  const leagueId = searchParams.get("league");
  const saved = leagues.find((l) => l.leagueId === leagueId) ?? leagues[0] ?? null;
  return { leagues, saved, loading, refresh };
}
