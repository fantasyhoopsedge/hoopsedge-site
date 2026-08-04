/**
 * The player identity layer — one canonical id per human, one normalizer, one
 * resolver. Full design: `docs/player-identity-layer.md`.
 *
 * ── What to import from where ───────────────────────────────────────────────
 *   `@/lib/player-identity`          types, the resolver class, the normalizer.
 *                                    Data-free — safe anywhere, including client
 *                                    components.
 *   `@/lib/player-identity/bundled`  the actual registry snapshot (~230 KB).
 *                                    Pulls the data in; import it knowingly.
 *
 * Scripts import the same modules by relative path (`../src/lib/player-identity`),
 * which is how the app, the build pipeline and the reconciliation gate stay on
 * one resolution rule instead of three near-identical copies of it.
 *
 * ── The invariant worth restating ───────────────────────────────────────────
 * The resolver never guesses. Ambiguity resolves to `{ kind: "ambiguous" }`, not
 * to the first candidate. Every identity bug FHE has shipped had the same shape
 * — a name join that confidently returned the wrong human — so "I don't know" is
 * a first-class answer here, and callers are handed a discriminated result
 * precisely so they cannot silently flatten it into "no such player".
 */
export { normalizePlayerName, playerSlug } from "./normalize";
export {
  PlayerIdentityIndex,
  identityFromRow,
  type AliasMap,
  type IdentityRecord,
  type ProviderIdField,
  type Resolution,
  type ResolveQuery,
} from "./registry";
