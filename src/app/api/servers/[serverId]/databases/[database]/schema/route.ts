import { NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";

// Whole-database schema for the ER diagram: every table's columns + foreign keys.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string; database: string }> }
) {
  const { serverId, database } = await params;
  try {
    const driver = getDriver(serverId);
    const tables = await driver.listTables(database);
    const out = [];
    // Sequential to avoid a burst of connections on large schemas.
    for (const table of tables) {
      try {
        const s = await driver.getTableStructure(database, table);
        out.push({ table, columns: s.columns, foreignKeys: s.foreignKeys });
      } catch {
        out.push({ table, columns: [], foreignKeys: [] });
      }
    }
    return NextResponse.json(out);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load schema" },
      { status: 500 }
    );
  }
}
