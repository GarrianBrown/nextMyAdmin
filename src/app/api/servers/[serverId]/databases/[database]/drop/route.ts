import { NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ serverId: string; database: string }> }
) {
  const { serverId, database } = await params;
  try {
    await getDriver(serverId).dropDatabase(database);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to drop database" },
      { status: 500 }
    );
  }
}
