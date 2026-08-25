"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { HubShell } from "../../../_components/hub-shell";
import { IconChevronLeft } from "../../../_components/icons";
import { DEEP_EDGE_TABLE_CSS, SortTh, useSortableTable } from "../../../_components/sortable-table";
import { useActiveLeague } from "../../../_lib/use-saved-leagues";
import { CUSTOM_VALUATIONS_STALE_AFTER_MS, relativeTime, useNow } from "../../../_lib/relative-time";
import { formatCustomSalary, formatSalary, TeamLogo } from "../../../_components/roster-table";
import { PlayerHeadshot } from "@/app/team-rosters/_components/roster-headshot";
import { DEFAULT_LEAGUE_TAGS } from "@/lib/fantrax/league-tags";
import type { CustomValuationsDoc, LedgerRow } from "@/lib/fantrax/custom-valuations-store";

type SortKey = "tradeRank" | "asset" | "owner" | "dynRank" | "tradeValue" | "salary";
type TypeFilter = "all" | "player" | "pick";

/** Custom trade rank vs. dynasty consensus rank, same visual language as
 *  Dynasty Consensus' own expert-vs-consensus cell (rankings-table.tsx's
 *  VsConsCell): green ↑N when this league's own custom value ranks the
 *  asset HIGHER (a smaller rank number) than pure consensus does, red ↓N
 *  when lower, muted "—" for a pick (no consensus counterpart at all) or an
 *  unchanged rank. Ash, 2026-08-24: "show the movement in custom rank vs the
 *  dynasty consensus." */
function MovementCell({ dynRank, tradeRank }: { dynRank: number | null; tradeRank: number | null }) {
  if (dynRank == null || tradeRank == null) return <span style={{ color: "var(--rt-muted)" }}>—</span>;
  const delta = dynRank - tradeRank;
  if (delta === 0) return <span style={{ color: "var(--rt-muted)" }}>—</span>;
  const up = delta > 0;
  return (
    <span style={{ color: up ? "var(--rt-up)" : "var(--rt-down)", fontWeight: 700 }}>
      {up ? "↑" : "↓"}{Math.abs(delta)}
    </span>
  );
}

/** Headshot + name + position, shared by both table variants. Picks get no
 *  headshot (they aren't a player) — just the label. */
function AssetCell({ row }: { row: LedgerRow }) {
  if (row.type === "pick") {
    return <span className="de-player-name">{row.asset}</span>;
  }
  const initials = row.asset.split(" ").map((w) => w[0]).slice(0, 2).join("");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <PlayerHeadshot name={row.asset} size={26} initials={initials} background="var(--rt-surface-strong)" color="var(--rt-ink)" fontSize={10} rookie={row.isRookie} />
      <span>
        <span className="de-player-name">{row.asset}</span>
        {row.pos && <span style={{ color: "var(--rt-muted)", marginLeft: 6, fontSize: 11 }}>{row.pos}</span>}
      </span>
    </div>
  );
}

