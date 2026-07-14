/**
 * Pure trend-insight logic shared between the server (roster-live-data.ts,
 * precomputing a compact tone per roster player for the list/grid views) and
 * the client (player-trend-chart.tsx's TrendHero, which has the full block
 * series and renders the rich callout). No React, no "use client" — just data.
 *
 * Rule provenance: docs/trend-tag-audit-2026-07.md (Part 3, R1–R17). Each
 * non-obvious guard below cites its R-number.
 */

export type Trend = "rising" | "declining" | "stable" | null;
export type MetricBlock = {
  blockValue: number | null;
  rolling: { last2: number | null; last4: number | null; last6: number | null; seasonAvg: number | null };
  trend: Trend;
  /** This player's rank (1 = best) by cumulative (rolling.seasonAvg) value among all
   * display-eligible players AT THIS BLOCK — see attachCumRanks() in build-player-trends.ts. */
  cumRank: number | null;
};
export type BlockOut = {
  block: number;
  dateRange: [string, string];
  gamesInBlock: number;
  stale: boolean;
  nineCatV: MetricBlock;
  minus1V: MetricBlock;
  eightCatV: MetricBlock;
  staleFractionLast2: number;
};
/** One prior/current season's real, already-computed value line — see fetchSeasonHistory() in build-player-trends.ts. */
export type SeasonHistoryEntry = {
  season: number;
  team: string | null;
  gp: number;
  mpg: number;
  nineCatV: number;
  minus1V: number;
  eightCatV: number;
};
/** Raw per-game line for a window, same shape as the UI's PerGameStats (roster-data.ts). */
export type RecentPerGame = { pts: number; reb: number; ast: number; stl: number; blk: number; tpm: number; fgp: number; ftp: number; to: number };
/** Trailing 20-week (10-block) window — see RecentOut in build-player-trends.ts. null
 * when the window has 0 games. Powers the compare tool's "Recent" mode. */
export type TrendRecent = {
  gamesPlayed: number;
  mpg: number;
  pg: RecentPerGame;
  /** CATS order (roster-data.ts): pts, reb, ast, stl, blk, tpm, fgp, ftp, to. */
  catVals: number[];
  nineCatV: number;
  minus1V: number;
  eightCatV: number;
  rankNineCat: number | null;
  rankMinus1: number | null;
  rankEightCat: number | null;
} | null;
export type TrendPlayer = {
  playerId: string;
  player: string;
  gamesPlayed: number;
  mpg: number;
  blocks: BlockOut[];
  seasonHistory: SeasonHistoryEntry[];
  recent: TrendRecent;
};

export type TrendMetric = "nineCatV" | "minus1V" | "eightCatV";

/**
 * Position-vs-consensus × velocity-direction/magnitude trend tag. The core
 * tags come from a decision tree over `gapNow` (real rank minus consensus
 * rank — positive = below/worse than consensus) and `trend` (this window's
 * first-to-last move, positive = improving) — see deriveInsight() below.
 * The availability tags ("games-limited"/"small-sample") and the age tags
 * ("aging-decline"/"washed") are separate gates in deriveFinalTake() that
 * override the tree when the trend data can't be trusted at face value.
 */
export type TrendTag =
  | "breaking-out"
  | "surging"
  | "outproducing"
  | "climbing"
  | "developing"
  | "stable"
  | "regressing"
  | "plunging"
  | "fading"
  | "cratering"
  | "games-limited"
  | "small-sample"
  | "aging-decline"
  | "washed";

/** Reuses the site's existing 5-tier diverging scale (STATSET_COLORS in
 * roster-data.ts) instead of inventing new colors — color communicates
 * "how good/bad," the label + emoji communicate the specific story. */
