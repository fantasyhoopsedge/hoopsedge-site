/**
 * Abbreviate a full player name to "F. SURNAME" (all caps) for tight table
 * columns. Multi-segment surnames longer than ~11 chars get every segment
 * but the last reduced to an initial, keeping each segment's own separator
 * (space or hyphen) — "Shai Gilgeous-Alexander" → "S. G-ALEXANDER",
 * "Yannick Konan Niederhauser" → "Y. K NIEDERHAUSER". The final segment is
 * always kept in full so the name stays identifiable; a single long
 * unbroken surname (e.g. "Antetokounmpo") is left as-is — there's no
 * natural place to split it — and relies on the table's ellipsis fallback.
 */
export function shortenPlayerName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return fullName.toUpperCase();

  const first = parts[0];
  const initial = `${first[0].toUpperCase()}.`;
  const surname = parts.slice(1).join(" ");

  // Flatten the surname into segments, remembering the separator (if any)
  // that preceded each one, so hyphen- and space-joined segments compress
  // the same way.
  const segments: { text: string; sep: "" | " " | "-" }[] = [];
  parts.slice(1).forEach((word, wordIndex) => {
    word.split("-").forEach((seg, segIndex) => {
      segments.push({ text: seg, sep: segIndex > 0 ? "-" : wordIndex > 0 ? " " : "" });
    });
  });

  const shortSurname =
    segments.length > 1 && surname.length > 11
      ? segments
          .map((s, i) => (i === segments.length - 1 ? `${s.sep}${s.text}` : `${s.sep}${s.text[0]}`))
          .join("")
      : surname;

  return `${initial} ${shortSurname.toUpperCase()}`;
}
