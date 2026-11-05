import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

/**
 * Network guard in front of every request. This app holds database credentials
 * and runs arbitrary SQL, so its HTTP server must only answer the app itself:
 *
 * 1. Host allowlist — only loopback names (plus NMA_ALLOWED_HOSTS). Blocks DNS
 *    rebinding, where a website points its own hostname at 127.0.0.1 to read
 *    responses from this server.
 * 2. No cross-site requests — a page on another origin can still *send*
 *    requests to localhost (e.g. a no-cors POST that drops a table) even when it
 *    can't read the reply, so anything not same-origin is refused.
 * 3. Per-launch token — the desktop app sets NMA_AUTH_TOKEN and gives only its
 *    own window the matching cookie, so other local processes and browser tabs
 *    can't use the server at all.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Must match the cookie electron/main.cjs sets on the app window.
const AUTH_COOKIE = "nma_token";

function allowedHost(host: string | null): boolean {
  if (!host) return false;
  const name = host.toLowerCase().replace(/:\d+$/, "");
  if (LOOPBACK_HOSTS.has(name)) return true;
  const extra = (process.env.NMA_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return extra.includes(name) || extra.includes(host.toLowerCase());
}

function crossSite(request: NextRequest, host: string): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return true;
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") {
    try {
      return new URL(origin).host.toLowerCase() !== host.toLowerCase();
    } catch {
      return true;
    }
  }
  // An opaque origin ("null": sandboxed iframes, file://) is never this app.
  return origin === "null";
}

function tokenOk(request: NextRequest, expected: string): boolean {
  const got = request.cookies.get(AUTH_COOKIE)?.value ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function deny(status: number, message: string) {
  return new NextResponse(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  if (!allowedHost(host)) {
    return deny(403, "Forbidden host. Set NMA_ALLOWED_HOSTS to serve nextMyAdmin under another hostname.");
  }
  if (crossSite(request, host!)) return deny(403, "Cross-site requests are not allowed.");

  const token = process.env.NMA_AUTH_TOKEN;
  if (token && !tokenOk(request, token)) return deny(401, "Unauthorized.");

  return NextResponse.next();
}