export const TAG_META: Record<TrendTag, { label: string; emoji: string; color: string }> = {
  "breaking-out": { label: "POPPING", emoji: "🚀", color: "#12a150" },
  surging: { label: "SURGING", emoji: "📈", color: "#62a046" },
  outproducing: { label: "ACING", emoji: "💪", color: "#62a046" },
  climbing: { label: "CLIMBING", emoji: "↗️", color: "#62a046" },
  developing: { label: "GROWING", emoji: "🌱", color: "var(--rt-muted)" },
  stable: { label: "STABLE", emoji: "➡️", color: "var(--rt-muted)" },
  regressing: { label: "SINKING", emoji: "↘️", color: "#dd7a2b" },
  fading: { label: "FADING", emoji: "📉", color: "#cf2230" },
  plunging: { label: "PLUNGING", emoji: "⚰️", color: "#cf2230" },
  cratering: { label: "TANKING", emoji: "⚠️", color: "#cf2230" },
  "games-limited": { label: "LIMITED", emoji: "🏥", color: "var(--rt-muted)" },
  "small-sample": { label: "SMALL SAMPLE", emoji: "🔬", color: "var(--rt-muted)" },
  "aging-decline": { label: "AGEING", emoji: "⏳", color: "#cf2230" },
  washed: { label: "WASHED", emoji: "🧼", color: "#cf2230" },
};

/** `headlineMove` is the signed spot-move the callout is telling the story about
 * (positive = improving), so the header arrow can be driven from the SAME number
 * the copy cites — they can never contradict (an earlier bug showed a green ▲ next
 * to "Regressing", or a red ▼ next to "Climbing"). */
export type Insight = { title: string; detail: string; tag: TrendTag; headlineMove: number };

// Blocks are ~2-week chunks; the trailing 10 blocks (~20 weeks) are what the chart
// shows AND what the trend is measured over — the insight window MUST equal the chart
// window (blocks.slice(-LOOKBACK_BLOCKS)) exactly. An earlier version measured over
// nowIdx-LOOKBACK..nowIdx = 11 blocks, one MORE than the chart; that extra pre-chart
// block (often a noisy cold-start sample) flipped the net's sign so the header arrow
// disagreed with the visible chart.
export const LOOKBACK_BLOCKS = 10;

// R1: dynasty-consensus joins fall back to 999 for unranked players; any value this
// high is "no consensus", and every gap-based tag is suppressed (an audit found 45
// players whose cards cited "#999 consensus rank").
const CONSENSUS_FALLBACK_MIN = 900;

// R3: the window's start rank is a season-to-date average — on a starved early
// sample it can be absurd (Coby White's cumRank was #3 after one game, printing a
// fake −120 "crater"). The trend's start point slides forward to the first charted
// block where the player's cumulative season games reach this floor.
const WINDOW_START_MIN_GAMES = 15;

// R4: a player idle over the run-in keeps a carried rank that drifts on absence,
// not form — eleven audited players sat at exactly 4/12 stale (one under the 0.35
// share gate) while wearing directional tags. If ≥3 of the final 4 elapsed blocks
// are stale, the season ends on absence and the tag routes to games-limited.
const TRAILING_STALE_MIN = 3;
const TRAILING_WINDOW = 4;

// R13: distinguishes the injury pattern from the late-call-up pattern (two-ways,
// April auditions). A short season with no real prior-year track record is an
// evaluation sample, not a health story — and its hot rank is usually inflated.
const SMALL_SAMPLE_MAX_GAMES = 30;
const SMALL_SAMPLE_PRIOR_GP = 40;

/**
 * The chart window's honest endpoints for one metric: start (R3-guarded),
 * now, and the first-to-last trend. Shared by the tree, the gates' copy, and
 * the R9 rider so every number a card cites comes from the same computation.
 */
function chartWindow(blocks: BlockOut[], metric: TrendMetric): { startRank: number | null; nowRank: number | null; trend: number } {
  const windowStart = Math.max(0, blocks.length - LOOKBACK_BLOCKS);
  let cumGames = 0;
  for (let i = 0; i < windowStart; i++) cumGames += blocks[i].gamesInBlock;

  let startRank: number | null = null;
  let firstRank: number | null = null; // fallback when the games floor is never reached
  let nowRank: number | null = null;
  for (let i = windowStart; i < blocks.length; i++) {
    cumGames += blocks[i].gamesInBlock;
    const r = blocks[i][metric].cumRank;
    if (r == null) continue;
    if (firstRank == null) firstRank = r;
    if (startRank == null && cumGames >= WINDOW_START_MIN_GAMES) startRank = r; // R3
    nowRank = r;
  }
  const start = startRank ?? firstRank;
  return { startRank: start, nowRank, trend: start != null && nowRank != null ? start - nowRank : 0 };
}

