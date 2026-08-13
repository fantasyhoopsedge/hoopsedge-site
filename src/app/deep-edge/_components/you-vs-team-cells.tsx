"use client";

import { CATEGORY_LABEL, type FheCategory } from "@/lib/fantrax/league";
import type { TeamH2HRecord } from "@/lib/fantrax/power-rankings";

/** Compact single-glyph category codes for the "You vs Team" grid — the
 *  9-wide row is tight on space, so CATEGORY_LABEL's "3PM"/"FG%" are too
 *  wide for every column; shooting percentages keep their real label
 *  (there's no shorter unambiguous glyph for them), everything else is one
 *  character. */
const CAT_SHORT: Record<FheCategory, string> = {
  PTS: "P", FG3: "3", REB: "R", AST: "A", STL: "S", BLK: "B", FG: "FG%", FT: "FT%", TO: "TO",
};

/**
 * A row of small win/loss/draw glyphs — this team's own H2H-categories
 * matchup against `opponentTeamId`, one cell per scored category. Green =
 * you win that category against them, red = you lose it, amber = draw, dim
 * dash = this row IS your own team (no matchup against yourself).
 *
 * Reads straight off H2HMatchup.categoryResults (simulateH2HCategoryStandings),
 * which every H2H-categories standings table already computes — this just
 * surfaces detail that was previously thrown away after being rolled up into
 * the CATEGORY W-D-L count.
 */
export function YouVsTeamCells({
  myRecord, opponentTeamId, scored,
}: {
  myRecord: TeamH2HRecord | null | undefined;
  opponentTeamId: string;
  scored: readonly FheCategory[];
}) {
  const isSelf = myRecord?.teamId === opponentTeamId;
  const matchup = myRecord && !isSelf ? myRecord.matchups.find((m) => m.opponentId === opponentTeamId) : null;

  return (
    <div style={{ display: "inline-flex", gap: 3 }}>
      {scored.map((cat) => {
        const result = isSelf ? null : matchup?.categoryResults.find((c) => c.category === cat)?.result ?? null;
        const bg = result === "win" ? "rgba(34,197,94,0.30)" : result === "loss" ? "rgba(239,68,68,0.30)" : result === "draw" ? "rgba(201,138,31,0.28)" : "transparent";
        const color = result === "win" ? "var(--rt-up)" : result === "loss" ? "var(--rt-down)" : result === "draw" ? "#c98a1f" : "var(--rt-hairline)";
        return (
          <span
            key={cat}
            title={`${CATEGORY_LABEL[cat]}${result ? `: ${result}` : ""}`}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 24, height: 20,
              borderRadius: 4, background: bg, color, fontSize: 9.5, fontWeight: 700, fontFamily: "var(--rt-font-mono)",
            }}
          >
            {isSelf ? "–" : CAT_SHORT[cat]}
          </span>
        );
      })}
    </div>
  );
}
