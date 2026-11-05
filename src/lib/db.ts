import mysql from "mysql2/promise";
import { randomUUID } from "crypto";
import { chmodSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { AppConfig, ServerConfig } from "./types";
import { needsSealing, openServer, sealServer, SecretUnavailableError } from "./secrets";

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
  const stored = JSON.parse(raw) as AppConfig;
  // Passwords saved before encryption existed (or by another writer) get sealed
  // the first time a key is available.
  if (stored.servers.some(needsSealing)) writeConfig(stored);
  return { ...stored, servers: stored.servers.map(openServer) };
}

export function getServerConfig(serverId: string): ServerConfig | undefined {
  const config = getConfig();
  return config.servers.find((s) => s.id === serverId);
}

/** Thrown when something tries to open a connection the user has disconnected. */
export class DisconnectedError extends Error {
  constructor(name?: string) {
    super(`This connection${name ? ` "${name}"` : ""} is disconnected. Reconnect it on the Servers page to run queries.`);
    this.name = "DisconnectedError";
  }
}

/** Guard the connection entry points: refuse to open a disconnected server. */
export function assertConnected(server: ServerConfig): void {
  if (server.disconnected) throw new DisconnectedError(server.name);
  if (server.secretUnavailable) throw new SecretUnavailableError(server.name);
}

function writeConfig(config: AppConfig): void {
  // Holds database passwords, so keep it owner-only (chmod too: `mode` only
  // applies when the file is created).
  const file = join(getConfigDir(), "nextmyadmin.config.json");
  const sealed = { ...config, servers: config.servers.map(sealServer) };
  writeFileSync(file, JSON.stringify(sealed, null, 2), { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(file, 0o600);
}

/**
 * Add a server to the config under a random UUID. The id is a URL segment
 * (`/server/<id>`), so it's never derived from the user's name — a name can't
 * collide with a static route, and ids aren't guessable. Older configs keep
 * their name-based ids; those still resolve.
 */
export function addServer(input: Omit<ServerConfig, "id">): ServerConfig {
  const config = getConfig();
  const server = { ...input, id: randomUUID() } as ServerConfig;
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
 * Replace a saved connection's details (from the edit form) while preserving its
 * id and the app-owned flags (`managed`, `disconnected`). Replacing rather than
 * merging means fields removed in the form (e.g. switching URL→host) don't linger.
 */
export function updateServer(id: string, input: Omit<ServerConfig, "id">): ServerConfig {
  const config = getConfig();
  const i = config.servers.findIndex((s) => s.id === id);
  if (i < 0) throw new Error(`Server "${id}" not found in config`);
  const prev = config.servers[i];
  const updated: ServerConfig = { ...input, id, managed: prev.managed, disconnected: prev.disconnected };
  config.servers[i] = updated;
  writeConfig(config);
  return updated;
}

/** Merge a small patch (e.g. the disconnected flag) into a saved connection. */
export function patchServer(id: string, patch: Partial<ServerConfig>): ServerConfig {
  const config = getConfig();
  const i = config.servers.findIndex((s) => s.id === id);
  if (i < 0) throw new Error(`Server "${id}" not found in config`);
  config.servers[i] = { ...config.servers[i], ...patch, id };
  writeConfig(config);
  return config.servers[i];
}

/**
 * Open a raw mysql2 connection for a configured server.
 *
 * Still used by the MySQL-only operation routes (rename/copy/export/import/users)
 * that haven't been moved behind the driver interface yet. For engine-agnostic
 * work use `getDriver()` from `@/lib/drivers`. Throws for non-MySQL engines so a
 * Postgres/other server can never be handed a MySQL socket by mistake.
 */
export async function getConnection(
  serverId: string,
  database?: string,
  // Off unless a caller runs a whole script (SQL import): with it on, one
  // unescaped value anywhere becomes a second statement.
  { multipleStatements = false } = {}
) {
  const server = getServerConfig(serverId);
  if (!server) throw new Error(`Server "${serverId}" not found in config`);
  assertConnected(server);

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
    multipleStatements,
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