/**
 * Blends the site's dynasty consensus rank (the market's slow-moving read) with this
 * player's real cumulative-rank trend into one plain-language callout.
 *
 * The trend is the honest first-to-last change in cumulative rank over the charted
 * window (R3-guarded start point → now). The tag combines that direction with where
 * the player sits vs consensus:
 *   • ABOVE consensus (outproducing) + trend up    → Surging     (extending the lead)
 *   • ABOVE consensus + flat                       → Outproducing (R14 — a market-rank
 *     signal, not a trend; previously mislabeled "Surging")
 *   • ABOVE consensus + trend down                 → Regressing  (sliding back toward it)
 *   • BELOW consensus + trend up                   → Climbing    (closing the gap)
 *   • BELOW consensus + rookie (not collapsing)    → Developing  (R15 — dynasty consensus
 *     prices upside; a rookie's production gap is a discount, not a fade)
 *   • BELOW consensus + trend down                 → Fading / Cratering (vets only)
 *   • NEAR consensus + big move up                 → Breaking out
 *   • NEAR consensus + big move down, still at/above consensus → Regressing (R5 — a hot
 *     start normalizing to the market's rank is not a "crash")
 *   • NEAR consensus + big move down, below consensus → Plunging
 *   • otherwise                                    → Stable
 * The header arrow is driven by this same `headlineMove`, so arrow and copy can never
 * disagree with each other or with the chart.
 */
