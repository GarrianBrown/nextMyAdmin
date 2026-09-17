import { getServerConfig } from "@/lib/db";
import { getDriver } from "@/lib/drivers";
import DatabaseSidebar from "@/components/DatabaseSidebar";
import DatabaseTabs from "@/components/DatabaseTabs";
import FunctionDictionary from "@/components/FunctionDictionary";
import { ServerIcon, DatabaseIcon } from "@/components/icons";
import Link from "next/link";

const ENGINE_LABELS: Record<string, string> = {
  mysql: "MySQL",
  mariadb: "MariaDB",
  postgres: "PostgreSQL",
  sqlite: "SQLite",
  mongodb: "MongoDB",
};

export default async function DatabaseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ serverId: string; database: string }>;
}) {
  const { serverId, database } = await params;
  const server = getServerConfig(serverId);

  if (!server) {
    return <div className="p-4">{children}</div>;
  }

  const engine = server.engine ?? "mysql";
  const isMysqlFamily = engine === "mysql" || engine === "mariadb";

  let databases: string[] = [];
  let tables: string[] = [];
  let connError: string | null = null;

  try {
    const driver = getDriver(serverId);
    [databases, tables] = await Promise.all([
      driver.listDatabases(),
      driver.listTables(database),
    ]);
  } catch (e) {
    // Keep rendering the shell, but tell the user why the sidebar is empty.
    connError = e instanceof Error ? e.message : `Couldn't connect to "${server.name}".`;
  }

  return (
    <div className="flex h-full overflow-hidden">
      <DatabaseSidebar
        serverId={serverId}
        database={database}
        databases={databases}
        tables={tables}
        serverName={server.name}
        engine={engine}
        readOnly={!!server.readOnly}
        color={server.color}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Sticky breadcrumb */}
        <nav
          className="sticky top-0 z-40 shrink-0 px-3 py-1 text-xs flex items-center gap-1.5"
          style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}
        >
          <Link href="/" className="hover:underline" style={{ color: "var(--primary)" }}>Home</Link>
          <span style={{ color: "var(--border-strong)" }}>›</span>
          {server.color && (
            <span aria-hidden style={{ width: 9, height: 9, borderRadius: "50%", background: server.color, display: "inline-block", flexShrink: 0 }} title="Connection color" />
          )}
          <ServerIcon style={{ width: 13, height: 13 }} />
          <Link href={`/server/${serverId}`} className="hover:underline" style={{ color: "var(--primary)" }}>{server.name}</Link>
          <span style={{ color: "var(--border-strong)" }}>›</span>
          <DatabaseIcon style={{ width: 13, height: 13 }} />
          <Link href={`/server/${serverId}/${database}`} className="hover:underline font-medium" style={{ color: "var(--primary)" }}>{database}</Link>
          <span className="badge badge-engine ml-1.5">{ENGINE_LABELS[engine] ?? engine}</span>
          {server.readOnly && (
            <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded" style={{ background: "color-mix(in srgb, var(--accent) 18%, transparent)", color: "var(--accent)", border: "1px solid var(--accent)" }} title="This connection is read-only (safe mode)">
              Read-only
            </span>
          )}
        </nav>
        <DatabaseTabs serverId={serverId} database={database} engine={engine} />
        <div className="flex-1 overflow-hidden flex min-h-0">
          <div className="flex-1 min-w-0 overflow-hidden px-3 py-2 flex flex-col">
            {connError && (
              <div className="rounded-md p-3 text-sm mb-2 shrink-0" style={{ background: "color-mix(in srgb, var(--danger) 8%, transparent)", border: "1px solid var(--danger)" }}>
                <p className="font-semibold" style={{ color: "var(--danger)" }}>Can&apos;t connect to &ldquo;{server.name}&rdquo;</p>
                <p className="mt-0.5" style={{ color: "var(--muted)" }}>{connError}</p>
              </div>
            )}
            {children}
          </div>
          {isMysqlFamily && <FunctionDictionary />}
        </div>
      </div>
    </div>
  );
}
