import type { DriverCapabilities, Engine } from "./types";

/**
 * Per-engine capability flags — the single source of truth shared by the drivers
 * (which expose them as `driver.capabilities`) and the UI (which gates tabs and
 * buttons via `getCapabilities(engine)`). Keeping them here, rather than only on
 * driver instances, lets Server Components decide what to render without opening
 * a connection.
 */
const mysql: DriverCapabilities = {
  query: true,
  users: true,
  createDatabase: true,
  dropDatabase: true,
  renameDatabase: true,
  copyDatabase: true,
  exportDump: true,
  importDump: true,
  foreignKeys: true,
  schemas: false,
  schemaEdit: true,
  tableOps: true,
  createTable: true,
  exportTableSql: true,
};

const postgres: DriverCapabilities = {
  query: true,
  users: false,
  createDatabase: true,
  dropDatabase: true,
  renameDatabase: false,
  copyDatabase: false,
  exportDump: false,
  importDump: false,
  foreignKeys: true,
  schemas: false,
  schemaEdit: true,
  tableOps: true,
  createTable: true,
  exportTableSql: true,
};

const sqlite: DriverCapabilities = {
  query: true,
  users: false,
  createDatabase: true,
  dropDatabase: true,
  renameDatabase: false,
  copyDatabase: false,
  exportDump: false,
  importDump: false,
  foreignKeys: true,
  schemas: false,
  schemaEdit: true,
  tableOps: true,
  createTable: true,
  exportTableSql: true,
};

const mongodb: DriverCapabilities = {
  query: false, // no SQL; the ad-hoc SQL editor is hidden
  users: false,
  createDatabase: false, // Mongo creates databases lazily when data is written
  dropDatabase: true,
  renameDatabase: false,
  copyDatabase: false,
  exportDump: false,
  importDump: false,
  foreignKeys: false,
  schemas: false,
  schemaEdit: false,
  tableOps: true,
  createTable: true,
  exportTableSql: false, // no SQL representation for Mongo collections
};

export const CAPABILITIES: Record<Engine, DriverCapabilities> = {
  mysql,
  mariadb: mysql,
  postgres,
  sqlite,
  mongodb,
};

export function getCapabilities(engine: Engine): DriverCapabilities {
  return CAPABILITIES[engine] ?? mysql;
}
