/**
 * ── The one authored alias list ─────────────────────────────────────────────
 * This file is hand-maintained; everything else is generated from it.
 * `npm run identity:build` copies this map into
 * `src/lib/player-identity/registry.json`, which the Python models read through
 * `models/player_identity.py`. So a pair added here reaches BOTH languages, and
 * the "TypeScript-side only, so it cannot be imported here" comment that used to
 * justify a mirrored Python copy no longer applies.
 *
 * Adding a pair therefore means: edit this map, then re-run `npm run
 * identity:build`. `npm run identity:verify` fails if the generated snapshot has
 * fallen behind this file, or if a new pair would make some name ambiguous.
 *
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
  // Discovered during the July 2026 Angle merge — same class of bug as the
  // three above, plus two variants that aren't nicknames but hit the same
  // lookup mechanism: a legal-name/nickname pair long documented as a known
  // recurring bug (carrington), a family-name-first ordering for a Chinese
  // player's name (yang hansen), and a source-side typo (larrson).
  "derrick lively": "dereck lively",
  "carlton carrington": "bub carrington",
  "robert dillingham": "rob dillingham",
  "hansen yang": "yang hansen",
  "pelle larrson": "pelle larsson",
  // Fantrax dialect, found 2026-08-03 wiring up the league connector
  // (src/lib/fantrax/): its player feed uses legal first names where hoopR and
  // the dynasty board use the nickname. These two were the ONLY name-shaped
  // misses across a 422-player league import — every other unmatched player was
  // genuinely absent from FHE's datasets (unsigned FA or a 2026 rookie), not
  // misnamed. Re-run that diff when adding a new league source.
  "cameron thomas": "cam thomas",
  "nicolas claxton": "nic claxton",
  // Was Python-only (`DRAFT_NAME_TO_HOOPR` in models/rookie-translation/common.py),
  // which is precisely the split this file now closes: the draft model files him
  // under his legal name, hoopR under the nickname. Moved here 2026-08-04 when the
  // alias map became the shared artifact both languages read.
  "gregory jackson": "gg jackson",
  // HoopsHype's salary CSV against everything else, found 2026-08-04 by resolving
  // every models-layer source against the registry. `data/nba-salaries/current.csv`
  // was the ONLY live source with unresolved names — these two, out of 516. The
  // roster CSV, the depth chart, the role-context file, the projection artifact
  // and the dynasty board all spell them the long way. "jaden" is a missing "y",
  // i.e. a source-side typo, not a nickname.
  "ej harkless": "elijah harkless",
  "jaden quaintance": "jayden quaintance",
  // Found 2026-08-16: the roster CSV had carried the wrong first name for a
  // GSW two-way; his real name is Jeenathon Williams, the registry/nba_players
  // still store him under the stale "Nate Williams" that predates the correction.
  "jeenathon williams": "nate williams",
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
