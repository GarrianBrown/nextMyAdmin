import mysql from "mysql2/promise";
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
import { getCapabilities } from "./capabilities";
import { friendlyConnectionError } from "./errors";
import {
  splitStatements,
  parseSingleTableSelect,
  stripTrailingLimit,
  rowsToCsv,
  buildWhereClause,
  buildTableDump,
} from "./sql-utils";

/**
 * MySQL / MariaDB driver. Holds no persistent connection: each method opens a
 * fresh connection and closes it, matching the original per-request model.
 */
export class MysqlDriver implements DatabaseDriver {
  readonly engine: Engine;
  readonly capabilities: DriverCapabilities;

  constructor(private readonly config: ServerConfig) {
    this.engine = config.engine === "mariadb" ? "mariadb" : "mysql";
    this.capabilities = getCapabilities(this.engine);
  }

  private async connect(database?: string) {
    let connection;
    try {
      if (this.config.url) {
        // Connect via a full connection string. Ensure multi-statement support
        // (the query editor runs scripts) and optionally switch database.
        const url = new URL(this.config.url);
        if (!url.searchParams.has("multipleStatements")) url.searchParams.set("multipleStatements", "true");
        if (database) url.pathname = `/${database}`;
        connection = await mysql.createConnection(url.toString());
      } else {
        connection = await mysql.createConnection({
          host: this.config.host,
          port: this.config.port,
          user: this.config.user,
          password: this.config.password,
          database: database || this.config.database || undefined,
          multipleStatements: true,
          ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
        });
      }
    } catch (err) {
      throw friendlyConnectionError(err, this.engine);
    }

    // mysql2 hardcodes collation_connection to utf8mb4_unicode_ci, which differs from
    // the server default (utf8mb4_0900_ai_ci on MySQL 8). String literals are coercible
    // so `col = 'x'` still works, but a user variable is *implicit* like a column — so
    // `col = @var` throws "Illegal mix of collations". Align the session to the server's
    // own default (what the mysql CLI does via SET NAMES) so user variables just work.
    // @@collation_database resolves to the server default when no database is selected.
    try {
      await connection.query("SET collation_connection = @@collation_database");
    } catch {
      // Older/non-standard servers may reject this; the connection is still usable.
    }

    return connection;
  }

  async listDatabases(): Promise<string[]> {
    const connection = await this.connect();
    try {
      const [rows] = await connection.query("SHOW DATABASES");
      return (rows as { Database: string }[]).map((r) => r.Database);
    } finally {
      await connection.end();
    }
  }

  async createDatabase(name: string): Promise<void> {
    const connection = await this.connect();
    try {
      await connection.query(`CREATE DATABASE ${connection.escapeId(name)}`);
    } finally {
      await connection.end();
    }
  }

  async dropDatabase(name: string): Promise<void> {
    const connection = await this.connect();
    try {
      await connection.query(`DROP DATABASE ${connection.escapeId(name)}`);
    } finally {
      await connection.end();
    }
  }

  async listTables(database: string): Promise<string[]> {
    const connection = await this.connect(database);
    try {
      const [rows] = await connection.query("SHOW TABLES");
      const key = `Tables_in_${database}`;
      return (rows as Record<string, string>[]).map((r) => r[key]);
    } finally {
      await connection.end();
    }
  }

