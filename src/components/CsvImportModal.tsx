"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnInfo } from "@/lib/types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, "" escapes, and newlines inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  // Drop a trailing empty row (file ending with a newline).
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Flatten a JSON array of objects into the same [header, ...rows] grid the CSV path produces.
 *  Accepts a bare array, or an object wrapping the array (e.g. { data: [...] }). Nested
 *  objects/arrays inside a cell are JSON-stringified so they survive the round-trip. */
function parseJson(text: string): string[][] {
  const data = JSON.parse(text);
  let records: unknown[];
  if (Array.isArray(data)) records = data;
  else if (data && typeof data === "object") {
    const arr = Object.values(data).find((v) => Array.isArray(v));
    records = Array.isArray(arr) ? (arr as unknown[]) : [data];
  } else {
    throw new Error("JSON must be an array of objects.");
  }
  const objects = records.filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r));
  if (objects.length === 0) throw new Error("JSON has no object rows to import.");
  // Header = union of keys, in first-seen order.
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const o of objects) for (const k of Object.keys(o)) if (!seen.has(k)) { seen.add(k); headers.push(k); }
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  return [headers, ...objects.map((o) => headers.map((h) => cell(o[h])))];
}

export default function CsvImportModal({
  serverId,
  database,
  table,
  columns,
  onClose,
}: {
  serverId: string;
  database: string;
  table: string;
  columns: ColumnInfo[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [parsed, setParsed] = useState<string[][] | null>(null);
  const [isJsonSource, setIsJsonSource] = useState(false);
  const [hasHeader, setHasHeader] = useState(true);
  // mapping: table column name -> CSV column index (or -1 to skip)
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const csvHeaders = useMemo(() => {
    if (!parsed || parsed.length === 0) return [];
    if (hasHeader) return parsed[0].map((h, i) => h.trim() || `Column ${i + 1}`);
    return parsed[0].map((_, i) => `Column ${i + 1}`);
  }, [parsed, hasHeader]);

  const dataRows = useMemo(() => (parsed ? (hasHeader ? parsed.slice(1) : parsed) : []), [parsed, hasHeader]);

  function onFile(file: File) {
    setError(null); setDone(null);
    file.text().then((text) => {
      const trimmed = text.trimStart();
      const isJson = /\.json$/i.test(file.name) || file.type === "application/json" || trimmed.startsWith("[") || trimmed.startsWith("{");
      let rows: string[][];
      if (isJson) {
        try { rows = parseJson(text); } catch (e: unknown) { setError(e instanceof Error ? e.message : "Could not parse JSON."); return; }
        setHasHeader(true); // JSON always carries its keys as the header row
        setIsJsonSource(true);
      } else {
        rows = parseCsv(text);
        setIsJsonSource(false);
      }
      if (rows.length === 0) { setError("That file has no rows."); return; }
      setParsed(rows);
      // Auto-map by matching header name to a table column (case-insensitive).
      const headers = (rows[0] || []).map((h) => h.trim().toLowerCase());
      const initial: Record<string, number> = {};
      for (const col of columns) {
        if (/auto_increment/i.test(col.Extra ?? "")) { initial[col.Field] = -1; continue; }
        const idx = headers.indexOf(col.Field.toLowerCase());
        initial[col.Field] = idx; // -1 if not found
      }
      setMapping(initial);
    });
  }

  const mappedCols = columns.filter((c) => (mapping[c.Field] ?? -1) >= 0);

  async function runImport() {
    if (mappedCols.length === 0) { setError("Map at least one column to import."); return; }
    setImporting(true); setError(null); setDone(null);
    try {
      const cols = mappedCols.map((c) => c.Field);
      const rows = dataRows.map((r) =>
        mappedCols.map((c) => {
          const v = r[mapping[c.Field]];
          return v === undefined || v === "" ? null : v; // blank cells → NULL
        })
      );
      const res = await fetch(`${BASE}/api/servers/${serverId}/databases/${database}/tables/${table}/import-csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columns: cols, rows }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setDone(j.message || `Imported ${rows.length} rows.`);
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[88vh]" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <h3 className="font-semibold">Import CSV / JSON into <span className="font-mono">{table}</span></h3>
          <button onClick={onClose} className="text-lg leading-none px-1" style={{ color: "var(--muted)" }}>&times;</button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <div className="flex items-center gap-3 flex-wrap">
            <input type="file" accept=".csv,text/csv,.json,application/json" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="text-sm" />
            {parsed && !isJsonSource && (
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
                First row is a header
              </label>
            )}
            {parsed && isJsonSource && (
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--muted-bg, rgba(127,127,127,0.15))", color: "var(--muted)" }}>JSON</span>
            )}
            {parsed && <span className="text-xs ml-auto" style={{ color: "var(--muted)" }}>{dataRows.length} data row{dataRows.length === 1 ? "" : "s"}</span>}
          </div>

          {parsed && (
            <>
              <div>
                <div className="text-sm font-semibold mb-1.5">Map columns</div>
                <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr><th className="text-left">Table column</th><th className="text-left">CSV column</th></tr>
                    </thead>
                    <tbody>
                      {columns.map((col) => (
                        <tr key={col.Field}>
                          <td className="font-mono">
                            {col.Field}
                            <span className="ml-1.5 text-xs" style={{ color: "var(--muted)" }}>{col.Type.split("(")[0]}{col.Key === "PRI" ? " · PK" : ""}</span>
                          </td>
                          <td>
                            <select
                              className="input text-xs py-0.5 w-full"
                              value={mapping[col.Field] ?? -1}
                              onChange={(e) => setMapping((m) => ({ ...m, [col.Field]: Number(e.target.value) }))}
                            >
                              <option value={-1}>— skip —</option>
                              {csvHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold mb-1.5">Preview</div>
                <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
                  <table className="w-full text-xs">
                    <thead><tr>{csvHeaders.map((h, i) => <th key={i} className="font-mono">{h}</th>)}</tr></thead>
                    <tbody>
                      {dataRows.slice(0, 5).map((r, ri) => (
                        <tr key={ri}>{csvHeaders.map((_, ci) => <td key={ci} className="font-mono">{r[ci] ?? ""}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
          {done && <p className="text-sm" style={{ color: "var(--success)" }}>✓ {done}</p>}
        </div>

        <div className="px-4 py-3 flex justify-end gap-2 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
          <button className="btn text-sm" onClick={onClose} disabled={importing}>{done ? "Close" : "Cancel"}</button>
          {parsed && !done && (
            <button className="btn btn-primary text-sm" onClick={runImport} disabled={importing || mappedCols.length === 0}>
              {importing ? "Importing…" : `Import ${dataRows.length} row${dataRows.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