function AssetValuesContent() {
  const { saved, loading: loadingSaved } = useActiveLeague();
  const [doc, setDoc] = useState<CustomValuationsDoc | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");

  useEffect(() => {
    if (!saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting derived state when the league this effect depends on is absent, not a plain render-time computation
      setLoadingDoc(false);
      return;
    }
    setLoadingDoc(true);
    fetch(`/api/fantrax/custom-valuations?leagueId=${encodeURIComponent(saved.leagueId)}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setDoc(d.doc ?? null); })
      .catch((err) => setError(String(err)))
      .finally(() => setLoadingDoc(false));
  }, [saved]);

  // Which flavor of ledger this page is regenerating — read off the
  // league's own settings, never off whatever `doc` currently happens to
  // hold (a stale/never-generated doc has no mode to trust). A league using
  // full custom valuations always regenerates "full"; a standard league
  // that's opted into generated pick values regenerates "picksOnly" — never
  // silently overwrite one flavor with the other (Ash's own framing keeps
  // them as two distinct leagues/paths, not a per-click choice).
  const regenerateMode: "full" | "picksOnly" = saved?.settings.useGeneratedPickValues && !saved?.settings.useCustomValuations
    ? "picksOnly"
    : "full";

  function regenerate() {
    if (!saved) return;
    setRegenerating(true);
    setError("");
    fetch("/api/fantrax/custom-valuations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leagueId: saved.leagueId,
        teamId: saved.teamId,
        dataset: saved.settings.defaultDataset ?? "2027:projection",
        settings: saved.settings,
        mode: regenerateMode,
      }),
    })
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setDoc(d.doc ?? null); })
      .catch((err) => setError(String(err)))
      .finally(() => setRegenerating(false));
  }

  const owners = doc ? [...new Set(doc.rows.map((r) => r.owner))].sort() : [];
  const filteredRows = (doc?.rows ?? []).filter(
    (r) => (typeFilter === "all" || r.type === typeFilter) && (ownerFilter === "all" || r.owner === ownerFilter),
  );

  const { sort, onSort, sorted } = useSortableTable<LedgerRow, SortKey>(
    filteredRows,
    { key: "tradeRank", dir: "asc" },
    (row, key) => row[key],
  );

  const now = useNow();
  const stale = doc && now != null ? now - new Date(doc.generatedAt).getTime() > CUSTOM_VALUATIONS_STALE_AFTER_MS : false;
  const salaryFormat = saved?.settings.salaryFormat ?? DEFAULT_LEAGUE_TAGS.salaryFormat;
  const formatRowSalary = salaryFormat === "custom" ? formatCustomSalary : formatSalary;
  // Two looks, per Ash (2026-08-24): a dynasty/keeper league is styled after
  // Dynasty Consensus (headshot, team logo, movement vs. that same consensus
  // rank) — the whole point of a custom ledger there is "how does MY league's
  // math disagree with the public consensus." A redraft league has no
  // consensus rank to compare against at all (dynRank is populated from the
  // SAME site-wide dynasty board regardless of league type, but it means
  // nothing to a redraft manager) — styled after the player value
  // rankings/projections pages instead: a plain rank/value list, no
  // consensus-movement column.
  const leagueType = saved?.settings.leagueType ?? DEFAULT_LEAGUE_TAGS.leagueType;
  const isDynasty = leagueType === "dynasty" || leagueType === "keeper";

  return (
    <HubShell hasLeague={Boolean(saved)} breadcrumb={saved ? `${saved.leagueName} · Custom asset values` : "Custom asset values"}>
      <style>{DEEP_EDGE_TABLE_CSS}</style>
      {/* Redesign pass, Ash 2026-08-24: every column — header and data alike —
          now matches the player-name cell's own look (--rt-font-sans, 15px,
          weight 400) instead of the smaller mono numeric convention every
          other .de-table uses; applies to both the dynasty and redraft
          variants, so the earlier dynasty-only font override is superseded
          by this uniform rule. Player names render in standard mixed case —
          the shared .de-player-name class' own uppercase transform (and an
          earlier font-variant-caps: small-caps attempt here, which Geist
          synthesizes as full-height caps rather than true small caps,
          visually oversized next to the rest of the row) are both turned
          off for this table specifically. */}
      <style>{`
        .de-table-assetvalues th, .de-table-assetvalues td {
          font-family: var(--rt-font-sans) !important;
          font-size: 15px !important;
          font-weight: 400;
        }
        .de-table-assetvalues th { text-transform: none; letter-spacing: 0; }
        .de-table-assetvalues .de-player-name { text-transform: none; font-variant-caps: normal; }
        .de-table-wrap-freeze { max-height: calc(100vh - 380px); min-height: 320px; overflow-y: auto; }
      `}</style>
      <Link href={`/deep-edge/home/trade-edge${saved ? `?league=${encodeURIComponent(saved.leagueId)}` : ""}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--rt-muted)", fontSize: 13, textDecoration: "none", marginBottom: 16 }}>
        <IconChevronLeft size={14} /> Back to Trade Edge
      </Link>

      <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>
        {regenerateMode === "picksOnly" ? "Draft pick values" : "Custom asset values"}
      </h1>
      <p style={{ color: "var(--rt-body)", fontSize: 14, margin: "0 0 20px", maxWidth: 640 }}>
        {regenerateMode === "picksOnly" ? (
          <>
            Every draft pick in {saved?.leagueName ?? "your league"}, priced individually — real dynasty consensus
            (or real-salary rank) at each current-year slot, sign-aware decay for future-year picks. Players and
            free agents stay on this league&apos;s standard base values.
          </>
        ) : (
          <>
            Every rostered player, free agent, and draft pick in {saved?.leagueName ?? "your league"}, revalued against
            this league&apos;s own rules — real dynasty consensus at each pick slot, house contract rules, and
            sign-aware decay for future-year picks.
          </>
        )}
      </p>

      {loadingSaved ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>Loading…</p>
      ) : !saved ? (
        <p style={{ color: "var(--rt-muted)", fontSize: 13.5 }}>No league connected yet — add one from Home.</p>
      ) : (
        <>
          <div
            style={{
              display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 12,
              background: "var(--rt-surface-soft)", border: "1px solid var(--rt-hairline)", marginBottom: 20, flexWrap: "wrap",
            }}
          >
            {doc ? (
              <span style={{ fontSize: 12.5, color: stale ? "var(--rt-down)" : "var(--rt-muted)" }}>
                {stale ? "⚠ May be stale — " : ""}Generated {relativeTime(doc.generatedAt)} · {doc.playerCount} players ·{" "}
                {doc.pickCount + doc.extraPickCount} picks
              </span>
            ) : (
              <span style={{ fontSize: 12.5, color: "var(--rt-muted)" }}>
                {loadingDoc ? "Loading…" : "Not generated yet — build the ledger below."}
              </span>
            )}
            {doc && doc.realSalaryEfficiencyWeight != null && Math.abs(doc.realSalaryEfficiencyWeight - 0.30) > 0.001 && (
              <span
                title="Away from the 30% default — this ledger was generated with a custom consensus/efficiency blend from Settings."
                style={{
                  fontSize: 11.5, fontWeight: 700, padding: "4px 10px", borderRadius: 999,
                  background: "var(--rt-primary)", color: "var(--rt-on-primary)", whiteSpace: "nowrap",
                }}
              >
                {Math.round(doc.realSalaryEfficiencyWeight * 100)}% cheap/production blend
              </span>
            )}
            <button
              type="button"
              onClick={regenerate}
              disabled={regenerating}
              style={{
                marginLeft: "auto", height: 36, padding: "0 18px", borderRadius: 100, border: "none",
                fontWeight: 700, fontSize: 12.5, cursor: regenerating ? "default" : "pointer",
                background: "var(--rt-primary)", color: "#fff",
              }}
            >
              {regenerating ? "Regenerating…" : doc ? "Regenerate" : "Generate"}
            </button>
          </div>

          {error && <p style={{ color: "var(--rt-down)", fontSize: 13.5, marginBottom: 16 }}>{error}</p>}

          {doc && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
                <div style={{ display: "inline-flex", padding: 3, background: "var(--rt-surface-strong)", borderRadius: 999 }}>
                  {(["all", "player", "pick"] as TypeFilter[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setTypeFilter(v)}
                      style={{
                        padding: "7px 14px", border: "none", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                        background: typeFilter === v ? "var(--rt-canvas)" : "transparent",
                        color: typeFilter === v ? "var(--rt-ink)" : "var(--rt-muted)",
                      }}
                    >
                      {v === "all" ? "All" : v === "player" ? "Players" : "Picks"}
                    </button>
                  ))}
                </div>
                <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} style={{ height: 34, borderRadius: 8, border: "1px solid var(--rt-hairline)", background: "var(--rt-canvas)", color: "var(--rt-ink)", fontSize: 12.5, padding: "0 10px" }}>
                  <option value="all">All owners</option>
                  {owners.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                <span style={{ fontSize: 12.5, color: "var(--rt-muted)" }}>{filteredRows.length} assets</span>
              </div>

              <div className="de-table-wrap de-table-wrap-freeze">
                <table className="de-table de-table-assetvalues">
                  <thead>
                    <tr>
                      <SortTh<SortKey> label="RANK" sortKey="tradeRank" sort={sort} onSort={onSort} />
                      <SortTh<SortKey> label="ASSET" sortKey="asset" sort={sort} onSort={onSort} align="left" />
                      <th className="l">TEAM</th>
                      <SortTh<SortKey> label="OWNER" sortKey="owner" sort={sort} onSort={onSort} align="left" />
                      {isDynasty && <SortTh<SortKey> label="DYN RANK" sortKey="dynRank" sort={sort} onSort={onSort} />}
                      {isDynasty && <th>VS CONSENSUS</th>}
                      <SortTh<SortKey> label="TRADE VALUE" sortKey="tradeValue" sort={sort} onSort={onSort} />
                      <SortTh<SortKey> label="SALARY" sortKey="salary" sort={sort} onSort={onSort} />
                      <th>CONTRACT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((row) => (
                      <tr key={`${row.type}-${row.asset}-${row.owner}`} className={row.owner === saved.teamName ? "mine" : ""}>
                        <td>{row.tradeRank != null && row.tradeRank <= 10 ? <span style={{ color: "var(--rt-primary)", fontWeight: 700 }}>{row.tradeRank}</span> : row.tradeRank}</td>
                        <td className="l"><AssetCell row={row} /></td>
                        <td className="l">{row.nbaTeam ? <TeamLogo team={row.nbaTeam} size={34} /> : <span style={{ color: "var(--rt-muted)" }}>—</span>}</td>
                        <td className="l">{row.owner}</td>
                        {isDynasty && <td>{row.dynRank ?? "—"}</td>}
                        {isDynasty && <td><MovementCell dynRank={row.dynRank} tradeRank={row.tradeRank} /></td>}
                        <td style={{ fontWeight: 700 }}>{row.tradeValue.toFixed(3)}</td>
                        <td>{formatRowSalary(row.salary)}</td>
                        <td>{row.contract ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </HubShell>
  );
}

export default function AssetValuesPage() {
  return (
    <Suspense fallback={null}>
      <AssetValuesContent />
    </Suspense>
  );
}
