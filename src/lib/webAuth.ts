import { createHash, createHmac, timingSafeEqual } from "crypto";

/**
 * Optional password login for running nextMyAdmin as a web app (`next start`).
 * Set NMA_PASSWORD to require it. The desktop app doesn't use this — it has
 * its own per-launch token (NMA_AUTH_TOKEN), so the login is skipped there.
 *
 * Sessions are a signed expiry (`<expiresMs>.<hmac>`) in an httpOnly cookie,
 * keyed off the password: changing NMA_PASSWORD signs everyone out.
 */

export const SESSION_COOKIE = "nma_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function webAuthEnabled(): boolean {
  return !!process.env.NMA_PASSWORD && !process.env.NMA_AUTH_TOKEN;
}

function sessionKey(): Buffer {
  return createHash("sha256").update(`nma-session\0${process.env.NMA_PASSWORD ?? ""}`).digest();
}

function sign(payload: string): string {
  return createHmac("sha256", sessionKey()).update(payload).digest("base64url");
}

function equal(a: string | Buffer, b: string | Buffer): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createSession(now = Date.now()): string {
  const expires = String(now + SESSION_TTL_MS);
  return `${expires}.${sign(expires)}`;
}

export function verifySession(value: string | undefined, now = Date.now()): boolean {
  if (!value || !webAuthEnabled()) return false;
  const dot = value.indexOf(".");
  if (dot < 1) return false;
  const expires = value.slice(0, dot);
  if (!/^\d+$/.test(expires) || Number(expires) <= now) return false;
  return equal(value.slice(dot + 1), sign(expires));
}

/** Constant-time password check (hashing first evens out the lengths). */
export function checkPassword(input: unknown): boolean {
  const expected = process.env.NMA_PASSWORD;
  if (!expected || typeof input !== "string") return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return equal(h(input), h(expected));
}

/** Only same-app relative paths may be a post-login destination (no open redirect). */
export function safeNextPath(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
}
