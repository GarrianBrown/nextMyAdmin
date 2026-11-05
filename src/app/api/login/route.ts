import { NextResponse } from "next/server";
import { checkPassword, createSession, SESSION_COOKIE, SESSION_TTL_MS, webAuthEnabled } from "@/lib/webAuth";

// Brute-force brake: every failure costs a delay, and a client that keeps
// failing is locked out for a while. In-memory is fine — one server process.
const MAX_FAILURES = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
const FAILURE_DELAY_MS = 750;
const failures = new Map<string, { count: number; until: number }>();

function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}

function cookieOptions(request: Request, maxAgeSeconds: number) {
  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
    path: process.env.NEXT_PUBLIC_BASE_PATH || "/",
    maxAge: maxAgeSeconds,
  };
}

// Sign in with NMA_PASSWORD.
export async function POST(request: Request) {
  if (!webAuthEnabled()) return NextResponse.json({ error: "Sign-in isn't enabled." }, { status: 404 });

  const key = clientKey(request);
  const entry = failures.get(key);
  if (entry && entry.until > Date.now()) {
    const minutes = Math.ceil((entry.until - Date.now()) / 60000);
    return NextResponse.json({ error: `Too many failed attempts. Try again in ${minutes} minute(s).` }, { status: 429 });
  }

  const { password } = await request.json().catch(() => ({}));
  if (!checkPassword(password)) {
    const count = (entry?.count ?? 0) + 1;
    failures.set(key, { count, until: count >= MAX_FAILURES ? Date.now() + LOCKOUT_MS : 0 });
    await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  failures.delete(key);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createSession(), cookieOptions(request, SESSION_TTL_MS / 1000));
  return res;
}

// Sign out.
export async function DELETE(request: Request) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", cookieOptions(request, 0));
  return res;
}
