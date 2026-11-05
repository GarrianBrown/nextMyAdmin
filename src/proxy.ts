import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { SESSION_COOKIE, verifySession, webAuthEnabled } from "@/lib/webAuth";

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
 * 4. Web login — as a web app, NMA_PASSWORD requires signing in (src/lib/webAuth.ts).
 *    Serving extra hostnames (NMA_ALLOWED_HOSTS) without it is refused: that's
 *    exposing database access to a network with no password.
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

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
// Reachable without a session: the login page/API and the static assets they need.
const PUBLIC_PATHS = [/^\/login$/, /^\/api\/login$/, /^\/_next\//, /^\/icon\.svg$/, /^\/favicon\.ico$/];

/** Request path without the basePath (whether or not Next already stripped it). */
function appPath(request: NextRequest): string {
  const p = request.nextUrl.pathname;
  if (BASE_PATH && (p === BASE_PATH || p.startsWith(`${BASE_PATH}/`))) return p.slice(BASE_PATH.length) || "/";
  return p;
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
  if (token) return tokenOk(request, token) ? NextResponse.next() : deny(401, "Unauthorized.");

  if (webAuthEnabled()) {
    const path = appPath(request);
    if (PUBLIC_PATHS.some((re) => re.test(path)) || verifySession(request.cookies.get(SESSION_COOKIE)?.value)) {
      return NextResponse.next();
    }
    if (path.startsWith("/api/")) return deny(401, "Sign in required.");
    const login = new URL(`${BASE_PATH}/login`, request.url);
    login.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  if (process.env.NMA_ALLOWED_HOSTS) {
    return deny(403, "NMA_ALLOWED_HOSTS is set but NMA_PASSWORD isn't. Set NMA_PASSWORD to serve nextMyAdmin beyond this machine.");
  }
  return NextResponse.next();
}
