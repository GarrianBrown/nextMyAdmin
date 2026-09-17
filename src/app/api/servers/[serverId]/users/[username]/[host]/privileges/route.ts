import { NextResponse } from "next/server";
import { assertWritable } from "@/lib/readonly";
import { getConnection } from "@/lib/db";
import { escape } from "mysql2";
import { ALL_PRIVILEGES } from "@/lib/privileges";

type Params = { params: Promise<{ serverId: string; username: string; host: string }> };

const VALID_PRIVS = new Set(ALL_PRIVILEGES.map(p => p.sql));

export async function PUT(req: Request, { params }: Params) {
  const { serverId, username, host } = await params;
  const { global: globalPrivs, databases } = await req.json() as {
    global: string[];
    databases: { database: string; privileges: string[] }[];
  };

  for (const p of globalPrivs) {
    if (!VALID_PRIVS.has(p))
      return NextResponse.json({ error: `Invalid privilege: ${p}` }, { status: 400 });
  }
  for (const { database, privileges } of databases) {
    if (!database)
      return NextResponse.json({ error: "Missing database name" }, { status: 400 });
    for (const p of privileges) {
      if (!VALID_PRIVS.has(p))
        return NextResponse.json({ error: `Invalid privilege: ${p}` }, { status: 400 });
    }
  }

  const userIdent = `${escape(username)}@${escape(host)}`;

  let connection;
  try {
    assertWritable(serverId);
    connection = await getConnection(serverId);

    // Get current db-level grants so we know what to revoke
    const [currentDbRows] = await connection.query(
      "SELECT Db FROM mysql.db WHERE User = ? AND Host = ?",
      [username, host]
    );
    const currentDbs = (currentDbRows as { Db: string }[]).map(r => r.Db);

    // Revoke all global privileges
    await connection.query(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${userIdent}`);

    // Revoke all existing db-level privileges
    for (const db of currentDbs) {
      await connection.query(`REVOKE ALL PRIVILEGES, GRANT OPTION ON \`${db}\`.* FROM ${userIdent}`);
    }

    // Grant new global privileges
    const withGlobalGrant = globalPrivs.includes("GRANT OPTION");
    const actualGlobal = globalPrivs.filter(p => p !== "GRANT OPTION");
    if (actualGlobal.length > 0) {
      let sql = `GRANT ${actualGlobal.join(", ")} ON *.* TO ${userIdent}`;
      if (withGlobalGrant) sql += " WITH GRANT OPTION";
      await connection.query(sql);
    } else if (withGlobalGrant) {
      await connection.query(`GRANT USAGE ON *.* TO ${userIdent} WITH GRANT OPTION`);
    }

    // Grant new db-level privileges
    for (const { database, privileges } of databases) {
      if (privileges.length === 0) continue;
      const withDbGrant = privileges.includes("GRANT OPTION");
      const actualDb = privileges.filter(p => p !== "GRANT OPTION");
      if (actualDb.length > 0) {
        let sql = `GRANT ${actualDb.join(", ")} ON \`${database}\`.* TO ${userIdent}`;
        if (withDbGrant) sql += " WITH GRANT OPTION";
        await connection.query(sql);
      } else if (withDbGrant) {
        await connection.query(`GRANT USAGE ON \`${database}\`.* TO ${userIdent} WITH GRANT OPTION`);
      }
    }

    await connection.query("FLUSH PRIVILEGES");
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update privileges" },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
