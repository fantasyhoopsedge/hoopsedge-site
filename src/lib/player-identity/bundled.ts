/**
 * The registry, loaded from the generated snapshot.
 *
 * ── Import this path deliberately ───────────────────────────────────────────
 * It is a separate entry point from `@/lib/player-identity` on purpose: this
 * module pulls in `registry.json` (~230 KB, 1,206 identities), and the sibling
 * entry point deliberately does not, so a component that only needs
 * `normalizePlayerName()` never ships the data. Anything importing THIS file
 * pays for the whole registry — which is the right trade server-side, and a
 * decision worth making explicitly in a client component.
 *
 * ── Snapshot, not a live read ───────────────────────────────────────────────
 * This is the state of the registry at the last `npm run identity:build`, the
 * same generation that was upserted into Supabase's `player_identity` by that
 * run. Consumers needing rows the build cannot know about (or wanting the full
 * ledger's provenance fields) should read the table with the SERVICE-ROLE client
 * — `player_identity` has RLS on with no policies, so an anon read silently
 * returns zero rows and presents as "no player matched" rather than as an error.
 *
 * That silence is the reason to prefer this file where a snapshot will do: a
 * bundled import cannot fail halfway and look like a coverage problem.
 */
import { PlayerIdentityIndex, type IdentityRecord } from "./registry";
import snapshot from "./registry.json";

interface RawPlayer {
  fheId: string;
  displayName: string;
  normName: string;
  status: string;
  espnId?: string;
  nbaStatsId?: string;
  bbmId?: string;
  fantraxId?: string;
  dob?: string;
  draftYear?: number;
  currentTeam?: string;
}

/** Null fields are omitted by the emitter to keep the committed file small — put
 *  them back, so consumers see one shape rather than an optional-field maze. */
function hydrate(p: RawPlayer): IdentityRecord {
  return {
    fheId: p.fheId,
    displayName: p.displayName,
    normName: p.normName,
    status: p.status as IdentityRecord["status"],
    espnId: p.espnId ?? null,
    nbaStatsId: p.nbaStatsId ?? null,
    bbmId: p.bbmId ?? null,
    fantraxId: p.fantraxId ?? null,
    dob: p.dob ?? null,
    draftYear: p.draftYear ?? null,
    currentTeam: p.currentTeam ?? null,
  };
}

let cached: PlayerIdentityIndex | null = null;

/** The registry index. Built once per process — the snapshot is immutable. */
export function playerIdentity(): PlayerIdentityIndex {
  if (!cached) {
    cached = new PlayerIdentityIndex(
      (snapshot.players as RawPlayer[]).map(hydrate),
      snapshot.aliases as Record<string, string>,
    );
  }
  return cached;
}

/** When the snapshot was generated, for staleness reporting in admin surfaces. */
export const REGISTRY_GENERATED_AT: string = snapshot.generatedAt;
