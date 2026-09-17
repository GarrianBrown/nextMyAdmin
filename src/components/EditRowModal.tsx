"use client";

import { useState, useEffect, useMemo } from "react";
import type { ColumnInfo, ForeignKeyInfo } from "@/lib/types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

interface EditRowModalProps {
  serverId: string;
  database: string;
  table: string;
  columns: ColumnInfo[];
  primaryKeys: string[];
  /** Existing row to edit. Required for `mode === "edit"`, ignored for `"insert"`. */
  row?: Record<string, unknown>;
  mode?: "edit" | "insert";
  foreignKeys?: ForeignKeyInfo[];
  onClose: () => void;
  onSaved: () => void;
}

function isAutoIncrement(col: ColumnInfo): boolean {
  return /auto_increment/i.test(col.Extra ?? "");
}

/**
 * Detects columns whose default is a SQL expression rather than a literal —
 * e.g. `uuid()`, `CURRENT_TIMESTAMP`, `now()`. MySQL 8+ flags these via
 * `DEFAULT_GENERATED` in the Extra column; for older MySQL/MariaDB we fall
 * back to inspecting the Default value itself.
 */
function hasGeneratedDefault(col: ColumnInfo): boolean {
  const extra = (col.Extra ?? "").toLowerCase();
  if (extra.includes("default_generated")) return true;
  const def = String(col.Default ?? "").toLowerCase();
  if (!def) return false;
  if (def === "current_timestamp" || def === "current_date" || def === "current_time") return true;
  // looks like a function call (e.g. uuid(), now())
  if (/\w+\s*\(/.test(def)) return true;
  return false;
}

export default function EditRowModal({
  serverId,
  database,
  table,
  columns,
  primaryKeys,
  row,
  mode = "edit",
  foreignKeys = [],
  onClose,
  onSaved,
}: EditRowModalProps) {
  const isInsert = mode === "insert";

  // Map FK column -> referenced table/column so we can offer a value picker.
  const fkByColumn = useMemo(() => {
    const m = new Map<string, { refTable: string; refColumn: string }>();
    for (const fk of foreignKeys) {
      if (fk.REFERENCED_TABLE_NAME && fk.REFERENCED_COLUMN_NAME) {
        m.set(fk.COLUMN_NAME, { refTable: fk.REFERENCED_TABLE_NAME, refColumn: fk.REFERENCED_COLUMN_NAME });
      }
    }
    return m;
  }, [foreignKeys]);

  // Fetched candidate values for each FK column (bounded), keyed by column name.
  const [fkOptions, setFkOptions] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = Array.from(fkByColumn.entries());
      await Promise.all(
        entries.map(async ([column, { refTable, refColumn }]) => {
          try {
            const params = new URLSearchParams({ page: "1", pageSize: "1000", sortColumn: refColumn, sortDirection: "asc" });
            const res = await fetch(`${BASE}/api/servers/${serverId}/databases/${database}/tables/${refTable}/data?${params}`);
            if (!res.ok) return;
            const body = await res.json();
            const vals = (body.rows as Record<string, unknown>[])
              .map((r) => r[refColumn])
              .filter((v) => v !== null && v !== undefined)
              .map((v) => String(v));
            if (!cancelled) setFkOptions((prev) => ({ ...prev, [column]: vals }));
          } catch {
            /* ignore — the column still works as a free-text input */
          }
        })
      );
    })();
    return () => { cancelled = true; };
  }, [fkByColumn, serverId, database]);

  // A "duplicate" is an insert seeded from an existing row.
  const isDuplicate = isInsert && !!row;

  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const col of columns) {
      if (isInsert) {
        if (row) {
          // Duplicate: copy the source row's values, but blank auto-increment
          // columns so the DB assigns a fresh key.
          const val = row[col.Field];
          if (isAutoIncrement(col)) initial[col.Field] = "";
          else if (val === null || val === undefined) initial[col.Field] = "";
          else if (typeof val === "object") initial[col.Field] = JSON.stringify(val);
          else initial[col.Field] = String(val);
        }
        // Leave generated/expression defaults blank — we'll omit them from
        // the INSERT so MySQL evaluates the expression itself. Pre-filling
        // with the literal "uuid()" would insert the string "uuid()".
        else if (hasGeneratedDefault(col)) {
          initial[col.Field] = "";
        } else if (col.Default !== null && col.Default !== undefined) {
          initial[col.Field] = String(col.Default);
        } else {
          initial[col.Field] = "";
        }
      } else {
        const val = row?.[col.Field];
        if (val === null || val === undefined) {
          initial[col.Field] = "";
        } else if (typeof val === "object") {
          // JSON columns arrive pre-parsed from the mysql2 driver; stringify
          // back so the user sees/edits the actual JSON, not "[object Object]".
          initial[col.Field] = JSON.stringify(val);
        } else {
          initial[col.Field] = String(val);
        }
      }
    }
    return initial;
  });

  const [nullFields, setNullFields] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const col of columns) {
      if (isInsert) {
        if (row) {
          // Duplicate: mirror the source row's NULLs (but never for auto-inc).
          if (row[col.Field] === null && !isAutoIncrement(col)) set.add(col.Field);
        } else if (col.Null === "YES" && (col.Default === null || col.Default === undefined)) {
          // Plain insert: NULL by default if nullable AND no explicit default.
          set.add(col.Field);
        }
      } else {
        if (row?.[col.Field] === null) set.add(col.Field);
      }
    }
    return set;
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function getInputType(col: ColumnInfo): string {
    const type = col.Type.toLowerCase();
    if (type.includes("datetime") || type.includes("timestamp")) return "datetime-local";
    if (type.includes("date")) return "date";
    if (type.includes("time") && !type.includes("timestamp")) return "time";
    return "text";
  }

  function isTextarea(col: ColumnInfo): boolean {
    const type = col.Type.toLowerCase();
    return type.includes("text") || type.includes("blob") || type.includes("json");
  }

  function formatValueForInput(col: ColumnInfo, value: string): string {
    const type = col.Type.toLowerCase();
    if ((type.includes("datetime") || type.includes("timestamp")) && value) {
      // Convert "2024-01-01 12:00:00" to "2024-01-01T12:00:00" for datetime-local input
      return value.replace(" ", "T").replace(/\.000Z$/, "");
    }
    return value;
  }

  function normalizeValueForDb(col: ColumnInfo, value: string): string {
    const type = col.Type.toLowerCase();
    if ((type.includes("datetime") || type.includes("timestamp")) && value) {
      // Possible inputs reaching here:
      //   "2026-04-10T00:42:47.000Z"  — untouched JSON-serialized Date from the API
      //   "2026-04-10T00:42:47"       — datetime-local input after user edits
      //   "2026-04-10T00:42"          — datetime-local input without seconds
      //   "2026-04-10 00:42:47"       — already MySQL format
      // MySQL accepts "YYYY-MM-DD HH:MM[:SS]" with no fractional seconds or TZ.
      return value
        .replace("T", " ")
        .replace(/(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/, "");
    }
    return value;
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    try {
      let res: Response;

      if (isInsert) {
        const insertValues: Record<string, unknown> = {};
        for (const col of columns) {
          // Skip auto-increment columns entirely so MySQL assigns the next value.
          if (isAutoIncrement(col)) continue;
          if (nullFields.has(col.Field)) {
            insertValues[col.Field] = null;
          } else {
            const v = values[col.Field];
            // For expression defaults (uuid(), CURRENT_TIMESTAMP, ...) — if the
            // user left it blank, omit so MySQL evaluates the default itself.
            if (hasGeneratedDefault(col) && v === "") continue;
            insertValues[col.Field] = normalizeValueForDb(col, v);
          }
        }

        res = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/databases/${database}/tables/${table}/insert`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ values: insertValues }),
          }
        );
      } else {
        if (!row) throw new Error("No row provided for edit");
        const pkValues: Record<string, unknown> = {};
        for (const pk of primaryKeys) {
          pkValues[pk] = row[pk];
        }

        const updates: Record<string, unknown> = {};
        for (const col of columns) {
          if (primaryKeys.includes(col.Field)) continue;
          if (nullFields.has(col.Field)) {
            updates[col.Field] = null;
          } else {
            updates[col.Field] = normalizeValueForDb(col, values[col.Field]);
          }
        }

        res = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/databases/${database}/tables/${table}/update`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ primaryKeys: pkValues, updates }),
          }
        );
      }

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        {/* Header */}
        <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <h3 className="font-semibold">{isDuplicate ? "Duplicate Row" : isInsert ? "Insert Row" : "Edit Row"}</h3>
          <button onClick={onClose} className="text-lg leading-none px-1" style={{ color: "var(--muted)" }}>&times;</button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {columns.map((col) => {
            const isPk = primaryKeys.includes(col.Field);
            const autoInc = isAutoIncrement(col);
            const isNull = nullFields.has(col.Field);
            const canBeNull = col.Null === "YES";
            const fk = fkByColumn.get(col.Field);
            const fkListId = fk ? `fk-${col.Field}` : undefined;

            // In edit mode, PK fields are read-only (you can't change a PK by editing).
            // In insert mode, only auto-increment columns are read-only (DB picks the value).
            const readOnly = isInsert ? autoInc : isPk;

            return (
              <div key={col.Field}>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">
                    {col.Field}
                    {isPk && <span className="ml-1 text-xs" style={{ color: "var(--primary)" }}>(PK)</span>}
                    {isInsert && autoInc && <span className="ml-1 text-xs" style={{ color: "var(--muted)" }}>(auto)</span>}
                    {fk && <span className="ml-1 text-xs" style={{ color: "var(--muted)" }} title={`references ${fk.refTable}.${fk.refColumn}`}>&#8594; {fk.refTable}</span>}
                    <span className="ml-2 text-xs font-normal" style={{ color: "var(--muted)" }}>{col.Type}</span>
                  </label>
                  {canBeNull && !readOnly && (
                    <label className="flex items-center gap-1 text-xs" style={{ color: "var(--muted)" }}>
                      <input
                        type="checkbox"
                        checked={isNull}
                        onChange={(e) => {
                          const next = new Set(nullFields);
                          if (e.target.checked) next.add(col.Field);
                          else next.delete(col.Field);
                          setNullFields(next);
                        }}
                      />
                      NULL
                    </label>
                  )}
                </div>
                {isTextarea(col) ? (
                  <textarea
                    className="input w-full font-mono text-xs"
                    rows={3}
                    disabled={readOnly || isNull}
                    placeholder={
                      isInsert && autoInc
                        ? "(auto-assigned)"
                        : isInsert && hasGeneratedDefault(col)
                          ? `default: ${col.Default ?? ""}`
                          : ""
                    }
                    value={isNull ? "" : values[col.Field]}
                    onChange={(e) => setValues((v) => ({ ...v, [col.Field]: e.target.value }))}
                  />
                ) : (
                  <input
                    type={getInputType(col)}
                    className="input w-full font-mono text-sm"
                    disabled={readOnly || isNull}
                    list={fkListId}
                    placeholder={
                      isInsert && autoInc
                        ? "(auto-assigned)"
                        : isInsert && hasGeneratedDefault(col)
                          ? `default: ${col.Default ?? ""}`
                          : fk
                            ? `pick from ${fk.refTable}`
                            : ""
                    }
                    value={isNull ? "" : formatValueForInput(col, values[col.Field])}
                    onChange={(e) => setValues((v) => ({ ...v, [col.Field]: e.target.value }))}
                  />
                )}
                {fk && fkOptions[col.Field] && (
                  <datalist id={fkListId}>
                    {fkOptions[col.Field].map((opt) => <option key={opt} value={opt} />)}
                  </datalist>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
          {error && <p className="text-xs mr-2 flex-1 truncate" style={{ color: "var(--danger)" }}>{error}</p>}
          <div className="flex gap-2 ml-auto">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : isInsert ? "Insert" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
