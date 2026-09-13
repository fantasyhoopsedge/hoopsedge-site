/**
 * Fantrax external API (FXEA) — the documented, key-less read API Fantrax
 * exposes for third-party tools (the same surface Basketball Monster's league
 * connector uses).
 *
 * Two access levels, and the difference drives this feature's whole architecture:
 *
 *   • getLeagues NEEDS the user's Secret ID (found on their Fantrax user
 *     profile). It is the ONLY endpoint that does.
 *   • Every league-scoped endpoint needs nothing but the league id. A league id
 *     is a capability on its own — which is exactly why Fantrax users can paste
 *     one into a third-party tool to link a private league.
 *
 * Because of that split, the Secret ID never has to reach a FantasyHoopsEdge
 * server: fantrax.com answers these endpoints with `access-control-allow-origin: *`
 * (verified 2026-08-03), so the BROWSER calls getLeagues itself and keeps the
 * secret in sessionStorage. That is not merely a nicety — /privacy §4 publishes
 * it as a commitment ("never transmitted to, stored on, or logged by any
 * FantasyHoopsEdge server at any point"). Anything added here that would send a
 * Secret ID through our server breaks that promise; league-scoped calls (which
 * carry no secret) are the only ones allowed to run server-side.
 *
 * Responses come back as `text/plain`, so always parse with res.json() rather
 * than trusting the content type.
 */

const FXEA = "https://www.fantrax.com/fxea/general";

/** Where a Fantrax user finds their Secret ID — shown in the connect UI. */
export const FANTRAX_SECRET_ID_HELP_URL = "https://www.fantrax.com/fantasy/userProfile";

// ── raw payload shapes (only the fields we actually consume) ────────────────

export interface FxLeagueSummary {
  leagueName: string;
  teamName: string;
  leagueId: string;
  teamId: string;
  sport: string;
}

/**
 * Categories-mode leagues carry `weight` (always 1 in every league seen so
 * far); points-mode leagues carry `points` + `cumulative` instead — verified
 * live against a real points league (2026-08-09), e.g.
 * `{ points: 1.5, cumulative: true, scoringCategory: { shortName: "AST" } }`.
 * Both optional on one type rather than lying about either shape.
 */
export interface FxScoringCategoryConfig {
  weight?: number;
  points?: number;
  cumulative?: boolean;
  position: { code: string; name: string; id: string; shortName: string };
  scoringCategory: { code: string; name: string; id: string; shortName: string };
}

export interface FxLeagueInfo {
  leagueName: string;
  seasonYear: number;
  endDate?: string;
  draftType?: string;
  /** Fantrax's own label — "rotisserie", "headToHead", "points", … */
  scoringSystem?: {
    type?: string;
    /** { PLAYER: { PTS: { Default: "1.0" }, … } } */
    scoringCategories?: Record<string, Record<string, Record<string, string>>>;
    scoringCategorySettings?: { configs?: FxScoringCategoryConfig[] }[];
  };
  rosterInfo?: {
    positionConstraints?: Record<string, { maxActive?: number }>;
    maxTotalPlayers?: number;
    maxTotalActivePlayers?: number;
  };
  teamInfo?: Record<string, { id: string; name: string; division?: string }>;
  /** Fantrax player id → league-specific eligibility/ownership. */
  playerInfo?: Record<string, { eligiblePos?: string; status?: string }>;
  scoringPeriods?: { number: number; startDate: string; endDate: string }[];
  /** The real fixture list, one entry per scoring period. Playoff periods
   *  carry only `{ seed }` on each side — the teams are undecided — so a
   *  side without an `id` is a bracket placeholder, not a missing field. */
  matchups?: { period?: number; matchupList?: { home?: { id?: string }; away?: { id?: string } }[] }[];
  /** Head-to-head leagues only. `lastRegularSeasonPeriod` is what separates
   *  the real schedule above from the bracket. */
  playoffs?: {
    used?: boolean;
    lastRegularSeasonPeriod?: number;
    firstPlayoffPeriod?: number;
    numPlayoffTeams?: number;
    mergePlayoffPeriods?: boolean;
  };
}

