/**
 * The resolver. One implementation of "which human is this row about", shared by
 * the app, the build scripts and (through the same generated artifact) Python.
 *
 * ── Why it's a class and not a function ─────────────────────────────────────
 * Resolution needs four indexes over ~1,200 identities. Building them per call
 * is what made every consumer hand-roll its own — there were three separate
 * `Resolver` classes before this file (`scripts/backfill-fhe-id.ts`,
 * `scripts/reconcile-player-identity.ts`, and an inline map in
 * `src/lib/fantrax/resolve.ts`), each subtly different about what "no answer"
 * means. That divergence is the bug this layer exists to prevent, so it would be
 * absurd to reintroduce it in the layer itself.
 *
 * ── Resolution order (docs/player-identity-layer.md §3.4) ───────────────────
 *   1. Provider id we already hold  → exact, can never be wrong.
 *   2. Exact normalized name, alias-aware, resolving to exactly ONE identity.
 *   3. Disambiguate a multi-candidate name on DOB, then draft year, then team.
 *   4. No confident answer → refuse. Return `ambiguous`/`none`, never a guess.
 *
 * Step 4 is the whole point and is not negotiable. A confidently wrong id
 * attaches a real stat line to the wrong player — the Fantrax waiver board
 * handing a rank-10 star's z-scores to his teamless namesake, the Harden age-19
 * rank-reuse bug. A blank cell is a visible gap; a wrong join is a silent lie.
 * Callers get a discriminated result specifically so "I don't know" cannot be
 * mistaken for "no such player".
 */
import { normalizePlayerName } from "./normalize";

/** Provider id spaces the registry bridges. See CLAUDE.md — they are disjoint. */
export type ProviderIdField = "espnId" | "nbaStatsId" | "bbmId" | "fantraxId";

export interface IdentityRecord {
  fheId: string;
  displayName: string;
  normName: string;
  status: "prospect" | "nba" | "former";
  /** ESPN athlete id — also `nba_players.id` / `season_player_stats.player_id`. */
  espnId: string | null;
  /** NBA Stats id — the headshot namespace (`src/lib/nba-player-ids.json`). */
  nbaStatsId: string | null;
  bbmId: string | null;
  fantraxId: string | null;
  /** Disambiguators, in the order §3.4 trusts them. */
  dob: string | null;
  draftYear: number | null;
  currentTeam: string | null;
}

/** Everything a caller might know about a row it wants resolved. All optional —
 *  supply what you have and the resolver uses the strongest evidence present. */
export interface ResolveQuery {
  espnId?: string | null;
  nbaStatsId?: string | null;
  bbmId?: string | null;
  fantraxId?: string | null;
  name?: string | null;
  /** Disambiguators, used only when a name matches more than one identity. */
  dob?: string | null;
  draftYear?: number | null;
  team?: string | null;
}

export type Resolution =
  | { kind: "matched"; identity: IdentityRecord; via: "provider_id" | "name" | "disambiguated" }
  /** The name matched several identities and nothing separated them. NOT a miss —
   *  the player is probably in the registry, we just refuse to pick. */
  | { kind: "ambiguous"; candidates: IdentityRecord[] }
  /** Nothing matched at all. */
  | { kind: "none" };

/** Nickname ⇄ legal-name pairs, keyed both ways. Supplied by the artifact so the
 *  TypeScript and Python sides read one authored list (`player-name-aliases.ts`). */
export type AliasMap = Readonly<Record<string, string>>;

/**
 * Adapt a `player_identity` row to an `IdentityRecord`.
 *
 * The table's snake_case column names are part of this layer's contract, so the
 * mapping lives here rather than being retyped by every script that reads it —
 * that retyping is how the three previous resolver copies each ended up trusting
 * a slightly different set of columns. Fields the resolver doesn't use
 * (rotowire/sportradar/statsinc ids, confidence, sources) are intentionally
 * dropped: read the table directly if you need the provenance trail.
 */
export function identityFromRow(row: {
  fhe_id: string;
  display_name: string;
  norm_name: string;
  status?: string | null;
  espn_id?: string | null;
  nba_stats_id?: string | null;
  bbm_id?: string | null;
  fantrax_id?: string | null;
  dob?: string | null;
  draft_year?: number | null;
  current_team?: string | null;
}): IdentityRecord {
  return {
    fheId: row.fhe_id,
    displayName: row.display_name,
    normName: row.norm_name,
    status: (row.status as IdentityRecord["status"]) ?? "nba",
    espnId: row.espn_id ?? null,
    nbaStatsId: row.nba_stats_id ?? null,
    bbmId: row.bbm_id ?? null,
    fantraxId: row.fantrax_id ?? null,
    dob: row.dob ?? null,
    draftYear: row.draft_year ?? null,
    currentTeam: row.current_team ?? null,
  };
}

