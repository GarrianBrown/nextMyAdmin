import { getServerConfig } from "./db";
import { splitStatements } from "./drivers/sql-utils";

/** Whether a connection is flagged read-only (safe mode). */
export function isReadOnly(serverId: string): boolean {
  try {
    return !!getServerConfig(serverId)?.readOnly;
  } catch {
    return false;
  }
}

/** Throw a 403-worthy error if the connection is read-only. Call at the top of mutating routes. */
export function assertWritable(serverId: string): void {
  if (isReadOnly(serverId)) {
    throw new ReadOnlyError();
  }
}

export class ReadOnlyError extends Error {
  constructor() {
    super("This connection is read-only (safe mode). Turn off read-only in the connection settings to make changes.");
    this.name = "ReadOnlyError";
  }
}

// Statements that only read. Anything else — including transaction control
// (COMMIT/BEGIN/SET …) that could escape the read-only transaction the drivers
// open — is refused. This is the first layer; the second is the database itself:
// drivers run read-only connections' queries in a read-only transaction (or, for
// SQLite, a read-only file handle), so a write that slips past this still fails.
const READ_KEYWORDS = new Set(["SELECT", "SHOW", "EXPLAIN", "DESCRIBE", "DESC", "WITH", "VALUES", "TABLE"]);
const ENGINE_READ_KEYWORDS: Record<string, string[]> = {
  mysql: ["USE"],
  mariadb: ["USE"],
  sqlite: ["PRAGMA"],
};

/** Drop leading whitespace, comments and opening parens: `/* x *\/ (SELECT …` → `SELECT …`. */
function stripLeading(stmt: string): string {
  let s = stmt;
  for (;;) {
    const next = s.replace(/^(?:\s+|--[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|\()/, "");
    if (next === s) return s;
    s = next;
  }
}

/**
 * For the ad-hoc SQL console on a read-only connection: allow read-only scripts,
 * reject anything that could write. Returns an error message, or null if OK.
 */
export function readOnlySqlViolation(serverId: string, sql: string): string | null {
  const server = getServerConfig(serverId);
  if (!server?.readOnly) return null;
  const allowed = new Set([...READ_KEYWORDS, ...(ENGINE_READ_KEYWORDS[server.engine ?? "mysql"] ?? [])]);
  for (const stmt of splitStatements(sql)) {
    const body = stripLeading(stmt);
    if (!body) continue;
    const kw = (body.match(/^[A-Za-z]+/)?.[0] ?? "").toUpperCase();
    // MySQL user variables (SET @x = …) are session-local and harmless.
    const userVar = kw === "SET" && /^SET\s+@(?!@)/i.test(body);
    if (!userVar && !allowed.has(kw)) {
      const what = kw ? `"${kw}" statements are` : "that statement is";
      return `This connection is read-only (safe mode) — ${what} blocked. Turn off read-only to run them.`;
    }
    if (/\bINTO\s+(?:OUTFILE|DUMPFILE)\b/i.test(body)) {
      return "This connection is read-only (safe mode) — writing query results to a file is blocked.";
    }
  }
  return null;
}
