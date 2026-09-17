"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface TableRow {
  name: string;
  structure: boolean;
  data: boolean;
}

export default function ExportPage() {
  const params = useParams<{ serverId: string; database: string }>();
  const serverId = params.serverId;
  const database = params.database;

  const [includeCreateDatabase, setIncludeCreateDatabase] = useState(true);
  const [dropTableIfExists, setDropTableIfExists] = useState(true);
  const [targetName, setTargetName] = useState(database);
  const [rows, setRows] = useState<TableRow[]>([]);
  const [loadingTables, setLoadingTables] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/databases/${database}/tables`
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (cancelled) return;
        const tables = (json as string[]).map((name) => ({
          name,
          structure: true,
          data: true,
        }));
        setRows(tables);
      } catch (e: unknown) {
        if (!cancelled) {
          setStatus({ type: "error", message: e instanceof Error ? e.message : String(e) });
        }
      } finally {
        if (!cancelled) setLoadingTables(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverId, database]);

  const allChecked =
    rows.length > 0 && rows.every((r) => r.structure && r.data);

  function toggleAll() {
    const next = !allChecked;
    setRows((prev) => prev.map((r) => ({ ...r, structure: next, data: next })));
  }

  function toggleRow(index: number, field: "structure" | "data") {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: !r[field] } : r))
    );
  }

  async function handleExport() {
    const selected = rows.filter((r) => r.structure || r.data);
    if (selected.length === 0) {
      setStatus({ type: "error", message: "Select at least one table to export." });
      return;
    }
    if (!targetName.trim()) {
      setStatus({ type: "error", message: "Target database name is required." });
      return;
    }

    setExporting(true);
    setStatus(null);

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/databases/${database}/export`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            includeCreateDatabase,
            dropTableIfExists,
            targetDatabaseName: targetName.trim(),
            tables: selected,
          }),
        }
      );

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = targetName.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
      a.download = `${safeName}.sql`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatus({ type: "success", message: `Exported ${selected.length} table(s) to ${safeName}.sql` });
    } catch (e: unknown) {
      setStatus({ type: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="max-w-3xl overflow-y-auto">
      <h1 className="text-xl font-bold mb-4">Export</h1>

      <div
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        className="rounded-lg p-6"
      >
        <div className="mb-4 flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeCreateDatabase}
              onChange={(e) => setIncludeCreateDatabase(e.target.checked)}
            />
            <span>Include <code className="font-mono text-xs">CREATE DATABASE</code> statement</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={dropTableIfExists}
              onChange={(e) => setDropTableIfExists(e.target.checked)}
            />
            <span>Add <code className="font-mono text-xs">DROP TABLE IF EXISTS</code> before each <code className="font-mono text-xs">CREATE TABLE</code></span>
          </label>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Target database name</label>
          <input
            type="text"
            className="input w-full"
            value={targetName}
            onChange={(e) => setTargetName(e.target.value)}
            placeholder={database}
          />
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            The exported SQL will create / use this database name. Defaults to the source name.
          </p>
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium">Tables</label>
            <button
              type="button"
              className="btn py-1 px-2 text-xs"
              onClick={toggleAll}
              disabled={rows.length === 0}
            >
              {allChecked ? "Uncheck all" : "Check all"}
            </button>
          </div>

          {loadingTables ? (
            <p className="text-xs" style={{ color: "var(--muted)" }}>Loading tables...</p>
          ) : rows.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--muted)" }}>No tables found in this database.</p>
          ) : (
            <div className="rounded-md overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              <table className="w-full">
                <thead>
                  <tr>
                    <th>Table</th>
                    <th style={{ width: "120px", textAlign: "center" }}>Structure</th>
                    <th style={{ width: "120px", textAlign: "center" }}>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={row.name}>
                      <td className="font-mono text-xs">{row.name}</td>
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={row.structure}
                          onChange={() => toggleRow(i, "structure")}
                        />
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={row.data}
                          onChange={() => toggleRow(i, "data")}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <button
          className="btn btn-primary"
          onClick={handleExport}
          disabled={exporting || loadingTables || rows.length === 0}
        >
          {exporting ? "Exporting..." : "Export SQL"}
        </button>

        {status && (
          <div
            className="mt-4 rounded-md p-4 text-sm"
            style={
              status.type === "success"
                ? { background: "color-mix(in srgb, var(--success) 10%, transparent)", border: "1px solid var(--success)" }
                : { background: "color-mix(in srgb, var(--danger) 10%, transparent)", border: "1px solid var(--danger)" }
            }
          >
            <p
              className="font-semibold"
              style={{ color: status.type === "success" ? "var(--success)" : "var(--danger)" }}
            >
              {status.type === "success" ? "Success" : "Error"}
            </p>
            <p className="mt-1">{status.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
