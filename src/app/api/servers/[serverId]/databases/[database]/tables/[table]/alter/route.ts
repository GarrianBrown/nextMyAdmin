import { NextResponse } from "next/server";
import { assertWritable } from "@/lib/readonly";
import { getDriver } from "@/lib/drivers";

// Single schema/table-operation endpoint. The body carries an `action` plus its
// params; we dispatch to the matching driver method (capability-gated in the UI).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string; database: string; table: string }> }
) {
  const { serverId, database, table } = await params;
  try {
    assertWritable(serverId);
    const body = await request.json();
    const driver = getDriver(serverId);
    let result;
    switch (body.action) {
      case "addColumn":
        result = await driver.addColumn(database, table, body.def);
        break;
      case "changeColumn":
        result = await driver.changeColumn(database, table, body.oldName, body.def);
        break;
      case "dropColumn":
        result = await driver.dropColumn(database, table, body.column);
        break;
      case "addIndex":
        result = await driver.addIndex(database, table, body.def);
        break;
      case "dropIndex":
        result = await driver.dropIndex(database, table, body.name);
        break;
      case "truncateTable":
        result = await driver.truncateTable(database, table);
        break;
      case "renameTable":
        result = await driver.renameTable(database, table, body.newName);
        break;
      case "dropTable":
        result = await driver.dropTable(database, table);
        break;
      default:
        return NextResponse.json({ error: `Unknown action "${body.action}"` }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Operation failed" },
      { status: 400 }
    );
  }
}
