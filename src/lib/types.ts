import type { Engine } from "./drivers/types";

export interface ServerConfig {
  id: string;
  name: string;
  /** Database engine. Defaults to "mysql" when omitted (backward compatible). */
  engine?: Engine;

  // Network engines (mysql, mariadb, postgres). Optional so file/URI engines
  // (sqlite, mongodb) can omit them.
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  /** Default database/schema to connect to (mysql/mariadb). */
  database?: string;
  /**
   * Full connection string (mysql://…, postgres://…). When set, drivers connect
   * with it directly instead of host/port/user/password.
   */
  url?: string;

  /**
   * Postgres connects to a specific database; this is the one used for
   * server-level operations (listing databases, etc). Defaults to "postgres".
   */
  defaultDatabase?: string;
  /** Enable TLS (Postgres). `true` uses a permissive config for self-signed certs. */
  ssl?: boolean;

  // SQLite. Either `directory` (a folder whose *.db/*.sqlite files are the
  // "databases") or `file` (a single database file).
  directory?: string;
  file?: string;

  /** MongoDB connection string, e.g. "mongodb://127.0.0.1:27017". */
  uri?: string;

  /** Set by the local server manager for instances it starts/stops. */
  managed?: boolean;
}

export interface AppConfig {
  servers: ServerConfig[];
}

export interface ColumnInfo {
  Field: string;
  Type: string;
  Null: string;
  Key: string;
  Default: string | null;
  Extra: string;
}

export interface KeyInfo {
  Table: string;
  Non_unique: number;
  Key_name: string;
  Seq_in_index: number;
  Column_name: string;
  Collation: string | null;
  Cardinality: number | null;
  Sub_part: string | null;
  Packed: string | null;
  Null: string;
  Index_type: string;
  Comment: string;
}

export interface ForeignKeyInfo {
  CONSTRAINT_NAME: string;
  COLUMN_NAME: string;
  REFERENCED_TABLE_SCHEMA: string;
  REFERENCED_TABLE_NAME: string;
  REFERENCED_COLUMN_NAME: string;
  UPDATE_RULE: string;
  DELETE_RULE: string;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  fields: string[];
  totalRows: number;
  page: number;
  pageSize: number;
  totalPages: number;
  executionTime: number;
}
