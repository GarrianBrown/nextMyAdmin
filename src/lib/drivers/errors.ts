import type { Engine } from "./types";

const ENGINE_LABEL: Record<Engine, string> = {
  mysql: "MySQL",
  mariadb: "MariaDB",
  postgres: "PostgreSQL",
  sqlite: "SQLite",
  mongodb: "MongoDB",
};

/**
 * Turn a raw driver/connection error into a human-friendly message. Common
 * network and auth failures get an actionable hint; anything unrecognized is
 * passed through unchanged so the real DB error is never hidden.
 */
export function friendlyConnectionError(err: unknown, engine: Engine): Error {
  const label = ENGINE_LABEL[engine] ?? engine;
  const anyErr = err as { message?: string; code?: string } | null;
  const raw = (anyErr?.message ?? String(err)).trim();
  const code = anyErr?.code ?? "";
  const hay = `${code} ${raw}`;

  let friendly: string | null = null;

  if (/ECONNREFUSED/i.test(hay)) {
    friendly = `Can't reach the ${label} server — connection refused. Is it running and listening on that host and port?`;
  } else if (/ETIMEDOUT|(?:connection|connect).*timed?\s*out/i.test(hay)) {
    friendly = `The connection to the ${label} server timed out. Check the host/port and that the server is reachable (firewall, VPN).`;
  } else if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(hay)) {
    friendly = `Host not found — double-check the hostname for this ${label} connection.`;
  } else if (/ECONNRESET|server closed the connection|connection.*reset/i.test(hay)) {
    friendly = `The ${label} server closed the connection. It may require SSL, or the host/port points at something that isn't ${label}.`;
  } else if (/access denied|ER_ACCESS_DENIED|password authentication failed|authentication failed|auth(?:entication)? (?:failed|error)|bad auth|SCRAM|28P01|28000/i.test(hay)) {
    friendly = `Access denied for this ${label} connection — check the username and password.`;
  } else if (/unknown database|database .* does not exist|3D000|no such database|database not found/i.test(hay)) {
    friendly = `Database not found — it may have been renamed or dropped.`;
  } else if (/self[- ]signed certificate|SSL|certificate|ssl(?:mode)?/i.test(hay) && /required|error|verify/i.test(hay)) {
    friendly = `SSL/TLS problem connecting to ${label}. Try toggling the SSL option in the connection's Advanced settings.`;
  } else if (/no pg_hba|pg_hba\.conf/i.test(hay)) {
    friendly = `The ${label} server rejected the connection (pg_hba.conf) — the host/user isn't permitted, or SSL is required.`;
  }

  if (!friendly) return err instanceof Error ? err : new Error(raw || `Failed to connect to ${label}.`);
  // Keep the raw detail appended so power users still see the underlying error.
  const out = new Error(raw && !friendly.includes(raw) ? `${friendly} (${raw})` : friendly);
  return out;
}
