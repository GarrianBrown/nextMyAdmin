import { NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ serverId: string; database: string; table: string }> }
) {
  const { serverId, database, table } = await params;
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.max(1, Math.min(1000, parseInt(url.searchParams.get("pageSize") || "25", 10)));
  const sortColumn = url.searchParams.get("sortColumn");
  const sortDirection = url.searchParams.get("sortDirection");

  // Filters arrive as a JSON array of { column, op, value } in the `filters` param.
  let filters;
  const filtersParam = url.searchParams.get("filters");
  if (filtersParam) {
    try {
      const parsed = JSON.parse(filtersParam);
      if (Array.isArray(parsed)) filters = parsed;
    } catch {
      /* ignore malformed filters */
    }
  }

  try {
    const result = await getDriver(serverId).browseTable(database, table, {
      page,
      pageSize,
      sortColumn,
      sortDirection,
      filters,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch table data" },
      { status: 500 }
    );
  }
}
