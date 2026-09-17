// Post-build prep for the Electron package.
//
// `output: 'standalone'` emits a self-contained server + traced node_modules,
// but deliberately omits static assets (meant for a CDN). For a desktop app we
// serve them ourselves, so copy `.next/static` and `public/` into the standalone
// tree where `server.js` expects them.
//
// No native-module rebuild is required: better-sqlite3 v13 is an N-API module,
// so its prebuilt binary is ABI-stable across Node and Electron.
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  console.error("No .next/standalone — run `next build` (with output: 'standalone') first.");
  process.exit(1);
}

cpSync(join(root, ".next", "static"), join(standalone, ".next", "static"), { recursive: true });
if (existsSync(join(root, "public"))) {
  cpSync(join(root, "public"), join(standalone, "public"), { recursive: true });
}

// Next's file tracing only copies the CURRENT arch's better-sqlite3 prebuild into
// the standalone bundle. Copy them all so a universal macOS build (arm64 + x64) and
// the Windows/Linux installers each get the right N-API binary. better-sqlite3 ships
// every platform/arch prebuild in its npm package, so nothing is downloaded.
const prebuildsSrc = join(root, "node_modules", "better-sqlite3", "prebuilds");
const prebuildsDest = join(standalone, "node_modules", "better-sqlite3", "prebuilds");
if (existsSync(prebuildsSrc)) {
  cpSync(prebuildsSrc, prebuildsDest, { recursive: true });
}

// The app never optimizes images (images.unoptimized), yet Next's file tracer
// still pulls in the native `sharp`/`@img` packages defensively. Strip them so
// the only native module shipped is better-sqlite3.
for (const dep of ["@img", "sharp"]) {
  const dir = join(standalone, "node_modules", dep);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

console.log(
  "Prepared standalone: copied .next/static" +
    (existsSync(join(root, "public")) ? " and public/" : "") +
    " + all better-sqlite3 prebuilds into .next/standalone."
);
