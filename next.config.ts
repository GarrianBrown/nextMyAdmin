import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/nextMyAdmin",
  env: {
    NEXT_PUBLIC_BASE_PATH: "/nextMyAdmin",
  },
  // Native / heavy DB drivers must run in Node, not be bundled by Turbopack.
  serverExternalPackages: ["better-sqlite3", "mongodb"],
  // Emit a self-contained `.next/standalone/server.js` for the Electron
  // production build to launch (respects PORT / HOSTNAME). No effect on dev.
  output: "standalone",
  // The app never uses next/image, so disable image optimization. This keeps the
  // native `sharp` dependency out of the bundle entirely (smaller app, one fewer
  // native binary to package). better-sqlite3 remains the only native module.
  images: { unoptimized: true },
};

export default nextConfig;
