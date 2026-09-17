import { NextResponse } from "next/server";
import { getConnection } from "@/lib/db";

interface CopyRequest {
  targetName?: string;
  includeData?: boolean;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string; database: string }> }
) {
  const { serverId, database } = await params;

  let connection: Awaited<ReturnType<typeof getConnection>> | undefined;
  try {
    const body = (await request.json()) as CopyRequest;
    const targetName = (body.targetName ?? "").trim();
    const includeData = body.includeData ?? true;

    if (!targetName || !/^[a-zA-Z0-9_$-]+$/.test(targetName)) {
      return NextResponse.json(
        { error: "Invalid database name. Use only letters, numbers, underscores, hyphens, or $." },
        { status: 400 }
      );
    }
    if (targetName === database) {
      return NextResponse.json(
        { error: "Target database name must differ from the source." },
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

    await conn.query(
      `CREATE DATABASE ${tgtIdent} /*!40100 DEFAULT CHARACTER SET utf8mb4 */`
    );

    await conn.query("SET FOREIGN_KEY_CHECKS=0");
    try {
      // Base tables first, then views (views may depend on base tables).
      const baseTables = tables.filter((t) => t.TABLE_TYPE === "BASE TABLE");
      const views = tables.filter((t) => t.TABLE_TYPE === "VIEW");

      for (const t of baseTables) {
        const tIdent = conn.escapeId(t.TABLE_NAME);
        await conn.query(
          `CREATE TABLE ${tgtIdent}.${tIdent} LIKE ${srcIdent}.${tIdent}`
        );
        if (includeData) {
          await conn.query(
            `INSERT INTO ${tgtIdent}.${tIdent} SELECT * FROM ${srcIdent}.${tIdent}`
          );
        }
      }

      for (const v of views) {
        const vIdent = conn.escapeId(v.TABLE_NAME);
        const [createRows] = await conn.query(
          `SHOW CREATE VIEW ${srcIdent}.${vIdent}`
        );
        const createSql = (createRows as Record<string, string>[])[0]?.["Create View"];
        if (!createSql) continue;
        // Rewrite the view to live in the target database.
        const rewritten = createSql.replace(
          new RegExp(`VIEW\\s+\`?${database}\`?\\.`),
          `VIEW ${tgtIdent}.`
        );
        const finalSql = rewritten.includes(`${tgtIdent}.`)
          ? rewritten
          : createSql.replace(/VIEW\s+`?[^`\s.]+`?(?=\s)/, `VIEW ${tgtIdent}.${vIdent}`);
        await conn.query(`USE ${tgtIdent}`);
        await conn.query(finalSql);
      }
    } finally {
      await conn.query("SET FOREIGN_KEY_CHECKS=1");
    }

    return NextResponse.json({ success: true, database: targetName });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Copy failed" },
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
