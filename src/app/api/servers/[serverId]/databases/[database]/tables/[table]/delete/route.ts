import { NextResponse } from "next/server";
import { assertWritable } from "@/lib/readonly";
import { getDriver } from "@/lib/drivers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string; database: string; table: string }> }
) {
  const { serverId, database, table } = await params;
  try {
    assertWritable(serverId);
    const body = await request.json();
    const { primaryKeys } = body as { primaryKeys: Record<string, unknown> };

    if (!primaryKeys || Object.keys(primaryKeys).length === 0) {
      return NextResponse.json(
        { error: "Primary key values are required" },
        { status: 400 }
      );
    }

    const result = await getDriver(serverId).deleteRow(database, table, primaryKeys);
    return NextResponse.json({
      message: result.message ?? `${result.affectedRows} row(s) deleted.`,
      affectedRows: result.affectedRows,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete failed" },
      { status: 400 }
    );
  }
}
