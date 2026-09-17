import SqlEditor from "@/components/SqlEditor";
import { getServerConfig } from "@/lib/db";
import { getCapabilities } from "@/lib/drivers";

const ENGINE_LABELS: Record<string, string> = {
  mysql: "MySQL",
  mariadb: "MariaDB",
  postgres: "PostgreSQL",
  sqlite: "SQLite",
  mongodb: "MongoDB",
};

export default async function DatabasePage({
  params,
}: {
  params: Promise<{ serverId: string; database: string }>;
}) {
  const { serverId, database } = await params;
  const server = getServerConfig(serverId);
  const engine = server?.engine ?? "mysql";

  // Non-SQL engines (MongoDB) have no query console — steer the user to browsing.
  if (!getCapabilities(engine).query) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <p className="text-sm font-medium mb-1">No SQL console for {ENGINE_LABELS[engine] ?? engine}</p>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Pick a collection from the sidebar to browse and edit its documents.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <SqlEditor serverId={serverId} database={database} />
    </div>
  );
}
