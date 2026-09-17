import { NextResponse } from "next/server";
import { assertWritable } from "@/lib/readonly";
import { getConnection } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string; database: string }> }
) {
  const { serverId, database } = await params;
  let connection;
  try {
    assertWritable(serverId);
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    connection = await getConnection(serverId, database);

    if (fileName.endsWith(".sql")) {
      const text = await file.text();
      const fullSql = `USE \`${database}\`;\n${text}`;
      await connection.query(fullSql);
      return NextResponse.json({
        message: `SQL file "${file.name}" imported successfully.`,
      });
    }

    if (fileName.endsWith(".csv")) {
      const table = formData.get("table") as string | null;
      if (!table) {
        return NextResponse.json(
          { error: 'A "table" form field is required for CSV imports' },
          { status: 400 }
        );
      }

      const text = await file.text();
      const lines = parseCsv(text);

      if (lines.length < 2) {
        return NextResponse.json(
          { error: "CSV file must have a header row and at least one data row" },
          { status: 400 }
        );
      }

      const headers = lines[0];
      const dataRows = lines.slice(1);
      const columnList = headers.map((h) => `\`${h}\``).join(", ");

      await connection.query(`USE \`${database}\``);

      let insertedRows = 0;
      // Process in batches of 100
      for (let i = 0; i < dataRows.length; i += 100) {
        const batch = dataRows.slice(i, i + 100);
        const placeholderRow = `(${headers.map(() => "?").join(", ")})`;
        const placeholders = batch.map(() => placeholderRow).join(", ");
        const values = batch.flat();

        await connection.query(
          `INSERT INTO \`${table}\` (${columnList}) VALUES ${placeholders}`,
          values
        );
        insertedRows += batch.length;
      }

      return NextResponse.json({
        message: `CSV file "${file.name}" imported successfully. ${insertedRows} row(s) inserted into \`${table}\`.`,
      });
    }

    return NextResponse.json(
      { error: "Unsupported file type. Only .sql and .csv files are supported." },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(current);
        current = "";
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && i + 1 < text.length && text[i + 1] === "\n") {
          i++; // skip \r\n
        }
        row.push(current);
        current = "";
        if (row.some((cell) => cell !== "")) {
          rows.push(row);
        }
        row = [];
      } else {
        current += char;
      }
    }
  }

  // Handle last row (no trailing newline)
  if (current || row.length > 0) {
    row.push(current);
    if (row.some((cell) => cell !== "")) {
      rows.push(row);
    }
  }

  return rows;
}