export function deriveInsight(blocks: BlockOut[], metric: TrendMetric, consensusRank: number | null, isRookie = false): Insight | null {
  if (consensusRank == null || consensusRank >= CONSENSUS_FALLBACK_MIN) return null; // R1
  const { startRank, nowRank, trend } = chartWindow(blocks, metric);
  if (startRank == null || nowRank == null) return null;

  const gapNow = nowRank - consensusRank; // positive = real rank worse than (behind) consensus

  // FLOOR = the smallest move worth an arrow / a directional tag; smaller is treated
  // as flat noise (no arrow, "holding"). SMALL_GAP = clearly off consensus; HEAVY = a
  // dramatic move (break-out / plunge / crater); FAR = far enough below to risk crater.
  const FLOOR = 10;
  const SMALL_GAP = 20;
  const HEAVY = 40;
  const FAR_GAP = 60;
  // R15: a rookie slide has to be this steep before it reads as a real collapse
  // rather than the normal dynasty-discount development gap.
  const ROOKIE_COLLAPSE = 60;
  const abs = (n: number) => Math.abs(n).toFixed(0);
  // Arrow shows only for moves that clear the floor, always in the tag's direction.
  const arrowUp = trend >= FLOOR ? trend : 0;
  const arrowDown = trend <= -FLOOR ? trend : 0;

  // ── ABOVE consensus (outproducing) ───────────────────────────────────────────
  if (gapNow < -SMALL_GAP) {
    if (trend <= -FLOOR) {
      // "toward it" only when he's actually near consensus; a player far above it
      // (production rank much better than consensus) is trending down but NOT
      // approaching consensus, so don't imply he is.
      const near = -gapNow <= 50; // gapNow is negative here; -gapNow = spots above consensus
      return {
        title: "Sinking",
        detail: `Still outproducing his #${consensusRank} consensus rank at #${nowRank}, but ${near ? "sliding back toward it" : "trending down"} — off ~${abs(trend)} spots over the trend window.`,
        tag: "regressing",
        headlineMove: trend,
      };
    }
    if (trend >= FLOOR) {
      return {
        title: "Surging",
        detail: `Outproducing his #${consensusRank} consensus rank at #${nowRank}, and still pulling further ahead — up ~${abs(trend)} spots over the trend window.`,
        tag: "surging",
        headlineMove: arrowUp,
      };
    }
    // R14: flat-above-consensus is its own story — the market rank looks stale,
    // but nothing is "surging".
    return {
      title: "Acing",
      detail: `Outproducing his #${consensusRank} consensus rank at #${nowRank}, holding well above where the market has him.`,
      tag: "outproducing",
      headlineMove: 0,
    };
  }

  // ── BELOW consensus (underproducing) ──────────────────────────────────────────
  if (gapNow > SMALL_GAP) {
    if (trend >= FLOOR) {
      return {
        title: "Climbing",
        detail: `Still trading below his #${consensusRank} consensus rank at #${nowRank}, but closing the gap — up ~${abs(trend)} spots over the trend window.`,
        tag: "climbing",
        headlineMove: trend,
      };
    }
    // R15: dynasty consensus prices a rookie's long-term upside, so the gap below
    // it measures the dynasty discount, not decline. Ten of twelve audited
    // CRATERING players were ≤23; rookies never crater here.
    if (isRookie) {
      if (trend <= -ROOKIE_COLLAPSE) {
        return {
          title: "Fading",
          detail: `His #${consensusRank} consensus prices the long-term upside, and the rookie-year slide is real too — down ~${abs(trend)} spots over the trend window to #${nowRank}.`,
          tag: "fading",
          headlineMove: trend,
        };
      }
      return {
        title: "Growing",
        detail: `His #${consensusRank} consensus prices the long-term upside; rookie production sits at #${nowRank}${trend <= -FLOOR ? `, off ~${abs(trend)} spots over the trend window` : ""} — a normal development gap, not a decline.`,
        tag: "developing",
        headlineMove: arrowDown,
      };
    }
    if (gapNow >= FAR_GAP && trend <= -HEAVY) {
      return {
        title: "Tanking",
        detail: `Consensus has him at #${consensusRank}; production has collapsed to #${nowRank} — a steep ~${abs(trend)}-spot slide over the trend window, well below his floor.`,
        tag: "cratering",
        headlineMove: trend,
      };
    }
    return {
      title: "Fading",
      detail:
        trend <= -FLOOR
          ? `Consensus has him at #${consensusRank}; production has held below that at #${nowRank} and is slipping further — down ~${abs(trend)} spots over the trend window.`
          : `Consensus has him at #${consensusRank}; production has held below that at #${nowRank}, without closing the gap.`,
      tag: "fading",
      headlineMove: arrowDown,
    };
  }

  // ── NEAR consensus ────────────────────────────────────────────────────────────
  if (trend >= HEAVY) {
    return {
      title: "Popping",
      detail: `Production has surged to #${nowRank}, up ~${abs(trend)} spots over the trend window — pulling clear of his #${consensusRank} consensus rank.`,
      tag: "breaking-out",
      headlineMove: trend,
    };
  }
  if (trend <= -HEAVY) {
    // R5: "crashed" is sign-blind without this — five audited "PLUNGING" players
    // finished AHEAD of their consensus (Mikal Bridges: "crashed to #63" vs a #76
    // consensus). Landing at or above the market's rank is normalization.
    if (gapNow <= FLOOR) {
      return {
        title: "Sinking",
        detail: `A hot start has normalized — down ~${abs(trend)} spots over the trend window to #${nowRank}, still ${gapNow <= 0 ? "ahead of" : "right at"} his #${consensusRank} consensus rank.`,
        tag: "regressing",
        headlineMove: trend,
      };
    }
    return {
      title: "Plunging",
      detail: `Consensus has him at #${consensusRank}; production has crashed to #${nowRank}, a steep ~${abs(trend)}-spot drop over the trend window.`,
      tag: "plunging",
      headlineMove: trend,
    };
  }
  return {
    title: "Stable",
    detail: `Real production is tracking his #${consensusRank} consensus rank.`,
    tag: "stable",
    headlineMove: 0,
  };
}

