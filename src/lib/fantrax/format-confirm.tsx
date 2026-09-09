"use client";

import type { LeagueFormat } from "./league-tags";

/**
 * The last-resort prompt for rotisserie vs head-to-head-categories.
 *
 * It used to be the FIRST resort, on the belief that Fantrax reports
 * "rotisserie" for both. It doesn't (see league.ts's leagueFormatOf), so
 * nearly every league now answers the question from its own scoring label
 * and never renders this. What's left is the genuinely unlabelled league —
 * an unrecognised or absent scoringType — where the math still can't
 * proceed on a guess and a person has to say.
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
 *  roto-vs-H2H-dependent view can render. Points-mode leagues never need it,
 *  and neither does one whose scoringType names its format — pass
 *  `analysis.league.derivedFormat` for that, which is null only when the
 *  label says nothing. */
export function needsFormatConfirm(
  pointsMode: boolean,
  formatConfirmed: boolean | undefined,
  derivedFormat?: LeagueFormat | null,
): boolean {
  return !pointsMode && !formatConfirmed && !derivedFormat;
}
