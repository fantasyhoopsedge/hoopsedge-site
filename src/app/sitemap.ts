import type { MetadataRoute } from 'next';
import { getAllProspectSlugs } from '@/lib/prospects';

const SITE_URL = 'https://www.fantasyhoopsedge.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const slugs = getAllProspectSlugs();

  const prospectUrls: MetadataRoute.Sitemap = slugs.map(({ slug }) => ({
    url: `${SITE_URL}/prospects/${slug}`,
    lastModified: new Date(),
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/dynasty-rankings`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/seasonal-rankings`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/draft-board`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    ...prospectUrls,
  ];
}
