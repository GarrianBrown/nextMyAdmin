import type { ColumnInfo, KeyInfo, ForeignKeyInfo } from "@/lib/types";

/**
 * Supported database engines. Relational engines (mysql, mariadb, postgres,
 * sqlite) share a SQL-based implementation; mongodb is a non-SQL adapter that
 * maps collections<->tables and documents<->rows onto the same interface.
 */
export type Engine = "mysql" | "mariadb" | "postgres" | "sqlite" | "mongodb";

/**
 * Feature flags per driver. The UI reads these to hide actions an engine can't
 * perform (e.g. no SQL editor for MongoDB, no user management for SQLite) so a
 * route is never invoked against an engine that doesn't implement it.
 */
export interface DriverCapabilities {
  /** Arbitrary query editor. SQL for relational engines; a query language for others. */
  query: boolean;
  /** GRANT/REVOKE-style user & privilege management. */
  users: boolean;
  createDatabase: boolean;
  dropDatabase: boolean;
  renameDatabase: boolean;
  copyDatabase: boolean;
  /** SQL dump export. */
  exportDump: boolean;
  /** SQL dump import. */
  importDump: boolean;
  /** Reports foreign-key relationships in table structure. */
  foreignKeys: boolean;
  /** Engine groups tables under named schemas (Postgres). */
  schemas: boolean;
  /** Supports editing columns and indexes (ALTER TABLE etc.). False for schemaless MongoDB. */
  schemaEdit: boolean;
  /** Supports table-level operations (rename / truncate / drop). */
  tableOps: boolean;
  /** Supports creating a new table/collection. */
  createTable: boolean;
  /** Supports exporting a single table as a SQL dump (structure + data). */
  exportTableSql: boolean;
}

/** A database-level schema object (view, stored routine, or trigger). */
export interface DatabaseObject {
  name: string;
  /** The SQL definition/body (CREATE statement or routine body). */
  definition: string;
  /** Human-readable summary, e.g. "AFTER INSERT on orders" or "FUNCTION". */
  meta?: string;
  /** Owning table — set for triggers (some engines need it to DROP). */
  table?: string;
  /** PROCEDURE | FUNCTION — set for routines. */
  routineType?: string;
}

/** The named objects in a database, grouped by kind (empty arrays when unsupported). */
export interface DatabaseObjects {
  views: DatabaseObject[];
  routines: DatabaseObject[];
  triggers: DatabaseObject[];
}

export type DatabaseObjectKind = "view" | "routine" | "trigger";

/** A column definition for add/change operations. */
export interface ColumnDef {
  name: string;
  type: string; // raw type string, e.g. "VARCHAR(255)", "INT", "TEXT"
  nullable: boolean;
  default: string | null; // null = no explicit default
  autoIncrement?: boolean;
}

/** An index/key definition for add operations. */
export interface IndexDef {
  name: string;
  columns: string[];
  kind: "index" | "unique" | "primary";
}

/** Result of browsing a table or the trailing SELECT of a query. */
export interface BrowseResult {
  rows: Record<string, unknown>[];
  fields: string[];
  totalRows: number;
  page: number;
  pageSize: number;
  totalPages: number;
  executionTime: number;
}

/** Editability metadata for a result set backed by a single table. */
export interface EditableInfo {
  table: string;
  primaryKeys: string[];
  columns: ColumnInfo[];
}

/**
 * Discriminated result of running a user-supplied query. Mirrors the JSON the
 * query route has always returned so the existing front-end keeps working; the
 * route only serializes it (and turns `csv` into a file Response).
 */
export type RunQueryResult =
  | {
      type: "select";
      rows: Record<string, unknown>[];
      fields: string[];
      executionTime: number;
      totalRows?: number | null;
      page?: number;
      pageSize?: number;
      totalPages?: number | null;
      editable?: EditableInfo;
      prefixStatements?: number;
      prefixAffectedRows?: number;
    }
  | {
      type: "execute";
      affectedRows: number;
      message: string;
      executionTime: number;
    }
  | { type: "csv"; content: string };

export interface ExecResult {
  affectedRows: number;
  insertId?: number | string | null;
  message?: string;
}

