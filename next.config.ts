import type { NextConfig } from "next";

// Production build assets are content-hashed, so caching them hard is correct.
// In dev, Turbopack serves stable-path chunks — an immutable cache would pin
// stale JS in the browser and break HMR/reloads (Next warns about this at
// startup), so we send no-store instead.
const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Team abbreviation standardization (docs/FHE_NBA_team_standard_abr.txt):
      // /team-rosters/[team] used to be keyed by NOP/PHX (stats.nba.com-style),
      // now NOR/PHO (the FHE standard) — keep the old slugs resolving.
      {
        source: "/team-rosters/NOP",
        destination: "/team-rosters/NOR",
        permanent: true,
      },
      {
        source: "/team-rosters/PHX",
        destination: "/team-rosters/PHO",
        permanent: true,
      },
      // Free-agent bucket consolidation: "FA" and "UFA" used to be two
      // separate (redundant) non-team categories — now just "FA".
      {
        source: "/team-rosters/UFA",
        destination: "/team-rosters/FA",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        // Build assets are content-hashed and immutable in prod: cache them hard
        // so an open tab keeps its chunks across a redeploy (no missing-chunk
        // errors). In dev, never cache — chunk paths are reused across edits.
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: isProd ? "public, max-age=31536000, immutable" : "no-store",
          },
        ],
      },
      {
        // Admin + board data must never be cached by browsers or CDNs.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
