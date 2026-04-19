import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Dynasty Rankings — Fantasy Hoops Edge",
  description:
    "9-cat dynasty consensus rankings from six expert sources. Built for category leagues and deep dynasty formats.",
};

export default function DynastyRankingsLayout({ children }: { children: ReactNode }) {
  return children;
}