  async getTableStructure(database: string, table: string): Promise<TableStructure> {
    const connection = await this.connect(database);
    try {
      const [columns] = await connection.query(`DESCRIBE ${connection.escapeId(table)}`);
      const [indexes] = await connection.query(`SHOW INDEX FROM ${connection.escapeId(table)}`);
      const [foreignKeys] = await connection.query(
        `SELECT kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_SCHEMA, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME, rc.UPDATE_RULE, rc.DELETE_RULE
         FROM information_schema.KEY_COLUMN_USAGE kcu
         JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
           ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
           AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA
         WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
        [database, table]
      );
      return {
        columns: columns as ColumnInfo[],
        indexes: indexes as KeyInfo[],
        foreignKeys: foreignKeys as ForeignKeyInfo[],
      };
    } finally {
      await connection.end();
    }
  }

  async browseTable(
    database: string,
    table: string,
    options: BrowseOptions
  ): Promise<BrowseResult> {
    const connection = await this.connect(database);
    try {
      const where = buildWhereClause(options.filters, (n) => connection.escapeId(n), () => "?");
      const whereSql = where.clause ? ` ${where.clause}` : "";

      const [countResult] = await connection.query(
        `SELECT COUNT(*) as total FROM ${connection.escapeId(table)}${whereSql}`,
        where.params
      );
      const totalRows = (countResult as { total: number }[])[0].total;
      const totalPages = Math.ceil(totalRows / options.pageSize);

      let query = `SELECT * FROM ${connection.escapeId(table)}${whereSql}`;

      if (options.sortColumn) {
        const [describeRows] = await connection.query(
          `DESCRIBE ${connection.escapeId(table)}`
        );
        const validColumns = (describeRows as ColumnInfo[]).map((c) => c.Field);
        if (validColumns.includes(options.sortColumn)) {
          const direction = options.sortDirection === "desc" ? "DESC" : "ASC";
          query += ` ORDER BY ${connection.escapeId(options.sortColumn)} ${direction}`;
        }
      }

      const offset = (options.page - 1) * options.pageSize;
      query += ` LIMIT ${options.pageSize} OFFSET ${offset}`;

      const startTime = performance.now();
      const [rows, fields] = await connection.query(query, where.params);
      const executionTime = parseFloat((performance.now() - startTime).toFixed(2));

      const fieldNames = fields
        ? (fields as { name: string }[]).map((f) => f.name)
        : [];

      return {
        rows: rows as Record<string, unknown>[],
        fields: fieldNames,
        totalRows,
        page: options.page,
        pageSize: options.pageSize,
        totalPages,
        executionTime,
      };
    } finally {
      await connection.end();
    }
  }

  async insertRow(
    database: string,
    table: string,
    values: Record<string, unknown>
  ): Promise<ExecResult> {
    const connection = await this.connect(database);
    try {
      const cols = Object.keys(values);
      const columnList = cols.map((c) => connection.escapeId(c)).join(", ");
      const placeholders = cols.map(() => "?").join(", ");
      const sql = `INSERT INTO ${connection.escapeId(table)} (${columnList}) VALUES (${placeholders})`;
      const [result] = await connection.query(sql, Object.values(values));
      const execResult = result as { affectedRows?: number; insertId?: number };
      return {
        affectedRows: execResult.affectedRows ?? 0,
        insertId: execResult.insertId ?? null,
        message: `${execResult.affectedRows ?? 0} row(s) inserted.`,
      };
    } finally {
      await connection.end();
    }
  }

  async updateRow(
    database: string,
    table: string,
    primaryKeys: Record<string, unknown>,
    updates: Record<string, unknown>
  ): Promise<ExecResult> {
    const connection = await this.connect(database);
    try {
      const setClauses = Object.keys(updates).map((col) => `${connection.escapeId(col)} = ?`);
      const whereClauses = Object.keys(primaryKeys).map((col) => `${connection.escapeId(col)} = ?`);
      const values = [...Object.values(updates), ...Object.values(primaryKeys)];
      const sql = `UPDATE ${connection.escapeId(table)} SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")} LIMIT 1`;
      const [result] = await connection.query(sql, values);
      const execResult = result as { affectedRows?: number };
      return {
        affectedRows: execResult.affectedRows ?? 0,
        message: `${execResult.affectedRows ?? 0} row(s) updated.`,
      };
    } finally {
      await connection.end();
    }
  }

  async deleteRow(
    database: string,
    table: string,
    primaryKeys: Record<string, unknown>
  ): Promise<ExecResult> {
    const connection = await this.connect(database);
    try {
      const whereClauses = Object.keys(primaryKeys).map((col) => `${connection.escapeId(col)} = ?`);
      const sql = `DELETE FROM ${connection.escapeId(table)} WHERE ${whereClauses.join(" AND ")} LIMIT 1`;
      const [result] = await connection.query(sql, Object.values(primaryKeys));
      const execResult = result as { affectedRows?: number };
      return {
        affectedRows: execResult.affectedRows ?? 0,
        message: `${execResult.affectedRows ?? 0} row(s) deleted.`,
      };
    } finally {
      await connection.end();
    }
  }

  async runQuery(
    database: string,
    query: string,
    options: RunQueryOptions
  ): Promise<RunQueryResult> {
    const connection = await this.connect(database);
    try {
      const statements = splitStatements(query);
      if (statements.length === 0) {
        throw new Error("No SQL statements found");
      }

      await connection.query(`USE ${connection.escapeId(database)}`);

      const lastStatement = statements[statements.length - 1];
      const isLastSelect = /^\s*(select|show|describe|desc|explain)\b/i.test(lastStatement);
      const prefixStmts = statements.slice(0, -1);
      const currentPage = Math.max(1, options.page ?? 1);
      const pageSize = Math.max(1, Math.min(1000, options.pageSize ?? 25));

      let prefixAffectedRows = 0;
      for (const stmt of prefixStmts) {
        const [result] = await connection.query(stmt);
        if (!Array.isArray(result)) {
          prefixAffectedRows += (result as { affectedRows?: number }).affectedRows ?? 0;
        }
      }

      const startTime = performance.now();

      if (isLastSelect && /^\s*select\b/i.test(lastStatement)) {
        const baseSql = stripTrailingLimit(lastStatement);

        let totalRows: number | null = null;
        try {
          const countSql = `SELECT COUNT(*) as total FROM (${baseSql}) AS _count_sub`;
          const [countResult] = await connection.query(countSql);
          if (Array.isArray(countResult) && countResult.length > 0) {
            totalRows = Number((countResult[0] as { total: number }).total);
          }
        } catch {
          // Count failed for complex query — skip pagination metadata
        }

        if (options.download === "csv") {
          const [csvResults] = await connection.query(lastStatement);
          const csvRows = Array.isArray(csvResults)
            ? (csvResults as Record<string, unknown>[])
            : [];
          const csvFields = csvRows.length > 0 ? Object.keys(csvRows[0]) : [];
          return { type: "csv", content: rowsToCsv(csvRows, csvFields) };
        }

        const offset = (currentPage - 1) * pageSize;
        const paginatedSql = `${baseSql} LIMIT ${pageSize} OFFSET ${offset}`;
        const [results] = await connection.query(paginatedSql);
        const executionTime = parseFloat((performance.now() - startTime).toFixed(2));

        const rows = Array.isArray(results) ? (results as Record<string, unknown>[]) : [];
        const fields = rows.length > 0 ? Object.keys(rows[0]) : [];

        let editable: EditableInfo | undefined;
        const tableName = parseSingleTableSelect(lastStatement);
        if (tableName) {
          try {
            const [pkRows] = await connection.query(
              `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
               WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
               ORDER BY ORDINAL_POSITION`,
              [database, tableName]
            );
            const primaryKeys = (pkRows as Array<{ COLUMN_NAME: string }>).map(
              (r) => r.COLUMN_NAME
            );
            if (primaryKeys.length > 0 && primaryKeys.every((pk) => fields.includes(pk))) {
              const [colRows] = await connection.query(
                `DESCRIBE ${connection.escapeId(tableName)}`
              );
              editable = {
                table: tableName,
                primaryKeys,
                columns: colRows as ColumnInfo[],
              };
            }
          } catch {
            // Couldn't determine editability — leave undefined
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
          ...(prefixStmts.length > 0
            ? { prefixStatements: prefixStmts.length, prefixAffectedRows }
            : {}),
        };
      }

      // Non-paginated result-set queries (SHOW, DESCRIBE, EXPLAIN) or non-SELECT
      const [results] = await connection.query(lastStatement);
      const executionTime = parseFloat((performance.now() - startTime).toFixed(2));

      if (Array.isArray(results)) {
        const rows = results as Record<string, unknown>[];
        const fields = rows.length > 0 ? Object.keys(rows[0]) : [];
        return {
          type: "select",
          rows,
          fields,
          executionTime,
          ...(prefixStmts.length > 0
            ? { prefixStatements: prefixStmts.length, prefixAffectedRows }
            : {}),
        };
      }

      const execResult = results as { affectedRows?: number };
      const totalAffected = prefixAffectedRows + (execResult.affectedRows ?? 0);
      return {
        type: "execute",
        affectedRows: totalAffected,
        message: `${statements.length > 1 ? `${statements.length} statements executed. ` : "Query executed successfully. "}${totalAffected} row(s) affected.`,
        executionTime,
      };
    } finally {
      await connection.end();
    }
  }

  // ---- schema editing ----

  private columnSql(conn: mysql.Connection, def: ColumnDef): string {
    let sql = `${conn.escapeId(def.name)} ${def.type}`;
    sql += def.nullable ? " NULL" : " NOT NULL";
    if (def.default !== null && def.default !== undefined && def.default !== "") {
      sql += ` DEFAULT ${defaultLiteral(conn, def.default)}`;
    }
    if (def.autoIncrement) sql += " AUTO_INCREMENT";
    return sql;
  }

  async addColumn(database: string, table: string, def: ColumnDef): Promise<ExecResult> {
    const conn = await this.connect(database);
    try {
      await conn.query(`ALTER TABLE ${conn.escapeId(table)} ADD COLUMN ${this.columnSql(conn, def)}`);
      return { affectedRows: 0, message: `Column "${def.name}" added.` };
    } finally {
      await conn.end();
    }
  }

  async changeColumn(database: string, table: string, oldName: string, def: ColumnDef): Promise<ExecResult> {
    const conn = await this.connect(database);
    try {
      await conn.query(`ALTER TABLE ${conn.escapeId(table)} CHANGE ${conn.escapeId(oldName)} ${this.columnSql(conn, def)}`);
      return { affectedRows: 0, message: `Column "${oldName}" updated.` };
    } finally {
      await conn.end();
    }
  }

  async dropColumn(database: string, table: string, column: string): Promise<ExecResult> {
    const conn = await this.connect(database);
    try {
      await conn.query(`ALTER TABLE ${conn.escapeId(table)} DROP COLUMN ${conn.escapeId(column)}`);
      return { affectedRows: 0, message: `Column "${column}" dropped.` };
    } finally {
      await conn.end();
    }
  }

  async addIndex(database: string, table: string, def: IndexDef): Promise<ExecResult> {
    const conn = await this.connect(database);
    try {
      const cols = def.columns.map((c) => conn.escapeId(c)).join(", ");
      const t = conn.escapeId(table);
      const sql =
        def.kind === "primary"
          ? `ALTER TABLE ${t} ADD PRIMARY KEY (${cols})`
          : `CREATE ${def.kind === "unique" ? "UNIQUE " : ""}INDEX ${conn.escapeId(def.name)} ON ${t} (${cols})`;
      await conn.query(sql);
      return { affectedRows: 0, message: `Index added.` };
    } finally {
      await conn.end();
    }
  }

  async dropIndex(database: string, table: string, name: string): Promise<ExecResult> {
    const conn = await this.connect(database);
    try {
      const t = conn.escapeId(table);
      const sql = name === "PRIMARY" ? `ALTER TABLE ${t} DROP PRIMARY KEY` : `ALTER TABLE ${t} DROP INDEX ${conn.escapeId(name)}`;
      await conn.query(sql);
      return { affectedRows: 0, message: `Index "${name}" dropped.` };
    } finally {
      await conn.end();
    }
  }

  async createTable(database: string, name: string, columns: ColumnDef[], primaryKey: string[]): Promise<ExecResult> {
    const conn = await this.connect(database);
    try {
      const defs = columns.map((c) => this.columnSql(conn, c));
      if (primaryKey.length) defs.push(`PRIMARY KEY (${primaryKey.map((c) => conn.escapeId(c)).join(", ")})`);
      await conn.query(`CREATE TABLE ${conn.escapeId(name)} (${defs.join(", ")})`);
      return { affectedRows: 0, message: `Table "${name}" created.` };
    } finally {
      await conn.end();
    }
  }

  async dumpTableSql(database: string, table: string): Promise<string> {
    const conn = await this.connect(database);
    try {
      const [createRows] = await conn.query(`SHOW CREATE TABLE ${conn.escapeId(table)}`);
      const createSql = (createRows as Array<Record<string, string>>)[0]["Create Table"] ?? "";
      const [rows] = await conn.query(`SELECT * FROM ${conn.escapeId(table)}`);
      const dataRows = rows as Record<string, unknown>[];
      const cols = dataRows.length ? Object.keys(dataRows[0]) : [];
      return buildTableDump(table, createSql, cols, dataRows, (n) => conn.escapeId(n), (v) => conn.escape(v));
    } finally {
      await conn.end();
    }
  }

  // ---- database objects (views / routines / triggers) ----

  async listDatabaseObjects(database: string): Promise<DatabaseObjects> {
    const conn = await this.connect(database);
    try {
      const [viewRows] = await conn.query(
        `SELECT TABLE_NAME AS name, VIEW_DEFINITION AS def
           FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
        [database]
      );
      const views = (viewRows as Array<Record<string, string>>).map((r) => ({
        name: r.name,
        definition: r.def ?? "",
        meta: "VIEW",
      }));

      const [routineRows] = await conn.query(
        `SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type, ROUTINE_DEFINITION AS def
           FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_NAME`,
        [database]
      );
      const routines = (routineRows as Array<Record<string, string>>).map((r) => ({
        name: r.name,
        definition: r.def ?? "",
        meta: r.type,
        routineType: r.type,
      }));

      const [triggerRows] = await conn.query(
        `SELECT TRIGGER_NAME AS name, ACTION_TIMING AS timing, EVENT_MANIPULATION AS event,
                EVENT_OBJECT_TABLE AS tbl, ACTION_STATEMENT AS stmt
           FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME`,
        [database]
      );
      const triggers = (triggerRows as Array<Record<string, string>>).map((r) => ({
        name: r.name,
        definition: r.stmt ?? "",
        meta: `${r.timing} ${r.event} on ${r.tbl}`,
        table: r.tbl,
      }));

      return { views, routines, triggers };
    } finally {
      await conn.end();
    }
  }

  async dropObject(database: string, kind: DatabaseObjectKind, object: DatabaseObject): Promise<ExecResult> {
    const conn = await this.connect(database);
    try {
      let sql: string;
      if (kind === "view") sql = `DROP VIEW IF EXISTS ${conn.escapeId(object.name)}`;
      else if (kind === "trigger") sql = `DROP TRIGGER IF EXISTS ${conn.escapeId(object.name)}`;
      else {
        const t = (object.routineType || "PROCEDURE").toUpperCase() === "FUNCTION" ? "FUNCTION" : "PROCEDURE";
        sql = `DROP ${t} IF EXISTS ${conn.escapeId(object.name)}`;
      }
      await conn.query(sql);
      return { affectedRows: 0, message: `${kind} "${object.name}" dropped.` };
    } finally {
      await conn.end();
    }
  }

  // ---- table operations ----

  truncateTable(database: string, table: string): Promise<ExecResult> {
    return this.connect(database).then(async (conn) => {
      try {
        await conn.query(`TRUNCATE TABLE ${conn.escapeId(table)}`);
        return { affectedRows: 0, message: `Table "${table}" truncated.` };
      } finally {
        await conn.end();
      }
    });
  }

  renameTable(database: string, table: string, newName: string): Promise<ExecResult> {
    return this.connect(database).then(async (conn) => {
      try {
        await conn.query(`RENAME TABLE ${conn.escapeId(table)} TO ${conn.escapeId(newName)}`);
        return { affectedRows: 0, message: `Renamed to "${newName}".` };
      } finally {
        await conn.end();
      }
    });
  }

  dropTable(database: string, table: string): Promise<ExecResult> {
    return this.connect(database).then(async (conn) => {
      try {
        await conn.query(`DROP TABLE ${conn.escapeId(table)}`);
        return { affectedRows: 0, message: `Table "${table}" dropped.` };
      } finally {
        await conn.end();
      }
    });
  }
}

/** A DEFAULT value literal: keywords/expressions raw, everything else quoted. */
function defaultLiteral(conn: mysql.Connection, value: string): string {
  const raw = /^(current_timestamp(\(\))?|now\(\)|null|true|false|-?\d+(\.\d+)?)$/i;
  return raw.test(value.trim()) ? value : conn.escape(value);
}
