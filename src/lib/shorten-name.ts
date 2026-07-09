/**
 * Abbreviate a full player name to "F. SURNAME" (all caps) for tight table
 * columns. Hyphenated surnames longer than ~11 chars get their leading
 * segment reduced to an initial too, e.g. "Shai Gilgeous-Alexander" →
 * "S. G-ALEXANDER" — the last hyphen segment is always kept in full so the
 * name stays identifiable.
 */
export function shortenPlayerName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return fullName.toUpperCase();

  const first = parts[0];
  const surname = parts.slice(1).join(" ");
  const initial = `${first[0].toUpperCase()}.`;

  const segments = surname.split("-");
  const shortSurname =
    segments.length > 1 && surname.length > 11
      ? segments.map((seg, i) => (i === segments.length - 1 ? seg : seg[0])).join("-")
      : surname;

  return `${initial} ${shortSurname.toUpperCase()}`;
}