export interface TableStructure {
  columns: ColumnInfo[];
  indexes: KeyInfo[];
  foreignKeys: ForeignKeyInfo[];
}

/** A single column filter condition (ANDed together when browsing). */
export interface FilterCondition {
  column: string;
  /** One of {@link FILTER_OPERATORS}. */
  op: string;
  /** Ignored for IS NULL / IS NOT NULL. */
  value?: string;
}

/** Whitelisted filter operators — the only values a driver will act on. */
export const FILTER_OPERATORS = [
  "=",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "LIKE",
  "NOT LIKE",
  "IS NULL",
  "IS NOT NULL",
] as const;

export interface BrowseOptions {
  page: number;
  pageSize: number;
  sortColumn?: string | null;
  sortDirection?: string | null;
  filters?: FilterCondition[];
}

export interface RunQueryOptions {
  page?: number;
  pageSize?: number;
  /** When "csv", return the full (unpaginated) trailing SELECT as CSV. */
  download?: string | null;
}

/**
 * Engine-agnostic surface every driver implements. Method names use the
 * relational vocabulary (database/table/row); non-relational adapters map their
 * own concepts onto it (Mongo: database/collection/document). Callers gate
 * optional operations on {@link DriverCapabilities} rather than catching errors.
 */
export interface DatabaseDriver {
  readonly engine: Engine;
  readonly capabilities: DriverCapabilities;

  // --- server / databases ---
  listDatabases(): Promise<string[]>;
  createDatabase(name: string): Promise<void>;
  dropDatabase(name: string): Promise<void>;

  // --- tables ---
  listTables(database: string): Promise<string[]>;
  getTableStructure(database: string, table: string): Promise<TableStructure>;
  browseTable(
    database: string,
    table: string,
    options: BrowseOptions
  ): Promise<BrowseResult>;

  // --- rows ---
  insertRow(
    database: string,
    table: string,
    values: Record<string, unknown>
  ): Promise<ExecResult>;
  /** Bulk-insert many rows (values in `columns` order) in a single connection — used by CSV import. */
  insertRows(
    database: string,
    table: string,
    columns: string[],
    rows: unknown[][]
  ): Promise<ExecResult>;
  updateRow(
    database: string,
    table: string,
    primaryKeys: Record<string, unknown>,
    updates: Record<string, unknown>
  ): Promise<ExecResult>;
  deleteRow(
    database: string,
    table: string,
    primaryKeys: Record<string, unknown>
  ): Promise<ExecResult>;

  // --- ad-hoc query ---
  runQuery(
    database: string,
    query: string,
    options: RunQueryOptions
  ): Promise<RunQueryResult>;

  // --- schema editing (gated by capabilities.schemaEdit) ---
  addColumn(database: string, table: string, def: ColumnDef): Promise<ExecResult>;
  changeColumn(database: string, table: string, oldName: string, def: ColumnDef): Promise<ExecResult>;
  dropColumn(database: string, table: string, column: string): Promise<ExecResult>;
  addIndex(database: string, table: string, def: IndexDef): Promise<ExecResult>;
  dropIndex(database: string, table: string, name: string): Promise<ExecResult>;

  // --- create table (gated by capabilities.createTable) ---
  createTable(database: string, name: string, columns: ColumnDef[], primaryKey: string[]): Promise<ExecResult>;

  // --- single-table SQL dump (gated by capabilities.exportTableSql) ---
  dumpTableSql(database: string, table: string): Promise<string>;

  // --- database objects: views / routines / triggers (SQL engines only) ---
  listDatabaseObjects(database: string): Promise<DatabaseObjects>;
  dropObject(database: string, kind: DatabaseObjectKind, object: DatabaseObject): Promise<ExecResult>;

  // --- table operations (gated by capabilities.tableOps) ---
  truncateTable(database: string, table: string): Promise<ExecResult>;
  renameTable(database: string, table: string, newName: string): Promise<ExecResult>;
  dropTable(database: string, table: string): Promise<ExecResult>;
}

/** Thrown when a route reaches a driver that doesn't support the operation. */
export class NotSupportedError extends Error {
  constructor(engine: Engine, operation: string) {
    super(`The ${engine} driver does not support "${operation}".`);
    this.name = "NotSupportedError";
  }
}
