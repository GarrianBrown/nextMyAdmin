import { NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";
import { assertWritable } from "@/lib/readonly";

// Bulk-insert parsed CSV rows into a table. Body: { columns: string[], rows: unknown[][] }.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string; database: string; table: string }> }
) {
  const { serverId, database, table } = await params;
  try {
    assertWritable(serverId);
    const body = await request.json();
    const columns = Array.isArray(body.columns) ? body.columns.map(String) : [];
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (columns.length === 0) {
      return NextResponse.json({ error: "No columns selected to import." }, { status: 400 });
    }
    const result = await getDriver(serverId).insertRows(database, table, columns, rows);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "CSV import failed" },
      { status: 400 }
    );
  }
}
