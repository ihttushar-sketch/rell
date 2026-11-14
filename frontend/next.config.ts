import type { NextConfig } from "next";

/**
 * The studio UI must be reachable through the Arena preview proxy
 * (https://<port>-<sandbox>.e2b.app), so the dev server binds 0.0.0.0 and
 * accepts proxied origins. Requests to /api/* are proxied server-side to the
 * Python production engine, which keeps browser code origin-relative.
 */
const BACKEND = process.env.NEXUS_BACKEND_URL ?? "http://127.0.0.1:8000";

/**
 * Next clones/buffers proxied request bodies and caps them at 10 MB by default.
 * Raw footage is routinely larger than that, so the cap is raised to match the
 * node's own upload ceiling (NEXUS_MAX_UPLOAD_MB, 512 MB by default). Without
 * this, any /api/analyze or /api/produce upload above 10 MB is truncated and the
 * proxy aborts with "socket hang up" (HTTP 500).
 */
type ProxyBodyLimit = NonNullable<NextConfig["experimental"]>["middlewareClientMaxBodySize"];
const MAX_PROXY_BODY = (process.env.NEXUS_STUDIO_MAX_UPLOAD ?? "512mb") as ProxyBodyLimit;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { middlewareClientMaxBodySize: MAX_PROXY_BODY },
  allowedDevOrigins: ["*.e2b.app", "localhost", "127.0.0.1"],
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "ALLOWALL" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
