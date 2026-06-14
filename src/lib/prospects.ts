import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

export interface Prospect {
  slug: string;
  name: string;
  dynastyPick: string;
  pickNumber: number;
  pos: string;
  school: string;
  age: number | null;
  heightIn: number | null;
  ppg: number | null;
  rpg: number | null;
  apg: number | null;
  spg: number | null;
  bpg: number | null;
  topg: number | null;
  fgPct: number | null;
  ftPct: number | null;
  tpmPg: number | null;
  starPts: number;
  starReb: number;
  starAst: number;
  starStl: number;
  starBlk: number;
  starFg: number;
  starFt: number;
  star3pm: number;
  starTo: number;
  dynastyVerdict: string;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function parseNum(val: string): number | null {
  if (!val || val.trim() === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function parseStar(val: string): number {
  if (!val || val.trim() === '') return 3;
  const n = parseInt(val, 10);
  return isNaN(n) ? 3 : n;
}

function parsePickNumber(dynastyPick: string): number {
  const parts = dynastyPick.split('.');
  if (parts.length < 2) return 0;
  return parseInt(parts[1], 10);
}

function parseHeightIn(val: string): number | null {
  if (!val || val.trim() === '') return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

let _prospects: Prospect[] | null = null;

function loadProspects(): Prospect[] {
  if (_prospects) return _prospects;

  const csvPath = path.join(process.cwd(), 'data', 'fhe_2026_prospects_master.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    trim: true,
  }) as Record<string, string>[];

  _prospects = records.map((row): Prospect => {
    const name = row.name.trim();
    return {
      slug: toSlug(name),
      name,
      dynastyPick: row.dynasty_pick.trim(),
      pickNumber: parsePickNumber(row.dynasty_pick.trim()),
      pos: row.pos.trim(),
      school: row.school.trim(),
      age: parseNum(row.age),
      heightIn: parseHeightIn(row.height_in),
      ppg: parseNum(row.ppg),
      rpg: parseNum(row.rpg),
      apg: parseNum(row.apg),
      spg: parseNum(row.spg),
      bpg: parseNum(row.bpg),
      topg: parseNum(row.topg),
      fgPct: parseNum(row.fg_pct),
      ftPct: parseNum(row.ft_pct),
      tpmPg: parseNum(row.tpm_pg),
      starPts: parseStar(row.star_pts),
      starReb: parseStar(row.star_reb),
      starAst: parseStar(row.star_ast),
      starStl: parseStar(row.star_stl),
      starBlk: parseStar(row.star_blk),
      starFg: parseStar(row.star_fg),
      starFt: parseStar(row.star_ft),
      star3pm: parseStar(row.star_3pm),
      starTo: parseStar(row.star_to),
      dynastyVerdict: (row.dynasty_verdict ?? '').trim(),
    };
  });

  _prospects.sort((a, b) => a.pickNumber - b.pickNumber);
  return _prospects;
}

export function getAllProspects(): Prospect[] {
  return loadProspects();
}

export function getProspectBySlug(slug: string): Prospect | null {
  return loadProspects().find((p) => p.slug === slug) ?? null;
}

export function getAllProspectSlugs(): { slug: string }[] {
  return loadProspects().map((p) => ({ slug: p.slug }));
}

/** Minimal prospect display fields, keyed by slug — for client UIs (Draft
 * Night) that can't read the fs-backed CSV directly. */
export interface ProspectLite {
  slug: string;
  name: string;
  pos: string;
  school: string;
  rank: number;
}

export function getProspectLiteMap(): Record<string, ProspectLite> {
  const map: Record<string, ProspectLite> = {};
  for (const p of loadProspects()) {
    map[p.slug] = {
      slug: p.slug,
      name: p.name,
      pos: p.pos,
      school: p.school,
      rank: p.pickNumber,
    };
  }
  return map;
}
