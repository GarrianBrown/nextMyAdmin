import { NextResponse } from "next/server";
import { getConfig, addServer } from "@/lib/db";
import { normalizeServerInput, validateServerInput } from "@/lib/serverInput";

export async function GET() {
  try {
    const config = getConfig();
    const servers = config.servers.map(({ id, name, host, port, engine }) => ({
      id,
      name,
      host,
      port,
      engine: engine ?? "mysql",
    }));
    return NextResponse.json(servers);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load config" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = normalizeServerInput(body);
    const invalid = validateServerInput(input);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    const server = addServer(input);
    return NextResponse.json({ server });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save connection" },
      { status: 500 }
    );
  }
}
