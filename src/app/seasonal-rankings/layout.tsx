import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Seasonal Rankings — Fantasy Hoops Edge",
  description:
    "9-cat seasonal player category values with per-league-size baselines. Value and Minus1V standardized against the top-N pool for your league size.",
};

export default function SeasonalRankingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* The shell renders its own footer; suppress the global one. */}
      <style>{`.site-footer-global { display: none !important; }`}</style>
      {children}
</>
  );
}
