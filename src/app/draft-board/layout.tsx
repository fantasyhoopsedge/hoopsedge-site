import type { ReactNode } from 'react';
import { getAllProspects } from '@/lib/prospects';
import { generateRookieBoardSchema } from '@/lib/schemas';

export default function DraftBoardLayout({ children }: { children: ReactNode }) {
  const prospects = getAllProspects();
  const schema = generateRookieBoardSchema(prospects, 'https://fantasyhoopsedge.com');
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      {children}
    </>
  );
}
