import type { NextConfig } from "next";

// Production build assets are content-hashed, so caching them hard is correct.
// In dev, Turbopack serves stable-path chunks — an immutable cache would pin
// stale JS in the browser and break HMR/reloads (Next warns about this at
// startup), so we send no-store instead.
const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
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
