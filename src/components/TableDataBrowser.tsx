"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ColumnInfo, ForeignKeyInfo } from "@/lib/types";
import type { Engine, FilterCondition } from "@/lib/drivers/types";
import { FILTER_OPERATORS } from "@/lib/drivers/types";
import { getCapabilities } from "@/lib/drivers/capabilities";
import EditRowModal from "./EditRowModal";
import SqlEditor from "./SqlEditor";
import RowDetailPanel from "./RowDetailPanel";
import CsvImportModal from "./CsvImportModal";
import { EditIcon, TrashIcon, PlusIcon, SearchIcon, DownloadIcon, CopyIcon, SqlIcon } from "./icons";

interface TableDataBrowserProps {
  serverId: string;
  database: string;
  table: string;
  engine: Engine;
  columns: ColumnInfo[];
  foreignKeys?: ForeignKeyInfo[];
  readOnly?: boolean;
}

interface DataResponse {
  rows: Record<string, unknown>[];
  fields: string[];
  totalRows: number;
  page: number;
  pageSize: number;
  totalPages: number;
  executionTime: number;
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Operators that don't take a value.
const NO_VALUE_OPS = new Set(["IS NULL", "IS NOT NULL"]);

// Recognise a JSON-serialized SQL datetime so we can show it phpMyAdmin-style.
const ISO_DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function parseUrlFilters(raw: string): FilterCondition[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((f) => f && typeof f.column === "string" && typeof f.op === "string");
    }
  } catch {
    /* ignore */
  }
  return [];
}

