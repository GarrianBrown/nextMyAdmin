import { getServerConfig } from "@/lib/db";
import { getDriver } from "@/lib/drivers";
import type { ColumnInfo, KeyInfo, ForeignKeyInfo } from "@/lib/types";
import TableView from "@/components/TableView";

export default async function TablePage({
  params,
}: {
  params: Promise<{ serverId: string; database: string; table: string }>;
}) {
  const { serverId, database, table } = await params;
  const server = getServerConfig(serverId);

  if (!server) {
    return (
      <div className="p-4">
        <div style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", border: "1px solid var(--danger)" }} className="rounded-md p-4 text-sm">
          <p className="font-semibold" style={{ color: "var(--danger)" }}>Server not found</p>
        </div>
      </div>
    );
  }

  let columns: ColumnInfo[] = [];
  let indexes: KeyInfo[] = [];
  let foreignKeys: ForeignKeyInfo[] = [];
  let error: string | null = null;

  try {
    const structure = await getDriver(serverId).getTableStructure(database, table);
    columns = structure.columns;
    indexes = structure.indexes;
    foreignKeys = structure.foreignKeys;
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", border: "1px solid var(--danger)" }} className="rounded-md p-4 text-sm">
        <p className="font-semibold" style={{ color: "var(--danger)" }}>Error</p>
        <p className="mt-1">{error}</p>
      </div>
    );
  }

  return (
    <TableView
      serverId={serverId}
      database={database}
      table={table}
      engine={server.engine ?? "mysql"}
      columns={columns}
      indexes={indexes}
      foreignKeys={foreignKeys}
    />
  );
}
