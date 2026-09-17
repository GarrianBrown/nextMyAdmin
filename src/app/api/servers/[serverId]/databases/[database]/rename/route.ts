import { NextResponse } from "next/server";
import { assertWritable } from "@/lib/readonly";
import { getConnection } from "@/lib/db";

interface RenameRequest {
  targetName?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string; database: string }> }
) {
  const { serverId, database } = await params;

  let connection: Awaited<ReturnType<typeof getConnection>> | undefined;
  try {
    assertWritable(serverId);
    const body = (await request.json()) as RenameRequest;
    const targetName = (body.targetName ?? "").trim();

    if (!targetName || !/^[a-zA-Z0-9_$-]+$/.test(targetName)) {
      return NextResponse.json(
        { error: "Invalid database name. Use only letters, numbers, underscores, hyphens, or $." },
        { status: 400 }
      );
    }
    if (targetName === database) {
      return NextResponse.json(
        { error: "New name must differ from the current name." },
        { status: 400 }
      );
    }

    connection = await getConnection(serverId);
    const conn = connection;

    const [existingRows] = await conn.query("SHOW DATABASES");
    const existing = new Set(
      (existingRows as Record<string, string>[]).map((r) => Object.values(r)[0])
    );
    if (existing.has(targetName)) {
      return NextResponse.json(
        { error: `Database "${targetName}" already exists.` },
        { status: 400 }
      );
    }

    const srcIdent = conn.escapeId(database);
    const tgtIdent = conn.escapeId(targetName);

    const [tableRows] = await conn.query(
      `SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
      [database]
    );
    const tables = tableRows as { TABLE_NAME: string; TABLE_TYPE: string }[];
    const baseTables = tables.filter((t) => t.TABLE_TYPE === "BASE TABLE");
    const views = tables.filter((t) => t.TABLE_TYPE === "VIEW");

    // Capture view definitions before we drop the old schema.
    const viewDefs: { name: string; sql: string }[] = [];
    for (const v of views) {
      const vIdent = conn.escapeId(v.TABLE_NAME);
      const [createRows] = await conn.query(`SHOW CREATE VIEW ${srcIdent}.${vIdent}`);
      const createSql = (createRows as Record<string, string>[])[0]?.["Create View"];
      if (createSql) viewDefs.push({ name: v.TABLE_NAME, sql: createSql });
    }

    await conn.query(
      `CREATE DATABASE ${tgtIdent} /*!40100 DEFAULT CHARACTER SET utf8mb4 */`
    );

    await conn.query("SET FOREIGN_KEY_CHECKS=0");
    try {
      for (const t of baseTables) {
        const tIdent = conn.escapeId(t.TABLE_NAME);
        await conn.query(
          `RENAME TABLE ${srcIdent}.${tIdent} TO ${tgtIdent}.${tIdent}`
        );
      }

      for (const v of viewDefs) {
        const vIdent = conn.escapeId(v.name);
        const rewritten = v.sql.replace(
          new RegExp(`VIEW\\s+\`?${database}\`?\\.`),
          `VIEW ${tgtIdent}.`
        );
        const finalSql = rewritten.includes(`${tgtIdent}.`)
          ? rewritten
          : v.sql.replace(/VIEW\s+`?[^`\s.]+`?(?=\s)/, `VIEW ${tgtIdent}.${vIdent}`);
        await conn.query(`USE ${tgtIdent}`);
        await conn.query(finalSql);
        await conn.query(`DROP VIEW IF EXISTS ${srcIdent}.${vIdent}`);
      }
    } finally {
      await conn.query("SET FOREIGN_KEY_CHECKS=1");
    }

    await conn.query(`DROP DATABASE ${srcIdent}`);

    return NextResponse.json({ success: true, database: targetName });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Rename failed" },
      { status: 500 }
    );
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch {
        // ignore
      }
    }
  }
}
