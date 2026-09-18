import { NextResponse } from "next/server";
import { removeServer, getServerConfig, updateServer } from "@/lib/db";
import { normalizeServerInput, validateServerInput } from "@/lib/serverInput";

// Full config for one server — used to prefill the Edit Connection form.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const { serverId } = await params;
  const server = getServerConfig(serverId);
  if (!server) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  return NextResponse.json({ server });
}

// Edit a saved connection (replace its details).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const { serverId } = await params;
  try {
    const existing = getServerConfig(serverId);
    if (!existing) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    if (existing.managed) {
      return NextResponse.json(
        { error: "This is a managed local server — it's controlled from the Local Servers panel and can't be edited here." },
        { status: 400 }
      );
    }
    const body = await request.json();
    const input = normalizeServerInput(body);
    const invalid = validateServerInput(input);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    const server = updateServer(serverId, input);
    return NextResponse.json({ server });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update connection" },
      { status: 500 }
    );
  }
}

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
