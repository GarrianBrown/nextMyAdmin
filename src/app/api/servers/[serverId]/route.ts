import { NextResponse } from "next/server";
import { removeServer, getServerConfig } from "@/lib/db";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const { serverId } = await params;
  try {
    const server = getServerConfig(serverId);
    if (server?.managed) {
      return NextResponse.json(
        { error: "This is a managed local server — stop it from the Local Servers panel instead." },
        { status: 400 }
      );
    }
    removeServer(serverId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to remove connection" },
      { status: 500 }
    );
  }
}
