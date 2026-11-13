import type { NextConfig } from "next";

/**
 * The studio UI must be reachable through the Arena preview proxy
 * (https://<port>-<sandbox>.e2b.app), so the dev server binds 0.0.0.0 and
 * accepts proxied origins. Requests to /api/* are proxied server-side to the
 * Python production engine, which keeps browser code origin-relative.
 */
const BACKEND = process.env.NEXUS_BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
