import { getConfig } from "@/lib/db";
import Link from "next/link";
import { ServerIcon } from "@/components/icons";
import LocalServersPanel from "@/components/LocalServersPanel";
import AddConnectionButton from "@/components/AddConnectionButton";
import DeleteConnectionButton from "@/components/DeleteConnectionButton";

const ENGINE_LABELS: Record<string, string> = {
  mysql: "MySQL",
  mariadb: "MariaDB",
  postgres: "PostgreSQL",
  sqlite: "SQLite",
  mongodb: "MongoDB",
};

export default function HomePage() {
  let servers;
  try {
    const config = getConfig();
    servers = config.servers;
  } catch {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <h1 className="text-2xl font-bold mb-4">nextMyAdmin</h1>
        <div style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)' }} className="rounded-md p-4 text-sm">
          <p className="font-semibold" style={{ color: 'var(--danger)' }}>Configuration Error</p>
          <p className="mt-1">Could not load <code className="font-mono">nextmyadmin.config.json</code>. Make sure it exists in the project root.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 pt-8 pb-8">
      <div className="flex items-center mb-6">
        <h1 className="text-2xl font-bold">Servers</h1>
        <div className="ml-auto">
          <AddConnectionButton />
        </div>
      </div>
      {servers.length === 0 ? (
        <div className="rounded-lg p-6 text-center" style={{ background: 'var(--surface)', border: '1px dashed var(--border-strong)' }}>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            No connections yet. Click <span className="font-medium" style={{ color: 'var(--foreground)' }}>Add Connection</span> to connect to a database.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {servers.map((server) => (
            <div key={server.id} className="relative">
              <Link
                href={`/server/${server.id}`}
                style={{ background: 'var(--card)', border: '1px solid var(--border)', borderLeft: server.color ? `4px solid ${server.color}` : '1px solid var(--border)' }}
                className="block rounded-lg p-5 transition-all hover:shadow-md hover:-translate-y-0.5"
              >
                <div className="flex items-center gap-2 mb-1 pr-6">
                  <ServerIcon style={{ width: 18, height: 18, color: 'var(--primary)' }} />
                  <h2 className="text-lg font-semibold flex-1 truncate">{server.name}</h2>
                  {server.readOnly && <span className="badge" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>read-only</span>}
                  <span className="badge badge-engine">{ENGINE_LABELS[server.engine ?? 'mysql'] ?? server.engine}</span>
                </div>
                <p className="text-sm font-mono truncate" style={{ color: 'var(--muted)' }}>
                  {server.host
                    ? `${server.host}:${server.port}`
                    : server.uri ?? server.directory ?? server.file ?? ''}
                </p>
                {server.user && (
                  <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                    User: {server.user}
                  </p>
                )}
                {server.managed && <span className="badge mt-2 inline-block">managed · local</span>}
              </Link>
              {!server.managed && <DeleteConnectionButton serverId={server.id} name={server.name} />}
            </div>
          ))}
        </div>
      )}

      <LocalServersPanel />
    </div>
  );
}