export interface FxRosterItem {
  id: string;
  position: string;
  /** Only present in salary-cap leagues. */
  salary?: number;
  /** Only present in leagues that track contract years (real or custom
   *  keeper/dynasty leagues) — e.g. `{ smallId: "3", name: "27-28" }` for a
   *  deal running through the 2027-28 season, or `{ smallId: "a", name:
   *  "R-1st" }` for a rookie-scale first-year deal. `name` is the only part
   *  FHE displays; verified live 2026-08-13 against a real custom-salary
   *  league (getTeamRosters). */
  contract?: { smallId: string; name: string };
  /** ACTIVE | RESERVE | MINORS | INJURED … */
  status: string;
}

export interface FxTeamRosters {
  period?: number;
  rosters: Record<string, { teamName: string; rosterItems: FxRosterItem[] }>;
}

export interface FxStandingsRow {
  teamName: string;
  teamId: string;
  rank: number;
  points: string;
  gamesBack: number;
  winPercentage: number;
}

export interface FxDraftResults {
  draftDate?: string;
  draftPicks?: { round: number; pick: number; pickInRound: number; teamId: string; playerId?: string; time?: number }[];
}

/**
 * A dynasty league's owned FUTURE draft-pick assets — distinct from
 * FxDraftResults above, which covers picks already MADE in a completed/
 * in-progress draft. This is undocumented on Fantrax's public site (no
 * official reference found; endpoint existence confirmed by a live call,
 * 2026-08-14) but behaves identically to every other key-less FXEA endpoint:
 * `leagueId` only, `access-control-allow-origin: *`, text/plain-serialized
 * JSON. No pick-in-round number — a future round hasn't been ordered yet, so
 * Fantrax only knows round + year + who currently holds it.
 *
 * A year's picks disappear from this response entirely once that year's
 * draft has concluded (they've become real rostered rookies by then) — not a
 * bug to work around, see buildDraftPickAssets() in league.ts.
 */
export interface FxDraftPickEntry {
  currentOwnerTeamId: string;
  round: number;
  year: number;
  /** Same as currentOwnerTeamId for a team's own, un-traded pick. */
  originalOwnerTeamId: string;
}
export interface FxDraftPicks {
  futureDraftPicks?: FxDraftPickEntry[];
}

export interface FxPlayerIdEntry {
  fantraxId: string;
  /** Always "Last, First" — see toDisplayName(). */
  name: string;
  team: string;
  position: string;
  statsIncId?: number;
  rotowireId?: number;
  sportRadarId?: string;
}

export type FxPlayerIdMap = Record<string, FxPlayerIdEntry>;

/**
 * One player's Average Draft Position across Fantrax's own redraft drafts.
 *
 * `id` is the same bare Fantrax id every other endpoint here uses, so this
 * joins straight onto a roster spot with no identity-registry lookup — which
 * also means a player the registry never linked still gets a real ADP (see
 * resolve.ts's own note). `ADP` is capitalized in the payload; left as-is
 * rather than renamed so the shape matches what the wire actually sends.
 *
 * Only players who have actually been drafted somewhere appear: 292 of the
 * NBA pool as of 2026-09-13, ADP 1.52 (Jokić) through 244.16. A deep dynasty
 * roster is therefore expected to be roughly half-covered — the missing ones
 * are not an error, they are players nobody drafts in a redraft league.
 */
export interface FxAdpEntry {
  id: string;
  name: string;
  pos: string;
  ADP: number;
}

// ── fetch helpers ───────────────────────────────────────────────────────────

export class FantraxError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FantraxError";
  }
}

/** RequestInit plus Next's fetch-cache options, so server callers can set a TTL. */
export type FxRequestInit = RequestInit & { next?: { revalidate?: number | false; tags?: string[] } };

