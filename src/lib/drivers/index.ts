import { getServerConfig } from "@/lib/db";
import type { ServerConfig } from "@/lib/types";
import type { DatabaseDriver, Engine } from "./types";
import { MysqlDriver } from "./mysql";
import { PostgresDriver } from "./postgres";
import { SqliteDriver } from "./sqlite";
import { MongoDriver } from "./mongodb";

export type { DatabaseDriver } from "./types";
export { NotSupportedError } from "./types";
export { getCapabilities, CAPABILITIES } from "./capabilities";

/** Resolve the engine for a server config, defaulting to MySQL for back-compat. */
export function resolveEngine(engine: Engine | undefined): Engine {
  return engine ?? "mysql";
}

/** Construct a driver from a server config object (may be unsaved — used to test). */
export function buildDriver(server: ServerConfig): DatabaseDriver {
  const engine = resolveEngine(server.engine);
  switch (engine) {
    case "mysql":
    case "mariadb":
      return new MysqlDriver(server);
    case "postgres":
      return new PostgresDriver(server);
    case "sqlite":
      return new SqliteDriver(server);
    case "mongodb":
      return new MongoDriver(server);
    default:
      throw new Error(`No driver implemented for engine "${engine}" yet.`);
  }
}

/** Build the driver for a configured server. Throws if the server id is unknown. */
export function getDriver(serverId: string): DatabaseDriver {
  const server = getServerConfig(serverId);
  if (!server) throw new Error(`Server "${serverId}" not found in config`);
  return buildDriver(server);
}
