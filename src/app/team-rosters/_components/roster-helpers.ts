/**
 * Pure derived-value helpers ported from the Claude Design prototype
 * (Thunder Roster.dc.html). "Prior" and "projection" stat lines are
 * deterministic jitter around the current per-game line (seeded off the
 * player id) — placeholder trend data until real season history / a
 * projection model is wired in.
 */
import { CATS, TAG_THEME, type Cat, type FvMetric, type PerGameStats, type Player, type PlayerTag } from "./roster-data";

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

export function lastSeasonVal(p: Player, cat: Cat) {
  const seed = seedOf(p, cat.label.length * 7);
  const j = Math.sin(seed * 1.3) * 0.12;
  return p.pg[cat.key] * (1 + j);
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

export type ContractRow = { year: string; team: string; age: string; salary: string; estimated: boolean };

/**
 * Contract table built from real per-year cap hits (p.salaryYears from
 * nba_roster). Year 1 = 2026-27; only seasons with a contracted salary are
 * listed. Even-split estimated years are flagged. nba_roster tracks 4 years
 * (through 2029-30), so a longer deal shows its first four seasons.
 */
export function contractFor(p: Player) {
  const firstStart = 2026; // 2026-27 season = Year 1
  const estSet = new Set(
    (p.estimatedYears ?? "").split(",").map((s) => s.trim()).filter(Boolean),
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
    });
  });
  // Header shows the FULL contract from nba_roster (length + total may run beyond
  // the 4-year salary window the rows cover); fall back to the rows we have.
  const n = p.contractYears ?? rows.length;
  const total = p.contractTotal ?? rowTotal;
  return { n, total, avg: n ? total / n : 0, rows };
}
