import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Real Salary Rankings — Fantasy Hoops Edge",
  description:
    "Dynasty rankings re-weighted for hard-cap real-salary leagues: projected 9-cat production priced in cap dollars, minus each player's actual salary.",
};

export default function RealSalaryRankingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* The shell renders its own footer; suppress the global one. */}
      <style>{`.site-footer-global { display: none !important; }`}</style>
      {children}
    </>
  );
}
