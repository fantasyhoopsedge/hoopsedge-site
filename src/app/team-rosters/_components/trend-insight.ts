/**
 * Pure trend-insight logic shared between the server (roster-live-data.ts,
 * precomputing a compact tone per roster player for the list/grid views) and
 * the client (player-trend-chart.tsx's TrendHero, which has the full block
 * series and renders the rich callout). No React, no "use client" — just data.
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
export type TrendPlayer = {
  playerId: string;
  player: string;
  gamesPlayed: number;
  mpg: number;
  blocks: BlockOut[];
  seasonHistory: SeasonHistoryEntry[];
};

export type TrendMetric = "nineCatV" | "minus1V" | "eightCatV";

export type Tone = "positive" | "negative" | "caution" | "flat";
export const TONE_COLOR: Record<Tone, string> = {
  positive: "var(--rt-up)",
  negative: "var(--rt-down)",
  caution: "#dd7a2b",
  flat: "var(--rt-muted)",
};

/** Compact buy/sell/hold read of a tone, for list/card badges. */
export function verdictFromTone(tone: Tone): "BUY" | "SELL" | "HOLD" {
  if (tone === "positive") return "BUY";
  if (tone === "negative") return "SELL";
  return "HOLD"; // caution + flat both read as "no urgent action" at a glance
}

export type Insight = { title: string; detail: string; tone: Tone };

// Blocks are ~2-week chunks; a 20-week lookback is the trailing 10 blocks.
export const LOOKBACK_BLOCKS = 10;

/**
 * Blends the site's dynasty consensus rank (the market's slow-moving read) with
 * this player's real cumulative rank trend (this season's actual production) into
 * one plain-language callout. The story that matters isn't the raw gap between
 * the two rankings — it's whether that gap has been WIDENING or NARROWING over
 * the last ~20 weeks, since that's what tells a dynasty manager whether a player
 * is trending toward or away from what the market already has priced in.
 */
export function deriveInsight(blocks: BlockOut[], metric: TrendMetric, consensusRank: number | null): Insight | null {
  if (consensusRank == null) return null;
  const ranked = blocks.map((b, i) => ({ i, rank: b[metric].cumRank })).filter((r) => r.rank != null) as {
    i: number;
    rank: number;
  }[];
  if (ranked.length < 2) return null;

  const nowIdx = ranked[ranked.length - 1].i;
  const nowRank = ranked[ranked.length - 1].rank;
  const gapNow = nowRank - consensusRank; // positive = real rank worse than (behind) consensus

  // Look at the whole lookback window's best/worst gap, not just its two
  // endpoints — a player who dipped mid-window and has since recovered (or
  // vice versa) needs the window's extreme as the reference point, not
  // whatever the gap happened to be exactly N weeks ago.
  const windowStart = Math.max(0, nowIdx - LOOKBACK_BLOCKS);
  const gaps = ranked.filter((r) => r.i >= windowStart && r.i <= nowIdx).map((r) => r.rank - consensusRank);
  const worstGap = Math.max(...gaps); // most underperforming point in the window
  const bestGap = Math.min(...gaps); // most outperforming point in the window
  const improvedFromWorst = worstGap - gapNow; // how much better than his own worst point
  const worsenedFromBest = gapNow - bestGap; // how much worse than his own best point

  // Tuned against the full 361-player eligible pool (2026-07-06): at 15/15, players
  // with a real but marginal ~15-spot swing (e.g. Anthony Edwards, Jalen Suggs) got
  // cast as "closing the gap"/"cooling off" even though their CURRENT gap was already
  // small — noisy. 20 filters that out while still catching the swings we validated
  // (Chet Holmgren's 21-point recovery, Ty Jerome's sustained ~140-spot outperformance
  // reads as "Breaking out" instead of a marginal "Cooling off"). Verdict split at 20/20
  // across the pool: 149 BUY / 73 SELL / 139 HOLD — stable relative to neighboring values
  // (18↔20 only flips 4 players; 20↔25 flips 8 — real inflection, not a random cliff).
  const MOVE_THRESHOLD = 20; // a swing at least this big is the headline, wherever he sits now
  const SMALL_GAP = 20; // otherwise, a gap smaller than this just reads as "matching consensus"

  if (Math.max(improvedFromWorst, worsenedFromBest) >= MOVE_THRESHOLD) {
    if (improvedFromWorst > worsenedFromBest) {
      // Recovering from a trough somewhere in the window.
      return gapNow > 0
        ? {
            title: "Closing the gap",
            detail: `Still trading below his #${consensusRank} consensus rank, but has climbed back from a #${consensusRank + worstGap} low to #${nowRank} over the last ~20 weeks.`,
            tone: "positive",
          }
        : {
            title: "Breaking out",
            detail: `Outproducing his #${consensusRank} consensus rank at #${nowRank}, after a slower stretch earlier this window.`,
            tone: "positive",
          };
    }
    // Declining from a peak somewhere in the window.
    return gapNow > 0
      ? {
          title: "Falling behind consensus",
          detail: `Consensus has him at #${consensusRank}; production has slipped to #${nowRank} after being well ahead of that earlier this window.`,
          tone: "negative",
        }
      : {
          title: "Cooling off, still ahead",
          detail: `Still outproducing his #${consensusRank} consensus rank at #${nowRank}, but less than earlier this window.`,
          tone: "caution",
        };
  }

  if (Math.abs(gapNow) <= SMALL_GAP) {
    return {
      title: "Playing to his billing",
      detail: `Real production is tracking his #${consensusRank} consensus rank.`,
      tone: "flat",
    };
  }
  return gapNow > 0
    ? {
        title: "Falling behind consensus",
        detail: `Consensus has him at #${consensusRank}; production has held at #${nowRank} all window.`,
        tone: "negative",
      }
    : {
        title: "Breaking out",
        detail: `Outproducing his #${consensusRank} consensus rank at #${nowRank}, and holding it.`,
        tone: "positive",
      };
}

