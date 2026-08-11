"use client";

import { useCallback, useEffect, useState } from "react";
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
