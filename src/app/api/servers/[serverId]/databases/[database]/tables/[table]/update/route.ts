import { NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string; database: string; table: string }> }
) {
  const { serverId, database, table } = await params;
  try {
    const body = await request.json();
    const { primaryKeys, updates } = body as {
      primaryKeys: Record<string, unknown>;
      updates: Record<string, unknown>;
    };

    if (!primaryKeys || Object.keys(primaryKeys).length === 0) {
      return NextResponse.json({ error: "Primary key values are required" }, { status: 400 });
    }
    if (!updates || Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No updates provided" }, { status: 400 });
    }

    const result = await getDriver(serverId).updateRow(database, table, primaryKeys, updates);
    return NextResponse.json({
      message: result.message ?? `${result.affectedRows} row(s) updated.`,
      affectedRows: result.affectedRows,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed" },
      { status: 400 }
    );
  }
}