export default function TableDataBrowser({ serverId, database, table, engine, columns, foreignKeys = [], readOnly = false }: TableDataBrowserProps) {
  const canWrite = !readOnly;
  // Identifier quoting for the *display-only* SQL previews (the actual queries
  // run server-side through the driver). MySQL/MariaDB use backticks; the other
  // relational engines use double quotes.
  const isMysqlFamily = engine === "mysql" || engine === "mariadb";
  const caps = getCapabilities(engine);
  const canQuery = caps.query; // false for MongoDB — no SQL console
  const quoteId = (id: string) =>
    isMysqlFamily ? `\`${id}\`` : `"${id.replace(/"/g, '""')}"`;

  const searchParams = useSearchParams();
  const urlFiltersRaw = searchParams.get("filters") ?? "";

  const [data, setData] = useState<DataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(null);
  const [insertingRow, setInsertingRow] = useState(false);
  const [duplicatingRow, setDuplicatingRow] = useState<Record<string, unknown> | null>(null);
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<Record<string, unknown> | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Inline SQL console: null = closed; a string = the SQL to seed the editor with.
  const [sqlConsole, setSqlConsole] = useState<string | null>(null);
  // Inline cell editing (double-click a cell).
  const [editingCell, setEditingCell] = useState<{ key: string; field: string } | null>(null);
  const [cellDraft, setCellDraft] = useState("");
  const [savingCell, setSavingCell] = useState(false);
  // Row detail sidebar (JSON view): the index of the row being shown, or null.
  const [detailIndex, setDetailIndex] = useState<number | null>(null);
  const [showImport, setShowImport] = useState(false);

  // --- filters ---
  const [filters, setFilters] = useState<FilterCondition[]>(() => parseUrlFilters(urlFiltersRaw));
  const [showFilters, setShowFilters] = useState(() => parseUrlFilters(urlFiltersRaw).length > 0);
  const [draft, setDraft] = useState<FilterCondition[]>(() => {
    const initial = parseUrlFilters(urlFiltersRaw);
    return initial.length ? initial : [{ column: columns[0]?.Field ?? "", op: "=", value: "" }];
  });

  // --- selection (bulk actions) ---
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);

  // When we navigate between tables (or arrive with URL filters), re-sync.
  const syncKey = `${table}|${urlFiltersRaw}`;
  const syncedRef = useRef(syncKey);
  useEffect(() => {
    if (syncedRef.current !== syncKey) {
      syncedRef.current = syncKey;
      const urlF = parseUrlFilters(urlFiltersRaw);
      setFilters(urlF);
      setShowFilters(urlF.length > 0);
      setDraft(urlF.length ? urlF : [{ column: columns[0]?.Field ?? "", op: "=", value: "" }]);
      setPage(1);
      setSelectedKeys(new Set());
    }
  }, [syncKey, urlFiltersRaw, columns]);

  const primaryKeys = columns.filter((c) => c.Key === "PRI").map((c) => c.Field);
  const hasPrimaryKey = primaryKeys.length > 0;

  // Map FK column -> referenced table/column for clickable navigation.
  const fkByColumn = useMemo(() => {
    const m = new Map<string, { refTable: string; refColumn: string }>();
    for (const fk of foreignKeys) {
      if (fk.REFERENCED_TABLE_NAME && fk.REFERENCED_COLUMN_NAME) {
        m.set(fk.COLUMN_NAME, { refTable: fk.REFERENCED_TABLE_NAME, refColumn: fk.REFERENCED_COLUMN_NAME });
      }
    }
    return m;
  }, [foreignKeys]);

  const rowKey = useCallback(
    (row: Record<string, unknown>) => JSON.stringify(primaryKeys.map((pk) => row[pk])),
    [primaryKeys]
  );

  function whereForDisplay(): string {
    if (filters.length === 0) return "";
    const parts = filters.map((f) => {
      if (NO_VALUE_OPS.has(f.op)) return `${quoteId(f.column)} ${f.op}`;
      return `${quoteId(f.column)} ${f.op} '${String(f.value ?? "").replace(/'/g, "''")}'`;
    });
    return ` WHERE ${parts.join(" AND ")}`;
  }

  function getCurrentQuery() {
    if (!canQuery) {
      const sort = sortColumn ? `.sort({ ${JSON.stringify(sortColumn)}: ${sortDirection === "desc" ? -1 : 1} })` : "";
      return `db.${table}.find({})${sort}`;
    }
    let q = `SELECT * FROM ${quoteId(table)}${whereForDisplay()}`;
    if (sortColumn) {
      q += ` ORDER BY ${quoteId(sortColumn)} ${sortDirection.toUpperCase()}`;
    }
    return q;
  }

  const filtersParam = filters.length ? JSON.stringify(filters) : "";

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (sortColumn) {
        params.set("sortColumn", sortColumn);
        params.set("sortDirection", sortDirection);
      }
      if (filtersParam) params.set("filters", filtersParam);
      const res = await fetch(
        `${BASE}/api/servers/${serverId}/databases/${database}/tables/${table}/data?${params}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [serverId, database, table, page, pageSize, sortColumn, sortDirection, filtersParam]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function handleSort(column: string) {
    if (sortColumn === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
    setPage(1);
  }

  // Open the inline SQL console, seeded with the query that produced the current view.
  function openConsole() {
    setSqlConsole(getCurrentQuery());
  }

  // --- filter bar actions ---
  function setDraftRow(i: number, patch: Partial<FilterCondition>) {
    setDraft((d) => d.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function addDraftRow() {
    setDraft((d) => [...d, { column: columns[0]?.Field ?? "", op: "=", value: "" }]);
  }
  function removeDraftRow(i: number) {
    setDraft((d) => (d.length <= 1 ? d : d.filter((_, idx) => idx !== i)));
  }
  function applyFilters() {
    const clean = draft.filter((f) => f.column && (NO_VALUE_OPS.has(f.op) || String(f.value ?? "").length > 0 || f.op === "=" || f.op === "!="));
    setFilters(clean);
    setSelectedKeys(new Set());
    setPage(1);
  }
  function clearFilters() {
    setFilters([]);
    setDraft([{ column: columns[0]?.Field ?? "", op: "=", value: "" }]);
    setSelectedKeys(new Set());
    setPage(1);
  }

  function formatCell(value: unknown): string {
    if (value === null) return "NULL";
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "object") return JSON.stringify(value);
    if (typeof value === "string") {
      const m = value.match(ISO_DATETIME);
      if (m) return `${m[1]} ${m[2]}`; // phpMyAdmin-style "YYYY-MM-DD HH:MM:SS"
    }
    return String(value);
  }

  function formatSqlLiteral(value: unknown): string {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value instanceof Date) return `'${value.toISOString()}'`;
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  function buildDeleteSql(row: Record<string, unknown>): string {
    if (!canQuery) {
      const filter = primaryKeys.map((pk) => `${JSON.stringify(pk)}: ${JSON.stringify(row[pk])}`).join(", ");
      return `db.${table}.deleteOne({ ${filter} })`;
    }
    const where = primaryKeys
      .map((pk) => `${quoteId(pk)} = ${formatSqlLiteral(row[pk])}`)
      .join(" AND ");
    return `DELETE FROM ${quoteId(table)} WHERE ${where}${isMysqlFamily ? " LIMIT 1" : ""}`;
  }

  async function deleteByPk(pkValues: Record<string, unknown>) {
    const res = await fetch(
      `${BASE}/api/servers/${serverId}/databases/${database}/tables/${table}/delete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryKeys: pkValues }),
      }
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  }

  async function handleDelete() {
    if (!confirmDeleteRow) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const pkValues: Record<string, unknown> = {};
      for (const pk of primaryKeys) pkValues[pk] = confirmDeleteRow[pk];
      await deleteByPk(pkValues);
      setConfirmDeleteRow(null);
      fetchData();
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  // --- bulk selection ---
  function toggleRow(row: Record<string, unknown>) {
    const key = rowKey(row);
    setSelectedKeys((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const pageRowKeys = data ? data.rows.map(rowKey) : [];
  const allPageSelected = pageRowKeys.length > 0 && pageRowKeys.every((k) => selectedKeys.has(k));
  function toggleSelectAll() {
    setSelectedKeys((s) => {
      const next = new Set(s);
      if (allPageSelected) pageRowKeys.forEach((k) => next.delete(k));
      else pageRowKeys.forEach((k) => next.add(k));
      return next;
    });
  }

  async function handleBulkDelete() {
    if (!data) return;
    const targets = data.rows.filter((r) => selectedKeys.has(rowKey(r)));
    if (targets.length === 0) return;
    if (!confirm(`Delete ${targets.length} selected row${targets.length === 1 ? "" : "s"}? This is permanent.`)) return;
    setBulkDeleting(true);
    setError(null);
    try {
      for (const row of targets) {
        const pkValues: Record<string, unknown> = {};
        for (const pk of primaryKeys) pkValues[pk] = row[pk];
        await deleteByPk(pkValues);
      }
      setSelectedKeys(new Set());
      fetchData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkDeleting(false);
    }
  }

  // --- inline cell editing ---
  function startEdit(row: Record<string, unknown>, field: string) {
    const v = row[field];
    setCellDraft(v === null || v === undefined ? "" : formatCell(v));
    setEditingCell({ key: rowKey(row), field });
  }

  async function saveCell(row: Record<string, unknown>) {
    if (!editingCell) return;
    const field = editingCell.field;
    setSavingCell(true);
    setError(null);
    try {
      const pkValues: Record<string, unknown> = {};
      for (const pk of primaryKeys) pkValues[pk] = row[pk];
      const res = await fetch(
        `${BASE}/api/servers/${serverId}/databases/${database}/tables/${table}/update`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ primaryKeys: pkValues, updates: { [field]: cellDraft } }),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setEditingCell(null);
      fetchData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setEditingCell(null);
    } finally {
      setSavingCell(false);
    }
  }

  // --- table export (CSV, respecting the active filter) ---
  function csvField(value: unknown): string {
    const s =
      value === null || value === undefined ? "" :
      value instanceof Date ? value.toISOString() :
      typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  async function handleExport(format: "csv" | "json" = "csv") {
    setExporting(true);
    setError(null);
    try {
      const CHUNK = 1000;
      let p = 1;
      let fields: string[] = [];
      const lines: string[] = [];               // CSV
      const objects: Record<string, unknown>[] = []; // JSON
      // Page through the table so exports aren't capped at one page.
      while (true) {
        const params = new URLSearchParams({ page: String(p), pageSize: String(CHUNK) });
        if (sortColumn) { params.set("sortColumn", sortColumn); params.set("sortDirection", sortDirection); }
        if (filtersParam) params.set("filters", filtersParam);
        const res = await fetch(`${BASE}/api/servers/${serverId}/databases/${database}/tables/${table}/data?${params}`);
        if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
        const chunk: DataResponse = await res.json();
        if (p === 1) { fields = chunk.fields; if (format === "csv") lines.push(fields.map(csvField).join(",")); }
        for (const row of chunk.rows) {
          if (format === "csv") lines.push(fields.map((f) => csvField(row[f])).join(","));
          else objects.push(row);
        }
        if (p >= (chunk.totalPages || 1) || chunk.rows.length === 0) break;
        p += 1;
      }
      const blob = format === "json"
        ? new Blob([JSON.stringify(objects, null, 2)], { type: "application/json" })
        : new Blob([lines.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${table}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  // SQL dump of the whole table (structure + data), streamed by the server.
  function handleExportSql() {
    const a = document.createElement("a");
    a.href = `${BASE}/api/servers/${serverId}/databases/${database}/tables/${table}/export?format=sql`;
    a.download = `${table}.sql`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Inline SQL console — editor + results together, right here in the Browse view.
  if (sqlConsole !== null) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-2 mb-2 shrink-0">
          <button
            className="btn text-xs py-0.5"
            onClick={() => { setSqlConsole(null); fetchData(); }}
            title="Return to the data grid"
          >
            ← Back to {table}
          </button>
          <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>SQL console</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>· Ctrl+Enter to run</span>
        </div>
        <SqlEditor serverId={serverId} database={database} initialSql={sqlConsole} startExpanded autoExecute docked />
      </div>
    );
  }

  if (loading && !data) {
    return <div className="py-8 text-center" style={{ color: "var(--muted)" }}>Loading data...</div>;
  }

  if (error && !data) {
    return (
      <div
        style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", border: "1px solid var(--danger)" }}
        className="rounded-md p-4 text-sm"
      >
        <p className="font-semibold" style={{ color: "var(--danger)" }}>Error loading data</p>
        <p className="mt-1">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const selectedCount = selectedKeys.size;
  const showChecks = hasPrimaryKey && canWrite; // bulk-select is only for deletes
  const extraCols = (showChecks ? 1 : 0) + (hasPrimaryKey ? 1 : 0); // checkbox? + actions

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Query bar — click the query to drop into the inline SQL console */}
      <div
        className="flex items-center gap-2 rounded px-2.5 py-1.5 mb-2"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        {canQuery ? (
          <code
            className="font-mono text-xs flex-1 truncate cursor-pointer hover:underline"
            style={{ color: "var(--muted)" }}
            onClick={openConsole}
            title="Edit as SQL in the console"
          >
            {getCurrentQuery()}
          </code>
        ) : (
          <code className="font-mono text-xs flex-1 truncate" style={{ color: "var(--muted)" }}>
            {getCurrentQuery()}
          </code>
        )}
        <button
          className="btn py-0.5 px-2 text-xs shrink-0"
          data-active={showFilters || filters.length > 0}
          onClick={() => setShowFilters((v) => !v)}
          title="Filter rows"
        >
          <SearchIcon style={{ width: 13, height: 13 }} />
          Filter{filters.length > 0 ? ` (${filters.length})` : ""}
        </button>
        <div className="relative shrink-0">
          <button
            className="btn py-0.5 px-2 text-xs"
            onClick={() => setExportMenu((v) => !v)}
            disabled={exporting}
            title="Export table"
          >
            <DownloadIcon style={{ width: 13, height: 13 }} />
            {exporting ? "Exporting…" : "Export"}
            <span style={{ marginLeft: 2 }}>▾</span>
          </button>
          {exportMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setExportMenu(false)} />
              <div className="absolute right-0 mt-1 z-20 rounded-md shadow-lg overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)", minWidth: 190 }}>
                <button className="block w-full text-left px-3 py-1.5 text-xs hover:opacity-80" style={{ borderBottom: "1px solid var(--border)" }} onClick={() => { setExportMenu(false); handleExport("csv"); }}>
                  CSV{filters.length > 0 ? " (filtered)" : ""}
                </button>
                <button className="block w-full text-left px-3 py-1.5 text-xs hover:opacity-80" style={{ borderBottom: caps.exportTableSql ? "1px solid var(--border)" : undefined }} onClick={() => { setExportMenu(false); handleExport("json"); }}>
                  JSON{filters.length > 0 ? " (filtered)" : ""}
                </button>
                {caps.exportTableSql && (
                  <button className="block w-full text-left px-3 py-1.5 text-xs hover:opacity-80" onClick={() => { setExportMenu(false); handleExportSql(); }}>
                    SQL (structure + data)
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        {canWrite && (
          <button className="btn py-0.5 px-2 text-xs shrink-0" onClick={() => setShowImport(true)} title="Import a CSV file into this table">
            Import
          </button>
        )}
        {canQuery && (
          <button className="btn py-0.5 px-2 text-xs shrink-0" onClick={openConsole} title="Open the SQL console">
            <SqlIcon style={{ width: 13, height: 13 }} />
            SQL
          </button>
        )}
        {canWrite ? (
          <button className="btn btn-primary py-0.5 px-2 text-xs shrink-0" onClick={() => setInsertingRow(true)}>
            <PlusIcon style={{ width: 13, height: 13 }} />
            Insert row
          </button>
        ) : (
          <span className="text-xs shrink-0 px-2 py-0.5 rounded" style={{ border: "1px solid var(--border)", color: "var(--muted)" }} title="This connection is read-only (safe mode)">
            Read-only
          </span>
        )}
      </div>

      {/* Filter builder */}
      {showFilters && (
        <div className="mb-2 rounded px-2.5 py-2 space-y-1.5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          {draft.map((f, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <select className="input text-xs py-0.5 font-mono" style={{ maxWidth: 180 }} value={f.column} onChange={(e) => setDraftRow(i, { column: e.target.value })}>
                {columns.map((c) => <option key={c.Field} value={c.Field}>{c.Field}</option>)}
              </select>
              <select className="input text-xs py-0.5" style={{ maxWidth: 110 }} value={f.op} onChange={(e) => setDraftRow(i, { op: e.target.value })}>
                {FILTER_OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
              </select>
              <input
                className="input text-xs py-0.5 flex-1 font-mono"
                value={f.value ?? ""}
                disabled={NO_VALUE_OPS.has(f.op)}
                placeholder={NO_VALUE_OPS.has(f.op) ? "—" : f.op === "LIKE" || f.op === "NOT LIKE" ? "%pattern%" : "value"}
                onChange={(e) => setDraftRow(i, { value: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
              />
              <button className="btn py-0.5 px-1.5 text-xs shrink-0" onClick={() => removeDraftRow(i)} disabled={draft.length <= 1} title="Remove condition">
                <TrashIcon style={{ width: 12, height: 12 }} />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-0.5">
            <button className="btn py-0.5 px-2 text-xs" onClick={addDraftRow}>
              <PlusIcon style={{ width: 12, height: 12 }} /> Add condition
            </button>
            <button className="btn btn-primary py-0.5 px-2 text-xs ml-auto" onClick={applyFilters}>Apply</button>
            <button className="btn py-0.5 px-2 text-xs" onClick={clearFilters} disabled={filters.length === 0 && draft.every((f) => !f.value)}>Clear</button>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {showChecks && selectedCount > 0 && (
        <div className="mb-2 rounded px-2.5 py-1.5 flex items-center gap-2 text-xs" style={{ background: "color-mix(in srgb, var(--primary) 8%, transparent)", border: "1px solid var(--primary)" }}>
          <span>{selectedCount} selected</span>
          <button className="btn btn-danger py-0.5 px-2 text-xs ml-auto" onClick={handleBulkDelete} disabled={bulkDeleting}>
            <TrashIcon style={{ width: 12, height: 12 }} />
            {bulkDeleting ? "Deleting…" : `Delete selected`}
          </button>
          <button className="btn py-0.5 px-2 text-xs" onClick={() => setSelectedKeys(new Set())} disabled={bulkDeleting}>Clear</button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex gap-2">
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <div className="flex-1 min-h-0 overflow-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full">
          <thead>
            <tr>
              {showChecks && (
                <th style={{ width: "1%", whiteSpace: "nowrap" }}>
                  <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAll} title="Select all on page" />
                </th>
              )}
              {hasPrimaryKey && <th style={{ width: "1%", whiteSpace: "nowrap" }}>Actions</th>}
              {data.fields.map((field) => (
                <th key={field} className="cursor-pointer select-none hover:underline" onClick={() => handleSort(field)}>
                  {field}
                  {fkByColumn.has(field) && <span className="ml-1" style={{ color: "var(--muted)" }} title="Foreign key">&#128279;</span>}
                  {sortColumn === field && (
                    <span className="ml-1">{sortDirection === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={data.fields.length + extraCols} className="text-center py-8" style={{ color: "var(--muted)" }}>
                  No rows found.
                </td>
              </tr>
            ) : (
              data.rows.map((row, i) => {
                const key = rowKey(row);
                const selected = selectedKeys.has(key);
                return (
                  <tr key={i} style={selected ? { background: "color-mix(in srgb, var(--primary) 8%, transparent)" } : undefined}>
                    {showChecks && (
                      <td>
                        <input type="checkbox" checked={selected} onChange={() => toggleRow(row)} />
                      </td>
                    )}
                    {hasPrimaryKey && (
                      <td>
                        <div className="flex gap-1">
                          <button
                            className="inline-flex items-center text-xs px-1.5 py-0.5 rounded transition-colors"
                            style={{ color: "var(--muted)", border: "1px solid var(--border)" }}
                            onClick={() => setDetailIndex(i)}
                            title="View row details (JSON)"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <rect x="3" y="4" width="18" height="16" rx="2" />
                              <path d="M14 4v16" />
                            </svg>
                          </button>
                          {canWrite && (
                            <>
                              <button
                                className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded transition-colors"
                                style={{ color: "var(--primary)", border: "1px solid var(--primary)" }}
                                onClick={() => setEditingRow(row)}
                                title="Edit row"
                              >
                                <EditIcon style={{ width: 12, height: 12 }} />
                                Edit
                              </button>
                              <button
                                className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded transition-colors"
                                style={{ color: "var(--muted)", border: "1px solid var(--border)" }}
                                onClick={() => setDuplicatingRow(row)}
                                title="Duplicate row"
                              >
                                <CopyIcon style={{ width: 12, height: 12 }} />
                              </button>
                              <button
                                className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded transition-colors"
                                style={{ color: "var(--danger)", border: "1px solid var(--danger)" }}
                                onClick={() => { setConfirmDeleteRow(row); setDeleteError(null); }}
                                title="Delete row"
                              >
                                <TrashIcon style={{ width: 12, height: 12 }} />
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                    {data.fields.map((field) => {
                      const value = row[field];
                      const fk = fkByColumn.get(field);
                      const cellEditable = canWrite && hasPrimaryKey && !primaryKeys.includes(field) && !fk;
                      const isEditing = editingCell?.key === key && editingCell?.field === field;
                      return (
                        <td
                          key={field}
                          className="font-mono text-xs"
                          onDoubleClick={cellEditable && !isEditing ? () => startEdit(row, field) : undefined}
                          style={cellEditable ? { cursor: "cell" } : undefined}
                          title={cellEditable && !isEditing ? "Double-click to edit (Enter to save, Esc to cancel)" : undefined}
                        >
                          {isEditing ? (
                            <input
                              autoFocus
                              className="input w-full font-mono text-xs py-0.5"
                              value={cellDraft}
                              disabled={savingCell}
                              onChange={(e) => setCellDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); saveCell(row); }
                                else if (e.key === "Escape") { e.preventDefault(); setEditingCell(null); }
                              }}
                              onBlur={() => setEditingCell(null)}
                            />
                          ) : value === null ? (
                            <span style={{ color: "var(--muted)", fontStyle: "italic" }}>NULL</span>
                          ) : value === undefined ? (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          ) : fk ? (
                            <Link
                              href={`/server/${serverId}/${database}/${encodeURIComponent(fk.refTable)}?filters=${encodeURIComponent(JSON.stringify([{ column: fk.refColumn, op: "=", value: String(value) }]))}`}
                              className="hover:underline"
                              style={{ color: "var(--primary)" }}
                              title={`View ${fk.refTable} where ${fk.refColumn} = ${String(value)}`}
                            >
                              {formatCell(value)} &rsaquo;
                            </Link>
                          ) : (
                            formatCell(value)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination + stats */}
      <div className="flex items-center justify-between mt-2 text-sm shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {data.totalRows.toLocaleString()} rows{filters.length > 0 ? " (filtered)" : ""} &middot; {data.executionTime}ms
            {loading && " · Refreshing..."}
          </span>
          <select className="input text-xs py-0.5 px-1.5" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
            {[10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>{size} / page</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn py-1 px-2 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
          <span className="text-xs" style={{ color: "var(--muted)" }}>{data.page} / {data.totalPages || 1}</span>
          <button className="btn py-1 px-2 text-xs" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>
      </div>
      {detailIndex !== null && detailIndex < data.rows.length && (
        <RowDetailPanel
          rows={data.rows}
          fields={data.fields}
          index={detailIndex}
          onIndexChange={setDetailIndex}
          onClose={() => setDetailIndex(null)}
        />
      )}
      </div>

      {/* Edit Modal */}
      {editingRow && (
        <EditRowModal
          serverId={serverId}
          database={database}
          table={table}
          columns={columns}
          primaryKeys={primaryKeys}
          row={editingRow}
          mode="edit"
          foreignKeys={foreignKeys}
          onClose={() => setEditingRow(null)}
          onSaved={() => { setEditingRow(null); fetchData(); }}
        />
      )}

      {/* Insert Modal */}
      {insertingRow && (
        <EditRowModal
          serverId={serverId}
          database={database}
          table={table}
          columns={columns}
          primaryKeys={primaryKeys}
          mode="insert"
          foreignKeys={foreignKeys}
          onClose={() => setInsertingRow(false)}
          onSaved={() => { setInsertingRow(false); fetchData(); }}
        />
      )}

      {/* CSV import */}
      {showImport && (
        <CsvImportModal
          serverId={serverId}
          database={database}
          table={table}
          columns={columns}
          onClose={() => { setShowImport(false); fetchData(); }}
        />
      )}

      {/* Duplicate Modal (insert seeded from a row) */}
      {duplicatingRow && (
        <EditRowModal
          serverId={serverId}
          database={database}
          table={table}
          columns={columns}
          primaryKeys={primaryKeys}
          mode="insert"
          row={duplicatingRow}
          foreignKeys={foreignKeys}
          onClose={() => setDuplicatingRow(null)}
          onSaved={() => { setDuplicatingRow(null); fetchData(); }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {confirmDeleteRow && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={(e) => { if (e.target === e.currentTarget && !deleting) setConfirmDeleteRow(null); }}
        >
          <div
            className="rounded-lg shadow-xl w-full max-w-lg flex flex-col"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
              <h3 className="font-semibold">Confirm delete</h3>
              <button onClick={() => setConfirmDeleteRow(null)} disabled={deleting} className="text-lg leading-none px-1" style={{ color: "var(--muted)" }}>&times;</button>
            </div>
            <div className="p-4">
              <p className="text-sm mb-2">Are you sure you want to run this SQL?</p>
              <pre className="font-mono text-xs p-3 rounded whitespace-pre-wrap break-all" style={{ background: "var(--background)", border: "1px solid var(--border)" }}>
                {buildDeleteSql(confirmDeleteRow)}
              </pre>
              {deleteError && <p className="text-xs mt-2" style={{ color: "var(--danger)" }}>{deleteError}</p>}
            </div>
            <div className="px-4 py-3 flex justify-end gap-2 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
              <button className="btn" disabled={deleting} onClick={() => setConfirmDeleteRow(null)}>Cancel</button>
              <button className="btn btn-danger" disabled={deleting} onClick={handleDelete}>
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
