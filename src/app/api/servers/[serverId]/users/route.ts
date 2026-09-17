import { NextResponse } from "next/server";
import { getConnection } from "@/lib/db";
import { escape } from "mysql2";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const { serverId } = await params;
  let connection;
  try {
    connection = await getConnection(serverId);
    const [rows] = await connection.query(
      "SELECT User, Host, account_locked FROM mysql.user ORDER BY User, Host"
    );
    const [roleRows] = await connection.query(
      "SELECT DISTINCT FROM_USER AS User, FROM_HOST AS Host FROM mysql.role_edges"
    );
    const roleSet = new Set(
      (roleRows as { User: string; Host: string }[]).map(r => `${r.User}@${r.Host}`)
    );
    const annotated = (rows as { User: string; Host: string; account_locked: string }[]).map(r => ({
      ...r,
      isRole: roleSet.has(`${r.User}@${r.Host}`),
    }));
    return NextResponse.json(annotated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list users" },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const { serverId } = await params;
  const { username, host, password } = await req.json();

  if (!username || !host || typeof username !== "string" || typeof host !== "string") {
    return NextResponse.json({ error: "Username and host are required" }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_$%.@-]{1,32}$/.test(username)) {
    return NextResponse.json({ error: "Invalid username" }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_$.%-]{1,60}$/.test(host)) {
    return NextResponse.json({ error: "Invalid host" }, { status: 400 });
  }

  let connection;
  try {
    connection = await getConnection(serverId);
    await connection.query(
      `CREATE USER ${escape(username)}@${escape(host)} IDENTIFIED BY ${escape(password ?? "")}`
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create user" },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
