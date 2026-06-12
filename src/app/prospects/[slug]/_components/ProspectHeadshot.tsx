"use client";

function toKebabName(name: string): string {
  return name.toLowerCase().replace(/[.,]/g, "").replace(/['\s]+/g, "-").replace(/-+/g, "-");
}

function getInitials(name: string): string {
  const parts = name.split(" ");
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default function ProspectHeadshot({ name, size = 64 }: { name: string; size?: number }) {
  const kebabName = toKebabName(name);
  const initials = getInitials(name);
  const circleStyle: React.CSSProperties = {
    width: size, height: size, borderRadius: "50%", flexShrink: 0,
  };
  return (
    <div style={{ position: "relative", ...circleStyle }}>
      <img
        src={`/images/prospects/${kebabName}.jpg`}
        alt={name}
        width={size}
        height={size}
        style={{ ...circleStyle, objectFit: "cover", display: "block" }}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
          const fallback = e.currentTarget.nextElementSibling as HTMLElement;
          if (fallback) fallback.style.display = "flex";
        }}
      />
      <div style={{
        ...circleStyle,
        background: "var(--blueprint)", color: "white",
        display: "none", alignItems: "center", justifyContent: "center",
        fontSize: Math.round(size * 0.27) + "px", fontWeight: 700,
        fontFamily: "'Oswald', sans-serif",
        position: "absolute", top: 0, left: 0,
      }}>{initials}</div>
    </div>
  );
}