// A season this shallow can't tell you anything reliable about decline vs. injury —
// it just means he barely played, so exclude it from any "healthy season" trend read.
const HEALTHY_GAMES_THRESHOLD = 50;
// Share of this-season blocks that are stale (<2 games) before we call the season
// itself availability-limited rather than trusting the cumulative rank at face value.
const INJURY_STALE_SHARE = 0.35;
// Below this age, a 2-3 season dip is more often role/opportunity/breakout-regression
// than actual aging decline — don't apply the aging read to younger players at all.
const AGING_DECLINE_MIN_AGE = 30;
// R7: a hair-thin year-over-year dip is noise, not decline — the audit found Myles
// Turner triggered on a 0.68 → 0.68 (sub-rounding) step. Each healthy-season step
// must fall by at least AGING_STEP_MIN, and the full trail by AGING_TOTAL_MIN.
const AGING_STEP_MIN = 0.03;
const AGING_TOTAL_MIN = 0.12;
// R7: if the MOST RECENT season (healthy or not) improved by more than this, the
// player is rebounding right now and the aging read is stale (Nurkić's 42-game
// season rebounded +0.39 while the healthy-season filter ignored it).
const AGING_REBOUND_BLOCK = 0.03;
// A sub-5 MPG drop across the window is normal year-to-year noise (load
// management, rotation tweaks) — not worth calling out on its own. Only
// mention minutes when the total drop (first healthy season to last) clears this.
const MPG_DECLINE_MIN = 5.0;
// A player ranked this well or better is still a top-tier asset, full stop —
// "aging decline" would read as alarmist noise for someone still clearly
// producing at a starter/stud level. Leave those to the normal tag system
// (deriveInsight() above), which already has a tag for "great but slipping":
// Regressing. The special aging-decline override is reserved for players
// who've actually fallen out of that tier because of it.
const ELITE_RANK_THRESHOLD = 25;
// Independently of consensus: if a player's CURRENT production is still top-tier,
// "age-related decline" is the wrong story no matter what his multi-season trail
// says — he's at worst "Regressing" (off a peak but still a clear asset). This
// protects genuine cornerstones like Jalen Brunson / Devin Booker, whose value
// dipped year-over-year but who are plainly still studs, from a tag that reads
// as "washed."
const AGING_PRODUCTION_FLOOR = 60;
// R16: the WASHED tier — strictly harsher than AGE DECLINE, reserved for cases
// nobody would argue: old enough, every healthy step a real decline, and current
// production already out of the rosterable tier. DeRozan/Klay/Draymond stay
// AGE DECLINE; the Conley/late-career-fringe tier reads WASHED.
const WASHED_MIN_AGE = 33;
const WASHED_STEP_MIN = 0.05;
const WASHED_RANK_FLOOR = 300;
// R9: an aging card sitting on a visibly rising chart contradicts itself (Portis
// improved +65 in-window under an "every season worse" blurb) — a window
// improvement this large earns an explicit rider.
const AGING_INSEASON_RIDER = 20;

// R10: a single win or a garbage-time cameo isn't a form read — require six games
// (a full series) before trusting the postseason sample at all.
const POSTSEASON_MIN_GAMES = 6;
// Value-scale (z-score-average) jump big enough to call out as "a different
// player" — the postseason pool is smaller (playoff teams only) so its ranks
// aren't comparable to the 400-player regular-season pool, but both pools
// score the SAME z-score-per-category-averaged Value/Minus1V/8CatV, so the
// raw value itself is the apples-to-apples comparison, not rank position.
const POSTSEASON_STEP = 0.3;
// R10: "fell well short" reads absurd on a player who was still elite in the
// playoffs (Maxey dipped on the z-scale while ranking #13) — soften the downward
// note when his postseason cumulative rank stayed inside this tier.
const POSTSEASON_STILL_ELITE = 15;

function seasonLabel(hoopRSeason: number): string {
  return `${hoopRSeason - 1}-${String(hoopRSeason).slice(2)}`;
}

/**
 * Recent playoff form, when it tells a materially different story than the
 * regular-season read above it. Playoffs are the most recent, highest-leverage
 * games a player has on record — a rookie (or anyone) who raised his level once
 * the games mattered most is a genuinely different signal than "his regular-
 * season cumulative rank," and a regular-season-only read can otherwise miss it
 * entirely (a long, injury-shortened, or slow-starting regular season and a
 * strong playoff run are not mutually exclusive — see Dylan Harper, 2026).
 */
function postseasonNote(
  postseasonBlocks: BlockOut[] | null | undefined,
  postseasonGamesPlayed: number | undefined,
  regularSeasonAvg: number | null,
  metric: TrendMetric,
): string | null {
  if (!postseasonBlocks?.length || !postseasonGamesPlayed || postseasonGamesPlayed < POSTSEASON_MIN_GAMES) return null;
  if (regularSeasonAvg == null) return null;

  const lastBlock = postseasonBlocks[postseasonBlocks.length - 1];
  const postseasonAvg = lastBlock[metric].rolling.seasonAvg;
  if (postseasonAvg == null) return null;

  const jump = postseasonAvg - regularSeasonAvg;
  if (jump >= POSTSEASON_STEP) {
    return `Worth weighing: across ${postseasonGamesPlayed} playoff games he was a clearly better player than his regular-season line above — his most recent, highest-leverage form points up, not down.`;
  }
  if (jump <= -POSTSEASON_STEP) {
    const postRank = [...postseasonBlocks].reverse().map((b) => b[metric].cumRank).find((r) => r != null) ?? null;
    if (postRank != null && postRank <= POSTSEASON_STILL_ELITE) {
      return `Worth weighing: his playoff value dipped from the regular-season line above, though he still ranked #${postRank} across ${postseasonGamesPlayed} playoff games — a step down, not a collapse.`;
    }
    return `Worth weighing: across ${postseasonGamesPlayed} playoff games his production fell well short of his regular-season line above.`;
  }
  return null;
}

