"use client";

import { contractFor, money } from "./roster-helpers";
import type { Player } from "./roster-data";

/**
 * Full "Salary & contract" card — contract status pill, term/avg-salary
 * header, and the year-by-year Year/Team/Age/Salary table (est/QO
 * superscripts). Extracted from roster-app.tsx's single-player detail panel
 * (2026-07-31) so /real-salary-rankings' player modal can show it too,
 * without duplicating the JSX. Visually identical to the original inline
 * block — `compact` replaces roster-app.tsx's `isLandscapeTabletWidth` flag.
 *
 * Shows every populated salary year from `contractFor()` — up to 6
 * (2026-27 → 2031-32, nba_roster's salary_yr1..yr6) for a deal that runs
 * that long; most players only have 1-4 populated and the rest render
 * nothing (contractFor()'s row-building is already length-agnostic).
 */
export function SalaryContractCard({ player, compact = false }: { player: Player; compact?: boolean }) {
  const contract = contractFor(player);
  const isNewRookieScale = contract.status === "Rookie Scale" && player.tag === "rookie";

  return (
    <div style={{ background: "var(--rt-canvas)", border: "1px solid var(--rt-hairline)", borderRadius: 16, padding: compact ? 14 : 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--rt-ink)" }}>Salary &amp; contract</span>
        {contract.status && (
          <span
            style={{
              fontFamily: "var(--rt-font-sans)",
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: isNewRookieScale ? "var(--dynasty-gold)" : "var(--rt-muted)",
              border: `1px solid ${isNewRookieScale ? "var(--dynasty-gold)" : "var(--rt-hairline)"}`,
              borderRadius: 999,
              padding: "3px 9px",
            }}
          >
            {contract.status}
          </span>
        )}
      </div>
      {contract.rows.length === 0 ? (
        <div style={{ padding: "20px 0", textAlign: "center", color: "var(--rt-muted)", fontSize: 12, lineHeight: 1.5 }}>
          No salary data yet — contract terms haven&apos;t been reported.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: compact ? 10 : 16 }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Contract terms</div>
              <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 22, fontWeight: 500, letterSpacing: "-0.5px", color: "var(--rt-ink)", marginTop: 5, fontVariantNumeric: "tabular-nums" }}>
                {contract.n} yr{contract.n > 1 ? "s" : ""} · {money(contract.total)}
              </div>
              {contract.yearPosition && (
                <div style={{ fontSize: 11, color: "var(--rt-muted)", marginTop: 3 }}>Year {contract.yearPosition}</div>
              )}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Avg salary</div>
              <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 18, fontWeight: 500, color: "var(--rt-ink)", marginTop: 5, fontVariantNumeric: "tabular-nums" }}>{money(contract.avg)}</div>
            </div>
          </div>
          <div style={{ marginTop: compact ? 10 : 18, paddingTop: 4, borderTop: "1px solid var(--rt-hairline-soft)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 34px 74px", gap: 10, padding: compact ? "7px 0 5px" : "11px 0 9px" }}>
              <span style={{ fontSize: 10, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Year</span>
              <span style={{ fontSize: 10, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Team</span>
              <span style={{ fontSize: 10, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center" }}>Age</span>
              <span style={{ fontSize: 10, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right" }}>Salary</span>
            </div>
            {contract.rows.map((yr, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto 34px 74px", gap: 10, padding: compact ? "5px 0" : "9px 0", borderTop: "1px solid var(--rt-hairline-soft)", alignItems: "center" }}>
                <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 13, color: "var(--rt-ink)", fontVariantNumeric: "tabular-nums" }}>{yr.year}</span>
                <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 13, color: "var(--rt-body)", fontVariantNumeric: "tabular-nums" }}>{yr.team}</span>
                <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 13, color: "var(--rt-muted)", fontVariantNumeric: "tabular-nums", textAlign: "center" }}>{yr.age}</span>
                <span style={{ fontFamily: "var(--rt-font-mono)", fontSize: 13, color: "var(--rt-ink)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                  {yr.salary}
                  {yr.estimated && (
                    <sup title="Even-split estimate" style={{ fontSize: 8, color: "var(--rt-muted)", marginLeft: 2, fontFamily: "var(--rt-font-sans)", letterSpacing: "0.03em" }}>est</sup>
                  )}
                  {yr.qo && (
                    <sup title="Qualifying offer — a real cap hold, not a negotiated salary" style={{ fontSize: 8, color: "var(--rt-muted)", marginLeft: 2, fontFamily: "var(--rt-font-sans)", letterSpacing: "0.03em" }}>QO</sup>
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
