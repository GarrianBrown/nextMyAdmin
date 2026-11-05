import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import type { ServerConfig } from "./types";

/**
 * Encryption at rest for saved credentials. The desktop app keeps a random
 * 256-bit key in the OS keychain (Electron safeStorage) and hands it to this
 * server as NMA_SECRET_KEY; without a key (plain web use) secrets stay as-is.
 *
 * Only the secret itself is encrypted — the `password` field and the password
 * segment of a URL/URI (`mongodb://user:<token>@host`) — so hosts, users and
 * password-less URIs stay readable (the desktop server manager matches on them).
 */

const TOKEN_PREFIX = "nma1.";
// scheme://user:PASSWORD@… (same shape serverInput masks).
const URL_PASSWORD = /^([a-z][a-z0-9+.-]*:\/\/[^:/@]*:)([^/]*)@/i;

export class SecretUnavailableError extends Error {
  constructor(name?: string) {
    super(
      `The saved password for${name ? ` "${name}"` : " this connection"} can't be decrypted (the app's keychain entry may have been reset). Open Edit connection and enter it again.`
    );
    this.name = "SecretUnavailableError";
  }
}

function key(): Buffer | null {
  const hex = process.env.NMA_SECRET_KEY;
  if (!hex) return null;
  const k = Buffer.from(hex, "hex");
  return k.length === 32 ? k : null;
}

function encrypt(plain: string, k: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  // base64url: no `/`, `+`, `=` or `:`, so the token sits safely inside a URL.
  return TOKEN_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** Decrypt a token; null when there's no key or the token doesn't verify. */
function decrypt(token: string, k: Buffer | null): string | null {
  if (!k) return null;
  try {
    const raw = Buffer.from(token.slice(TOKEN_PREFIX.length), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function mapUrlPassword(url: string, fn: (pw: string) => string): string {
  const m = URL_PASSWORD.exec(url);
  return m ? url.replace(URL_PASSWORD, (_s, head: string) => `${head}${fn(m[2])}@`) : url;
}

/** Encrypt a server's secrets for writing to disk (no-op without a key). */
export function sealServer(s: ServerConfig): ServerConfig {
  const k = key();
  if (!k) return s;
  const seal = (v: string) => (v.startsWith(TOKEN_PREFIX) ? v : encrypt(v, k));
  const out = { ...s };
  if (out.password) out.password = seal(out.password);
  if (out.url) out.url = mapUrlPassword(out.url, seal);
  if (out.uri) out.uri = mapUrlPassword(out.uri, seal);
  delete out.secretUnavailable; // runtime-only flag
  return out;
}

/**
 * Decrypt a server's secrets after reading them. A secret that can't be
 * decrypted keeps its token (so a later write doesn't destroy it — restoring
 * the keychain entry brings it back) and the server is flagged, so connecting
 * fails with a clear message instead of an authentication error.
 */
export function openServer(s: ServerConfig): ServerConfig {
  const k = key();
  const out = { ...s };
  let unreadable = false;
  const open = (v: string) => {
    if (!v.startsWith(TOKEN_PREFIX)) return v;
    const plain = decrypt(v, k);
    if (plain === null) unreadable = true;
    return plain ?? v;
  };
  if (out.password) out.password = open(out.password);
  if (out.url) out.url = mapUrlPassword(out.url, open);
  if (out.uri) out.uri = mapUrlPassword(out.uri, open);
  if (unreadable) out.secretUnavailable = true;
  return out;
}

/** Whether a stored server still has plaintext secrets that a key could seal. */
export function needsSealing(s: ServerConfig): boolean {
  if (!key()) return false;
  const plainUrlPw = (u?: string) => {
    const pw = u ? URL_PASSWORD.exec(u)?.[2] : undefined;
    return !!pw && !pw.startsWith(TOKEN_PREFIX);
  };
  return (!!s.password && !s.password.startsWith(TOKEN_PREFIX)) || plainUrlPw(s.url) || plainUrlPw(s.uri);
}
