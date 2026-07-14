import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "NBA Team Rosters — Fantasy Hoops Edge",
  description:
    "Browse NBA team rosters with dynasty value, 9-category fantasy value, salary, and contract details for every player.",
};

export default function TeamRostersLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Full-height app shell renders its own chrome; suppress the root layout footer. */}
      <style>{`.site-footer-global { display: none !important; }`}</style>
      {children}
    </>
  );
}
