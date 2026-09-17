"use client";

import { useState, useRef, useEffect } from "react";
import SqlCodeEditor, { TableReferenceList, type TableReference } from "./SqlCodeEditor";
import ResultChart from "./ResultChart";
import EditRowModal from "./EditRowModal";
import type { ColumnInfo } from "@/lib/types";

interface SqlEditorProps {
  serverId: string;
  database: string;
  initialSql?: string;
  autoExecute?: boolean;
  /** Force the editor open (editable) even when seeded with initialSql. */
  startExpanded?: boolean;
  /** Keep the editor open above the results after running (phpMyAdmin-style docked view). */
  docked?: boolean;
}

interface EditableInfo {
  table: string;
  primaryKeys: string[];
  columns: ColumnInfo[];
}

interface SelectResult {
  type: "select";
  rows: Record<string, unknown>[];
  fields: string[];
  totalRows: number | null;
  page: number;
  pageSize: number;
  totalPages: number | null;
  executionTime: number;
  editable?: EditableInfo;
  prefixStatements?: number;
  prefixAffectedRows?: number;
}

interface ExecuteResult {
  type: "execute";
  affectedRows: number;
  message: string;
  executionTime: number;
}

type QueryResult = SelectResult | ExecuteResult;

export default function SqlEditor({ serverId, database, initialSql, autoExecute, startExpanded, docked }: SqlEditorProps) {
  const [sql, setSql] = useState(initialSql ?? "");
  const [expanded, setExpanded] = useState(startExpanded ?? !initialSql);
  const didAutoExecute = useRef(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const lastSqlRef = useRef("");
  const [references, setReferences] = useState<TableReference[]>([]);
  const [showChart, setShowChart] = useState(false);

  // Recent-query history, per connection+database.
  const historyKey = `nma-sqlhist:${serverId}:${database}`;
  const [history, setHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    try {
      const h = JSON.parse(localStorage.getItem(historyKey) || "[]");
      if (Array.isArray(h)) setHistory(h);
    } catch {
      /* ignore */
    }
  }, [historyKey]);
  function pushHistory(q: string) {
    const t = q.trim();
    if (!t) return;
    setHistory((prev) => {
      if (prev[0] === t) return prev;
      const next = [t, ...prev.filter((x) => x !== t)].slice(0, 50);
      try { localStorage.setItem(historyKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(null);
  const [insertingRow, setInsertingRow] = useState(false);
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<Record<string, unknown> | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function addTableReference(tableName: string) {
    if (references.some((r) => r.table === tableName)) return;
    setReferences((prev) =>
      prev.some((r) => r.table === tableName)
        ? prev
        : [...prev, { table: tableName, columns: null, loading: true, error: null }]
    );
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/databases/${database}/tables/${encodeURIComponent(tableName)}/structure`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setReferences((prev) =>
        prev.map((r) =>
          r.table === tableName ? { ...r, columns: json.columns as ColumnInfo[], loading: false } : r
        )
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setReferences((prev) =>
        prev.map((r) => (r.table === tableName ? { ...r, error: msg, loading: false } : r))
      );
    }
  }

  function removeTableReference(tableName: string) {
    setReferences((prev) => prev.filter((r) => r.table !== tableName));
  }

  useEffect(() => {
    if (autoExecute && initialSql && !didAutoExecute.current) {
      didAutoExecute.current = true;
      executeQuery();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function executeQuery(targetPage = 1, targetPageSize = pageSize) {
    const queryText = sql.trim();
    if (!queryText) return;
    setLoading(true);
    setError(null);

    if (queryText !== lastSqlRef.current) {
      targetPage = 1;
      setPage(1);
    }
    lastSqlRef.current = queryText;

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/databases/${database}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: queryText, page: targetPage, pageSize: targetPageSize }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setResult(json);
      pushHistory(queryText);
      setPage(targetPage);
      setPageSize(targetPageSize);
      // Docked mode keeps the editor open above the results (phpMyAdmin-style).
      if (!docked) setExpanded(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  async function exportCsv() {
    if (!sql.trim()) return;
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/databases/${database}/query?download=csv`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sql: sql.trim() }),
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
      a.download = `query-result-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function formatCell(value: unknown): string {
    if (value === null) return "NULL";
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "object") return JSON.stringify(value);
    if (typeof value === "string") {
      // Show JSON-serialized SQL datetimes phpMyAdmin-style ("YYYY-MM-DD HH:MM:SS").
      const m = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
      if (m) return `${m[1]} ${m[2]}`;
    }
    return String(value);
  }

  function formatSqlLiteral(value: unknown): string {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value instanceof Date) return `'${value.toISOString()}'`;
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  const isSelect = result?.type === "select";
  const selectResult = isSelect ? (result as SelectResult) : null;
  const hasPagination = selectResult?.totalRows !== null && selectResult?.totalPages !== null;
  const editable = selectResult?.editable ?? null;

  function buildDeleteSql(row: Record<string, unknown>): string {
    if (!editable) return "";
    const where = editable.primaryKeys
      .map((pk) => `\`${pk}\` = ${formatSqlLiteral(row[pk])}`)
      .join(" AND ");
    return `DELETE FROM \`${editable.table}\` WHERE ${where} LIMIT 1`;
  }

  async function handleDelete() {
    if (!confirmDeleteRow || !editable) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const pkValues: Record<string, unknown> = {};
      for (const pk of editable.primaryKeys) {
        pkValues[pk] = confirmDeleteRow[pk];
      }
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/databases/${database}/tables/${encodeURIComponent(editable.table)}/delete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ primaryKeys: pkValues }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setConfirmDeleteRow(null);
      executeQuery(page);
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      {/* SQL bar — collapsed or expanded */}
      {expanded ? (
        <div className="shrink-0 mb-2">
          <SqlCodeEditor
            value={sql}
            onChange={setSql}
            onSubmit={() => executeQuery()}
            serverId={serverId}
            database={database}
            rows={docked ? 4 : 6}
            placeholder="Enter SQL query... (Ctrl+Enter to execute; type @ to reference a table)"
            onAcceptTable={addTableReference}
          />
          <div className="flex items-center gap-2 mt-1.5">
            <button className="btn btn-primary py-1 px-3 text-xs" onClick={() => executeQuery()} disabled={loading || !sql.trim()}>
              {loading ? "Executing..." : "Execute"}
            </button>
            {isSelect && (
              <button className="btn py-1 px-3 text-xs" onClick={exportCsv}>Export CSV</button>
            )}
            {result && (
              <button className="btn py-1 px-3 text-xs" onClick={() => setExpanded(false)}>Collapse</button>
            )}
            {history.length > 0 && (
              <div className="relative">
                <button className="btn py-1 px-3 text-xs" data-active={showHistory} onClick={() => setShowHistory((v) => !v)} title="Recent queries">
                  History
                </button>
                {showHistory && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowHistory(false)} />
                    <div className="absolute left-0 mt-1 z-20 rounded-md shadow-lg overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)", width: 460, maxHeight: 320, overflowY: "auto" }}>
                      <div className="flex items-center justify-between px-3 py-1.5 text-xs" style={{ borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                        <span>Recent queries</span>
                        <button className="hover:underline" onClick={() => { setHistory([]); try { localStorage.removeItem(historyKey); } catch {} }}>Clear</button>
                      </div>
                      {history.map((q, i) => (
                        <button
                          key={i}
                          className="block w-full text-left px-3 py-1.5 font-mono text-xs hover:opacity-80 truncate"
                          style={{ borderBottom: "1px solid var(--border)", color: "var(--foreground)" }}
                          title={q}
                          onClick={() => { setSql(q); setShowHistory(false); setExpanded(true); }}
                        >
                          {q.replace(/\s+/g, " ").slice(0, 90)}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <span className="text-xs" style={{ color: "var(--muted)" }}>Ctrl+Enter</span>
          </div>
          <div className="mt-2">
            <TableReferenceList references={references} onRemove={removeTableReference} />
          </div>
        </div>
      ) : (
        <div
          className="shrink-0 mb-2 flex items-center gap-2 rounded px-2.5 py-1.5"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <code className="font-mono text-xs flex-1 truncate" style={{ color: "var(--muted)" }}>
            {sql}
          </code>
          <button
            className="btn py-0.5 px-2 text-xs shrink-0"
            onClick={() => setExpanded(true)}
          >
            Edit
          </button>
          {isSelect && (
            <button className="btn py-0.5 px-2 text-xs shrink-0" onClick={exportCsv}>CSV</button>
          )}
          {isSelect && (selectResult?.rows.length ?? 0) > 0 && (
            <button className="btn py-0.5 px-2 text-xs shrink-0" data-active={showChart} onClick={() => setShowChart((v) => !v)} title="Visualize as a chart">
              Chart
            </button>
          )}
          {editable && (
            <button
              className="btn btn-primary py-0.5 px-2 text-xs shrink-0"
              onClick={() => setInsertingRow(true)}
            >
              Insert row
            </button>
          )}
        </div>
      )}

      {/* Prefix statement summary */}
      {selectResult?.prefixStatements && selectResult.prefixStatements > 0 && (
        <div
          style={{ background: "color-mix(in srgb, var(--success) 10%, transparent)", border: "1px solid var(--success)" }}
          className="rounded-md px-3 py-1.5 text-xs mb-2 shrink-0"
        >
          <span style={{ color: "var(--success)" }}>
            {selectResult.prefixStatements} statement{selectResult.prefixStatements > 1 ? "s" : ""} executed
            {selectResult.prefixAffectedRows ? ` (${selectResult.prefixAffectedRows} row${selectResult.prefixAffectedRows !== 1 ? "s" : ""} affected)` : ""}
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", border: "1px solid var(--danger)" }}
          className="rounded-md p-3 text-sm mb-2 shrink-0"
        >
          <p className="font-semibold text-xs" style={{ color: "var(--danger)" }}>Error</p>
          <p className="mt-0.5 font-mono text-xs whitespace-pre-wrap">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="flex-1 min-h-0 flex flex-col">
          {selectResult ? (
            <>
              {showChart && selectResult.rows.length > 0 && (
                <div className="shrink-0">
                  <ResultChart rows={selectResult.rows} fields={selectResult.fields} />
                </div>
              )}
              <div className="flex-1 min-h-0 overflow-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
                <table className="w-full">
                  <thead>
                    <tr>
                      {editable && <th style={{ width: "1%", whiteSpace: "nowrap" }}>Actions</th>}
                      {selectResult.fields.map((field) => (
                        <th key={field}>{field}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selectResult.rows.length === 0 ? (
                      <tr>
                        <td colSpan={selectResult.fields.length + (editable ? 1 : 0)} className="text-center py-8" style={{ color: "var(--muted)" }}>
                          No rows returned.
                        </td>
                      </tr>
                    ) : (
                      selectResult.rows.map((row, i) => (
                        <tr key={i}>
                          {editable && (
                            <td>
                              <div className="flex gap-1">
                                <button
                                  className="text-xs px-2 py-0.5 rounded"
                                  style={{ color: "var(--primary)", border: "1px solid var(--primary)" }}
                                  onClick={() => setEditingRow(row)}
                                >
                                  Edit
                                </button>
                                <button
                                  className="text-xs px-2 py-0.5 rounded"
                                  style={{ color: "var(--danger)", border: "1px solid var(--danger)" }}
                                  onClick={() => { setConfirmDeleteRow(row); setDeleteError(null); }}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          )}
                          {selectResult.fields.map((field) => (
                            <td key={field} className="font-mono text-xs">
                              {row[field] === null ? (
                                <span style={{ color: "var(--muted)", fontStyle: "italic" }}>NULL</span>
                              ) : (
                                formatCell(row[field])
                              )}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination + stats */}
              <div className="flex items-center justify-between mt-2 text-sm shrink-0">
                <div className="flex items-center gap-3">
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {selectResult.totalRows !== null ? selectResult.totalRows.toLocaleString() : selectResult.rows.length} rows
                    &middot; {selectResult.executionTime}ms
                  </span>
                  {hasPagination && selectResult.totalPages! > 1 && (
                    <select
                      className="input text-xs py-0.5 px-1.5"
                      value={pageSize}
                      onChange={(e) => executeQuery(1, Number(e.target.value))}
                    >
                      {[10, 25, 50, 100].map((size) => (
                        <option key={size} value={size}>{size} / page</option>
                      ))}
                    </select>
                  )}
                </div>
                {hasPagination && selectResult.totalPages! > 1 && (
                  <div className="flex items-center gap-2">
                    <button className="btn py-1 px-2 text-xs" disabled={page <= 1 || loading} onClick={() => executeQuery(page - 1)}>Prev</button>
                    <span className="text-xs" style={{ color: "var(--muted)" }}>{selectResult.page} / {selectResult.totalPages}</span>
                    <button className="btn py-1 px-2 text-xs" disabled={page >= (selectResult.totalPages ?? 1) || loading} onClick={() => executeQuery(page + 1)}>Next</button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div
              style={{ background: "color-mix(in srgb, var(--success) 10%, transparent)", border: "1px solid var(--success)" }}
              className="rounded-md p-3 text-sm"
            >
              <p style={{ color: "var(--success)" }} className="font-semibold text-xs">Query executed successfully</p>
              {(result as ExecuteResult).affectedRows !== undefined && (
                <p className="mt-0.5 text-xs">{(result as ExecuteResult).affectedRows} row(s) affected.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Edit Row Modal */}
      {editingRow && editable && (
        <EditRowModal
          serverId={serverId}
          database={database}
          table={editable.table}
          columns={editable.columns.filter((c) => selectResult!.fields.includes(c.Field))}
          primaryKeys={editable.primaryKeys}
          row={editingRow}
          mode="edit"
          onClose={() => setEditingRow(null)}
          onSaved={() => { setEditingRow(null); executeQuery(page); }}
        />
      )}

      {/* Insert Row Modal */}
      {insertingRow && editable && (
        <EditRowModal
          serverId={serverId}
          database={database}
          table={editable.table}
          columns={editable.columns}
          primaryKeys={editable.primaryKeys}
          mode="insert"
          onClose={() => setInsertingRow(false)}
          onSaved={() => { setInsertingRow(false); executeQuery(page); }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {confirmDeleteRow && editable && (
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
              <button
                onClick={() => setConfirmDeleteRow(null)}
                disabled={deleting}
                className="text-lg leading-none px-1"
                style={{ color: "var(--muted)" }}
              >
                &times;
              </button>
            </div>

            <div className="p-4">
              <p className="text-sm mb-2">Are you sure you want to run this SQL?</p>
              <pre
                className="font-mono text-xs p-3 rounded whitespace-pre-wrap break-all"
                style={{ background: "var(--background)", border: "1px solid var(--border)" }}
              >
                {buildDeleteSql(confirmDeleteRow)}
              </pre>
              {deleteError && (
                <p className="text-xs mt-2" style={{ color: "var(--danger)" }}>{deleteError}</p>
              )}
            </div>

            <div className="px-4 py-3 flex justify-end gap-2 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
              <button className="btn" disabled={deleting} onClick={() => setConfirmDeleteRow(null)}>Cancel</button>
              <button
                className="btn"
                disabled={deleting}
                style={{ background: "var(--danger)", borderColor: "var(--danger)", color: "white" }}
                onClick={handleDelete}
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
