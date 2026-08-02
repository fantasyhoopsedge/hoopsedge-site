import type { Prospect } from './prospects';

const FHE_ORG = (siteUrl: string) => ({
  '@type': 'Organization',
  '@id': `${siteUrl}/#organization`,
  name: 'FantasyHoopsEdge',
  url: siteUrl,
  description:
    'Dynasty fantasy basketball intelligence for 9-category roto leagues. Expert analysis, consensus rankings, and prospect evaluation for deep dynasty formats of 16+ teams.',
  knowsAbout: [
    'dynasty fantasy basketball',
    '9-category roto leagues',
    'NBA draft prospect analysis',
    'dynasty rankings',
    'keeper leagues',
  ],
});

export function generateProspectSchema(prospect: Prospect, siteUrl: string): object {
  const {
    name, slug, pickNumber, pos, school, age, heightIn,
    ppg, rpg, apg, fgPct, dynastyVerdict,
    starPts, starReb, starAst, starStl, starBlk, starFg, starFt, star3pm, starTo,
  } = prospect;

  const description = ppg !== null
    ? `${name} is ranked #${pickNumber} on the FHE 2026 Dynasty Rookie Board. ${pos} from ${school}. 9-cat dynasty profile: ${ppg} PPG, ${rpg} RPG, ${fgPct}% FG. ${dynastyVerdict.slice(0, 120)}`
    : `${name} is ranked #${pickNumber} on the FHE 2026 Dynasty Rookie Board. ${pos} from ${school}. ${dynastyVerdict.slice(0, 150)}`;

  const ratings: Array<{ '@type': string; name: string; value: number; minValue: number; maxValue: number }> = [
    { '@type': 'PropertyValue', name: 'Dynasty PTS Rating (9-cat)',  value: starPts,  minValue: 1, maxValue: 5 },
    { '@type': 'PropertyValue', name: 'Dynasty REB Rating (9-cat)',  value: starReb,  minValue: 1, maxValue: 5 },
    { '@type': 'PropertyValue', name: 'Dynasty AST Rating (9-cat)',  value: starAst,  minValue: 1, maxValue: 5 },
    { '@type': 'PropertyValue', name: 'Dynasty STL Rating (9-cat)',  value: starStl,  minValue: 1, maxValue: 5 },
    { '@type': 'PropertyValue', name: 'Dynasty BLK Rating (9-cat)',  value: starBlk,  minValue: 1, maxValue: 5 },
    { '@type': 'PropertyValue', name: 'Dynasty FG% Rating (9-cat)',  value: starFg,   minValue: 1, maxValue: 5 },
    { '@type': 'PropertyValue', name: 'Dynasty FT% Rating (9-cat)',  value: starFt,   minValue: 1, maxValue: 5 },
    { '@type': 'PropertyValue', name: 'Dynasty 3PM Rating (9-cat)',  value: star3pm,  minValue: 1, maxValue: 5 },
    { '@type': 'PropertyValue', name: 'Dynasty TO Rating (9-cat)',   value: starTo,   minValue: 1, maxValue: 5 },
  ];

  const personProps: Record<string, unknown> = {
    '@type': 'Person',
    name,
    description: dynastyVerdict,
    knowsAbout: 'NBA basketball',
    additionalProperty: ratings,
  };
  if (age !== null) personProps['age'] = age;
  if (heightIn !== null) personProps['height'] = `${Math.floor(heightIn / 12)}'${heightIn % 12}"`;

  const profilePage = {
    '@type': 'ProfilePage',
    name: `${name} — Dynasty Fantasy Basketball Profile | FantasyHoopsEdge`,
    description,
    url: `${siteUrl}/prospects/${slug}`,
    author: { '@id': `${siteUrl}/#organization` },
    mainEntity: personProps,
    about: {
      '@type': 'Thing',
      name: '2026 NBA Draft Dynasty Fantasy Basketball',
    },
    keywords: [
      `${name} dynasty`,
      `${name} fantasy basketball`,
      '2026 NBA Draft dynasty',
      '9-category dynasty basketball',
      pos,
      school,
    ].join(', '),
  };

  const breadcrumb = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home',                    item: siteUrl },
      { '@type': 'ListItem', position: 2, name: '2026 Dynasty Rookie Board', item: `${siteUrl}/draft-board` },
      { '@type': 'ListItem', position: 3, name,                              item: `${siteUrl}/prospects/${slug}` },
    ],
  };

  return {
    '@context': 'https://schema.org',
    '@graph': [FHE_ORG(siteUrl), profilePage, breadcrumb],
  };
}

