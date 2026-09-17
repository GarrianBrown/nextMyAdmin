import { NextResponse } from "next/server";
import { assertWritable } from "@/lib/readonly";
import { getConnection } from "@/lib/db";
import { escape } from "mysql2";

type Params = { params: Promise<{ serverId: string; username: string; host: string }> };

export async function PUT(req: Request, { params }: Params) {
  const { serverId, username, host } = await params;
  const { password } = await req.json();

  if (typeof password !== "string" || password.length === 0) {
    return NextResponse.json({ error: "Password is required" }, { status: 400 });
  }

  let connection;
  try {
    assertWritable(serverId);
    connection = await getConnection(serverId);
    await connection.query(
      `ALTER USER ${escape(username)}@${escape(host)} IDENTIFIED BY ${escape(password)}`
    );
    await connection.query("FLUSH PRIVILEGES");
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to change password" },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
