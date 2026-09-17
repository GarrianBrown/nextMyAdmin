"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Engine } from "@/lib/drivers/types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function StructureIndexModal({
  serverId,
  database,
  table,
  engine,
  columns,
  onClose,
}: {
  serverId: string;
  database: string;
  table: string;
  engine: Engine;
  columns: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"index" | "unique" | "primary">("index");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowPrimary = engine !== "sqlite"; // SQLite can't add a PK to an existing table

  function toggle(col: string) {
    setSelected((s) => (s.includes(col) ? s.filter((c) => c !== col) : [...s, col]));
  }

  async function save() {
    if (selected.length === 0) {
      setError("Pick at least one column.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const idxName = name.trim() || `idx_${table}_${selected.join("_")}`.slice(0, 60);
      const res = await fetch(`${BASE}/api/servers/${serverId}/databases/${database}/tables/${table}/alter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "addIndex", def: { name: idxName, columns: selected, kind } }),
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
      <div className="rounded-lg shadow-xl w-full max-w-md flex flex-col max-h-[85vh]" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <h3 className="font-semibold">Add index</h3>
          <button onClick={onClose} className="text-lg leading-none px-1" style={{ color: "var(--muted)" }}>&times;</button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <label className="block text-sm">
            <span className="block mb-1" style={{ color: "var(--muted)" }}>Type</span>
            <select className="input w-full" value={kind} onChange={(e) => setKind(e.target.value as "index" | "unique" | "primary")}>
              <option value="index">Index</option>
              <option value="unique">Unique</option>
              {allowPrimary && <option value="primary">Primary key</option>}
            </select>
          </label>
          {kind !== "primary" && (
            <label className="block text-sm">
              <span className="block mb-1" style={{ color: "var(--muted)" }}>Name (optional)</span>
              <input className="input w-full font-mono" value={name} placeholder="auto-generated" onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          <div>
            <span className="block mb-1 text-sm" style={{ color: "var(--muted)" }}>Columns</span>
            <div className="rounded-md p-2 max-h-48 overflow-y-auto" style={{ border: "1px solid var(--border)" }}>
              {columns.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm py-0.5 font-mono">
                  <input type="checkbox" checked={selected.includes(c)} onChange={() => toggle(c)} />
                  {c}
                </label>
              ))}
            </div>
          </div>
          {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        </div>

        <div className="px-4 py-3 flex justify-end gap-2 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
          <button className="btn text-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary text-sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Add index"}</button>
        </div>
      </div>
    </div>
  );
}
