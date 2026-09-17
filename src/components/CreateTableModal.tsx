"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Engine } from "@/lib/drivers/types";
import { PlusIcon, TrashIcon } from "./icons";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

interface ColRow {
  name: string;
  type: string;
  nullable: boolean;
  default: string;
  autoIncrement: boolean;
  primary: boolean;
}

// Common types offered as a datalist per engine (free-text is still allowed).
const TYPE_SUGGESTIONS: Record<string, string[]> = {
  mysql: ["INT", "BIGINT", "VARCHAR(255)", "TEXT", "DATETIME", "TIMESTAMP", "DATE", "DECIMAL(10,2)", "TINYINT(1)", "FLOAT", "JSON"],
  mariadb: ["INT", "BIGINT", "VARCHAR(255)", "TEXT", "DATETIME", "TIMESTAMP", "DATE", "DECIMAL(10,2)", "TINYINT(1)", "FLOAT", "JSON"],
  postgres: ["INTEGER", "BIGINT", "VARCHAR(255)", "TEXT", "TIMESTAMP", "DATE", "NUMERIC(10,2)", "BOOLEAN", "JSONB", "UUID"],
  sqlite: ["INTEGER", "TEXT", "REAL", "BLOB", "NUMERIC"],
};

function newRow(partial: Partial<ColRow> = {}): ColRow {
  return { name: "", type: "", nullable: true, default: "", autoIncrement: false, primary: false, ...partial };
}

export default function CreateTableModal({
  serverId,
  database,
  engine,
  onClose,
}: {
  serverId: string;
  database: string;
  engine: Engine;
  onClose: () => void;
}) {
  const router = useRouter();
  const isMongo = engine === "mongodb";
  const [name, setName] = useState("");
  const [rows, setRows] = useState<ColRow[]>(
    isMongo ? [] : [newRow({ name: "id", type: engine === "sqlite" ? "INTEGER" : engine === "postgres" ? "INTEGER" : "INT", autoIncrement: true, primary: true, nullable: false })]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typeList = TYPE_SUGGESTIONS[engine] ?? [];

  function setRow(i: number, patch: Partial<ColRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, newRow()]);
  }
  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }

  async function save() {
    const tableName = name.trim();
    if (!tableName) {
      setError(`${isMongo ? "Collection" : "Table"} name is required.`);
      return;
    }
    let columns: unknown[] = [];
    let primaryKey: string[] = [];
    if (!isMongo) {
      const named = rows.filter((r) => r.name.trim());
      if (named.length === 0) {
        setError("Add at least one column.");
        return;
      }
      columns = named.map((r) => ({
        name: r.name.trim(),
        type: r.type.trim() || "TEXT",
        nullable: r.nullable && !r.primary,
        default: r.default.trim() === "" ? null : r.default.trim(),
        autoIncrement: r.autoIncrement,
      }));
      primaryKey = named.filter((r) => r.primary).map((r) => r.name.trim());
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/servers/${serverId}/databases/${database}/tables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tableName, columns, primaryKey }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      onClose();
      router.push(`/server/${serverId}/${database}/${encodeURIComponent(tableName)}`);
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-lg shadow-xl w-full max-w-3xl flex flex-col max-h-[88vh]" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <h3 className="font-semibold">Create {isMongo ? "collection" : "table"}</h3>
          <button onClick={onClose} className="text-lg leading-none px-1" style={{ color: "var(--muted)" }}>&times;</button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <label className="block text-sm">
            <span className="block mb-1" style={{ color: "var(--muted)" }}>{isMongo ? "Collection" : "Table"} name</span>
            <input className="input w-full font-mono" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder={isMongo ? "my_collection" : "my_table"} spellCheck={false} />
          </label>

          {!isMongo && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold">Columns</span>
                <button className="btn text-xs ml-auto py-0.5" type="button" onClick={addRow}>
                  <PlusIcon style={{ width: 12, height: 12 }} /> Add column
                </button>
              </div>
              <datalist id="nma-type-suggestions">
                {typeList.map((t) => <option key={t} value={t} />)}
              </datalist>
              <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 130 }}>Name</th>
                      <th style={{ minWidth: 130 }}>Type</th>
                      <th title="Nullable">Null</th>
                      <th style={{ minWidth: 110 }}>Default</th>
                      <th title="Auto increment">A_I</th>
                      <th title="Primary key">PK</th>
                      <th style={{ width: "1%" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td><input className="input w-full font-mono text-xs" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder="col_name" spellCheck={false} /></td>
                        <td><input className="input w-full font-mono text-xs" list="nma-type-suggestions" value={r.type} onChange={(e) => setRow(i, { type: e.target.value })} placeholder="type" spellCheck={false} /></td>
                        <td className="text-center"><input type="checkbox" checked={r.nullable && !r.primary} disabled={r.primary} onChange={(e) => setRow(i, { nullable: e.target.checked })} /></td>
                        <td><input className="input w-full font-mono text-xs" value={r.default} onChange={(e) => setRow(i, { default: e.target.value })} placeholder="NULL" spellCheck={false} /></td>
                        <td className="text-center"><input type="checkbox" checked={r.autoIncrement} onChange={(e) => setRow(i, { autoIncrement: e.target.checked, nullable: e.target.checked ? false : r.nullable })} /></td>
                        <td className="text-center"><input type="checkbox" checked={r.primary} onChange={(e) => setRow(i, { primary: e.target.checked, nullable: e.target.checked ? false : r.nullable })} /></td>
                        <td>
                          <button className="inline-flex items-center px-1 py-0.5 rounded" style={{ color: "var(--danger)" }} type="button" onClick={() => removeRow(i)} title="Remove column" disabled={rows.length === 1}>
                            <TrashIcon style={{ width: 13, height: 13 }} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                Tip: check <span className="font-mono">A_I</span> on your primary-key column for an auto-incrementing id.
              </p>
            </div>
          )}

          {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        </div>

        <div className="px-4 py-3 flex justify-end gap-2 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
          <button className="btn text-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary text-sm" onClick={save} disabled={saving}>{saving ? "Creating…" : `Create ${isMongo ? "collection" : "table"}`}</button>
        </div>
      </div>
    </div>
  );
}
