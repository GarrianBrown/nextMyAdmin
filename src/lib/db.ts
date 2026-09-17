import mysql from "mysql2/promise";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { AppConfig, ServerConfig } from "./types";

/**
 * Directory holding `nextmyadmin.config.json`. In the packaged desktop app,
 * Electron sets NMA_CONFIG_DIR to a writable per-user location (userData); in
 * dev / web use it falls back to the project working directory.
 */
export function getConfigDir(): string {
  return process.env.NMA_CONFIG_DIR || process.cwd();
}

export function getConfig(): AppConfig {
  const configPath = join(getConfigDir(), "nextmyadmin.config.json");
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch (err) {
    // A missing config isn't an error — it's a first run with no servers yet.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { servers: [] };
    throw err;
  }
  return JSON.parse(raw) as AppConfig;
}

export function getServerConfig(serverId: string): ServerConfig | undefined {
  const config = getConfig();
  return config.servers.find((s) => s.id === serverId);
}

function writeConfig(config: AppConfig): void {
  writeFileSync(join(getConfigDir(), "nextmyadmin.config.json"), JSON.stringify(config, null, 2));
}

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "server";
}

/** Add a server to the config, generating a unique id from its name. */
export function addServer(input: Omit<ServerConfig, "id"> & { id?: string }): ServerConfig {
  const config = getConfig();
  const existing = new Set(config.servers.map((s) => s.id));
  let id = input.id && !existing.has(input.id) ? input.id : slugify(input.name);
  let n = 1;
  const base = id;
  while (existing.has(id)) id = `${base}-${++n}`;
  const server = { ...input, id } as ServerConfig;
  config.servers.push(server);
  writeConfig(config);
  return server;
}

export function removeServer(id: string): void {
  const config = getConfig();
  config.servers = config.servers.filter((s) => s.id !== id);
  writeConfig(config);
}

/**
 * Open a raw mysql2 connection for a configured server.
 *
 * Still used by the MySQL-only operation routes (rename/copy/export/import/users)
 * that haven't been moved behind the driver interface yet. For engine-agnostic
 * work use `getDriver()` from `@/lib/drivers`. Throws for non-MySQL engines so a
 * Postgres/other server can never be handed a MySQL socket by mistake.
 */
export async function getConnection(serverId: string, database?: string) {
  const server = getServerConfig(serverId);
  if (!server) throw new Error(`Server "${serverId}" not found in config`);

  const engine = server.engine ?? "mysql";
  if (engine !== "mysql" && engine !== "mariadb") {
    throw new Error(
      `getConnection() only supports MySQL/MariaDB; server "${serverId}" is "${engine}". Use getDriver() instead.`
    );
  }

  const connection = await mysql.createConnection({
    host: server.host,
    port: server.port,
    user: server.user,
    password: server.password,
    database: database || undefined,
    multipleStatements: true,
  });

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
