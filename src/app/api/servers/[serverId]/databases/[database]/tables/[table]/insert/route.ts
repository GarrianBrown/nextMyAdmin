import { NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string; database: string; table: string }> }
) {
  const { serverId, database, table } = await params;
  try {
    const body = await request.json();
    const { values } = body as { values: Record<string, unknown> };

    if (!values || Object.keys(values).length === 0) {
      return NextResponse.json({ error: "No values provided" }, { status: 400 });
    }

    const result = await getDriver(serverId).insertRow(database, table, values);
    return NextResponse.json({
      message: result.message ?? `${result.affectedRows} row(s) inserted.`,
      affectedRows: result.affectedRows,
      insertId: result.insertId ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Insert failed" },
      { status: 400 }
    );
  }
}