type Availability = {
  limited: boolean;
  trailing: boolean;
  staleCount: number;
  totalCount: number;
  trailingStale: number;
  gamesTotal: number;
  lastFreshEnd: string | null;
};

/** Has this player missed enough time THIS season — overall (share gate) or over the
 * run-in (R4 trailing gate) — that the cumulative rank is more about absence than form? */
function classifyAvailability(blocks: BlockOut[], metric: TrendMetric): Availability {
  const none: Availability = { limited: false, trailing: false, staleCount: 0, totalCount: 0, trailingStale: 0, gamesTotal: 0, lastFreshEnd: null };
  const ranked = blocks.map((b, i) => ({ i, rank: b[metric].cumRank })).filter((r) => r.rank != null);
  if (!ranked.length) return none;
  const nowIdx = ranked[ranked.length - 1].i;
  const upTo = blocks.slice(0, nowIdx + 1);
  const staleCount = upTo.filter((b) => b.stale).length;
  const totalCount = upTo.length;
  const gamesTotal = upTo.reduce((a, b) => a + b.gamesInBlock, 0);
  const lastFresh = [...upTo].reverse().find((b) => !b.stale);

  // R4: only judge the run-in over blocks the season has actually reached — on a
  // mid-season build the not-yet-played future blocks are stale by construction.
  const now = Date.now();
  let effectiveLast = nowIdx;
  for (let i = nowIdx; i >= 0; i--) {
    const start = Date.parse(blocks[i].dateRange[0]);
    if (Number.isNaN(start) || start <= now) {
      effectiveLast = i;
      break;
    }
  }
  const tail = blocks.slice(Math.max(0, effectiveLast - (TRAILING_WINDOW - 1)), effectiveLast + 1);
  const trailingStale = tail.filter((b) => b.stale).length;

  return {
    limited: totalCount > 0 && staleCount / totalCount >= INJURY_STALE_SHARE,
    trailing: tail.length === TRAILING_WINDOW && trailingStale >= TRAILING_STALE_MIN,
    staleCount,
    totalCount,
    trailingStale,
    gamesTotal,
    lastFreshEnd: lastFresh?.dateRange[1] ?? null,
  };
}

/** R13: a short season with no real prior-year track record is a late-call-up /
 * two-way audition, not an injury story — different label, different caveat. */
function isSmallSamplePattern(gamesTotal: number, seasonHistory: SeasonHistoryEntry[]): boolean {
  if (gamesTotal > SMALL_SAMPLE_MAX_GAMES) return false;
  if (!seasonHistory.length) return true;
  const latestSeason = Math.max(...seasonHistory.map((s) => s.season));
  return !seasonHistory.some((s) => s.season < latestSeason && s.gp >= SMALL_SAMPLE_PRIOR_GP);
}

/** R8: the availability caveat is two-sided — a starved sample can also FLATTER the
 * rank (Ty Jerome sat at #48 on 15 hot games; the old copy implied ranks only suffer). */
function availabilityDetail(avail: Availability, nowRank: number | null, consensusRank: number | null): string {
  const base = `Missed significant time this season (${avail.staleCount} of ${avail.totalCount} blocks, ${avail.gamesTotal} games)`;
  const hasConsensus = consensusRank != null && consensusRank < CONSENSUS_FALLBACK_MIN;
  if (hasConsensus && nowRank != null && nowRank < consensusRank) {
    return `${base} — the cumulative rank is a small-sample read, and a hot short stretch can flatter it.`;
  }
  return `${base} — the cumulative rank reflects games missed, not a production decline.`;
}

