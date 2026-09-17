import { getServerConfig } from "@/lib/db";
import { getDriver, getCapabilities } from "@/lib/drivers";
import Link from "next/link";
import CreateDatabaseButton from "@/components/CreateDatabaseButton";
import { DatabaseIcon } from "@/components/icons";

const ENGINE_LABELS: Record<string, string> = {
  mysql: "MySQL",
  mariadb: "MariaDB",
  postgres: "PostgreSQL",
  sqlite: "SQLite",
  mongodb: "MongoDB",
};

export default async function ServerPage({ params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params;
  const server = getServerConfig(serverId);

  if (!server) {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <div style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)' }} className="rounded-md p-4 text-sm">
          <p className="font-semibold" style={{ color: 'var(--danger)' }}>Server not found</p>
          <p className="mt-1">No server with ID &quot;{serverId}&quot; exists in the configuration.</p>
        </div>
      </div>
    );
  }

  const caps = getCapabilities(server.engine ?? "mysql");

  let databases: string[] = [];
  let error: string | null = null;

  try {
    databases = await getDriver(serverId).listDatabases();
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="max-w-4xl mx-auto px-6 pt-8 pb-8">
      <nav className="text-sm mb-6" style={{ color: 'var(--muted)' }}>
        <Link href="/" className="hover:underline" style={{ color: 'var(--primary)' }}>Home</Link>
        <span className="mx-1.5">&gt;</span>
        <span>{server.name}</span>
      </nav>

      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Databases on {server.name}</h1>
            <span className="badge badge-engine">{ENGINE_LABELS[server.engine ?? 'mysql'] ?? server.engine}</span>
          </div>
          <p className="text-sm mt-1 font-mono" style={{ color: 'var(--muted)' }}>
            {server.host}:{server.port}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {caps.users && (
            <Link href={`/server/${serverId}/users`} className="btn text-sm">Manage Users</Link>
          )}
          {caps.createDatabase && <CreateDatabaseButton serverId={serverId} />}
        </div>
      </div>

      {error ? (
        <div style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)' }} className="rounded-md p-4 text-sm">
          <p className="font-semibold" style={{ color: 'var(--danger)' }}>Connection Error</p>
          <p className="mt-1">{error}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {databases.map((db) => (
            <Link
              key={db}
              href={`/server/${serverId}/${db}`}
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
              className="flex items-center gap-2 rounded-lg px-4 py-3 transition-all hover:shadow-md hover:-translate-y-0.5"
            >
              <DatabaseIcon style={{ width: 16, height: 16, color: 'var(--primary)' }} />
              <span className="font-mono text-sm truncate">{db}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
