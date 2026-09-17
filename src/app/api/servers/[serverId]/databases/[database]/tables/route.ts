import { NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string; database: string }> }
) {
  const { serverId, database } = await params;
  try {
    const tables = await getDriver(serverId).listTables(database);
    return NextResponse.json(tables);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list tables" },
      { status: 500 }
    );
  }
}

// Create a new table/collection in this database.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string; database: string }> }
) {
  const { serverId, database } = await params;
  try {
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Table name is required." }, { status: 400 });
    const columns = Array.isArray(body.columns) ? body.columns : [];
    const primaryKey = Array.isArray(body.primaryKey) ? body.primaryKey : [];
    const result = await getDriver(serverId).createTable(database, name, columns, primaryKey);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create table" },
      { status: 400 }
    );
  }
}
