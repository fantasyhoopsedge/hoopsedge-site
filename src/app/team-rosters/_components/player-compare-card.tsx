"use client";

import { PlayerHeadshot } from "./roster-headshot";
import { TrendHero, usePlayerTrend } from "./player-trend-chart";
import { buildRankedProfile, buildRecentProfile, catOrderFor, contractFor, heroName, initials, money, mpgBarFor, posLabel, seasonTriosFor } from "./roster-helpers";
import { PRO_UNLOCKED, TEAM_LOGO, type Cat, type Player, type SeasonMode } from "./roster-data";
import type { TrendMetric } from "./trend-insight";

// Mirrors roster-app.tsx's TRENDS_SEASON/TRENDS_SEASON_TYPE — hoopR: 2026 =
// the 2025-26 season. The value metric (Minus1V / 9CatV / 8CatV) is chosen by
// the compare modal's metric toggle and passed in, so GP/rank/arrow/chart all
// respond to it.
const TRENDS_SEASON = 2026;
const TRENDS_SEASON_TYPE = "regular";

const METRIC_LABEL: Record<TrendMetric, string> = { minus1V: "Minus1V", nineCatV: "9CatV", eightCatV: "8CatV" };

/**
 * One player's card inside the compare modal — name/headshot/pos/age,
 * salary/contract, dynasty rank + Minus1V rank + trend tag + trend chart
 * (all via TrendHero, compact), and the 9-category profile for the shared
 * Current/Prior/Projection `mode` the modal controls.
 */
export function PlayerCompareCard({
  player,
  mode,
  metric,
  catOrder,
  onRemove,
}: {
  player: Player;
  mode: SeasonMode;
  metric: TrendMetric;
  catOrder?: Cat[];
  onRemove: () => void;
}) {
  const trend = usePlayerTrend(player.id, TRENDS_SEASON, TRENDS_SEASON_TYPE);
  const order = catOrder ?? catOrderFor(player);
  const trios = seasonTriosFor(player, metric);
  const profile = mode === "recent" ? buildRecentProfile(trend, order, player.gp, player.mpg) : buildRankedProfile(player, mode, order);
  const contract = contractFor(player);
  const isPrior = mode === "prior";
  // Projection has no real model behind it yet (placeholder jitter — see
  // roster-helpers.ts) — same Edge Pro gate as the single-player panel
  // (roster-app.tsx's projLocked), so the compare tool doesn't leak the
  // placeholder numbers anywhere the sidebar already hides them.
  const projLocked = mode === "proj" && !PRO_UNLOCKED;
  const displayMpg = mode === "recent" ? (trend.data?.recent?.mpg ?? null) : isPrior ? player.priorMpg : player.mpg;
  // No MPG whenever the profile itself has nothing to show (Recent under its
  // 10-GP gate, or literally zero games that season, e.g. Prior for a player who
  // wasn't in the league yet) — a minutes number next to a "no data" message for
  // the same window reads as contradictory.
  const hideMpg = projLocked || profile.noData;
  const mpgBar = displayMpg != null && !hideMpg ? mpgBarFor(displayMpg) : null;
  const logo = TEAM_LOGO[player.team];

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
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            {logo && (
              <img
                src={`/images/nba%20team%20images/${logo}`}
                alt=""
                width={14}
                height={14}
                style={{ objectFit: "contain", flexShrink: 0 }}
              />
            )}
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--rt-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {heroName(player.name, 18)}
            </div>
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
        metric={metric}
        metricLabel={METRIC_LABEL[metric]}
        cur={trios.cur}
        prior={trios.prior}
        priorPrior={trios.priorPrior}
        consensusRank={player.consensus}
        consensusDir={player.dir}
        age={player.age}
        isRookie={player.tag === "soph"}
        mode={mode}
        prefetched={trend}
        compact
      />

      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--rt-hairline-soft)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--rt-ink)" }}>9-category profile</div>
          {projLocked && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, fontWeight: 700, color: "var(--rt-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Coming soon
            </span>
          )}
        </div>
        {mpgBar && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 0 2px" }}>
            <span style={{ width: 28, fontSize: 10, fontWeight: 600, color: "var(--rt-ink)" }}>MPG</span>
            <span style={{ position: "relative", flex: 1, height: 6, background: "var(--rt-hairline-soft)", borderRadius: 999, overflow: "hidden" }}>
              <span style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${mpgBar.widthPct}%`, background: mpgBar.color, borderRadius: 999 }} />
            </span>
            <span style={{ width: 44, textAlign: "right", fontFamily: "var(--rt-font-mono)", fontSize: 10, fontWeight: 700, color: mpgBar.color }}>
              {displayMpg!.toFixed(1)}
            </span>
          </div>
        )}
        {profile.noData ? (
          <div style={{ padding: "12px 0", textAlign: "center", color: "var(--rt-muted)", fontSize: 11, lineHeight: 1.4 }}>{profile.reason}</div>
        ) : (
          <div style={{ marginTop: 8 }}>
            {profile.rows.map((row) => (
              <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
                <span style={{ width: 28, fontSize: 10, fontWeight: 600, color: "var(--rt-ink)" }}>{row.label}</span>
                <span style={{ position: "relative", flex: 1, height: 10 }}>
                  <span style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, background: "var(--rt-hairline)" }} />
                  {!projLocked && (
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
                  )}
                </span>
                <span style={{ width: 44, textAlign: "right", fontFamily: "var(--rt-font-mono)", fontSize: 10, fontWeight: 700, color: projLocked ? "var(--rt-muted-soft)" : row.color }}>
                  {projLocked ? "—" : row.stat}
                </span>
              </div>
            ))}
          </div>
        )}
        {mode === "recent" && (
          <div style={{ marginTop: 10, fontSize: 9, color: "var(--rt-muted)", lineHeight: 1.4 }}>
            Recent shows the trailing 8-week stat profile.
          </div>
        )}
      </div>
    </div>
  );
}
