import type { ServerConfig } from "./types";
import type { Engine } from "./drivers/types";

const ENGINES: Engine[] = ["mysql", "mariadb", "postgres", "sqlite", "mongodb"];

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Shape a raw form/JSON body into a server config (minus id), per engine. */
export function normalizeServerInput(body: Record<string, unknown>): Omit<ServerConfig, "id"> {
  const engine = (ENGINES.includes(body.engine as Engine) ? body.engine : "mysql") as Engine;
  const name = str(body.name);

  if (engine === "sqlite") {
    return { name, engine, directory: str(body.directory) || undefined, file: str(body.file) || undefined };
  }
  if (engine === "mongodb") {
    return {
      name,
      engine,
      uri: str(body.uri) || undefined,
      host: str(body.host) || undefined,
      port: body.port ? Number(body.port) : undefined,
    };
  }
  // mysql / mariadb / postgres
  const ssl = Boolean(body.ssl);
  const url = str(body.url);
  if (url) {
    // URL mode: the connection string carries host/port/user/password/database.
    return { name, engine, url, ssl };
  }

  const server: Omit<ServerConfig, "id"> = {
    name,
    engine,
    host: str(body.host),
    port: body.port ? Number(body.port) : undefined,
    user: str(body.user),
    password: typeof body.password === "string" ? body.password : "",
    ssl,
  };
  const database = str(body.database);
  // Postgres connects to a specific database (its "defaultDatabase"); MySQL/MariaDB
  // just take an optional default schema.
  if (engine === "postgres") {
    if (database) server.defaultDatabase = database;
  } else if (database) {
    server.database = database;
  }
  return server;
}

/** Returns an error message if the input is invalid, else null. */
export function validateServerInput(s: Omit<ServerConfig, "id">): string | null {
  if (!s.name) return "Name is required.";
  if (s.engine === "sqlite") {
    if (!s.directory && !s.file) return "SQLite needs a directory (folder of .db files) or a file path.";
    return null;
  }
  if (s.engine === "mongodb") {
    if (!s.uri && !s.host) return "MongoDB needs a connection URI or a host.";
    return null;
  }
  // sql engines
  if (s.url) {
    try {
      new URL(s.url);
    } catch {
      return "Connection URL is not valid (expected e.g. mysql://user:pass@host:3306/db).";
    }
    return null;
  }
  if (!s.host) return "Host is required.";
  if (!s.port || Number.isNaN(s.port)) return "A valid port is required.";
  return null;
}
