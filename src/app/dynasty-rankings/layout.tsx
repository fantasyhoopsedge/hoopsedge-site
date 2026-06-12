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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      {children}
    </>
  );
}
