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

// Statement keywords that only read data — everything else is treated as a write.
const READ_KEYWORDS = new Set(["SELECT", "SHOW", "EXPLAIN", "DESCRIBE", "DESC", "WITH", "PRAGMA", "USE", "SET"]);

/**
 * For the ad-hoc SQL console on a read-only connection: allow read-only scripts,
 * reject anything that could write. Returns an error message, or null if OK.
 */
export function readOnlySqlViolation(serverId: string, sql: string): string | null {
  if (!isReadOnly(serverId)) return null;
  for (const stmt of splitStatements(sql)) {
    const m = stmt.trim().match(/^[A-Za-z]+/);
    const kw = m ? m[0].toUpperCase() : "";
    if (kw && !READ_KEYWORDS.has(kw)) {
      return `This connection is read-only (safe mode) — "${kw}" statements are blocked. Turn off read-only to run them.`;
    }
  }
  return null;
}