async function fxGet<T>(path: string, params: Record<string, string>, init?: FxRequestInit): Promise<T> {
  const url = `${FXEA}/${path}?${new URLSearchParams(params)}`;
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
  } catch (cause) {
    throw new FantraxError(`Couldn't reach Fantrax (${path}). ${String(cause)}`);
  }
  if (!res.ok) throw new FantraxError(`Fantrax ${path} returned ${res.status}`, res.status);
  // text/plain response — parse the body ourselves so a Fantrax error page
  // surfaces as a clear message instead of an opaque JSON syntax error.
  const body = await res.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new FantraxError(`Fantrax ${path} returned a non-JSON body (likely an invalid id)`);
  }
}

/**
 * The user's leagues. **Browser-only** — passing a Secret ID through server code
 * would break the /privacy §4 commitment. Filtered to NBA: FHE has no data for
 * any other sport, so an NHL league would import into an empty analysis.
 */
export async function fetchUserLeagues(userSecretId: string): Promise<FxLeagueSummary[]> {
  const data = await fxGet<{ leagues?: FxLeagueSummary[] }>("getLeagues", { userSecretId });
  return (data.leagues ?? []).filter((l) => l.sport === "NBA");
}

/** League settings, teams, player pool and ownership. Safe server-side (no secret). */
export const fetchLeagueInfo = (leagueId: string, init?: FxRequestInit) =>
  fxGet<FxLeagueInfo>("getLeagueInfo", { leagueId }, init);

/** Every team's roster for the current period. Safe server-side (no secret). */
export const fetchTeamRosters = (leagueId: string, init?: FxRequestInit) =>
  fxGet<FxTeamRosters>("getTeamRosters", { leagueId }, init);

/** Current standings. Safe server-side (no secret). */
export const fetchStandings = (leagueId: string, init?: FxRequestInit) =>
  fxGet<FxStandingsRow[]>("getStandings", { leagueId }, init);

/** Draft board — picks made and still pending. Safe server-side (no secret). */
export const fetchDraftResults = (leagueId: string, init?: FxRequestInit) =>
  fxGet<FxDraftResults>("getDraftResults", { leagueId }, init);

/** Owned future draft-pick assets (dynasty leagues) — see FxDraftPicks.
 *  Safe server-side (no secret). */
export const fetchDraftPicks = (leagueId: string, init?: FxRequestInit) =>
  fxGet<FxDraftPicks>("getDraftPicks", { leagueId }, init);

/**
 * Every player with a recorded ADP, ascending. Safe server-side (no secret).
 *
 * Documented at fantrax.com/developer as "Retrieve Player Info", and it
 * accepts start/limit/order/position filters — none of which this needs: one
 * unfiltered call returns the COMPLETE set (verified 2026-09-13, `limit=1000`
 * and the default both return the same 292 rows, and `start=292` returns the
 * single last one), and it is ~18KB. Paging it would add failure modes to buy
 * nothing.
 */
export const fetchAdp = (sport = "NBA", init?: FxRequestInit) =>
  fxGet<FxAdpEntry[]>("getAdp", { sport }, init);

/** Fantrax player id → name/team/position for the whole sport (~1,800 rows). */
export const fetchPlayerIds = (sport = "NBA", init?: FxRequestInit) =>
  fxGet<FxPlayerIdMap>("getPlayerIds", { sport }, init);

/**
 * Fantrax ships every player name "Last, First" ("Booth, Phil"), while every FHE
 * surface — and normalizePlayerName() — expects "First Last". Reorder before
 * normalizing or the join misses on all ~1,800 players.
 */
export function toDisplayName(fantraxName: string): string {
  const comma = fantraxName.indexOf(",");
  if (comma === -1) return fantraxName.trim();
  const last = fantraxName.slice(0, comma).trim();
  const first = fantraxName.slice(comma + 1).trim();
  return first ? `${first} ${last}` : last;
}

/** A Fantrax league id is 16 lowercase alphanumerics (e.g. l2ftp82kmo6w41ci). */
export const LEAGUE_ID_RE = /^[a-z0-9]{16}$/;

export const isLeagueId = (value: string): boolean => LEAGUE_ID_RE.test(value.trim());
