/**
 * THE player-name normalizer. Not *a* copy of it — the one every other copy is
 * now an alias of.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * Name is the join key across ~12 sources, so the normalizer is load-bearing:
 * if two call sites disagree by one character class, a player silently stops
 * matching himself and a real stat line lands on nobody. It used to be
 * copy-pasted four times in two languages, held in parity by a written
 * instruction in CLAUDE.md and nothing else — and the copies had already
 * drifted (`src/lib/rookie-board.ts` used `\b(jr|sr|ii|iii|iv)\b` where the
 * others use `\s+(...)\b`, and stripped `‘` as well).
 *
 * `normalizePlayerName()` in `src/lib/dynasty-rankings.ts` and `normalizeName()`
 * in `scripts/nba-data/client.ts` are now re-exports of this function, so they
 * cannot drift. The Python side reads the same rule through
 * `models/player_identity.py`, and `npm run identity:verify` fails the build if
 * the two languages ever disagree on a real name.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * lowercase → strip diacritics → strip `.,'’` → strip a trailing generational
 * suffix (jr/sr/ii/iii/iv) → collapse whitespace.
 *
 * Deliberately conservative. It is NOT a fuzzy matcher: it only removes
 * differences that are purely typographic, so two normalized names being equal
 * is evidence, not a guess. Anything looser belongs in a suggestion UI, never
 * in a build (see docs/player-identity-layer.md §5).
 *
 * The suffix strip requires preceding whitespace (`\s+(jr|sr|ii|iii|iv)\b`) on
 * purpose: `\b` alone would eat the standalone token in a name that legitimately
 * contains one, and would fire mid-name on anything starting with those letters
 * once punctuation has already been removed.
 */

/** Zero imports, by design — this file is copied by reference into Python's
 *  docstring and must stay readable as a self-contained rule. */
export function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,'’]/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Slug form of a normalized name — `og anunoby` → `og-anunoby`.
 *
 * Note this is NOT the same as the prospect-image slug in `dynasty-rankings.ts`,
 * which deliberately keeps generational suffixes because the image filenames on
 * disk carry them. Don't merge the two.
 */
export function playerSlug(name: string): string {
  return normalizePlayerName(name).replace(/\s+/g, "-");
}