export class PlayerIdentityIndex {
  private readonly byFhe = new Map<string, IdentityRecord>();
  private readonly byProvider: Record<ProviderIdField, Map<string, IdentityRecord>> = {
    espnId: new Map(), nbaStatsId: new Map(), bbmId: new Map(), fantraxId: new Map(),
  };
  private readonly byNorm = new Map<string, IdentityRecord[]>();
  private readonly aliasBothWays = new Map<string, string>();

  constructor(records: readonly IdentityRecord[], aliases: AliasMap = {}) {
    for (const r of records) {
      this.byFhe.set(r.fheId, r);
      for (const f of ["espnId", "nbaStatsId", "bbmId", "fantraxId"] as const) {
        const v = r[f];
        if (v) this.byProvider[f].set(v, r);
      }
      const list = this.byNorm.get(r.normName);
      if (list) list.push(r);
      else this.byNorm.set(r.normName, [r]);
    }
    for (const [nickname, legal] of Object.entries(aliases)) {
      this.aliasBothWays.set(nickname, legal);
      this.aliasBothWays.set(legal, nickname);
    }
  }

  get size(): number {
    return this.byFhe.size;
  }

  all(): IdentityRecord[] {
    return [...this.byFhe.values()];
  }

  byFheId(fheId: string | null | undefined): IdentityRecord | null {
    return (fheId && this.byFhe.get(fheId)) || null;
  }

  byProviderId(field: ProviderIdField, id: string | null | undefined): IdentityRecord | null {
    return (id && this.byProvider[field].get(id)) || null;
  }

  /** Normalized-name keys worth trying, in priority order: the name itself, then
   *  its nickname/legal-name counterpart. Direction-agnostic. */
  nameKeys(name: string): string[] {
    const norm = normalizePlayerName(name);
    const alt = this.aliasBothWays.get(norm);
    return alt ? [norm, alt] : [norm];
  }

  /** Every identity a name could refer to. Empty when unknown; length > 1 is the
   *  duplicate-name case callers must not resolve by picking the first. */
  candidatesByName(name: string | null | undefined): IdentityRecord[] {
    if (!name) return [];
    for (const key of this.nameKeys(name)) {
      const hit = this.byNorm.get(key);
      if (hit?.length) return hit;
    }
    return [];
  }

  /**
   * The full §3.4 ladder. Prefer this over the individual lookups — it is the
   * only place the precedence between id evidence and name evidence is decided,
   * which is exactly the decision that must not vary between consumers.
   */
  resolve(q: ResolveQuery): Resolution {
    // 1 — provider id. Strongest evidence; an id we hold cannot be a coincidence.
    for (const f of ["espnId", "nbaStatsId", "bbmId", "fantraxId"] as const) {
      const hit = this.byProviderId(f, q[f]);
      if (hit) return { kind: "matched", identity: hit, via: "provider_id" };
    }

    // 2 — unique name.
    const candidates = this.candidatesByName(q.name);
    if (candidates.length === 0) return { kind: "none" };
    if (candidates.length === 1) return { kind: "matched", identity: candidates[0], via: "name" };

    // 3 — disambiguate, strongest attribute first. Each filter is applied only
    // when the caller supplied that attribute AND it narrows to exactly one;
    // a filter that empties the set means the caller's evidence contradicts every
    // candidate, which is a reason to refuse, not to fall through to a weaker one.
    const narrow = (pick: (r: IdentityRecord) => boolean): Resolution | null => {
      const hits = candidates.filter(pick);
      return hits.length === 1 ? { kind: "matched", identity: hits[0], via: "disambiguated" } : null;
    };
    if (q.dob) {
      const hit = narrow((r) => r.dob === q.dob);
      if (hit) return hit;
    }
    if (q.draftYear != null) {
      const hit = narrow((r) => r.draftYear === q.draftYear);
      if (hit) return hit;
    }
    if (q.team) {
      const hit = narrow((r) => r.currentTeam === q.team);
      if (hit) return hit;
    }

    // 4 — refuse.
    return { kind: "ambiguous", candidates };
  }

  /** `resolve()` collapsed to "the identity or nothing", for callers that treat
   *  ambiguous and unknown the same way. Named so the loss of that distinction
   *  is visible at the call site rather than implied. */
  resolveOrNull(q: ResolveQuery): IdentityRecord | null {
    const r = this.resolve(q);
    return r.kind === "matched" ? r.identity : null;
  }
}
