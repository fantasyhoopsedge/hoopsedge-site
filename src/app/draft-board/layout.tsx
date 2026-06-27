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
      <section
        aria-label="About the FHE dynasty rookie board"
        style={{
          padding: "40px 32px 56px",
          maxWidth: 860,
          margin: "0 auto",
          color: "var(--text-muted)",
          fontSize: 13,
          lineHeight: 1.7,
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--text-secondary)" }}>
          About the FHE 2026 Dynasty Rookie Board
        </h2>
        <p>
          The Fantasy Hoops Edge 2026 Dynasty Rookie Board ranks 2026 NBA Draft prospects by their
          long-term value in 9-category roto dynasty leagues. Each prospect is rated 1–5 stars
          across all nine standard categories — points, rebounds, assists, steals, blocks,
          field-goal percentage, free-throw percentage, three-pointers made, and turnovers — using
          star ratings calibrated against a pool of 765 historical NCAA and NBA player-seasons.
        </p>
        <p style={{ marginTop: 12 }}>
          Cameron Boozer (Duke, F/C) leads the 2026 board at #1 overall, projected as a
          multi-category contributor with elite rebounding and interior scoring upside. Darryn
          Peterson (Kansas, G) ranks #2 with a scoring and playmaking profile that projects well
          across points, assists, and three-pointers. AJ Dybantsa (BYU, G/F) ranks #3 as a
          versatile wing with high scoring and steal upside. Individual prospect pages include full
          9-category star breakdowns, college stats, and a dynasty verdict for each player.
        </p>
        <p style={{ marginTop: 12 }}>
          Dynasty rookie rankings differ from redraft rankings because they weight long-term
          multi-category upside over immediate production. A player who projects to contribute
          across six or seven categories at peak ranks higher than a pure scorer who helps in only
          two or three, making this board specifically designed for category managers building
          rosters over multiple seasons.
        </p>
      </section>
    </>
  );
}
