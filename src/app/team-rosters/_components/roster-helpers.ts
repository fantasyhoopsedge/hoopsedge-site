/**
 * Pure derived-value helpers ported from the Claude Design prototype
 * (Thunder Roster.dc.html). "Projection" stat lines are deterministic jitter
 * around the current per-game line (seeded off the player id) — placeholder
 * trend data until a real projection model is wired in. "Prior" (2024-25) is
 * real season_player_stats/season_player_values data — see roster-live-data.ts.
 */
import { CATS, STATSET_COLORS, TAG_THEME, type Cat, type FvMetric, type PerGameStats, type Player, type PlayerTag, type SeasonMode } from "./roster-data";

// Category key → its index in Player.catVals (which is in CATS order).
const CAT_IDX = Object.fromEntries(CATS.map((c, i) => [c.key, i])) as Record<keyof PerGameStats, number>;

/**
 * Current-season category value: the real season_player_values z-score when the
 * player has one, else a raw z-score from the per-game line (rookies with no
 * 2025-26 season). Same scale, so it drops into starTier/heatmap thresholds.
 */
export function catValCur(p: Player, cat: Cat): number {
  return p.catVals?.[CAT_IDX[cat.key]] ?? zFor(cat, p.pg[cat.key]);
}

/** Same as catValCur but for the real 2024-25 (prior) season line. */
export function catValPrior(p: Player, cat: Cat): number {
  return p.priorCatVals?.[CAT_IDX[cat.key]] ?? zFor(cat, p.priorPg?.[cat.key] ?? 0);
}

/** Fantasy value for a metric from the precomputed season_player_values. */
export function fvOf(p: Player, metric: FvMetric): number {
  return metric === "ninecat" ? p.nineCat : metric === "eightcat" ? p.eightCat : p.minus1;
}

export function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

export function zFor(cat: Cat, v: number) {
  let z = (v - cat.mean) / cat.std;
  if (cat.invert) z = -z;
  return z;
}

function seedOf(p: Player, salt: number) {
  return [...p.id].reduce((a, c) => a + c.charCodeAt(0), 0) + salt;
}

export function projSeasonVal(p: Player, cat: Cat) {
  const ageAdj = p.age <= 23 ? 0.08 : p.age <= 27 ? 0.03 : -0.05;
  const dirAdj = p.dir === "up" ? 0.03 : p.dir === "down" ? -0.03 : 0;
  const seed = seedOf(p, cat.label.length * 11);
  const j = Math.sin(seed * 0.9) * 0.05;
  return p.pg[cat.key] * (1 + ageAdj + dirAdj + j);
}

export function catZ(cats: Cat[], p: Player, useProj: boolean) {
  return cats.map((c) => zFor(c, useProj ? projSeasonVal(p, c) : p.pg[c.key]));
}

export function fvValue(metric: FvMetric, zArr: number[]) {
  const all9 = zArr.reduce((a, b) => a + b, 0);
  if (metric === "eightcat") return zArr.slice(0, 8).reduce((a, b) => a + b, 0); // drop TO
  if (metric === "minus1") return all9 - Math.min(...zArr); // drop worst cat
  return all9; // 9-cat
}

export function pctFor(cat: Cat, v: number) {
  let p = (v - cat.lo) / (cat.hi - cat.lo);
  if (cat.invert) p = 1 - p;
  return clamp(p, 0, 1);
}

export function starTier(z: number) {
  if (z >= 1.0) return 5;
  if (z >= 0.35) return 4;
  if (z >= -0.35) return 3;
  if (z >= -1.0) return 2;
  return 1;
}

export function initials(name: string) {
  const parts = name.split(" ");
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function money(n: number) {
  return "$" + (n / 1e6).toFixed(1) + "M";
}

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return n + "th";
  switch (n % 10) {
    case 1: return n + "st";
    case 2: return n + "nd";
    case 3: return n + "rd";
    default: return n + "th";
  }
}

export function fullMoney(n: number) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

export function commas(n: number) {
  return Math.round(n).toLocaleString("en-US");
}