/**
 * R7-hardened multi-season decline read: has this player's REAL production declined
 * every healthy season — by enough to be signal, not rounding — and is he old enough
 * that "aging curve" beats role/opportunity noise as the explanation? Also refuses
 * to fire while the most recent season (healthy or not) is actively rebounding.
 * R16: when the decline is steep, late, and current production has left the
 * rosterable tier, the read hardens from AGE DECLINE to WASHED.
 */
function classifyAgingDecline(
  seasonHistory: SeasonHistoryEntry[],
  age: number | null,
  metric: TrendMetric,
): { declining: boolean; washed: boolean; detail: string } {
  const none = { declining: false, washed: false, detail: "" };
  if (age == null || age < AGING_DECLINE_MIN_AGE) return none;
  const healthy = seasonHistory.filter((s) => s.gp >= HEALTHY_GAMES_THRESHOLD);
  if (healthy.length < 2) return none;

  // Every healthy step must be a real decline (R7 epsilon), and the trail must
  // add up to something material.
  let minStep = Infinity;
  let total = 0;
  for (let i = 1; i < healthy.length; i++) {
    const step = healthy[i - 1][metric] - healthy[i][metric]; // positive = declined
    minStep = Math.min(minStep, step);
    total += step;
  }
  if (minStep < AGING_STEP_MIN || total < AGING_TOTAL_MIN) return none;

  // R7 recency: a live rebound (even in a shallow season the healthy filter would
  // ignore) means the decline story is stale right now.
  const bySeason = [...seasonHistory].sort((a, b) => a.season - b.season);
  if (bySeason.length >= 2) {
    const latest = bySeason[bySeason.length - 1];
    const prev = bySeason[bySeason.length - 2];
    if (latest[metric] - prev[metric] > AGING_REBOUND_BLOCK) return none;
  }

  const washed = age >= WASHED_MIN_AGE && minStep >= WASHED_STEP_MIN;

  // Minutes are only mentioned (and the MPG trail only shown) when the drop is
  // material AND belongs to the most recent healthy season — and the label says
  // WHICH season that was: the audit caught a blurb calling 2024-25's minutes
  // cut "this year" because the current season was too shallow to qualify.
  const last = healthy[healthy.length - 1];
  const prior = healthy[healthy.length - 2];
  const mpgMaterial = prior.mpg - last.mpg >= MPG_DECLINE_MIN;
  const latestSeason = bySeason[bySeason.length - 1].season;
  const whenLabel = last.season === latestSeason ? "this year" : `in ${seasonLabel(last.season)}`;

  const base = `Real production has declined every healthy season since ${seasonLabel(healthy[0].season)}`;
  if (mpgMaterial) {
    const trail = healthy.map((s) => `${seasonLabel(s.season)}: ${s.mpg.toFixed(1)} MPG`).join(" → ");
    return {
      declining: true,
      washed,
      detail: `${base}, with minutes down ~${(prior.mpg - last.mpg).toFixed(1)}/game ${whenLabel} (${trail}) — this reads as age-related, not a blip.`,
    };
  }
  return { declining: true, washed, detail: `${base} — this reads as age-related, not a blip.` };
}

/**
 * The full "final take" — deriveInsight() plus the availability and age gates,
 * plus a postseason-form check appended to whichever wins. Prefer this over
 * calling deriveInsight() directly wherever `age` and `seasonHistory` are
 * available (both TrendHero and roster-live-data.ts's server-side precompute).
 *
 * `postseason` is optional/independent of everything else here on purpose: it's
 * the SAME season's playoff block series (when the player's team made the
 * playoffs), passed in by the caller rather than fetched here — this file stays
 * pure/data-only. Missing it (no playoff appearance, or the caller didn't fetch
 * it) just means no note gets appended; every existing call site is unaffected.
 *
 * `isRookie` = first-year player in the charted season (R6/R15) — the roster
 * pipeline's is_sophomore flag for the completed season, or Player.tag === "soph".
 */
