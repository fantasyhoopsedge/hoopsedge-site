/**
 * Nickname <-> legal-name aliases for players whose common name doesn't match
 * their nba_players/hoopR record. hoopR's box-score feed uses the NBA's legal
 * name ("Cameron Johnson", "Herbert Jones", "Ronald Holland II"); dynasty
 * consensus data and the roster CSV use the nickname everyone actually calls
 * them ("Cam Johnson", "Herb Jones", "Ron Holland II"). Any code joining a
 * "dynasty/roster" source against an "nba_players/hoopR" source on
 * normalizeName()/normalizePlayerName() must resolve through this map first,
 * or the join silently misses — which is exactly what happened: these three
 * players' consensus_rank stayed null in season_player_stats because
 * build-seasonal-values.ts joined nba_players' legal name straight against
 * the dynasty map without trying the nickname form.
 *
 * Keys/values are already normalizeName()'d (lowercase, no suffix/punctuation
 * — "ii"/"jr"/etc. are stripped by normalization, so don't include them here).
 * Found by fuzzy-diffing the roster/dynasty/salary name lists — re-run that
 * check whenever a source is refreshed, since a newly added player can
 * introduce this class of bug under a different name.
 */
export const NICKNAME_TO_LEGAL_NAME: Record<string, string> = {
  "cam johnson": "cameron johnson",
  "herb jones": "herbert jones",
  "ron holland": "ronald holland",
};

const LEGAL_NAME_TO_NICKNAME: Record<string, string> = Object.fromEntries(
  Object.entries(NICKNAME_TO_LEGAL_NAME).map(([nickname, legalName]) => [legalName, nickname]),
);

/**
 * All normalized-name keys worth trying for a lookup, in priority order: the
 * name itself, then its nickname<->legal-name counterpart if one is known.
 * Works in either direction regardless of which form the caller started with.
 */
export function nameKeyCandidates(norm: string): string[] {
  const alt = NICKNAME_TO_LEGAL_NAME[norm] ?? LEGAL_NAME_TO_NICKNAME[norm];
  return alt ? [norm, alt] : [norm];
}

/** Looks up `norm` in `map`, trying its nickname/legal-name alias if the direct key misses. */
export function lookupWithNameAlias<T>(map: Map<string, T>, norm: string): T | undefined {
  for (const key of nameKeyCandidates(norm)) {
    const hit = map.get(key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}