export function caret(dir: "up" | "down" | "flat") {
  return dir === "up" ? "▲" : dir === "down" ? "▼" : "–";
}

export function changeColor(dir: "up" | "down" | "flat") {
  return dir === "up" ? "var(--rt-up)" : dir === "down" ? "var(--rt-down)" : "var(--rt-muted)";
}

const POS_LABELS: Record<string, string> = {
  PG: "Point guard",
  SG: "Shooting guard",
  SF: "Small forward",
  PF: "Power forward",
  C: "Center",
  G: "Guard",
  F: "Forward",
  "G/F": "Guard / Forward",
  "F/C": "Forward / Center",
};

export function posLabel(pos: string) {
  return POS_LABELS[pos] ?? pos;
}

export function tagBadge(tag: NonNullable<PlayerTag>, dark: boolean) {
  const t = TAG_THEME[tag];
  return {
    label: t.label,
    color: dark ? t.darkText : t.lightText,
    border: dark ? t.darkBorder : t.lightBorder,
    bg: dark ? t.darkBg : "var(--rt-canvas)",
  };
}

export function shortName(name: string) {
  const parts = name.split(" ");
  if (parts.length < 2) return name.length > 30 ? name.slice(0, 29).trimEnd() + "…" : name;
  let s = parts[0][0] + ". " + parts.slice(1).join(" ");
  if (s.length > 30) s = s.slice(0, 29).trimEnd() + "…";
  return s;
}

/**
 * Shortens a name to fit the single-line hero header (e.g. "Shai
 * Gilgeous-Alexander" -> "Shai G-Alexander"). Tries, in order: the name as-is,
 * abbreviating a double-barreled surname's first segment, abbreviating the
 * first name to an initial, then a hard truncation as a last resort.
 */
export function heroName(name: string, maxChars = 20): string {
  if (name.length <= maxChars) return name;
  const parts = name.split(" ");
  if (parts.length < 2) return name.slice(0, maxChars - 1).trimEnd() + "…";
  const first = parts[0];
  const last = parts.slice(1).join(" ");
  if (last.includes("-")) {
    const hyphenParts = last.split("-");
    const abbreviated = first + " " + hyphenParts[0][0] + "-" + hyphenParts.slice(1).join("-");
    if (abbreviated.length <= maxChars) return abbreviated;
  }
  const initialed = first[0] + ". " + last;
  if (initialed.length <= maxChars) return initialed;
  return initialed.slice(0, maxChars - 1).trimEnd() + "…";
}

/** Drops a trailing "s" for compact tier tags (e.g. "Proven Contributors" -> "Proven Contributor"). */
export function singularTier(name: string): string {
  return name.endsWith("s") ? name.slice(0, -1) : name;
}

