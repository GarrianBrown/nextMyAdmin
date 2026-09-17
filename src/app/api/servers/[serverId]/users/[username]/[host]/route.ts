import { NextResponse } from "next/server";
import { getConnection } from "@/lib/db";
import { escape } from "mysql2";
import { ALL_PRIVILEGES } from "@/lib/privileges";

type Params = { params: Promise<{ serverId: string; username: string; host: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { serverId, username, host } = await params;
  let connection;
  try {
    connection = await getConnection(serverId);

    const [userRows] = await connection.query(
      "SELECT * FROM mysql.user WHERE User = ? AND Host = ?",
      [username, host]
    );
    const userRow = (userRows as Record<string, string>[])[0];
    if (!userRow) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const globalPrivileges = ALL_PRIVILEGES
      .filter(p => userRow[p.col] === "Y")
      .map(p => p.sql);

    const [dbRows] = await connection.query(
      "SELECT * FROM mysql.db WHERE User = ? AND Host = ?",
      [username, host]
    );
    const databasePrivileges = (dbRows as Record<string, string>[]).map(row => ({
      database: row.Db,
      privileges: ALL_PRIVILEGES
        .filter(p => p.dbLevel && row[p.col] === "Y")
        .map(p => p.sql),
    }));

    const [grantedRoleRows] = await connection.query(
      `SELECT FROM_USER AS role_user, FROM_HOST AS role_host
         FROM mysql.role_edges
        WHERE TO_USER = ? AND TO_HOST = ?
        ORDER BY FROM_USER, FROM_HOST`,
      [username, host]
    );
    const [defaultRoleRows] = await connection.query(
      `SELECT DEFAULT_ROLE_USER AS role_user, DEFAULT_ROLE_HOST AS role_host
         FROM mysql.default_roles
        WHERE USER = ? AND HOST = ?`,
      [username, host]
    );
    const defaultSet = new Set(
      (defaultRoleRows as { role_user: string; role_host: string }[])
        .map(r => `${r.role_user}@${r.role_host}`)
    );
    const grantedRoles = (grantedRoleRows as { role_user: string; role_host: string }[]).map(r => ({
      user: r.role_user,
      host: r.role_host,
      isDefault: defaultSet.has(`${r.role_user}@${r.role_host}`),
    }));

    return NextResponse.json({ username, host, globalPrivileges, databasePrivileges, grantedRoles });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get user" },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { serverId, username, host } = await params;
  let connection;
  try {
    connection = await getConnection(serverId);
    await connection.query(`DROP USER ${escape(username)}@${escape(host)}`);
    await connection.query("FLUSH PRIVILEGES");
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to drop user" },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
