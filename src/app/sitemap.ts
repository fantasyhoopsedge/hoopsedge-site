import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MetadataRoute } from 'next';
import { getAllProspectSlugs } from '@/lib/prospects';
import { TEAMS } from '@/app/team-rosters/_components/roster-data';

const SITE_URL = 'https://www.fantasyhoopsedge.com';

// Real "last changed" signal for prospect pages: the on-disk mtime of the
// same CSV getAllProspectSlugs() reads, computed once per deploy (module
// load) rather than per-request. The old `new Date()` claimed every
// prospect page had just changed on every single request, which is
// actively counterproductive now that Google relies on lastmod (not the
// retired sitemap ping endpoint) to decide when to recrawl a URL.
const PROSPECTS_LAST_MODIFIED = fs.statSync(
  path.join(process.cwd(), 'data', 'fhe_2026_prospects_master.csv'),
).mtime;

// Regenerate on a schedule instead of only at the next full build, so a
// newly-added prospect (CSV updated + redeployed) or a route added below
// shows up without waiting on the next deploy's static generation pass.
export const revalidate = 3600;

export default function sitemap(): MetadataRoute.Sitemap {
  const prospectUrls: MetadataRoute.Sitemap = getAllProspectSlugs().map(({ slug }) => ({
    url: `${SITE_URL}/prospects/${slug}`,
    lastModified: PROSPECTS_LAST_MODIFIED,
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  // Same list generateStaticParams() uses for /team-rosters/[team] (30 teams
  // + the FA free-agent bucket) — importing it instead of re-deriving from
  // NBA_TEAM_ABBRS keeps this from silently drifting out of sync with the
  // actual valid routes.
  const teamRosterUrls: MetadataRoute.Sitemap = TEAMS.map(({ abbr }) => ({
    url: `${SITE_URL}/team-rosters/${abbr}`,
    changeFrequency: 'daily',
    priority: 0.6,
  }));

  // Previously missing entirely from the sitemap despite being live, linked
  // routes: team-rosters, real-salary-rankings, prediction-arena, contact,
  // privacy, terms.
  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/dynasty-rankings`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE_URL}/seasonal-rankings`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE_URL}/draft-board`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE_URL}/team-rosters`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE_URL}/real-salary-rankings`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE_URL}/prediction-arena`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/contact`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE_URL}/terms`, changeFrequency: 'yearly', priority: 0.2 },
  ];

  return [...staticPages, ...teamRosterUrls, ...prospectUrls];
}
