"use client";

import { PlayerHeadshot } from "./roster-headshot";
import { TrendHero } from "./player-trend-chart";
import { buildRankedProfile, contractFor, heroName, initials, money, posLabel } from "./roster-helpers";
import type { Cat, Player, SeasonMode } from "./roster-data";

// Mirrors roster-app.tsx's TRENDS_SEASON/TRENDS_SEASON_TYPE — hoopR: 2026 =
// the 2025-26 season. Compare cards always read Minus1V specifically (the
// metric named in the request), independent of whatever fantasy metric the
// underlying team-rosters page happens to be sorted by.
const TRENDS_SEASON = 2026;
const TRENDS_SEASON_TYPE = "regular";

/**
 * One player's card inside the compare modal — name/headshot/pos/age,
 * salary/contract, dynasty rank + Minus1V rank + trend tag + trend chart
 * (all via TrendHero, compact), and the 9-category profile for the shared
 * Current/Prior/Projection `mode` the modal controls.
 */
export function PlayerCompareCard({
  player,
  mode,
  catOrder,
  onRemove,
}: {
  player: Player;
  mode: SeasonMode;
  catOrder?: Cat[];
  onRemove: () => void;
}) {
  const profile = catOrder ? buildRankedProfile(player, mode, catOrder) : buildRankedProfile(player, mode);
  const contract = contractFor(player);

  return (
    <div style={{ position: "relative", background: "var(--rt-canvas)", border: "1px solid var(--rt-hairline)", borderRadius: 16, padding: 16, minWidth: 0 }}>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${player.name} from comparison`}
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          width: 26,
          height: 26,
          borderRadius: 999,
          border: "1px solid var(--rt-hairline)",
          background: "var(--rt-surface-strong)",
          color: "var(--rt-muted)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        ×
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingRight: 30 }}>
        <PlayerHeadshot
          name={player.name}
          size={44}
          initials={initials(player.name)}
          background="var(--rt-primary)"
          color="var(--rt-on-primary)"
          fontSize={15}
          rookie={player.tag === "rookie"}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--rt-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {heroName(player.name, 18)}
          </div>
          <div style={{ fontSize: 11, color: "var(--rt-muted)", marginTop: 1 }}>
            {posLabel(player.pos)} · Age {player.age}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--rt-hairline-soft)" }}>
        <div>
          <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 14, fontWeight: 600, color: "var(--rt-ink)" }}>{money(player.salary)}</div>
          <div style={{ fontSize: 9, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>Salary</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "var(--rt-font-mono)", fontSize: 14, fontWeight: 600, color: "var(--rt-ink)" }}>
            {contract.n ? `${contract.n} yr${contract.n > 1 ? "s" : ""} · ${money(contract.total)}` : "—"}
          </div>
          <div style={{ fontSize: 9, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>Contract</div>
        </div>
      </div>

      <TrendHero
        playerId={player.id}
        season={TRENDS_SEASON}
        seasonType={TRENDS_SEASON_TYPE}
        metric="minus1V"
        metricLabel="Minus1V"
        rank={player.rankMinus1}
        consensusRank={player.consensus}
        consensusDir={player.dir}
        age={player.age}
        gamesPlayed={player.gp}
        mpg={player.mpg}
        isRookie={player.tag === "soph"}
        compact
      />

      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--rt-hairline-soft)" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--rt-ink)" }}>9-category profile</div>
        {profile.noData ? (
          <div style={{ padding: "12px 0", textAlign: "center", color: "var(--rt-muted)", fontSize: 11, lineHeight: 1.4 }}>{profile.reason}</div>
        ) : (
          <div style={{ marginTop: 8 }}>
            {profile.rows.map((row) => (
              <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
                <span style={{ width: 28, fontSize: 10, fontWeight: 600, color: "var(--rt-ink)" }}>{row.label}</span>
                <span style={{ position: "relative", flex: 1, height: 10 }}>
                  <span style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, background: "var(--rt-hairline)" }} />
                  <span
                    style={{
                      position: "absolute",
                      top: "50%",
                      transform: "translateY(-50%)",
                      height: 6,
                      left: row.bar.left,
                      width: row.bar.width,
                      background: row.color,
                      borderRadius: 999,
                    }}
                  />
                </span>
                <span style={{ width: 38, textAlign: "right", fontFamily: "var(--rt-font-mono)", fontSize: 10, fontWeight: 700, color: row.color }}>
                  {(row.z >= 0 ? "+" : "−") + Math.abs(row.z).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
