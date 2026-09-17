import { Client } from "pg";
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
import { friendlyConnectionError } from "./errors";
import {
  splitStatements,
  parseSingleTableSelect,
  stripTrailingLimit,
  rowsToCsv,
  buildWhereClause,
  buildTableDump,
  genericSqlLiteral,
} from "./sql-utils";

/** Quote a Postgres identifier (double quotes, embedded quotes doubled). */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** A Postgres string literal, for building a ::regclass argument. */
function regclassArg(table: string): string {
  return `public.${quoteIdent(table)}`;
}

/**
 * PostgreSQL driver. Maps Postgres' catalog onto the MySQL-shaped result types
 * the front-end expects (ColumnInfo with Field/Type/Null/Key/Default/Extra,
 * etc). Scoped to the `public` schema for this first iteration.
 */
export class PostgresDriver implements DatabaseDriver {
  readonly engine: Engine = "postgres";
  readonly capabilities: DriverCapabilities = CAPABILITIES.postgres;

  constructor(private readonly config: ServerConfig) {}

  private get defaultDatabase(): string {
    return this.config.defaultDatabase || "postgres";
  }

  private async connect(database?: string): Promise<Client> {
    const client = this.config.url
      ? new Client({
          connectionString: this.config.url,
          // Override the target database when browsing a specific one.
          ...(database ? { database } : {}),
          ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
        })
      : new Client({
          host: this.config.host,
          port: this.config.port,
          user: this.config.user,
          password: this.config.password,
          database: database || this.defaultDatabase,
          ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
        });
    try {
      await client.connect();
    } catch (err) {
      throw friendlyConnectionError(err, this.engine);
    }
    return client;
  }

  async listDatabases(): Promise<string[]> {
    const client = await this.connect();
    try {
      const res = await client.query(
        "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"
      );
      return res.rows.map((r) => r.datname as string);
    } finally {
      await client.end();
    }
  }

  async createDatabase(name: string): Promise<void> {
    const client = await this.connect();
    try {
      await client.query(`CREATE DATABASE ${quoteIdent(name)}`);
    } finally {
      await client.end();
    }
  }

  async dropDatabase(name: string): Promise<void> {
    const client = await this.connect();
    try {
      await client.query(`DROP DATABASE ${quoteIdent(name)}`);
    } finally {
      await client.end();
    }
  }