export function generateRookieBoardSchema(prospects: Prospect[], siteUrl: string): object {
  const top5 = prospects.slice(0, 5).map((p) => p.name).join(', ');

  const dataset = {
    '@type': 'Dataset',
    name: 'FHE 2026 Dynasty Rookie Board — 9-Category Roto Rankings',
    description:
      `FantasyHoopsEdge 2026 NBA Draft dynasty rankings for 9-category roto deep leagues. ${prospects.length} prospects rated across PTS, REB, AST, STL, BLK, FG%, FT%, 3PM, and TO using a star-rating system calibrated against a pool of 765 NCAA and NBA player-seasons. Top 5: ${top5}.`,
    url: `${siteUrl}/draft-board`,
    creator: { '@id': `${siteUrl}/#organization` },
    keywords: [
      'dynasty fantasy basketball',
      '2026 NBA Draft',
      '9-category roto',
      'rookie rankings',
      'dynasty rookie board',
      'deep leagues',
    ].join(', '),
    variableMeasured: [
      'Points per game (PTS)',
      'Rebounds per game (REB)',
      'Assists per game (AST)',
      'Steals per game (STL)',
      'Blocks per game (BLK)',
      'Field goal percentage (FG%)',
      'Free throw percentage (FT%)',
      'Three-pointers made per game (3PM)',
      'Turnovers per game (TO)',
    ],
    measurementTechnique: 'Star ratings (1–5) calibrated against historical NCAA and NBA player-season benchmarks',
    temporalCoverage: '2026',
    inLanguage: 'en',
    numberOfItems: prospects.length,
  };

  const itemList = {
    '@type': 'ItemList',
    name: 'FHE 2026 Dynasty Rookie Board',
    description: 'Ranked list of 2026 NBA Draft prospects by dynasty fantasy basketball value in 9-category roto leagues.',
    url: `${siteUrl}/draft-board`,
    numberOfItems: prospects.length,
    itemListElement: prospects.map((p) => ({
      '@type': 'ListItem',
      position: p.pickNumber,
      name: p.name,
      url: `${siteUrl}/prospects/${p.slug}`,
      description: `${p.pos}, ${p.school}. FHE 2026 dynasty rank #${p.pickNumber}. ${p.dynastyVerdict.slice(0, 100)}`,
    })),
  };

  return {
    '@context': 'https://schema.org',
    '@graph': [FHE_ORG(siteUrl), dataset, itemList],
  };
}

export function generateConsensusRankingsSchema(siteUrl: string): object {
  const dataset = {
    '@type': 'Dataset',
    '@id': `${siteUrl}/dynasty-rankings#dataset`,
    name: 'FHE Dynasty Fantasy Basketball Consensus Rankings 2026',
    description:
      '450-player dynasty fantasy basketball consensus rankings for 9-category roto leagues, aggregated from 5 expert sources: Dynatyze, Dizzle Dynasty, Angle Fantasy Basketball, FBI-HE, and Moneyballers. Built specifically for deep dynasty formats of 16 or more teams.',
    url: `${siteUrl}/dynasty-rankings`,
    creator: { '@id': `${siteUrl}/#organization` },
    keywords: [
      'dynasty fantasy basketball',
      '9-cat roto',
      'consensus rankings',
      '2026 dynasty rankings',
      'deep leagues',
      'keeper leagues',
      'dynasty basketball rankings',
    ].join(', '),
    variableMeasured: [
      'Consensus dynasty rank (average of 5 expert panels)',
      'Points per game (PTS)',
      'Rebounds per game (REB)',
      'Assists per game (AST)',
      'Steals per game (STL)',
      'Blocks per game (BLK)',
      'Field goal percentage (FG%)',
      'Free throw percentage (FT%)',
      'Three-pointers made per game (3PM)',
      'Turnovers per game (TO)',
    ],
    measurementTechnique:
      'Simple average of expert dynasty ranks from 5 panels: Dynatyze, Dizzle Dynasty, Angle Fantasy Basketball, FBI-HE, and Moneyballers',
    numberOfItems: 450,
    temporalCoverage: '2026',
    inLanguage: 'en',
    license: 'https://creativecommons.org/licenses/by-nc/4.0/',
    // FBI-HE (Fantasy Basketball International / Hoops Edge) is FHE's own
    // co-branded panel, not an external cited source — see the fbi-partnership
    // memory — so it has no entry here the way the other 4 external sites do.
    isBasedOn: [
      { '@type': 'WebSite', name: 'Dynatyze',                 url: 'https://dynatyze.com' },
      { '@type': 'WebSite', name: 'Dizzle Dynasty',           url: 'https://dizzledynasty.com' },
      { '@type': 'WebSite', name: 'Angle Fantasy Basketball', url: 'https://anglefantasybasketball.com' },
      { '@type': 'WebSite', name: 'Moneyballers',             url: 'https://moneyballers.com' },
    ],
  };

  return {
    '@context': 'https://schema.org',
    '@graph': [FHE_ORG(siteUrl), dataset],
  };
}