export function sparkSeries(p: Player) {
  const n = 8;
  const seed = [...p.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const vals: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const base = p.dir === "up" ? t : p.dir === "down" ? 1 - t : 0.5;
    const noise = Math.sin(seed + i * 1.7) * 0.16;
    vals.push(base * 0.7 + 0.15 + noise);
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const W = 150;
  const H = 40;
  const P = 5;
  const pts = vals.map((v, i) => {
    const x = P + (i / (n - 1)) * (W - 2 * P);
    const norm = (v - min) / (max - min || 1);
    const y = P + (1 - norm) * (H - 2 * P);
    return { x, y };
  });
  return {
    points: pts.map((q) => q.x.toFixed(1) + "," + q.y.toFixed(1)).join(" "),
    end: { cx: pts[pts.length - 1].x.toFixed(1), cy: pts[pts.length - 1].y.toFixed(1) },
  };
}

export type ContractRow = { year: string; team: string; age: string; salary: string; estimated: boolean; qo: boolean };

/**
 * Contract table built from real per-year cap hits (p.salaryYears from
 * nba_roster). Year 1 = 2026-27; only seasons with a contracted salary are
 * listed. Even-split estimated years are flagged, and Qualifying-Offer years
 * (a real current.csv figure, but a formulaic RFA cap hold rather than a
 * negotiated salary) are flagged separately. nba_roster tracks 4 years
 * (through 2029-30), so a longer deal shows its first four seasons.
 */
export function contractFor(p: Player) {
  const firstStart = 2026; // 2026-27 season = Year 1
  const estSet = new Set(
    (p.estimatedYears ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  const qoSet = new Set(
    (p.qoYears ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  const rows: ContractRow[] = [];
  let rowTotal = 0;
  (p.salaryYears ?? []).forEach((sal, i) => {
    if (sal == null) return;
    rowTotal += sal;
    const startYr = firstStart + i;
    const shortEnd = String(startYr + 1).slice(2);
    rows.push({
      year: `${startYr}–${shortEnd}`, // "2026–27"
      team: p.team,
      age: String(p.age + i),
      salary: money(sal),
      estimated: estSet.has(`${startYr}-${shortEnd}`), // estimatedYears uses "2027-28"
      qo: qoSet.has(`${startYr}-${shortEnd}`),
    });
  });
  // Header shows the FULL contract from nba_roster (length + total may run beyond
  // the 4-year salary window the rows cover); fall back to the rows we have.
  const n = p.contractYears ?? rows.length;
  const total = p.contractTotal ?? rowTotal;
  return { n, total, avg: n ? total / n : 0, rows, status: p.contractStatus };
}

export type RankedProfileRow = { key: string; label: string; z: number; color: string; bar: { left: string; width: string } };
export type RankedProfile = { noData: true; reason: string } | { noData: false; rows: RankedProfileRow[] };

/** A player's categories ranked highest z-score (current mode) to lowest —
 * the row order buildRankedProfile falls back to, and what the compare modal
 * uses as the shared anchor order for every card (see catOrder param below). */
export function catOrderFor(p: Player): Cat[] {
  return [...CATS].sort((a, b) => catValCur(p, b) - catValCur(p, a));
}

/**
 * The 9-category profile's full math for one player at one season mode —
 * shared by the single-player detail panel and every card in the compare
 * modal, so both stay in lockstep instead of drifting apart. A season this
 * shallow can't tell you anything reliable (see roster-app.tsx's original
 * comment this was extracted from) — noData + a reason string covers that.
 *
 * Row order defaults to this player's own CURRENT mode ranking (highest
 * z-score to lowest), even when Prior/Projection is requested, so toggling
 * between modes shows each category's z-score shift in place instead of
 * re-sorting into that mode's own order. Pass `catOrder` to override this —
 * the compare modal anchors every card to the first player's order instead,
 * so categories line up row-for-row across players.
 */
export function buildRankedProfile(p: Player, mode: SeasonMode, catOrder: Cat[] = catOrderFor(p)): RankedProfile {
  const isProj = mode === "proj";
  const isPrior = mode === "prior";
  const hasCurrentSample = p.gp > 0;
  const noProfileData =
    (isPrior && p.priorGp === 0) || (isProj && !hasCurrentSample) || (mode === "cur" && p.catVals.length === 0 && !hasCurrentSample);
  if (noProfileData) {
    return { noData: true, reason: isPrior ? "No 2024–25 games on record" : "No 2025–26 games logged yet" };
  }

  const valForStat = (c: Cat) => (isProj ? projSeasonVal(p, c) : isPrior ? (p.priorPg?.[c.key] ?? 0) : p.pg[c.key]);
  const zOf = (c: Cat) => (mode === "cur" ? catValCur(p, c) : isPrior ? catValPrior(p, c) : zFor(c, valForStat(c)));
  const mkBar = (z: number) => {
    const zc = clamp(z, -3, 3);
    const isPos = zc >= 0;
    const mag = (Math.abs(zc) / 3) * 50;
    return { left: (isPos ? 50 : 50 - mag) + "%", width: mag + "%" };
  };
  const rows = catOrder.map((c) => {
    const z = zOf(c);
    return { key: c.key, label: c.label, z, color: STATSET_COLORS[starTier(z)], bar: mkBar(z) };
  });
  return { noData: false, rows };
}
