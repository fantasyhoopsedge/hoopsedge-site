import dynastyRankingsJson from "./dynasty-rankings.json";
import nbaHeadshotIds from "./nba-headshot-ids.json";
import { normalizePlayerName } from "./player-identity/normalize";
import { nameKeyCandidates } from "./player-name-aliases";

/**
 * Headshot ids, GENERATED from the player identity registry by
 * `npm run identity:build` — not the hand/scraper-maintained
 * `src/lib/nba-player-ids.json`, which is now only an INPUT to that build.
 *
 * The distinction is the point: the scraper knows whoever stats.nba.com listed
 * when it last ran; the registry knows that PLUS Basketball Monster's NBA ID
 * column and every approved ESPN resolution. Switching this import to the
 * registry's view was measured to preserve all 587 previous ids exactly and add
 * 105 more — 7 of them on the dynasty board, who until now rendered no headshot
 * at all (Caleb Wilson, Kingston Flemings, Bennett Stirtz, Tyler Bilodeau, Keon
 * Johnson, Trey Lyles, Brandon Boston).
 */
type NbaPlayerEntry = { id: string; name: string };
const NBA_PLAYER_IDS = nbaHeadshotIds as Record<string, NbaPlayerEntry>;

/**
 * Re-exported, not defined here. This used to be one of four hand-maintained
 * copies of the same rule; it now forwards to the single implementation in
 * `player-identity/normalize.ts`, so the parity CLAUDE.md asks for is structural
 * rather than a promise. The export stays at this path because ~15 call sites
 * import it from here — moving them would be churn with no behaviour change.
 */
export { normalizePlayerName };

/** Returns the NBA Stats player id for a given display name, or null. */
export function nbaIdFor(playerName: string): string | null {
  const key = normalizePlayerName(playerName);
  for (const candidate of nameKeyCandidates(key)) {
    const id = NBA_PLAYER_IDS[candidate]?.id;
    if (id) return id;
  }
  return null;
}

/** Returns the cdn.nba.com headshot URL for a display name, or null if no id mapping. */
export function nbaHeadshotUrl(
  playerName: string,
  size: "260x190" | "1040x760" = "260x190",
): string | null {
  const id = nbaIdFor(playerName);
  return id ? `https://cdn.nba.com/headshots/nba/latest/${size}/${id}.png` : null;
}

/** Slugifies a name to match prospect image filenames in /public/images/prospects/. */
function prospectSlug(playerName: string): string {
  return playerName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,'’]/g, "")
    .replace(/\s+/g, "-");
}

/** Returns the local prospect headshot URL (jpg in /public/images/prospects/). */
export function prospectHeadshotUrl(playerName: string): string {
  return `/images/prospects/${prospectSlug(playerName)}.jpg`;
}

/**
 * Returns the best headshot URL for a player:
 *  - 2026 Rookies → local /images/prospects/{slug}.jpg
 *  - Otherwise → cdn.nba.com headshot if id is mapped, else null
 */
export function playerHeadshotUrl(player: { player: string; isRookie: boolean }): string | null {
  if (player.isRookie) return prospectHeadshotUrl(player.player);
  return nbaHeadshotUrl(player.player);
}

export type DynastyPosition = "G" | "F" | "C" | "G/F" | "F/C";

export interface DynastyPlayer {
  consensusRank: number;
  player: string;
  team: string;
  isRookie: boolean;
  position: DynastyPosition;
  age: number | null;
  expertRanks: {
    dizzle?: number;
    angle?: number;
    mball?: number;
    /** FBI-HE (Fantasy Basketball International / Hoops Edge) — replaced "hashtag"
     * 2026-08-02 when Hashtag Basketball ended its FHE partnership. Sourced from
     * the /admin/dynasty-board tool's published order, not an external scrape. */
    fbihe?: number;
    dynatyze?: number;
  };
  avgRank: number;
  rankedByCount: number;
  tier: number;
  trend: string;
  /** Spots moved since the prior version (|old consensusRank - new consensusRank|).
   * null when the player has no prior-version baseline (new to the board this cycle). */
  trendDelta: number | null;
}

export const DYNASTY_RANKINGS = dynastyRankingsJson as DynastyPlayer[];

/** Rank used for filters / rank column: consensus, or expert rank, or null if unranked by that expert. */
export function activeRankForView(player: DynastyPlayer, expertKey: string): number | null {
  if (!expertKey) return player.consensusRank;
  const v = player.expertRanks[expertKey as keyof DynastyPlayer["expertRanks"]];
  if (v === undefined || v === null) return null;
  return v;
}
