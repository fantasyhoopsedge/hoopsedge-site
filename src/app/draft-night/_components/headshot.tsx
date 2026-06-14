"use client";

/**
 * Prospect headshot for the Draft Night mini-games. Mirrors the app's existing
 * scheme (src/app/prospects/[slug]/_components/ProspectHeadshot): local images
 * at /images/prospects/{kebab-name}.jpg keyed off the prospect NAME (not the
 * slug — e.g. "Ja'Kobi Gillespie" → ja-kobi-gillespie.jpg), with an initials
 * circle as the fallback when an image is missing.
 */

function toKebabName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/['\s]+/g, "-")
    .replace(/-+/g, "-");
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function Headshot({ name, size = 40 }: { name: string; size?: number }) {
  const circle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    flexShrink: 0,
  };
  return (
    <div style={{ position: "relative", ...circle }} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/images/prospects/${toKebabName(name)}.jpg`}
        alt=""
        width={size}
        height={size}
        style={{ ...circle, objectFit: "cover", display: "block" }}
        onError={(e) => {
          e.currentTarget.style.display = "none";
          const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
          if (fallback) fallback.style.display = "flex";
        }}
      />
      <div
        style={{
          ...circle,
          position: "absolute",
          top: 0,
          left: 0,
          display: "none",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--blueprint)",
          color: "#fff",
          fontFamily: "'Oswald', sans-serif",
          fontWeight: 700,
          fontSize: Math.round(size * 0.36),
        }}
      >
        {getInitials(name)}
      </div>
    </div>
  );
}
