import { NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string; database: string }> }
) {
  const { serverId, database } = await params;
  const url = new URL(request.url);
  const download = url.searchParams.get("download");

  try {
    const body = await request.json();
    const { sql, page, pageSize } = body as {
      sql: string;
      page?: number;
      pageSize?: number;
    };

    if (!sql || typeof sql !== "string") {
      return NextResponse.json({ error: "SQL query is required" }, { status: 400 });
    }

    const result = await getDriver(serverId).runQuery(database, sql, {
      page,
      pageSize,
      download,
    });

    if (result.type === "csv") {
      return new Response(result.content, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="query_result.csv"',
        },
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Query execution failed" },
      { status: 400 }
    );
  }
}
