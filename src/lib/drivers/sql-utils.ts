/**
 * Dialect-agnostic SQL text helpers shared by the relational drivers. These are
 * lifted verbatim from the original MySQL query route so behaviour is unchanged;
 * the only engine-specific concern (identifier quoting) is handled by callers.
 */

import type { FilterCondition } from "./types";
import { FILTER_OPERATORS } from "./types";

/**
 * Build a parameterized WHERE clause from browse filters (ANDed). Operators are
 * whitelisted; identifier quoting and placeholder syntax are supplied by the
 * caller so this works for `?` (MySQL/SQLite) and `$n` (Postgres) dialects.
 * `placeholder` receives the 0-based index of the value being appended.
 */
export function buildWhereClause(
  filters: FilterCondition[] | undefined,
  quoteIdent: (name: string) => string,
  placeholder: (index: number) => string
): { clause: string; params: unknown[] } {
  if (!filters || filters.length === 0) return { clause: "", params: [] };
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const f of filters) {
    if (!f || !f.column) continue;
    if (!(FILTER_OPERATORS as readonly string[]).includes(f.op)) continue;
    const col = quoteIdent(f.column);
    if (f.op === "IS NULL" || f.op === "IS NOT NULL") {
      parts.push(`${col} ${f.op}`);
    } else {
      parts.push(`${col} ${f.op} ${placeholder(params.length)}`);
      params.push(f.value ?? "");
    }
  }
  if (parts.length === 0) return { clause: "", params: [] };
  return { clause: `WHERE ${parts.join(" AND ")}`, params };
}

/**
 * Assemble a single-table SQL dump: a header, DROP + CREATE, then one INSERT per
 * row. `createSql` is the engine's own CREATE TABLE text; `escapeLiteral` turns a
 * JS value into a SQL literal for that engine (MySQL passes `conn.escape`).
 */
export function buildTableDump(
  table: string,
  createSql: string,
  cols: string[],
  rows: Record<string, unknown>[],
  quoteIdent: (name: string) => string,
  escapeLiteral: (value: unknown) => string
): string {
  const lines: string[] = [];
  lines.push(`-- Structure for table ${table}`);
  lines.push(`DROP TABLE IF EXISTS ${quoteIdent(table)};`);
  lines.push(`${createSql.trim().replace(/;?\s*$/, "")};`);
  lines.push("");
  if (rows.length) {
    lines.push(`-- Data for table ${table} (${rows.length} row${rows.length === 1 ? "" : "s"})`);
    const colList = cols.map(quoteIdent).join(", ");
    for (const r of rows) {
      const vals = cols.map((c) => escapeLiteral(r[c])).join(", ");
      lines.push(`INSERT INTO ${quoteIdent(table)} (${colList}) VALUES (${vals});`);
    }
  } else {
    lines.push(`-- (no data)`);
  }
  return lines.join("\n") + "\n";
}

/** A generic SQL literal for engines without a driver-native escaper (Postgres/SQLite). */
export function genericSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (Buffer.isBuffer(value)) return `'\\x${value.toString("hex")}'`;
  if (typeof value === "object") return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Split a script into individual statements, respecting quotes and comments. */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = i + 1 < sql.length ? sql[i + 1] : "";

    if (inLineComment) {
      current += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      current += ch;
      if (ch === "*" && next === "/") {
        current += "/";
        i++;
        inBlockComment = false;
      }
      continue;
    }

    if (inSingleQuote) {
      current += ch;
      if (ch === "\\") {
        if (next) { current += next; i++; }
      } else if (ch === "'") {
        if (next === "'") { current += "'"; i++; }
        else inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      current += ch;
      if (ch === '"') inDoubleQuote = false;
      continue;
    }

    if (inBacktick) {
      current += ch;
      if (ch === "`") inBacktick = false;
      continue;
    }

    if (ch === "-" && next === "-") { inLineComment = true; current += ch; continue; }
    if (ch === "/" && next === "*") { inBlockComment = true; current += ch; continue; }
    if (ch === "#") { inLineComment = true; current += ch; continue; }
    if (ch === "'") { inSingleQuote = true; current += ch; continue; }
    if (ch === '"') { inDoubleQuote = true; current += ch; continue; }
    if (ch === "`") { inBacktick = true; current += ch; continue; }

    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }

    current += ch;
  }

  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}

/**
 * If `sql` is a plain single-table SELECT, return the (unqualified) table name
 * so the caller can offer inline editing; otherwise null. Handles both backtick
 * and double-quote identifier quoting so it works for MySQL and Postgres.
 */
export function parseSingleTableSelect(sql: string): string | null {
  const s = sql.replace(/\s+/g, " ").trim();
  if (!/^select\b/i.test(s)) return null;
  if (/\b(join|union|intersect|except)\b/i.test(s)) return null;

  let depth = 0;
  let fromPos = -1;
  const upper = s.toUpperCase();
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (depth === 0 && upper.startsWith("FROM ", i) && (i === 0 || s[i - 1] === " ")) {
      fromPos = i;
      break;
    }
  }
  if (fromPos === -1) return null;

  const afterFrom = s.slice(fromPos + 5).trim();
  if (afterFrom.startsWith("(")) return null;

  const tableMatch = afterFrom.match(/^(?:`[^`]+`|"[^"]+"|\w+)(?:\.(?:`[^`]+`|"[^"]+"|\w+))?/);
  if (!tableMatch) return null;

  const parts = tableMatch[0].split(".");
  const tableName = parts[parts.length - 1].replace(/[`"]/g, "");

  const rest = afterFrom.slice(tableMatch[0].length).trimStart();
  if (rest.startsWith(",")) return null;

  const kwPattern = /^(where|order|group|having|limit|offset|for|lock|into|procedure|;|$)/i;
  if (!kwPattern.test(rest)) {
    const aliasMatch = rest.match(/^(?:as\s+)?(?:`[^`]+`|"[^"]+"|\w+)\s*/i);
    if (aliasMatch) {
      const afterAlias = rest.slice(aliasMatch[0].length).trimStart();
      if (afterAlias.startsWith(",")) return null;
    }
  }

  return tableName;
}

/** Strip a trailing LIMIT/OFFSET clause so we can re-paginate a SELECT. */
export function stripTrailingLimit(sql: string): string {
  return sql.replace(
    /\s+LIMIT\s+\d+(\s*(,\s*\d+|\s+OFFSET\s+\d+))?\s*$/i,
    ""
  );
}

export function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function csvCellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Build a CSV document from row objects, in the given column order. */
export function rowsToCsv(
  rows: Record<string, unknown>[],
  fields: string[]
): string {
  const lines: string[] = [];
  lines.push(fields.map(escapeCsvField).join(","));
  for (const row of rows) {
    lines.push(fields.map((f) => escapeCsvField(csvCellToString(row[f]))).join(","));
  }
  return lines.join("\n");
}
