import { NextResponse } from "next/server";
import { getServerConfig, patchServer } from "@/lib/db";
import { buildDriver } from "@/lib/drivers";

/** Reachability check that bypasses the disconnected guard (we may be reconnecting). */
async function probe(serverId: string): Promise<{ reachable: boolean; error?: string }> {
  const server = getServerConfig(serverId);
  if (!server) return { reachable: false, error: "Connection not found" };
  try {
    await buildDriver(server).listDatabases();
    return { reachable: true };
  } catch (e) {
    return { reachable: false, error: e instanceof Error ? e.message : "Connection failed" };
  }
}

// op: "status" (probe only) | "connect" (probe, then mark online) | "disconnect" (mark offline)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const { serverId } = await params;
  try {
    const server = getServerConfig(serverId);
    if (!server) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    const { op } = await request.json().catch(() => ({ op: "status" }));

    if (op === "disconnect") {
      if (server.managed) {
        return NextResponse.json({ error: "Managed local servers are controlled from the Local Servers panel." }, { status: 400 });
      }
      patchServer(serverId, { disconnected: true });
      return NextResponse.json({ ok: true, disconnected: true });
    }

    if (op === "connect") {
      const result = await probe(serverId);
      if (!result.reachable) {
        // Couldn't reach it — leave it disconnected, like DBeaver keeps it closed on failure.
        return NextResponse.json({ ok: false, reachable: false, error: result.error }, { status: 502 });
      }
      patchServer(serverId, { disconnected: false });
      return NextResponse.json({ ok: true, reachable: true, disconnected: false });
    }

    // status (default): report reachability without changing state.
    const result = await probe(serverId);
    return NextResponse.json({ ok: true, disconnected: !!server.disconnected, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Connection action failed" },
      { status: 500 }
    );
  }
}
