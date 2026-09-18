import { getConfig } from "@/lib/db";
import LocalServersPanel from "@/components/LocalServersPanel";
import AddConnectionButton from "@/components/AddConnectionButton";
import ConnectionCard from "@/components/ConnectionCard";

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
            <ConnectionCard
              key={server.id}
              server={{
                id: server.id,
                name: server.name,
                engine: server.engine,
                host: server.host,
                port: server.port,
                uri: server.uri,
                directory: server.directory,
                file: server.file,
                user: server.user,
                color: server.color,
                readOnly: server.readOnly,
                managed: server.managed,
                disconnected: server.disconnected,
              }}
            />
          ))}
        </div>
      )}

      <LocalServersPanel />
    </div>
  );
}
