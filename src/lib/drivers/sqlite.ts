import Database from "better-sqlite3";
import { readdirSync, existsSync, unlinkSync } from "fs";
import { join, basename } from "path";
import type { ServerConfig, ColumnInfo, KeyInfo, ForeignKeyInfo } from "@/lib/types";
import type {
  DatabaseDriver,
  DriverCapabilities,
  Engine,
  BrowseOptions,
  BrowseResult,
  ExecResult,
  RunQueryOptions,
  RunQueryResult,
  TableStructure,
  EditableInfo,
  ColumnDef,
  IndexDef,
  DatabaseObjects,
  DatabaseObject,
  DatabaseObjectKind,
} from "./types";
import { CAPABILITIES } from "./capabilities";
import { NotSupportedError } from "./types";
import {
  splitStatements,
  parseSingleTableSelect,
  stripTrailingLimit,
  rowsToCsv,
  buildWhereClause,
  buildTableDump,
  genericSqlLiteral,
} from "./sql-utils";

const SQLITE_EXT = /\.(db|sqlite|sqlite3)$/i;

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** better-sqlite3 only binds primitives; coerce everything else. */
function bindValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "string") return v;
  if (Buffer.isBuffer(v)) return v;
  return JSON.stringify(v);
}

/**
 * SQLite driver (via better-sqlite3). A "server" is either a `directory` whose
 * *.db/*.sqlite files are the databases, or a single `file`. There are no users;
 * the catalog comes from sqlite_master + PRAGMA.
 */
export class SqliteDriver implements DatabaseDriver {
  readonly engine: Engine = "sqlite";
  readonly capabilities: DriverCapabilities = CAPABILITIES.sqlite;

  constructor(private readonly config: ServerConfig) {
    if (!config.directory && !config.file) {
      throw new Error(`SQLite server "${config.id}" needs a "directory" or "file" in config.`);
    }
  }

  private resolvePath(database: string): string {
    if (this.config.directory) return join(this.config.directory, database);
    return this.config.file!;
  }

