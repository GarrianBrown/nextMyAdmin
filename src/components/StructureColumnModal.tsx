"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnInfo } from "@/lib/types";
import type { Engine } from "@/lib/drivers/types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function StructureColumnModal({
  serverId,
  database,
  table,
  engine,
  column,
  onClose,
}: {
  serverId: string;
  database: string;
  table: string;
  engine: Engine;
  column?: ColumnInfo; // present = edit mode
  onClose: () => void;
}) {
  const router = useRouter();
  const isEdit = !!column;
  const isSqlite = engine === "sqlite";
  const isMysql = engine === "mysql" || engine === "mariadb";

  const [name, setName] = useState(column?.Field ?? "");
  const [type, setType] = useState(column?.Type ?? "VARCHAR(255)");
  const [nullable, setNullable] = useState(column ? column.Null === "YES" : true);
  const [def, setDef] = useState(column?.Default ?? "");
  const [autoInc, setAutoInc] = useState(column ? /auto_increment/i.test(column.Extra ?? "") : false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SQLite can only rename an existing column.
  const lockNonName = isSqlite && isEdit;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        action: isEdit ? "changeColumn" : "addColumn",
        ...(isEdit ? { oldName: column!.Field } : {}),
        def: { name: name.trim(), type: type.trim(), nullable, default: def === "" ? null : def, autoIncrement: autoInc },
      };
      const res = await fetch(`${BASE}/api/servers/${serverId}/databases/${database}/tables/${table}/alter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      onClose();
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-lg shadow-xl w-full max-w-md flex flex-col" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <h3 className="font-semibold">{isEdit ? `Edit column "${column!.Field}"` : "Add column"}</h3>
          <button onClick={onClose} className="text-lg leading-none px-1" style={{ color: "var(--muted)" }}>&times;</button>
        </div>

        <div className="p-4 space-y-3">
          {lockNonName && (
            <p className="text-xs rounded p-2" style={{ background: "var(--surface)", color: "var(--muted)" }}>
              SQLite can only rename an existing column — type and constraints can’t be changed without rebuilding the table.
            </p>
          )}
          <Field label="Name">
            <input className="input w-full font-mono" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Type">
            <input className="input w-full font-mono" value={type} disabled={lockNonName} placeholder="VARCHAR(255), INT, TEXT…" onChange={(e) => setType(e.target.value)} />
          </Field>
          <Field label="Default (blank = none)">
            <input className="input w-full font-mono" value={def} disabled={lockNonName} placeholder="e.g. 0, '', CURRENT_TIMESTAMP" onChange={(e) => setDef(e.target.value)} />
          </Field>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={nullable} disabled={lockNonName} onChange={(e) => setNullable(e.target.checked)} /> Nullable</label>
            {isMysql && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoInc} onChange={(e) => setAutoInc(e.target.checked)} /> Auto increment</label>
            )}
          </div>
          {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        </div>

        <div className="px-4 py-3 flex justify-end gap-2 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
          <button className="btn text-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary text-sm" onClick={save} disabled={saving || !name.trim()}>{saving ? "Saving…" : isEdit ? "Save" : "Add column"}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="block mb-1" style={{ color: "var(--muted)" }}>{label}</span>
      {children}
    </label>
  );
}
