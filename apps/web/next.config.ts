import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Multiple lockfiles in parent dirs can confuse tracing; pin workspace root.
  // Saving this file restarts the dev compiler; with `server.mjs`, restart `npm run dev` if you see
  // ENOENT on `.next/routes-manifest.json`.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  async rewrites() {
    return [{ source: "/agent/run", destination: "/api/agent/run" }];
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        assert: false
      };
    }
    // Do not set `config.cache = false` in dev: it can leave `.next` half-written (ENOENT on
    // vendor-chunks, fallback-build-manifest, pages/_document). Use middleware Cache-Control on
    // HTML and `npm run dev:clean` if the dev bundle gets out of sync.
    return config;
  }
};

export default nextConfig;
