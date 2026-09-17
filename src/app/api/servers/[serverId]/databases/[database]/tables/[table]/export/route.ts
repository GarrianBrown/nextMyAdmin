import { NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";

// Download a single table as a SQL dump (structure + data).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ serverId: string; database: string; table: string }> }
) {
  const { serverId, database, table } = await params;
  const format = new URL(request.url).searchParams.get("format") ?? "sql";
  try {
    const driver = getDriver(serverId);
    if (format !== "sql") {
      return NextResponse.json({ error: `Unsupported export format "${format}".` }, { status: 400 });
    }
    if (!driver.capabilities.exportTableSql) {
      return NextResponse.json({ error: `${driver.engine} does not support SQL export.` }, { status: 400 });
    }
    const sql = await driver.dumpTableSql(database, table);
    return new Response(sql, {
      headers: {
        "Content-Type": "application/sql; charset=utf-8",
        "Content-Disposition": `attachment; filename="${table}.sql"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to export table" },
      { status: 500 }
    );
  }
}
