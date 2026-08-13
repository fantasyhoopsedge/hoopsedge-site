"use client";

import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir };

/**
 * Generic sortable `<th>` — the pattern already used (independently, twice)
 * in admin/fantrax/_connector.tsx's `SortTh` and seasonal-rankings-table.tsx,
 * consolidated here for Category Edge's category table and Power Rankings'
 * three format tables so a third near-duplicate doesn't get written.
 */
export function SortTh<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  title,
  align = "center",
}: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  title?: string;
  align?: "center" | "left";
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className={`de-th-sortable${align === "left" ? " l" : ""}${active ? " de-th-active" : ""}`}
      onClick={() => onSort(sortKey)}
      title={title}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label}
      <span className="de-sort-arrow">{active ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}</span>
    </th>
  );
}

/** `{key,dir}` sort state + a memoized sorted copy of `rows`, toggling
 *  direction on repeat clicks of the same key (new key always starts desc). */
export function useSortableTable<T, K extends string>(
  rows: T[],
  initial: SortState<K>,
  valueOf: (row: T, key: K) => number | string | null,
) {
  const [sort, setSort] = useState<SortState<K>>(initial);

  const onSort = (key: K) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = valueOf(a, sort.key);
      const bv = valueOf(b, sort.key);
      if (typeof av === "string" || typeof bv === "string") {
        const cmp = String(av ?? "").localeCompare(String(bv ?? ""));
        return sort.dir === "asc" ? cmp : -cmp;
      }
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return sort.dir === "asc" ? av - bv : bv - av;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  return { sort, onSort, sorted };
}

/** Shared table CSS — inject once per screen via <style>{DEEP_EDGE_TABLE_CSS}</style>. */
export const DEEP_EDGE_TABLE_CSS = `
  .de-table-wrap { overflow-x: auto; border: 1px solid var(--rt-hairline); border-radius: 10px; }
  .de-table { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 1040px; }
  .de-table th { position: sticky; top: 0; background: var(--rt-surface-strong); color: var(--rt-muted);
    font-family: var(--rt-font-mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em;
    padding: 8px 10px; text-align: center; white-space: nowrap; }
  .de-table th.l, .de-table td.l { text-align: left; }
  .de-table td { padding: 8px 10px; text-align: center; border-top: 1px solid var(--rt-hairline);
    font-family: var(--rt-font-mono); }
  .de-table tr.mine td { background: rgba(250,70,22,.14); font-weight: 600; }
  .de-th-sortable { cursor: pointer; user-select: none; }
  .de-th-active { color: var(--rt-ink); }
  .de-sort-arrow { display: inline-block; width: 10px; }
  /* Squeezed variant for tables with lots of narrow numeric columns (Power
   * Rankings' roto standings, both standalone and inside Trade Edge's
   * before/after compare) — no forced min-width, tighter padding/font, so a
   * normal desktop viewport shows the whole table without horizontal
   * scroll (Ash, 2026-08-13). */
  .de-table.de-table-compact { min-width: 0; font-size: 11.5px; }
  .de-table.de-table-compact th, .de-table.de-table-compact td { padding: 6px 6px; }
`;