export function deriveFinalTake(
  blocks: BlockOut[],
  seasonHistory: SeasonHistoryEntry[],
  age: number | null,
  metric: TrendMetric,
  consensusRank: number | null,
  postseason?: { blocks: BlockOut[]; gamesPlayed: number } | null,
  isRookie = false,
): Insight | null {
  const hasConsensus = consensusRank != null && consensusRank < CONSENSUS_FALLBACK_MIN; // R1

  const withPostseasonNote = (insight: Insight | null): Insight | null => {
    if (!insight) return insight;
    const regularSeasonAvg = blocks[blocks.length - 1]?.[metric]?.rolling.seasonAvg ?? null;
    const note = postseason ? postseasonNote(postseason.blocks, postseason.gamesPlayed, regularSeasonAvg, metric) : null;
    return note ? { ...insight, detail: `${insight.detail} ${note}` } : insight;
  };

  const { startRank, nowRank, trend } = chartWindow(blocks, metric);
  const avail = classifyAvailability(blocks, metric);

  // ── Availability gates (need no consensus — R1 lets them fire for unranked players) ──
  if (avail.limited || avail.trailing) {
    // R13: late-call-up / two-way pattern — an audition sample, not a health story.
    if (isSmallSamplePattern(avail.gamesTotal, seasonHistory)) {
      return withPostseasonNote({
        title: "Small sample",
        detail: `Only ${avail.gamesTotal} games this season, with no real prior-year track record — an audition sample, not a level; don't read the cumulative rank as one.`,
        tag: "small-sample",
        headlineMove: 0,
      });
    }
    if (avail.limited) {
      return withPostseasonNote({
        title: "Limited",
        detail: availabilityDetail(avail, nowRank, consensusRank),
        tag: "games-limited",
        headlineMove: 0, // absence, not a directional move — header shows no arrow
      });
    }
    // R4 trailing-absence: played most of the year, then went idle over the run-in.
    return withPostseasonNote({
      title: "Limited",
      detail: `Barely played over the closing stretch (${avail.trailingStale} of the final ${TRAILING_WINDOW} blocks missed${avail.lastFreshEnd ? `; last regular run ended ${avail.lastFreshEnd}` : ""}) — the trend window ends on absence, not form.`,
      tag: "games-limited",
      headlineMove: 0,
    });
  }

  // ── Age gates ──────────────────────────────────────────────────────────────────
  // Current production rank (last real block) — gates the aging override so a
  // still-productive star never gets tagged as declining (see AGING_PRODUCTION_FLOOR).
  const stillProducing = nowRank != null && nowRank <= AGING_PRODUCTION_FLOOR;
  const isElite = hasConsensus && consensusRank <= ELITE_RANK_THRESHOLD;
  const aging = classifyAgingDecline(seasonHistory, age, metric);
  if (aging.declining && !isElite && !stillProducing) {
    // R9: don't let a decline card contradict a visibly rising chart.
    const rider = trend >= AGING_INSEASON_RIDER && startRank != null && nowRank != null
      ? ` Though he closed this season strong — up ~${Math.abs(trend).toFixed(0)} spots over the trend window (#${startRank} → #${nowRank}).`
      : "";
    // R16: the harsher tier, only when nobody would argue.
    if (aging.washed && nowRank != null && nowRank > WASHED_RANK_FLOOR) {
      return withPostseasonNote({
        title: "Washed",
        detail: `${aging.detail} Current production (#${nowRank}) has fallen out of the rosterable tier — this is the late-career cliff, not a dip.${rider}`,
        tag: "washed",
        headlineMove: 0,
      });
    }
    return withPostseasonNote({ title: "Ageing", detail: `${aging.detail}${rider}`, tag: "aging-decline", headlineMove: 0 });
  }

  if (!hasConsensus) return null; // R1: no gap-based tags without a real consensus

  let insight = deriveInsight(blocks, metric, consensusRank, isRookie);

  // R17: "regressing" off a season that is still the player's best on record is a
  // cool-down, not a decline — say so instead of reading bearish on a career year.
  if (insight?.tag === "regressing" && seasonHistory.length >= 2 && nowRank != null) {
    const latestSeason = Math.max(...seasonHistory.map((s) => s.season));
    const latest = seasonHistory.find((s) => s.season === latestSeason);
    const priors = seasonHistory.filter((s) => s.season < latestSeason);
    if (latest && priors.length && priors.every((p) => latest[metric] >= p[metric])) {
      insight = {
        ...insight,
        detail: `Cooling off what's still a career-best season — down ~${Math.abs(trend).toFixed(0)} spots over the trend window to #${nowRank}, but his full-season value tops both prior years${consensusRank > nowRank ? `, and he remains ahead of his #${consensusRank} consensus rank` : ""}.`,
      };
    }
  }

  return withPostseasonNote(insight);
}
