"use client";

import type { LeagueFormat } from "./league-tags";

/**
 * Fantrax's API can't tell rotisserie from head-to-head-categories — both
 * report scoringType "rotisserie" (verified live 2026-08-09, see
 * league.ts). Any view whose math depends on that distinction (Standings,
 * the F Hoops Edge trade tool, Category Edge, Power Rankings) must gate on
 * this prompt until the user has explicitly confirmed which one their
 * league actually is. Extracted out of admin/fantrax/_connector.tsx so The
 * Deep Edge's screens can reuse the exact same gate rather than a second
 * copy of this copy/logic.
 */
export function FormatConfirmPrompt({ onConfirm }: { onConfirm: (v: LeagueFormat) => void }) {
  return (
    <div className="fx-empty fx-format-confirm">
      <p>
        Fantrax doesn&apos;t tell us whether this league is scored Rotisserie or Head-to-head — which is it?
      </p>
      <div className="fx-row" style={{ justifyContent: "center" }}>
        <button type="button" className="fx-btn primary" onClick={() => onConfirm("roto")}>Rotisserie</button>
        <button type="button" className="fx-btn primary" onClick={() => onConfirm("h2h")}>Head-to-head</button>
      </div>
    </div>
  );
}

/** Whether a league's format needs the FormatConfirmPrompt gate before any
 *  roto-vs-H2H-dependent view can render. Points-mode leagues never need it
 *  — Fantrax's scoringType reliably distinguishes points from everything else. */
export function needsFormatConfirm(pointsMode: boolean, formatConfirmed: boolean | undefined): boolean {
  return !pointsMode && !formatConfirmed;
}
