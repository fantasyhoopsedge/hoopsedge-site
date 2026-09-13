import Image from "next/image";

export type PlatformId = "fantrax" | "yahoo" | "espn" | "sleeper" | "downtown";

/** Official platform marks, served from public/images/fantasy platforms/.
 *  The folder name has a space, so the paths are pre-encoded. */
const LOGO_SRC: Record<PlatformId, string> = {
  fantrax: "/images/fantasy%20platforms/fantrax.jpg",
  yahoo: "/images/fantasy%20platforms/yahoo.jpg",
  espn: "/images/fantasy%20platforms/espn.png",
  sleeper: "/images/fantasy%20platforms/sleeper.jpg",
  downtown: "/images/fantasy%20platforms/downtown.png",
};

const LOGO_ALT: Record<PlatformId, string> = {
  fantrax: "Fantrax", yahoo: "Yahoo", espn: "ESPN", sleeper: "Sleeper", downtown: "Downtown Fantasy Sports",
};

/** A square app-icon style platform mark. Radius scales with size so a 22px
 *  sidebar badge and a 44px provider tile read as the same shape. */
export function PlatformLogo({ platform, size, decorative = false }: { platform: PlatformId; size: number; decorative?: boolean }) {
  return (
    <Image
      src={LOGO_SRC[platform]}
      alt={decorative ? "" : LOGO_ALT[platform]}
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.24), objectFit: "cover", flexShrink: 0, display: "block" }}
    />
  );
}
