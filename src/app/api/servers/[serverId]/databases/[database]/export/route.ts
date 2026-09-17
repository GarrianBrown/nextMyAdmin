import { NextResponse } from "next/server";
import { getConnection } from "@/lib/db";

interface TableSelection {
  name: string;
  structure: boolean;
  data: boolean;
}

interface ExportRequest {
  includeCreateDatabase?: boolean;
  dropTableIfExists?: boolean;
  targetDatabaseName?: string;
  tables?: TableSelection[];
}

const ROWS_PER_INSERT = 200;

// The promise wrapper of mysql2 doesn't expose the underlying base Connection
// in its TypeScript types, but at runtime it lives at `.connection` and is what
// gives us access to the streaming Query API we need for large tables.
interface BaseQuery {
  stream(options?: { highWaterMark?: number }): NodeJS.ReadableStream & {
    destroy(error?: Error): void;
  };
}
interface BaseConnection {
  query(sql: string): BaseQuery;
}
interface ConnectionWithBase {
  connection: BaseConnection;
}

// mysql2 returns JSON columns as already-parsed objects/arrays. Passing these
// straight to connection.escape() produces "key = value" UPDATE-style strings
// (or "[object Object]") rather than a quoted JSON literal. Detect plain
// object/array values and JSON.stringify them first; let Date and Buffer fall
// through since escape() handles those correctly.
function escapeValue(
  conn: { escape(value: unknown): string },
  value: unknown
): string {
  if (
    value !== null &&
    typeof value === "object" &&
    !(value instanceof Date) &&
    !Buffer.isBuffer(value)
  ) {
    return conn.escape(JSON.stringify(value));
  }
  return conn.escape(value);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string; database: string }> }
) {
  const { serverId, database } = await params;

  let connection: Awaited<ReturnType<typeof getConnection>> | undefined;
  let connectionTransferred = false;

  try {
    const body = (await request.json()) as ExportRequest;
    const includeCreateDatabase = body.includeCreateDatabase ?? false;
    const dropTableIfExists = body.dropTableIfExists ?? false;
    const targetDatabaseName = body.targetDatabaseName?.trim() || database;
    const tables = Array.isArray(body.tables) ? body.tables : [];

    if (tables.length === 0) {
      return NextResponse.json(
        { error: "No tables selected for export" },
        { status: 400 }
      );
    }

    connection = await getConnection(serverId, database);

    // Validate selected tables exist before we start streaming the response —
    // once headers are sent, errors can only manifest as a truncated download.
    const [existingRows] = await connection.query("SHOW TABLES");
    const existingTables = new Set(
      (existingRows as Record<string, string>[]).map((r) => Object.values(r)[0])
    );
    for (const t of tables) {
      if (!t.structure && !t.data) continue;
      if (!existingTables.has(t.name)) {
        return NextResponse.json(
          { error: `Table "${t.name}" not found in database "${database}"` },
          { status: 400 }
        );
      }
    }

    const conn = connection;
    const encoder = new TextEncoder();
    const targetIdent = conn.escapeId(targetDatabaseName);
    const sourceIdent = conn.escapeId(database);

    // Track connection lifecycle so we close exactly once across the
    // start/cancel paths of the stream.
    let connClosed = false;
    const closeConn = async () => {
      if (connClosed) return;
      connClosed = true;
      try {
        await conn.end();
      } catch {
        // Connection may already be torn down — nothing to do.
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enqueue = (s: string) => controller.enqueue(encoder.encode(s));

        try {
          enqueue(`-- nextMyAdmin SQL Dump\n`);
          enqueue(`-- Source database: ${sourceIdent}\n`);
          if (targetDatabaseName !== database) {
            enqueue(`-- Target database: ${targetIdent}\n`);
          }
          enqueue(`-- Generated: ${new Date().toISOString()}\n\n`);
          enqueue(`SET FOREIGN_KEY_CHECKS=0;\n`);
          enqueue(`SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n`);
          enqueue(`SET NAMES utf8mb4;\n\n`);

          if (includeCreateDatabase) {
            enqueue(
              `CREATE DATABASE IF NOT EXISTS ${targetIdent} /*!40100 DEFAULT CHARACTER SET utf8mb4 */;\n`
            );
            enqueue(`USE ${targetIdent};\n\n`);
          }

          for (const table of tables) {
            if (!table.structure && !table.data) continue;
            const tableIdent = conn.escapeId(table.name);

            if (table.structure) {
              enqueue(`--\n-- Table structure for table ${tableIdent}\n--\n`);
              if (dropTableIfExists) {
                enqueue(`DROP TABLE IF EXISTS ${tableIdent};\n`);
              }
              const [createRows] = await conn.query(`SHOW CREATE TABLE ${tableIdent}`);
              const createRow = (createRows as Record<string, string>[])[0];
              const createSql =
                createRow["Create Table"] ?? createRow["Create View"] ?? "";
              enqueue(`${createSql};\n\n`);
            }

            if (table.data) {
              enqueue(`--\n-- Data for table ${tableIdent}\n--\n`);

              // Use the underlying base connection to get a streaming Query.
              // The promise wrapper exposes it via `.connection`.
              const baseConn = (conn as unknown as ConnectionWithBase).connection;
              const rowStream = baseConn
                .query(`SELECT * FROM ${tableIdent}`)
                .stream({ highWaterMark: 200 });

              let columns: string[] | null = null;
              let columnList = "";
              let batch: Record<string, unknown>[] = [];
              let hadRows = false;

              const flushBatch = () => {
                if (batch.length === 0 || !columns) return;
                const valueGroups = batch
                  .map((row) => {
                    const escapedValues = columns!
                      .map((col) => escapeValue(conn, row[col]))
                      .join(", ");
                    return `(${escapedValues})`;
                  })
                  .join(",\n  ");
                enqueue(
                  `INSERT INTO ${tableIdent} (${columnList}) VALUES\n  ${valueGroups};\n`
                );
                batch = [];
              };

              try {
                for await (const row of rowStream as AsyncIterable<
                  Record<string, unknown>
                >) {
                  hadRows = true;
                  if (!columns) {
                    columns = Object.keys(row);
                    columnList = columns
                      .map((c) => conn.escapeId(c))
                      .join(", ");
                  }
                  batch.push(row);
                  if (batch.length >= ROWS_PER_INSERT) {
                    flushBatch();
                  }
                }
                flushBatch();
                if (!hadRows) {
                  enqueue(`-- (no rows)\n`);
                }
              } catch (rowErr) {
                rowStream.destroy();
                throw rowErr;
              }

              enqueue(`\n`);
            }
          }

          enqueue(`SET FOREIGN_KEY_CHECKS=1;\n`);
          controller.close();
        } catch (e) {
          controller.error(e);
        } finally {
          await closeConn();
        }
      },
      async cancel() {
        await closeConn();
      },
    });

    connectionTransferred = true;

    const safeName = targetDatabaseName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `${safeName}.sql`;

    return new Response(stream, {
      headers: {
        "Content-Type": "application/sql; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export failed" },
      { status: 500 }
    );
  } finally {
    if (connection && !connectionTransferred) {
      try {
        await connection.end();
      } catch {
        // ignore
      }
    }
  }
}