  async listTables(database: string): Promise<string[]> {
    const client = await this.connect(database);
    try {
      const res = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type IN ('BASE TABLE', 'VIEW')
         ORDER BY table_name`
      );
      return res.rows.map((r) => r.table_name as string);
    } finally {
      await client.end();
    }
  }

  async getTableStructure(database: string, table: string): Promise<TableStructure> {
    const client = await this.connect(database);
    try {
      const columns = await this.fetchColumns(client, table);
      const indexes = await this.fetchIndexes(client, table);
      const foreignKeys = await this.fetchForeignKeys(client, table);
      return { columns, indexes, foreignKeys };
    } finally {
      await client.end();
    }
  }

  /** Column metadata shaped like MySQL's DESCRIBE (Field/Type/Null/Key/Default/Extra). */
  private async fetchColumns(client: Client, table: string): Promise<ColumnInfo[]> {
    const res = await client.query(
      `SELECT
         a.attname AS field,
         format_type(a.atttypid, a.atttypmod) AS type,
         CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS "null",
         pg_get_expr(ad.adbin, ad.adrelid) AS "default",
         CASE
           WHEN a.attidentity <> '' THEN 'auto_increment'
           WHEN pg_get_expr(ad.adbin, ad.adrelid) LIKE 'nextval(%' THEN 'auto_increment'
           ELSE ''
         END AS extra,
         a.attnum AS ordinal
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
       WHERE c.relname = $1 AND n.nspname = 'public'
         AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum`,
      [table]
    );

    // Primary-key and unique columns, to fill the MySQL-style Key column.
    const pkCols = await this.fetchKeyColumns(client, table, "i.indisprimary");
    const uniqueCols = await this.fetchKeyColumns(
      client,
      table,
      "i.indisunique AND NOT i.indisprimary"
    );

    return res.rows.map((r) => {
      const field = r.field as string;
      let key = "";
      if (pkCols.has(field)) key = "PRI";
      else if (uniqueCols.has(field)) key = "UNI";
      return {
        Field: field,
        Type: r.type as string,
        Null: r.null as string,
        Key: key,
        Default: (r.default as string | null) ?? null,
        Extra: r.extra as string,
      };
    });
  }

  private async fetchKeyColumns(
    client: Client,
    table: string,
    predicate: string
  ): Promise<Set<string>> {
    const res = await client.query(
      `SELECT a.attname
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND ${predicate}`,
      [regclassArg(table)]
    );
    return new Set(res.rows.map((r) => r.attname as string));
  }

  private async fetchIndexes(client: Client, table: string): Promise<KeyInfo[]> {
    const res = await client.query(
      `SELECT
         ic.relname AS key_name,
         a.attname AS column_name,
         CASE WHEN i.indisunique THEN 0 ELSE 1 END AS non_unique,
         am.amname AS index_type,
         kk.ord AS seq_in_index
       FROM pg_index i
       JOIN pg_class ic ON ic.oid = i.indexrelid
       JOIN pg_class tc ON tc.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = tc.relnamespace
       JOIN pg_am am ON am.oid = ic.relam
       JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS kk(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = kk.attnum
       WHERE tc.relname = $1 AND n.nspname = 'public'
       ORDER BY ic.relname, kk.ord`,
      [table]
    );
    return res.rows.map((r) => ({
      Table: table,
      Non_unique: Number(r.non_unique),
      Key_name: r.key_name as string,
      Seq_in_index: Number(r.seq_in_index),
      Column_name: r.column_name as string,
      Collation: null,
      Cardinality: null,
      Sub_part: null,
      Packed: null,
      Null: "",
      Index_type: r.index_type as string,
      Comment: "",
    }));
  }

  private async fetchForeignKeys(client: Client, table: string): Promise<ForeignKeyInfo[]> {
    const res = await client.query(
      `SELECT
         tc.constraint_name,
         kcu.column_name,
         ccu.table_schema AS referenced_table_schema,
         ccu.table_name AS referenced_table_name,
         ccu.column_name AS referenced_column_name,
         rc.update_rule,
         rc.delete_rule
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       JOIN information_schema.referential_constraints rc
         ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_name = $1 AND tc.table_schema = 'public'`,
      [table]
    );
    return res.rows.map((r) => ({
      CONSTRAINT_NAME: r.constraint_name as string,
      COLUMN_NAME: r.column_name as string,
      REFERENCED_TABLE_SCHEMA: r.referenced_table_schema as string,
      REFERENCED_TABLE_NAME: r.referenced_table_name as string,
      REFERENCED_COLUMN_NAME: r.referenced_column_name as string,
      UPDATE_RULE: r.update_rule as string,
      DELETE_RULE: r.delete_rule as string,
    }));
  }

  private async fetchPrimaryKeys(client: Client, table: string): Promise<string[]> {
    const res = await client.query(
      `SELECT a.attname, array_position(i.indkey, a.attnum) AS pos
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisprimary
       ORDER BY pos`,
      [regclassArg(table)]
    );
    return res.rows.map((r) => r.attname as string);
  }

  async browseTable(
    database: string,
    table: string,
    options: BrowseOptions
  ): Promise<BrowseResult> {
    const client = await this.connect(database);
    try {
      const where = buildWhereClause(options.filters, quoteIdent, (i) => `$${i + 1}`);
      const whereSql = where.clause ? ` ${where.clause}` : "";

      const countRes = await client.query(
        `SELECT COUNT(*) AS total FROM ${quoteIdent(table)}${whereSql}`,
        where.params
      );
      const totalRows = Number(countRes.rows[0].total);
      const totalPages = Math.ceil(totalRows / options.pageSize);

      let query = `SELECT * FROM ${quoteIdent(table)}${whereSql}`;

      if (options.sortColumn) {
        const validColumns = (await this.fetchColumns(client, table)).map((c) => c.Field);
        if (validColumns.includes(options.sortColumn)) {
          const direction = options.sortDirection === "desc" ? "DESC" : "ASC";
          query += ` ORDER BY ${quoteIdent(options.sortColumn)} ${direction}`;
        }
      }

      const offset = (options.page - 1) * options.pageSize;
      query += ` LIMIT ${options.pageSize} OFFSET ${offset}`;

      const startTime = performance.now();
      const res = await client.query(query, where.params);
      const executionTime = parseFloat((performance.now() - startTime).toFixed(2));

      return {
        rows: res.rows as Record<string, unknown>[],
        fields: res.fields.map((f) => f.name),
        totalRows,
        page: options.page,
        pageSize: options.pageSize,
        totalPages,
        executionTime,
      };
    } finally {
      await client.end();
    }
  }

  async insertRow(
    database: string,
    table: string,
    values: Record<string, unknown>
  ): Promise<ExecResult> {
    const client = await this.connect(database);
    try {
      const cols = Object.keys(values);
      const columnList = cols.map(quoteIdent).join(", ");
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      const sql = `INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES (${placeholders})`;
      const res = await client.query(sql, Object.values(values));
      return {
        affectedRows: res.rowCount ?? 0,
        insertId: null,
        message: `${res.rowCount ?? 0} row(s) inserted.`,
      };
    } finally {
      await client.end();
    }
  }

  async insertRows(database: string, table: string, columns: string[], rows: unknown[][]): Promise<ExecResult> {
    if (rows.length === 0) return { affectedRows: 0, message: "No rows to import." };
    const client = await this.connect(database);
    try {
      const columnList = columns.map(quoteIdent).join(", ");
      // Postgres caps a statement at ~65535 params — batch the multi-row INSERT.
      const batchSize = Math.max(1, Math.floor(60000 / Math.max(1, columns.length)));
      let inserted = 0;
      for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize);
        const params: unknown[] = [];
        const rowsSql = chunk.map((row) => {
          const ph = columns.map((_, ci) => `$${params.length + ci + 1}`);
          for (let ci = 0; ci < columns.length; ci++) params.push(row[ci]);
          return `(${ph.join(", ")})`;
        });
        const res = await client.query(`INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES ${rowsSql.join(", ")}`, params);
        inserted += res.rowCount ?? 0;
      }
      return { affectedRows: inserted, message: `${inserted} row(s) imported.` };
    } finally {
      await client.end();
    }
  }

  async updateRow(
    database: string,
    table: string,
    primaryKeys: Record<string, unknown>,
    updates: Record<string, unknown>
  ): Promise<ExecResult> {
    const client = await this.connect(database);
    try {
      const updateKeys = Object.keys(updates);
      const pkKeys = Object.keys(primaryKeys);
      const setClauses = updateKeys.map((col, i) => `${quoteIdent(col)} = $${i + 1}`);
      const whereClauses = pkKeys.map(
        (col, i) => `${quoteIdent(col)} = $${updateKeys.length + i + 1}`
      );
      const params = [...Object.values(updates), ...Object.values(primaryKeys)];
      // Postgres has no UPDATE ... LIMIT; the PK predicate already targets one row.
      const sql = `UPDATE ${quoteIdent(table)} SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")}`;
      const res = await client.query(sql, params);
      return {
        affectedRows: res.rowCount ?? 0,
        message: `${res.rowCount ?? 0} row(s) updated.`,
      };
    } finally {
      await client.end();
    }
  }

  async deleteRow(
    database: string,
    table: string,
    primaryKeys: Record<string, unknown>
  ): Promise<ExecResult> {
    const client = await this.connect(database);
    try {
      const pkKeys = Object.keys(primaryKeys);
      const whereClauses = pkKeys.map((col, i) => `${quoteIdent(col)} = $${i + 1}`);
      const sql = `DELETE FROM ${quoteIdent(table)} WHERE ${whereClauses.join(" AND ")}`;
      const res = await client.query(sql, Object.values(primaryKeys));
      return {
        affectedRows: res.rowCount ?? 0,
        message: `${res.rowCount ?? 0} row(s) deleted.`,
      };
    } finally {
      await client.end();
    }
  }

  async runQuery(
    database: string,
    query: string,
    options: RunQueryOptions
  ): Promise<RunQueryResult> {
    const client = await this.connect(database);
    try {
      const statements = splitStatements(query);
      if (statements.length === 0) {
        throw new Error("No SQL statements found");
      }

      const lastStatement = statements[statements.length - 1];
      const prefixStmts = statements.slice(0, -1);
      const currentPage = Math.max(1, options.page ?? 1);
      const pageSize = Math.max(1, Math.min(1000, options.pageSize ?? 25));

      let prefixAffectedRows = 0;
      for (const stmt of prefixStmts) {
        const r = await client.query(stmt);
        if (!r.fields || r.fields.length === 0) {
          prefixAffectedRows += r.rowCount ?? 0;
        }
      }

      const startTime = performance.now();

      if (/^\s*select\b/i.test(lastStatement)) {
        const baseSql = stripTrailingLimit(lastStatement);

        let totalRows: number | null = null;
        try {
          const countRes = await client.query(
            `SELECT COUNT(*) AS total FROM (${baseSql}) AS _count_sub`
          );
          totalRows = Number(countRes.rows[0].total);
        } catch {
          // Count failed for complex query — skip pagination metadata
        }

        if (options.download === "csv") {
          const csvRes = await client.query(lastStatement);
          const csvRows = csvRes.rows as Record<string, unknown>[];
          const csvFields = csvRes.fields.map((f) => f.name);
          return { type: "csv", content: rowsToCsv(csvRows, csvFields) };
        }

        const offset = (currentPage - 1) * pageSize;
        const res = await client.query(`${baseSql} LIMIT ${pageSize} OFFSET ${offset}`);
        const executionTime = parseFloat((performance.now() - startTime).toFixed(2));

        const rows = res.rows as Record<string, unknown>[];
        const fields = res.fields.map((f) => f.name);

        let editable: EditableInfo | undefined;
        const tableName = parseSingleTableSelect(lastStatement);
        if (tableName) {
          try {
            const primaryKeys = await this.fetchPrimaryKeys(client, tableName);
            if (primaryKeys.length > 0 && primaryKeys.every((pk) => fields.includes(pk))) {
              editable = {
                table: tableName,
                primaryKeys,
                columns: await this.fetchColumns(client, tableName),
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

      // SHOW/EXPLAIN/other result-returning statements, or a write statement.
      const res = await client.query(lastStatement);
      const executionTime = parseFloat((performance.now() - startTime).toFixed(2));

      if (res.fields && res.fields.length > 0) {
        const rows = res.rows as Record<string, unknown>[];
        const fields = res.fields.map((f) => f.name);
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

      const totalAffected = prefixAffectedRows + (res.rowCount ?? 0);
      return {
        type: "execute",
        affectedRows: totalAffected,
        message: `${statements.length > 1 ? `${statements.length} statements executed. ` : "Query executed successfully. "}${totalAffected} row(s) affected.`,
        executionTime,
      };
    } finally {
      await client.end();
    }
  }

  // ---- schema editing ----

  private async exec(database: string, run: (client: Client) => Promise<void>, message: string): Promise<ExecResult> {
    const client = await this.connect(database);
    try {
      await run(client);
      return { affectedRows: 0, message };
    } finally {
      await client.end();
    }
  }

  private colDef(def: ColumnDef): string {
    let sql = `${quoteIdent(def.name)} ${def.type}`;
    if (!def.nullable) sql += " NOT NULL";
    if (def.default !== null && def.default !== undefined && def.default !== "") {
      sql += ` DEFAULT ${pgDefaultLiteral(def.default)}`;
    }
    return sql;
  }

  addColumn(database: string, table: string, def: ColumnDef): Promise<ExecResult> {
    return this.exec(database, (c) => c.query(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${this.colDef(def)}`).then(() => {}), `Column "${def.name}" added.`);
  }

  async changeColumn(database: string, table: string, oldName: string, def: ColumnDef): Promise<ExecResult> {
    const client = await this.connect(database);
    try {
      const t = quoteIdent(table);
      let name = oldName;
      if (def.name !== oldName) {
        await client.query(`ALTER TABLE ${t} RENAME COLUMN ${quoteIdent(oldName)} TO ${quoteIdent(def.name)}`);
        name = def.name;
      }
      const col = quoteIdent(name);
      await client.query(`ALTER TABLE ${t} ALTER COLUMN ${col} TYPE ${def.type} USING ${col}::${def.type}`);
      await client.query(`ALTER TABLE ${t} ALTER COLUMN ${col} ${def.nullable ? "DROP NOT NULL" : "SET NOT NULL"}`);
      if (def.default !== null && def.default !== undefined && def.default !== "") {
        await client.query(`ALTER TABLE ${t} ALTER COLUMN ${col} SET DEFAULT ${pgDefaultLiteral(def.default)}`);
      } else {
        await client.query(`ALTER TABLE ${t} ALTER COLUMN ${col} DROP DEFAULT`);
      }
      return { affectedRows: 0, message: `Column "${oldName}" updated.` };
    } finally {
      await client.end();
    }
  }

  dropColumn(database: string, table: string, column: string): Promise<ExecResult> {
    return this.exec(database, (c) => c.query(`ALTER TABLE ${quoteIdent(table)} DROP COLUMN ${quoteIdent(column)}`).then(() => {}), `Column "${column}" dropped.`);
  }

  addIndex(database: string, table: string, def: IndexDef): Promise<ExecResult> {
    const t = quoteIdent(table);
    const cols = def.columns.map(quoteIdent).join(", ");
    const sql =
      def.kind === "primary"
        ? `ALTER TABLE ${t} ADD PRIMARY KEY (${cols})`
        : `CREATE ${def.kind === "unique" ? "UNIQUE " : ""}INDEX ${quoteIdent(def.name)} ON ${t} (${cols})`;
    return this.exec(database, (c) => c.query(sql).then(() => {}), "Index added.");
  }

  async dropIndex(database: string, table: string, name: string): Promise<ExecResult> {
    const client = await this.connect(database);
    try {
      // A name may back a constraint (primary/unique) or be a plain index; handle both.
      await client.query(`ALTER TABLE ${quoteIdent(table)} DROP CONSTRAINT IF EXISTS ${quoteIdent(name)}`);
      await client.query(`DROP INDEX IF EXISTS ${quoteIdent(name)}`);
      return { affectedRows: 0, message: `Index "${name}" dropped.` };
    } finally {
      await client.end();
    }
  }

  async createTable(database: string, name: string, columns: ColumnDef[], primaryKey: string[]): Promise<ExecResult> {
    const defs = columns.map((c) =>
      // An auto-increment column becomes SERIAL (implies NOT NULL + sequence default); the declared type is ignored.
      c.autoIncrement ? `${quoteIdent(c.name)} SERIAL` : this.colDef(c)
    );
    if (primaryKey.length) defs.push(`PRIMARY KEY (${primaryKey.map(quoteIdent).join(", ")})`);
    return this.exec(database, (c) => c.query(`CREATE TABLE ${quoteIdent(name)} (${defs.join(", ")})`).then(() => {}), `Table "${name}" created.`);
  }

  async dumpTableSql(database: string, table: string): Promise<string> {
    const client = await this.connect(database);
    try {
      // Postgres has no SHOW CREATE TABLE — reconstruct a best-effort CREATE from the catalog.
      const cols = await this.fetchColumns(client, table);
      const pk = cols.filter((c) => c.Key === "PRI").map((c) => c.Field);
      const defs = cols.map((c) => {
        if (/auto_increment/i.test(c.Extra || "")) {
          return `${quoteIdent(c.Field)} ${/bigint/i.test(c.Type) ? "BIGSERIAL" : "SERIAL"}`;
        }
        let s = `${quoteIdent(c.Field)} ${c.Type}`;
        if (c.Null === "NO") s += " NOT NULL";
        if (c.Default !== null && c.Default !== undefined && !/^nextval\(/i.test(String(c.Default))) {
          s += ` DEFAULT ${c.Default}`;
        }
        return s;
      });
      if (pk.length) defs.push(`PRIMARY KEY (${pk.map(quoteIdent).join(", ")})`);
      const createSql = `CREATE TABLE ${quoteIdent(table)} (\n  ${defs.join(",\n  ")}\n)`;

      const res = await client.query(`SELECT * FROM ${quoteIdent(table)}`);
      const rows = res.rows as Record<string, unknown>[];
      return buildTableDump(table, createSql, cols.map((c) => c.Field), rows, quoteIdent, genericSqlLiteral);
    } finally {
      await client.end();
    }
  }

  // ---- database objects (views / routines / triggers) ----

  async listDatabaseObjects(_database: string): Promise<DatabaseObjects> {
    const client = await this.connect(_database);
    try {
      const viewRes = await client.query(
        `SELECT table_name AS name, view_definition AS def
           FROM information_schema.views WHERE table_schema = 'public' ORDER BY table_name`
      );
      const views = viewRes.rows.map((r) => ({ name: r.name as string, definition: (r.def as string) ?? "", meta: "VIEW" }));

      const routineRes = await client.query(
        `SELECT routine_name AS name, routine_type AS type, routine_definition AS def
           FROM information_schema.routines WHERE routine_schema = 'public' ORDER BY routine_name`
      );
      const routines = routineRes.rows.map((r) => ({
        name: r.name as string,
        definition: (r.def as string) ?? "",
        meta: (r.type as string) ?? "FUNCTION",
        routineType: (r.type as string) ?? "FUNCTION",
      }));

      // information_schema.triggers can repeat a trigger per event — dedupe by name.
      const triggerRes = await client.query(
        `SELECT trigger_name AS name, action_timing AS timing, event_manipulation AS event,
                event_object_table AS tbl, action_statement AS stmt
           FROM information_schema.triggers WHERE trigger_schema = 'public' ORDER BY trigger_name`
      );
      const seen = new Set<string>();
      const triggers: DatabaseObject[] = [];
      for (const r of triggerRes.rows) {
        const key = `${r.name}|${r.tbl}`;
        if (seen.has(key)) continue;
        seen.add(key);
        triggers.push({
          name: r.name as string,
          definition: (r.stmt as string) ?? "",
          meta: `${r.timing} ${r.event} on ${r.tbl}`,
          table: r.tbl as string,
        });
      }

      return { views, routines, triggers };
    } finally {
      await client.end();
    }
  }

  async dropObject(database: string, kind: DatabaseObjectKind, object: DatabaseObject): Promise<ExecResult> {
    const client = await this.connect(database);
    try {
      let sql: string;
      if (kind === "view") sql = `DROP VIEW IF EXISTS ${quoteIdent(object.name)}`;
      else if (kind === "trigger") sql = `DROP TRIGGER IF EXISTS ${quoteIdent(object.name)} ON ${quoteIdent(object.table ?? "")}`;
      else sql = `DROP ROUTINE IF EXISTS ${quoteIdent(object.name)}`;
      await client.query(sql);
      return { affectedRows: 0, message: `${kind} "${object.name}" dropped.` };
    } finally {
      await client.end();
    }
  }

  // ---- table operations ----

  truncateTable(database: string, table: string): Promise<ExecResult> {
    return this.exec(database, (c) => c.query(`TRUNCATE TABLE ${quoteIdent(table)}`).then(() => {}), `Table "${table}" truncated.`);
  }
  renameTable(database: string, table: string, newName: string): Promise<ExecResult> {
    return this.exec(database, (c) => c.query(`ALTER TABLE ${quoteIdent(table)} RENAME TO ${quoteIdent(newName)}`).then(() => {}), `Renamed to "${newName}".`);
  }
  dropTable(database: string, table: string): Promise<ExecResult> {
    return this.exec(database, (c) => c.query(`DROP TABLE ${quoteIdent(table)}`).then(() => {}), `Table "${table}" dropped.`);
  }
}

/** A DEFAULT value literal for Postgres: keywords/expressions raw, else quoted. */
function pgDefaultLiteral(value: string): string {
  const raw = /^(current_timestamp|current_date|current_time|now\(\)|null|true|false|-?\d+(\.\d+)?|nextval\(.*\))$/i;
  return raw.test(value.trim()) ? value : `'${value.replace(/'/g, "''")}'`;
}
