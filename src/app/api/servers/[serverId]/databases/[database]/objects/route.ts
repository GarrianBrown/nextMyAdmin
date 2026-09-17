import { NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";
import { assertWritable } from "@/lib/readonly";

// GET lists views/routines/triggers; POST { action: "drop", kind, object } drops one.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string; database: string }> }
) {
  const { serverId, database } = await params;
  try {
    const objects = await getDriver(serverId).listDatabaseObjects(database);
    return NextResponse.json(objects);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list objects" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string; database: string }> }
) {
  const { serverId, database } = await params;
  try {
    assertWritable(serverId);
    const body = await request.json();
    if (body.action !== "drop") {
      return NextResponse.json({ error: `Unknown action "${body.action}"` }, { status: 400 });
    }
    const result = await getDriver(serverId).dropObject(database, body.kind, body.object);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Operation failed" },
      { status: 400 }
    );
  }
}
