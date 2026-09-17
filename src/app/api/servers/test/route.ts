import { NextResponse } from "next/server";
import { buildDriver } from "@/lib/drivers";
import { normalizeServerInput, validateServerInput } from "@/lib/serverInput";

// Try an unsaved connection: build a driver from the posted config and do a
// lightweight round-trip (list databases). Returns { ok } or { ok:false, error }.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = normalizeServerInput(body);
    const invalid = validateServerInput(input);
    if (invalid) return NextResponse.json({ ok: false, error: invalid });

    const driver = buildDriver({ ...input, id: "__test__" });
    const databases = await driver.listDatabases();
    return NextResponse.json({ ok: true, databases: databases.length });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Connection failed" });
  }
}
