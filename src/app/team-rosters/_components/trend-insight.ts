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

/**
 * Position-vs-consensus × velocity-direction/magnitude trend tag. The 8 core
 * tags come from a decision tree over `gapNow` (real rank minus consensus
 * rank — positive = below/worse than consensus) and `velocity` (this
 * window's dominant move, positive = improving) — see deriveInsight() below.
 * "injury-limited"/"aging-decline" are separate gates in deriveFinalTake()
 * that override the tag entirely when the trend data can't be trusted at
 * face value (see classifyAvailability/classifyAgingDecline).
 */
export type TrendTag =
  | "breaking-out"
  | "surging"
  | "climbing"
  | "stable"
  | "regressing"
  | "plunging"
  | "fading"
  | "cratering"
  | "injury-limited"
  | "aging-decline";

/** Reuses the site's existing 5-tier diverging scale (STATSET_COLORS in
 * roster-data.ts) instead of inventing new colors — color communicates
 * "how good/bad," the label + emoji communicate the specific story. */
export const TAG_META: Record<TrendTag, { label: string; emoji: string; color: string }> = {
  "breaking-out": { label: "BREAKING OUT", emoji: "🚀", color: "#12a150" },
  surging: { label: "SURGING", emoji: "📈", color: "#62a046" },
  climbing: { label: "CLIMBING", emoji: "↗️", color: "#62a046" },
  stable: { label: "STABLE", emoji: "➡️", color: "var(--rt-muted)" },
  regressing: { label: "REGRESSING", emoji: "↘️", color: "#dd7a2b" },
  fading: { label: "FADING", emoji: "📉", color: "#cf2230" },
  plunging: { label: "PLUNGING", emoji: "⚰️", color: "#cf2230" },
  cratering: { label: "CRATERING", emoji: "⚠️", color: "#cf2230" },
  "injury-limited": { label: "INJURY-LIMITED", emoji: "🏥", color: "var(--rt-muted)" },
  "aging-decline": { label: "AGE DECLINE", emoji: "⏳", color: "#cf2230" },
};

