import { NextResponse } from "next/server";
import { buildDriver } from "@/lib/drivers";
import { getServerConfig } from "@/lib/db";
import { normalizeServerInput, validateServerInput, restoreSecrets } from "@/lib/serverInput";

// Try an unsaved connection: build a driver from the posted config and do a
// lightweight round-trip (list databases). Returns { ok } or { ok:false, error }.
// From the Edit form, `serverId` names the saved connection whose secrets fill in
// whatever the form left unchanged (it never sees them).
export async function POST(request: Request) {
  try {
    const { serverId, ...body } = await request.json();
    const saved = typeof serverId === "string" ? getServerConfig(serverId) : undefined;
    const input = normalizeServerInput(saved ? restoreSecrets(body, saved) : body);
    const invalid = validateServerInput(input);
    if (invalid) return NextResponse.json({ ok: false, error: invalid });

    const driver = buildDriver({ ...input, id: "__test__" });
    const databases = await driver.listDatabases();
    return NextResponse.json({ ok: true, databases: databases.length });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Connection failed" });
  }
}
