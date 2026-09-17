import { NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";
import { assertWritable } from "@/lib/readonly";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const { serverId } = await params;
  try {
    const databases = await getDriver(serverId).listDatabases();
    return NextResponse.json(databases);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list databases" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const { serverId } = await params;
  const { name } = await request.json();

  if (!name || typeof name !== "string" || !/^[a-zA-Z0-9_$-]+$/.test(name)) {
    return NextResponse.json(
      { error: "Invalid database name. Use only letters, numbers, underscores, hyphens, or $." },
      { status: 400 }
    );
  }

  try {
    assertWritable(serverId);
    await getDriver(serverId).createDatabase(name);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create database" },
      { status: 500 }
    );
  }
}
