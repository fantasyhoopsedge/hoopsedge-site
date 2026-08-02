#!/usr/bin/env node
/**
 * Snapshot the current dynasty-rankings.json as a versioned archive.
 *
 * Usage:
 *   node scripts/snapshot-rankings.js --version 1.1 --date "July 2026"
 *
 * Expert dates are read from --dizzle, --mball, --angle, --dynatyze, --fbihe flags.
 * ("fbihe" = FBI-HE, Fantasy Basketball International / Hoops Edge — replaced
 * "hashtag" 2026-08-02 when Hashtag Basketball ended its FHE partnership; see
 * docs/dynasty-rankings-refresh.md and the fbi-partnership memory.)
 * After running, update public/data/versions-index.json manually (or use --update-index).
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
}

const version = flag('version');
const date = flag('date') || new Date().toISOString().slice(0, 7).replace('-', ' ');

if (!version) {
  console.error('Usage: node scripts/snapshot-rankings.js --version 1.1 --date "July 2026"');
  process.exit(1);
}

const expertDates = {
  dizzle:   flag('dizzle')   || '',
  mball:    flag('mball')    || '',
  angle:    flag('angle')    || '',
  dynatyze: flag('dynatyze') || '',
  fbihe:    flag('fbihe')    || '',
};

const rankings = require('../src/lib/dynasty-rankings.json');

const snapshot = {
  version,
  date: new Date().toISOString().slice(0, 10),
  label: date,
  expertDates,
  rankings: rankings.map(p => ({
    player: p.player,
    consensusRank: p.consensusRank,
    avgRank: p.avgRank,
    tier: p.tier,
    expertRanks: p.expertRanks,
  })),
};

const outPath = path.join(__dirname, '..', 'public', 'data', 'versions', `v${version}.json`);
fs.writeFileSync(outPath, JSON.stringify(snapshot));
console.log(`✓ Snapshot v${version} written → ${outPath}`);
console.log(`  ${snapshot.rankings.length} players, ${Buffer.byteLength(JSON.stringify(snapshot))} bytes`);
console.log('');
console.log('Next: update public/data/versions-index.json to add this version entry.');
