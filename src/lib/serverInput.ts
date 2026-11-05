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

  // Engine-agnostic UI options.
  const common: Partial<ServerConfig> = {};
  const color = str(body.color);
  if (color) common.color = color;
  if (body.readOnly === true || body.readOnly === "true" || body.readOnly === "on") common.readOnly = true;

  let base: Omit<ServerConfig, "id">;
  if (engine === "sqlite") {
    base = { name, engine, directory: str(body.directory) || undefined, file: str(body.file) || undefined };
  } else if (engine === "mongodb") {
    base = {
      name,
      engine,
      uri: str(body.uri) || undefined,
      host: str(body.host) || undefined,
      port: body.port ? Number(body.port) : undefined,
    };
  } else {
    // mysql / mariadb / postgres
    const ssl = Boolean(body.ssl);
    const url = str(body.url);
    if (url) {
      base = { name, engine, url, ssl };
    } else {
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
      base = server;
    }
  }
  return { ...base, ...common };
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

/** Shown in place of a saved password; sending it back means "keep the saved one". */
export const SECRET_MASK = "********";

// scheme://user:PASSWORD@… — the password part of a connection URL/URI.
const URL_PASSWORD = /^([a-z][a-z0-9+.-]*:\/\/[^:/@]*:)([^/]*)@/i;

function maskUrl(url: string | undefined): string | undefined {
  return url?.replace(URL_PASSWORD, (_m, head: string) => `${head}${SECRET_MASK}@`);
}

function unmaskUrl(url: string | undefined, saved: string | undefined): string | undefined {
  const m = url?.match(URL_PASSWORD);
  if (!url || !m || m[2] !== SECRET_MASK) return url;
  const savedPassword = saved?.match(URL_PASSWORD)?.[2];
  return savedPassword === undefined ? url : url.replace(URL_PASSWORD, (_m, head: string) => `${head}${savedPassword}@`);
}

/**
 * A saved connection as it's safe to send to the browser: the password is
 * dropped (only `hasPassword` says one exists) and URL/URI passwords are masked.
 */
export function redactServer(s: ServerConfig) {
  const { password, ...rest } = s;
  return { ...rest, url: maskUrl(s.url), uri: maskUrl(s.uri), hasPassword: !!password };
}

/**
 * Put saved secrets back into an edit-form submission: an omitted password keeps
 * the saved one, and a masked URL/URI password is swapped for the real one.
 */
export function restoreSecrets(body: Record<string, unknown>, saved: ServerConfig): Record<string, unknown> {
  const out = { ...body };
  if (!("password" in out)) out.password = saved.password ?? "";
  if (typeof out.url === "string") out.url = unmaskUrl(out.url, saved.url);
  if (typeof out.uri === "string") out.uri = unmaskUrl(out.uri, saved.uri);
  return out;
}
