import type { Metadata } from "next";
import type { ReactNode } from "react";
import { generateConsensusRankingsSchema } from "@/lib/schemas";

export const metadata: Metadata = {
  title: "Dynasty Rankings — Fantasy Hoops Edge",
  description:
    "9-cat dynasty consensus rankings from six expert sources. Built for category leagues and deep dynasty formats.",
};

export default function DynastyRankingsLayout({ children }: { children: ReactNode }) {
  const schema = generateConsensusRankingsSchema("https://fantasyhoopsedge.com");
  return (
    <>
      {/* Footer is rendered inside the shell; suppress the root layout one */}
      <style>{`.site-footer-global { display: none !important; }`}</style>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      {children}
      <section
        aria-label="About these dynasty rankings"
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
          About the FHE Dynasty Consensus Rankings
        </h2>
        <p>
          The Fantasy Hoops Edge dynasty consensus rankings aggregate expert dynasty ranks from five
          sources — Dynatyze, Dizzle Dynasty, Angle Fantasy Basketball, Hashtag Basketball, and
          Moneyballers — into a single consensus list of 446 players, updated each season. The list
          is built specifically for 9-category roto dynasty leagues of 16 or more teams, where
          category balance and long-term asset value matter more than simple points production.
        </p>
        <p style={{ marginTop: 12 }}>
          Rankings are sorted by average expert rank across all five panels. Victor Wembanyama (SAS)
          leads the consensus at #1, followed by Shai Gilgeous-Alexander (OKC) at #2 and Luka
          Doncic (LAL) at #3. Each player row shows individual expert ranks side-by-side so you can
          see where panelists agree and where they diverge — useful for identifying undervalued or
          overvalued assets in trade negotiations.
        </p>
        <p style={{ marginTop: 12 }}>
          For 9-category leagues, dynasty value is driven by multi-category contributors who score
          points, add assists and rebounds, and contribute in peripheral categories like steals,
          blocks, field-goal percentage, and three-pointers made without hurting you in turnovers or
          free-throw percentage. The consensus rank reflects that multi-category lens across all five
          expert panels.
        </p>
      </section>
    </>
  );
}
