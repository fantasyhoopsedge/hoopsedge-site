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
      <section
        aria-label="About player category values"
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
          About Player Category Values (CatV)
        </h2>
        <p>
          Fantasy Hoops Edge Player Category Values (CatV) measure how much a player contributes
          above a league-baseline replacement in each of the nine standard roto categories: points,
          rebounds, assists, steals, blocks, field-goal percentage, free-throw percentage,
          three-pointers made, and turnovers. A positive CatV means the player lifts your team above
          the baseline in that category; a negative value means he costs you ground.
        </p>
        <p style={{ marginTop: 12 }}>
          Baselines are calibrated per league size — a 12-team league has a shallower player pool
          than a 20-team league, so the replacement level is higher. CatV automatically adjusts so
          that a player ranked #120 overall reads as a fringe starter in a 12-team league and a
          valuable contributor in a 20-team league. Minus1V shows the marginal cost of dropping that
          player from your roster — useful for evaluating trade and waiver-wire decisions.
        </p>
        <p style={{ marginTop: 12 }}>
          Values are derived from real NBA box-score data and recomputed each season. The tool
          supports both current-season and prior-season datasets so managers can compare year-over-year
          trends and project which players are trending up or down across categories.
        </p>
      </section>
    </>
  );
}
