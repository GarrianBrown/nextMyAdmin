import { NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string; database: string; table: string }> }
) {
  const { serverId, database, table } = await params;
  try {
    const structure = await getDriver(serverId).getTableStructure(database, table);
    return NextResponse.json(structure);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get table structure" },
      { status: 500 }
    );
  }
}