  private open(database: string, create = false): Database.Database {
    const path = this.resolvePath(database);
    let db: Database.Database;
    try {
      db = new Database(path, { fileMustExist: !create });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/unable to open database file|cannot open|does not exist|ENOENT|no such file/i.test(msg)) {
        throw new Error(`Can't open the SQLite database file "${database}" — it may have been moved or deleted. (${msg})`);
      }
      if (/not a database|file is encrypted|malformed/i.test(msg)) {
        throw new Error(`"${database}" doesn't look like a valid SQLite database file. (${msg})`);
      }
      throw err instanceof Error ? err : new Error(msg);
    }
    db.pragma("foreign_keys = ON");
    return db;
  }

  async listDatabases(): Promise<string[]> {
    if (this.config.file) return [basename(this.config.file)];
    return readdirSync(this.config.directory!)
      .filter((f) => SQLITE_EXT.test(f))
      .sort();
  }

  async createDatabase(name: string): Promise<void> {
    if (!this.config.directory) {
      throw new Error("Creating databases requires a SQLite server configured with a directory.");
    }
    const fileName = SQLITE_EXT.test(name) ? name : `${name}.db`;
    const db = this.open(fileName, true);
    db.close(); // opening in create mode materializes the file
  }

  async dropDatabase(name: string): Promise<void> {
    if (!this.config.directory) {
      throw new Error("Dropping databases requires a SQLite server configured with a directory.");
    }
    const path = this.resolvePath(name);
    if (existsSync(path)) unlinkSync(path);
  }

  async listTables(database: string): Promise<string[]> {
    const db = this.open(database);
    try {
      const rows = db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
           ORDER BY name`
        )
        .all() as { name: string }[];
      return rows.map((r) => r.name);
    } finally {
      db.close();
    }
  }

  async getTableStructure(database: string, table: string): Promise<TableStructure> {
    const db = this.open(database);
    try {
      return {
        columns: this.columnsOf(db, table),
        indexes: this.indexesOf(db, table),
        foreignKeys: this.foreignKeysOf(db, table),
      };
    } finally {
      db.close();
    }
  }

  private columnsOf(db: Database.Database, table: string): ColumnInfo[] {
    const info = db
      .prepare(`PRAGMA table_info(${quoteIdent(table)})`)
      .all() as Array<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }>;
    const uniqueCols = this.uniqueColumnsOf(db, table);
    return info.map((c) => {
      // An INTEGER PRIMARY KEY is an alias for the rowid and auto-assigns — treat
      // it like auto_increment so the insert form leaves it to SQLite.
      const isRowidPk = c.pk > 0 && /^integer$/i.test((c.type || "").trim());
      let key = "";
      if (c.pk > 0) key = "PRI";
      else if (uniqueCols.has(c.name)) key = "UNI";
      return {
        Field: c.name,
        Type: c.type || "",
        // A PRIMARY KEY column is implicitly NOT NULL even though PRAGMA reports 0.
        Null: c.notnull || c.pk > 0 ? "NO" : "YES",
        Key: key,
        Default: c.dflt_value === null || c.dflt_value === undefined ? null : String(c.dflt_value),
        Extra: isRowidPk ? "auto_increment" : "",
      };
    });
  }

  /** Columns that are the sole column of a UNIQUE (non-pk) index. */
  private uniqueColumnsOf(db: Database.Database, table: string): Set<string> {
    const set = new Set<string>();
    const indexes = db
      .prepare(`PRAGMA index_list(${quoteIdent(table)})`)
      .all() as Array<{ name: string; unique: number; origin: string }>;
    for (const idx of indexes) {
      if (!idx.unique || idx.origin === "pk") continue;
      const cols = db.prepare(`PRAGMA index_info(${quoteIdent(idx.name)})`).all() as Array<{ name: string }>;
      if (cols.length === 1) set.add(cols[0].name);
    }
    return set;
  }

  private indexesOf(db: Database.Database, table: string): KeyInfo[] {
    const result: KeyInfo[] = [];

    // Synthesize a PRIMARY index from the table's PK columns (PRAGMA index_list
    // doesn't report the implicit rowid PK).
    const pkCols = (db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string; pk: number }>)
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk);
    pkCols.forEach((c, i) => {
      result.push(makeKeyInfo(table, "PRIMARY", c.name, 0, i + 1));
    });

    const indexes = db
      .prepare(`PRAGMA index_list(${quoteIdent(table)})`)
      .all() as Array<{ name: string; unique: number; origin: string }>;
    for (const idx of indexes) {
      if (idx.origin === "pk") continue; // already covered above
      const cols = db
        .prepare(`PRAGMA index_info(${quoteIdent(idx.name)})`)
        .all() as Array<{ seqno: number; name: string }>;
      for (const col of cols) {
        result.push(makeKeyInfo(table, idx.name, col.name, idx.unique ? 0 : 1, col.seqno + 1));
      }
    }
    return result;
  }

  private foreignKeysOf(db: Database.Database, table: string): ForeignKeyInfo[] {
    const fks = db
      .prepare(`PRAGMA foreign_key_list(${quoteIdent(table)})`)
      .all() as Array<{ id: number; from: string; table: string; to: string; on_update: string; on_delete: string }>;
    return fks.map((fk) => ({
      CONSTRAINT_NAME: `fk_${table}_${fk.id}`,
      COLUMN_NAME: fk.from,
      REFERENCED_TABLE_SCHEMA: "main",
      REFERENCED_TABLE_NAME: fk.table,
      REFERENCED_COLUMN_NAME: fk.to,
      UPDATE_RULE: fk.on_update,
      DELETE_RULE: fk.on_delete,
    }));
  }

  private primaryKeysOf(db: Database.Database, table: string): string[] {
    return (db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string; pk: number }>)
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);
  }

  async browseTable(database: string, table: string, options: BrowseOptions): Promise<BrowseResult> {
    const db = this.open(database);
    try {
      const where = buildWhereClause(options.filters, quoteIdent, () => "?");
      const whereSql = where.clause ? ` ${where.clause}` : "";

      const totalRows = (db.prepare(`SELECT COUNT(*) AS total FROM ${quoteIdent(table)}${whereSql}`).get(...where.params) as { total: number }).total;
      const totalPages = Math.ceil(totalRows / options.pageSize);

      let sql = `SELECT * FROM ${quoteIdent(table)}${whereSql}`;
      if (options.sortColumn) {
        const valid = this.columnsOf(db, table).map((c) => c.Field);
        if (valid.includes(options.sortColumn)) {
          sql += ` ORDER BY ${quoteIdent(options.sortColumn)} ${options.sortDirection === "desc" ? "DESC" : "ASC"}`;
        }
      }
      const offset = (options.page - 1) * options.pageSize;
      sql += ` LIMIT ${options.pageSize} OFFSET ${offset}`;

      const start = performance.now();
      const stmt = db.prepare(sql);
      const rows = stmt.all(...where.params) as Record<string, unknown>[];
      const executionTime = parseFloat((performance.now() - start).toFixed(2));
      const fields = stmt.columns().map((c) => c.name);

      return {
        rows,
        fields,
        totalRows,
        page: options.page,
        pageSize: options.pageSize,
        totalPages,
        executionTime,
      };
    } finally {
      db.close();
    }
  }

  async insertRow(database: string, table: string, values: Record<string, unknown>): Promise<ExecResult> {
    const db = this.open(database);
    try {
      const cols = Object.keys(values);
      const sql = `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
      const info = db.prepare(sql).run(...cols.map((c) => bindValue(values[c])));
      return {
        affectedRows: info.changes,
        insertId: typeof info.lastInsertRowid === "bigint" ? Number(info.lastInsertRowid) : info.lastInsertRowid,
        message: `${info.changes} row(s) inserted.`,
      };
    } finally {
      db.close();
    }
  }

  async insertRows(database: string, table: string, columns: string[], rows: unknown[][]): Promise<ExecResult> {
    if (rows.length === 0) return { affectedRows: 0, message: "No rows to import." };
    const db = this.open(database);
    try {
      const sql = `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
      const stmt = db.prepare(sql);
      const insertAll = db.transaction((all: unknown[][]) => {
        for (const row of all) stmt.run(...row.map((v) => bindValue(v)));
      });
      insertAll(rows);
      return { affectedRows: rows.length, message: `${rows.length} row(s) imported.` };
    } finally {
      db.close();
    }
  }

  async updateRow(
    database: string,
    table: string,
    primaryKeys: Record<string, unknown>,
    updates: Record<string, unknown>
  ): Promise<ExecResult> {
    const db = this.open(database);
    try {
      const setCols = Object.keys(updates);
      const pkCols = Object.keys(primaryKeys);
      const sql = `UPDATE ${quoteIdent(table)} SET ${setCols.map((c) => `${quoteIdent(c)} = ?`).join(", ")} WHERE ${pkCols
        .map((c) => `${quoteIdent(c)} = ?`)
        .join(" AND ")}`;
      const params = [...setCols.map((c) => bindValue(updates[c])), ...pkCols.map((c) => bindValue(primaryKeys[c]))];
      const info = db.prepare(sql).run(...params);
      return { affectedRows: info.changes, message: `${info.changes} row(s) updated.` };
    } finally {
      db.close();
    }
  }

  async deleteRow(database: string, table: string, primaryKeys: Record<string, unknown>): Promise<ExecResult> {
    const db = this.open(database);
    try {
      const pkCols = Object.keys(primaryKeys);
      const sql = `DELETE FROM ${quoteIdent(table)} WHERE ${pkCols.map((c) => `${quoteIdent(c)} = ?`).join(" AND ")}`;
      const info = db.prepare(sql).run(...pkCols.map((c) => bindValue(primaryKeys[c])));
      return { affectedRows: info.changes, message: `${info.changes} row(s) deleted.` };
    } finally {
      db.close();
    }
  }

  async runQuery(database: string, query: string, options: RunQueryOptions): Promise<RunQueryResult> {
    const db = this.open(database);
    try {
      const statements = splitStatements(query);
      if (statements.length === 0) throw new Error("No SQL statements found");

      const lastStatement = statements[statements.length - 1];
      const prefixStmts = statements.slice(0, -1);
      const currentPage = Math.max(1, options.page ?? 1);
      const pageSize = Math.max(1, Math.min(1000, options.pageSize ?? 25));

      let prefixAffectedRows = 0;
      for (const stmt of prefixStmts) {
        const s = db.prepare(stmt);
        if (!s.reader) prefixAffectedRows += s.run().changes;
        else s.all();
      }

      const start = performance.now();

      if (/^\s*select\b/i.test(lastStatement)) {
        const baseSql = stripTrailingLimit(lastStatement);

        let totalRows: number | null = null;
        try {
          totalRows = Number((db.prepare(`SELECT COUNT(*) AS total FROM (${baseSql}) AS _count_sub`).get() as { total: number }).total);
        } catch {
          // Count failed for complex query — skip pagination metadata
        }

        if (options.download === "csv") {
          const stmt = db.prepare(lastStatement);
          const rows = stmt.all() as Record<string, unknown>[];
          return { type: "csv", content: rowsToCsv(rows, stmt.columns().map((c) => c.name)) };
        }

        const offset = (currentPage - 1) * pageSize;
        const stmt = db.prepare(`${baseSql} LIMIT ${pageSize} OFFSET ${offset}`);
        const rows = stmt.all() as Record<string, unknown>[];
        const executionTime = parseFloat((performance.now() - start).toFixed(2));
        const fields = stmt.columns().map((c) => c.name);

        let editable: EditableInfo | undefined;
        const tableName = parseSingleTableSelect(lastStatement);
        if (tableName) {
          try {
            const primaryKeys = this.primaryKeysOf(db, tableName);
            if (primaryKeys.length > 0 && primaryKeys.every((pk) => fields.includes(pk))) {
              editable = { table: tableName, primaryKeys, columns: this.columnsOf(db, tableName) };
            }
          } catch {
            // not editable
          }
        }

        const totalPages = totalRows !== null ? Math.ceil(totalRows / pageSize) : null;
        return {
          type: "select",
          rows,
          fields,
          totalRows,
          page: currentPage,
          pageSize,
          totalPages,
          executionTime,
          ...(editable ? { editable } : {}),
          ...(prefixStmts.length > 0 ? { prefixStatements: prefixStmts.length, prefixAffectedRows } : {}),
        };
      }

      const stmt = db.prepare(lastStatement);
      if (stmt.reader) {
        const rows = stmt.all() as Record<string, unknown>[];
        const executionTime = parseFloat((performance.now() - start).toFixed(2));
        return {
          type: "select",
          rows,
          fields: stmt.columns().map((c) => c.name),
          executionTime,
          ...(prefixStmts.length > 0 ? { prefixStatements: prefixStmts.length, prefixAffectedRows } : {}),
        };
      }

      const info = stmt.run();
      const executionTime = parseFloat((performance.now() - start).toFixed(2));
      const totalAffected = prefixAffectedRows + info.changes;
      return {
        type: "execute",
        affectedRows: totalAffected,
        message: `${statements.length > 1 ? `${statements.length} statements executed. ` : "Query executed successfully. "}${totalAffected} row(s) affected.`,
        executionTime,
      };
    } finally {
      db.close();
    }
  }

  // ---- schema editing (SQLite ALTER is limited) ----

  private run(database: string, sql: string, message: string): ExecResult {
    const db = this.open(database);
    try {
      db.exec(sql);
      return { affectedRows: 0, message };
    } finally {
      db.close();
    }
  }

  async addColumn(database: string, table: string, def: ColumnDef): Promise<ExecResult> {
    let sql = `ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${quoteIdent(def.name)} ${def.type || "TEXT"}`;
    // SQLite: adding a NOT NULL column requires a default.
    if (!def.nullable) sql += ` NOT NULL DEFAULT ${sqliteDefaultLiteral(def.default ?? "")}`;
    else if (def.default !== null && def.default !== undefined && def.default !== "") sql += ` DEFAULT ${sqliteDefaultLiteral(def.default)}`;
    return this.run(database, sql, `Column "${def.name}" added.`);
  }

  async changeColumn(database: string, table: string, oldName: string, def: ColumnDef): Promise<ExecResult> {
    // SQLite can only rename a column (not retype it) without rebuilding the table.
    if (def.name !== oldName) {
      return this.run(database, `ALTER TABLE ${quoteIdent(table)} RENAME COLUMN ${quoteIdent(oldName)} TO ${quoteIdent(def.name)}`, `Column renamed to "${def.name}".`);
    }
    return { affectedRows: 0, message: "SQLite can only rename columns — type/constraint changes need a table rebuild." };
  }

  async dropColumn(database: string, table: string, column: string): Promise<ExecResult> {
    return this.run(database, `ALTER TABLE ${quoteIdent(table)} DROP COLUMN ${quoteIdent(column)}`, `Column "${column}" dropped.`);
  }

  async addIndex(database: string, table: string, def: IndexDef): Promise<ExecResult> {
    if (def.kind === "primary") throw new NotSupportedError(this.engine, "adding a primary key to an existing table");
    const cols = def.columns.map(quoteIdent).join(", ");
    return this.run(database, `CREATE ${def.kind === "unique" ? "UNIQUE " : ""}INDEX ${quoteIdent(def.name)} ON ${quoteIdent(table)} (${cols})`, "Index added.");
  }

  async dropIndex(database: string, _table: string, name: string): Promise<ExecResult> {
    return this.run(database, `DROP INDEX IF EXISTS ${quoteIdent(name)}`, `Index "${name}" dropped.`);
  }

  async createTable(database: string, name: string, columns: ColumnDef[], primaryKey: string[]): Promise<ExecResult> {
    // A single auto-increment PK column must be declared inline as `INTEGER PRIMARY KEY AUTOINCREMENT`.
    const autoPk = primaryKey.length === 1 && columns.find((c) => c.name === primaryKey[0])?.autoIncrement;
    const defs = columns.map((c) => {
      if (autoPk && c.name === primaryKey[0]) return `${quoteIdent(c.name)} INTEGER PRIMARY KEY AUTOINCREMENT`;
      let s = `${quoteIdent(c.name)} ${c.type || "TEXT"}`;
      if (!c.nullable) s += " NOT NULL";
      if (c.default !== null && c.default !== undefined && c.default !== "") s += ` DEFAULT ${sqliteDefaultLiteral(c.default)}`;
      return s;
    });
    if (primaryKey.length && !autoPk) defs.push(`PRIMARY KEY (${primaryKey.map(quoteIdent).join(", ")})`);
    return this.run(database, `CREATE TABLE ${quoteIdent(name)} (${defs.join(", ")})`, `Table "${name}" created.`);
  }

  async dumpTableSql(database: string, table: string): Promise<string> {
    const db = this.open(database);
    try {
      const createRow = db
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .get(table) as { sql: string } | undefined;
      const createSql = createRow?.sql ?? "";
      const rows = db.prepare(`SELECT * FROM ${quoteIdent(table)}`).all() as Record<string, unknown>[];
      const cols = rows.length ? Object.keys(rows[0]) : this.columnsOf(db, table).map((c) => c.Field);
      return buildTableDump(table, createSql, cols, rows, quoteIdent, genericSqlLiteral);
    } finally {
      db.close();
    }
  }

  // ---- database objects (views + triggers; SQLite has no stored routines) ----

  async listDatabaseObjects(database: string): Promise<DatabaseObjects> {
    const db = this.open(database);
    try {
      const viewRows = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'view' ORDER BY name`).all() as Array<{ name: string; sql: string }>;
      const views = viewRows.map((r) => ({ name: r.name, definition: r.sql ?? "", meta: "VIEW" }));
      const trigRows = db.prepare(`SELECT name, sql, tbl_name FROM sqlite_master WHERE type = 'trigger' ORDER BY name`).all() as Array<{ name: string; sql: string; tbl_name: string }>;
      const triggers = trigRows.map((r) => ({ name: r.name, definition: r.sql ?? "", meta: `on ${r.tbl_name}`, table: r.tbl_name }));
      return { views, routines: [], triggers };
    } finally {
      db.close();
    }
  }

  async dropObject(database: string, kind: DatabaseObjectKind, object: DatabaseObject): Promise<ExecResult> {
    if (kind === "view") return this.run(database, `DROP VIEW IF EXISTS ${quoteIdent(object.name)}`, `view "${object.name}" dropped.`);
    if (kind === "trigger") return this.run(database, `DROP TRIGGER IF EXISTS ${quoteIdent(object.name)}`, `trigger "${object.name}" dropped.`);
    throw new NotSupportedError(this.engine, "dropping routines");
  }

  // ---- table operations ----

  async truncateTable(database: string, table: string): Promise<ExecResult> {
    // SQLite has no TRUNCATE.
    return this.run(database, `DELETE FROM ${quoteIdent(table)}`, `Table "${table}" emptied.`);
  }
  async renameTable(database: string, table: string, newName: string): Promise<ExecResult> {
    return this.run(database, `ALTER TABLE ${quoteIdent(table)} RENAME TO ${quoteIdent(newName)}`, `Renamed to "${newName}".`);
  }
  async dropTable(database: string, table: string): Promise<ExecResult> {
    return this.run(database, `DROP TABLE ${quoteIdent(table)}`, `Table "${table}" dropped.`);
  }
}

/** A DEFAULT value literal for SQLite: keywords/numbers raw, else quoted. */
function sqliteDefaultLiteral(value: string): string {
  const raw = /^(current_timestamp|current_date|current_time|null|true|false|-?\d+(\.\d+)?)$/i;
  return raw.test(value.trim()) ? value : `'${value.replace(/'/g, "''")}'`;
}

function makeKeyInfo(
  table: string,
  keyName: string,
  column: string,
  nonUnique: number,
  seq: number
): KeyInfo {
  return {
    Table: table,
    Non_unique: nonUnique,
    Key_name: keyName,
    Seq_in_index: seq,
    Column_name: column,
    Collation: null,
    Cardinality: null,
    Sub_part: null,
    Packed: null,
    Null: "",
    Index_type: "BTREE",
    Comment: "",
  };
}
