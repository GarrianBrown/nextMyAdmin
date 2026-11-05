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
  // Defense in depth for a page that holds DB access: no framing, nothing loaded
  // from or sent to other origins (connect-src 'self' stops exfiltration even if
  // something injected a script). Inline scripts are needed by Next's bootstrap
  // and the theme init; dev also needs eval for React refresh.
  async headers() {
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