export type Insight = { title: string; detail: string; tag: TrendTag };

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
  // reads as "Breaking out" instead of a marginal "Cooling off").
  const MOVE_THRESHOLD = 20; // a swing at least this big is the headline, wherever he sits now
  const SMALL_GAP = 20; // otherwise, a gap smaller than this just reads as "matching consensus"
  // Re-validated for the 8-tag split against the same 361-player pool
  // (2026-07-09): HEAVY_THRESHOLD=40 / FAR_GAP=60 give a 6.4%-24.4% spread
  // across all 8 tags with no empty/dominant bucket, and are stable under
  // ±5/±10 perturbation — no cliff-edge sensitivity.
  const HEAVY_THRESHOLD = 40; // a swing big enough to read as "rapid"/"heavy"
  const FAR_GAP = 60; // a gap big enough to read as "far" below consensus

  // Signed dominant move for this window: positive = improving (recovering
  // from a trough), negative = declining (falling from a peak).
  const velocity = improvedFromWorst >= worsenedFromBest ? improvedFromWorst : -worsenedFromBest;
  const velStr = Math.abs(velocity).toFixed(0);

  if (Math.abs(gapNow) <= SMALL_GAP) {
    // Near/crossing consensus. gapNow's sign still matters for the copy —
    // "near" only means the GAP is small, not that he's already crossed to
    // the good side of it, so the wording must say which side he's actually
    // on rather than assuming a heavy positive move already means he's
    // outproducing (a player can be near-but-still-below consensus and
    // rising fast without having overtaken it yet — see gapNow > 0 branch).
    if (velocity >= HEAVY_THRESHOLD) {
      return {
        title: "Breaking out",
        detail:
          gapNow <= 0
            ? `Outproducing his #${consensusRank} consensus rank at #${nowRank}, after a ~${velStr}-spot move — crossing straight into elite territory.`
            : `Still trading just below his #${consensusRank} consensus rank at #${nowRank}, but rising fast — up ~${velStr} spots and closing in.`,
        tag: "breaking-out",
      };
    }
    if (velocity <= -HEAVY_THRESHOLD) {
      return {
        title: "Plunging",
        detail:
          gapNow >= 0
            ? `Consensus has him at #${consensusRank}; production has crashed to #${nowRank}, a fast ~${velStr}-spot decline that's crossed right through his floor.`
            : `Still narrowly outproducing his #${consensusRank} consensus rank at #${nowRank}, but fading fast — down ~${velStr} spots and closing in from above.`,
        tag: "plunging",
      };
    }
    return {
      title: "Stable",
      detail: `Real production is tracking his #${consensusRank} consensus rank.`,
      tag: "stable",
    };
  }

  if (gapNow < -SMALL_GAP) {
    // Clearly above (better than) consensus.
    if (velocity < -MOVE_THRESHOLD) {
      return {
        title: "Regressing",
        detail: `Still outproducing his #${consensusRank} consensus rank at #${nowRank}, but sliding back toward it — down ~${velStr} spots over the lookback window.`,
        tag: "regressing",
      };
    }
    return {
      title: "Surging",
      detail: `Outproducing his #${consensusRank} consensus rank at #${nowRank}, and still pulling further ahead.`,
      tag: "surging",
    };
  }

  // Clearly below (worse than) consensus.
  if (velocity > MOVE_THRESHOLD) {
    return {
      title: "Climbing",
      detail: `Still trading below his #${consensusRank} consensus rank at #${nowRank}, but closing the gap — up ~${velStr} spots over the lookback window.`,
      tag: "climbing",
    };
  }
  if (gapNow >= FAR_GAP && velocity <= -HEAVY_THRESHOLD) {
    return {
      title: "Cratering",
      detail: `Consensus has him at #${consensusRank}; production has collapsed to #${nowRank} — an extreme, high-velocity decline well past his floor.`,
      tag: "cratering",
    };
  }
  return {
    title: "Fading",
    detail: `Consensus has him at #${consensusRank}; production has held below that at #${nowRank}, drifting further behind.`,
    tag: "fading",
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
// A sub-5 MPG drop across the window is normal year-to-year noise (load
// management, rotation tweaks) — not worth calling out on its own. Only
// mention minutes when the total drop (first healthy season to last) clears this.
const MPG_DECLINE_MIN = 5.0;
// A player ranked this well or better is still a top-tier asset, full stop —
// "aging decline" would read as alarmist noise for someone still clearly
// producing at a starter/stud level. Leave those to the normal tag system
// (deriveInsight() below), which already has a tag for "great but slipping":
// Regressing. The special aging-decline override is reserved for players
// who've actually fallen out of that tier because of it.
const ELITE_RANK_THRESHOLD = 25;

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
  let mpgNeverIncreased = true;
  for (let i = 1; i < healthy.length; i++) {
    if (healthy[i][metric] >= healthy[i - 1][metric]) valueDeclining = false;
    if (healthy[i].mpg > healthy[i - 1].mpg) mpgNeverIncreased = false;
  }
  if (!valueDeclining) return { declining: false, detail: "" };

  // Never-increased alone isn't enough to call minutes out by name — a
  // 35.2 -> 34.2 MPG slide is noise, not a signal. Only the two together
  // (monotonic AND a material total drop) earn the "minutes falling too" line.
  const mpgTotalDrop = healthy[0].mpg - healthy[healthy.length - 1].mpg;
  const mpgMaterial = mpgNeverIncreased && mpgTotalDrop >= MPG_DECLINE_MIN;

  const trail = healthy.map((s) => `${seasonLabel(s.season)}: ${s.mpg.toFixed(1)} MPG`).join(" → ");
  return {
    declining: true,
    detail: `Real production has declined every healthy season since ${seasonLabel(healthy[0].season)}${mpgMaterial ? ", with minutes falling every year too" : ""} (${trail}) — this reads as age-related, not a blip.`,
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
      tag: "injury-limited",
    };
  }

  const isElite = consensusRank <= ELITE_RANK_THRESHOLD;
  const aging = classifyAgingDecline(seasonHistory, age, metric);
  if (aging.declining && !isElite) {
    return { title: "Age-related decline", detail: aging.detail, tag: "aging-decline" };
  }

  return deriveInsight(blocks, metric, consensusRank);
}
