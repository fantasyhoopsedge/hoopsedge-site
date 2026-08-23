"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { HubShell } from "../../../_components/hub-shell";
import { IconChevronLeft } from "../../../_components/icons";
import { DEEP_EDGE_TABLE_CSS, SortTh, useSortableTable } from "../../../_components/sortable-table";
import { useActiveLeague } from "../../../_lib/use-saved-leagues";
import { CUSTOM_VALUATIONS_STALE_AFTER_MS, relativeTime, useNow } from "../../../_lib/relative-time";
import { formatCustomSalary, formatSalary } from "../../../_components/roster-table";
import { DEFAULT_LEAGUE_TAGS } from "@/lib/fantrax/league-tags";
import type { CustomValuationsDoc, LedgerRow } from "@/lib/fantrax/custom-valuations-store";

type SortKey = "tradeRank" | "asset" | "owner" | "dynRank" | "tradeValue" | "salary";
type TypeFilter = "all" | "player" | "pick";

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

  return (
    <HubShell hasLeague={Boolean(saved)} breadcrumb={saved ? `${saved.leagueName} · Custom asset values` : "Custom asset values"}>
      <style>{DEEP_EDGE_TABLE_CSS}</style>
      <Link href={`/deep-edge/home/trade-edge${saved ? `?league=${encodeURIComponent(saved.leagueId)}` : ""}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--rt-muted)", fontSize: 13, textDecoration: "none", marginBottom: 16 }}>
        <IconChevronLeft size={14} /> Back to Trade Edge
      </Link>

      <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>Custom asset values</h1>
      <p style={{ color: "var(--rt-body)", fontSize: 14, margin: "0 0 20px", maxWidth: 640 }}>
        Every rostered player, free agent, and draft pick in {saved?.leagueName ?? "your league"}, revalued against
        this league&apos;s own rules — real dynasty consensus at each pick slot, house contract rules, and
        sign-aware decay for future-year picks.
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

              <div className="de-table-wrap">
                <table className="de-table">
                  <thead>
                    <tr>
                      <SortTh<SortKey> label="RANK" sortKey="tradeRank" sort={sort} onSort={onSort} />
                      <SortTh<SortKey> label="ASSET" sortKey="asset" sort={sort} onSort={onSort} align="left" />
                      <SortTh<SortKey> label="OWNER" sortKey="owner" sort={sort} onSort={onSort} align="left" />
                      <SortTh<SortKey> label="DYN RANK" sortKey="dynRank" sort={sort} onSort={onSort} />
                      <SortTh<SortKey> label="TRADE VALUE" sortKey="tradeValue" sort={sort} onSort={onSort} />
                      <SortTh<SortKey> label="SALARY" sortKey="salary" sort={sort} onSort={onSort} />
                      <th>CONTRACT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((row) => (
                      <tr key={`${row.type}-${row.asset}-${row.owner}`} className={row.owner === saved.teamName ? "mine" : ""}>
                        <td>{row.tradeRank != null && row.tradeRank <= 10 ? <span style={{ color: "var(--rt-primary)", fontWeight: 700 }}>{row.tradeRank}</span> : row.tradeRank}</td>
                        <td className="l"><span className="de-player-name">{row.asset}</span>{row.pos ? <span style={{ color: "var(--rt-muted)", marginLeft: 6, fontSize: 11 }}>{row.pos}</span> : null}</td>
                        <td className="l">{row.owner}</td>
                        <td>{row.dynRank ?? "—"}</td>
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