// A season this shallow can't tell you anything reliable about decline vs. injury —
// it just means he barely played, so exclude it from any "healthy season" trend read.
const HEALTHY_GAMES_THRESHOLD = 50;
// Share of this-season blocks that are stale (<2 games) before we call the season
// itself injury/absence-limited rather than trusting the cumulative rank at face value.
const INJURY_STALE_SHARE = 0.35;
// Below this age, a 2-3 season dip is more often role/opportunity/breakout-regression
// than actual aging decline — don't apply the aging read to younger players at all.
const AGING_DECLINE_MIN_AGE = 30;

function seasonLabel(hoopRSeason: number): string {
  return `${hoopRSeason - 1}-${String(hoopRSeason).slice(2)}`;
}

/** Has this player missed enough time THIS season that the cumulative rank is more about absence than production? */
function classifyAvailability(blocks: BlockOut[], metric: TrendMetric): { limited: boolean; staleCount: number; totalCount: number } {
  const ranked = blocks.map((b, i) => ({ i, rank: b[metric].cumRank })).filter((r) => r.rank != null);
  if (!ranked.length) return { limited: false, staleCount: 0, totalCount: 0 };
  const nowIdx = ranked[ranked.length - 1].i;
  const upTo = blocks.slice(0, nowIdx + 1);
  const staleCount = upTo.filter((b) => b.stale).length;
  const totalCount = upTo.length;
  return { limited: totalCount > 0 && staleCount / totalCount >= INJURY_STALE_SHARE, staleCount, totalCount };
}

/**
 * Has this player's REAL production declined every healthy season (not just this
 * one), and is he old enough that "aging curve" is a more likely explanation than
 * role/opportunity noise? This is what separates DeMar DeRozan (36, minutes and
 * value down every year for 3 straight healthy seasons) from Jalen Williams (24,
 * one shallow injury season sandwiched between two healthy, IMPROVING ones) —
 * filtering to healthy seasons already excludes the latter from ever triggering here.
 */
function classifyAgingDecline(seasonHistory: SeasonHistoryEntry[], age: number | null, metric: TrendMetric): { declining: boolean; detail: string } {
  if (age == null || age < AGING_DECLINE_MIN_AGE) return { declining: false, detail: "" };
  const healthy = seasonHistory.filter((s) => s.gp >= HEALTHY_GAMES_THRESHOLD);
  if (healthy.length < 2) return { declining: false, detail: "" };

  let valueDeclining = true;
  let mpgDeclining = true;
  for (let i = 1; i < healthy.length; i++) {
    if (healthy[i][metric] >= healthy[i - 1][metric]) valueDeclining = false;
    if (healthy[i].mpg > healthy[i - 1].mpg) mpgDeclining = false;
  }
  if (!valueDeclining) return { declining: false, detail: "" };

  const trail = healthy.map((s) => `${seasonLabel(s.season)}: ${s.mpg.toFixed(1)} MPG`).join(" → ");
  return {
    declining: true,
    detail: `Real production has declined every healthy season since ${seasonLabel(healthy[0].season)}${mpgDeclining ? ", with minutes falling every year too" : ""} (${trail}) — this reads as age-related, not a blip.`,
  };
}

/**
 * The full "final take" — deriveInsight() plus the two gates above. Prefer this
 * over calling deriveInsight() directly wherever an `age` and `seasonHistory` are
 * available (both TrendHero and roster-live-data.ts's server-side precompute).
 */
export function deriveFinalTake(
  blocks: BlockOut[],
  seasonHistory: SeasonHistoryEntry[],
  age: number | null,
  metric: TrendMetric,
  consensusRank: number | null,
): Insight | null {
  if (consensusRank == null) return null;

  const avail = classifyAvailability(blocks, metric);
  if (avail.limited) {
    return {
      title: "Injury-limited",
      detail: `Missed significant time this season (${avail.staleCount} of ${avail.totalCount} blocks) — cumulative rank reflects games missed, not a production decline.`,
      tone: "flat",
    };
  }

  const aging = classifyAgingDecline(seasonHistory, age, metric);
  if (aging.declining) {
    return { title: "Age-related decline", detail: aging.detail, tone: "negative" };
  }

  return deriveInsight(blocks, metric, consensusRank);
}
