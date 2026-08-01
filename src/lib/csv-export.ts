/** Client-side "download as CSV" — no server round-trip, no library. */

function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function downloadCsv(
  filename: string,
  columns: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void {
  const lines = [columns.map(csvField).join(",")];
  for (const row of rows) {
    lines.push(row.map((v) => csvField(v == null ? "" : String(v))).join(","));
  }
  const csv = lines.join("\r\n") + "\r\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
