"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnInfo, KeyInfo, ForeignKeyInfo } from "@/lib/types";
import type { Engine } from "@/lib/drivers/types";
import { getCapabilities } from "@/lib/drivers/capabilities";
import TableDataBrowser from "./TableDataBrowser";
import StructureColumnModal from "./StructureColumnModal";
import StructureIndexModal from "./StructureIndexModal";
import { TableIcon, BrowseIcon, StructureIcon, PlusIcon, EditIcon, TrashIcon } from "./icons";

interface TableViewProps {
  serverId: string;
  database: string;
  table: string;
  engine: Engine;
  columns: ColumnInfo[];
  indexes: KeyInfo[];
  foreignKeys: ForeignKeyInfo[];
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function TableView({ serverId, database, table, engine, columns, indexes, foreignKeys }: TableViewProps) {
  const [activeTab, setActiveTab] = useState<"structure" | "data">("data");
  const router = useRouter();
  const caps = getCapabilities(engine);

  const [colModal, setColModal] = useState<{ column?: ColumnInfo } | null>(null);
  const [idxModal, setIdxModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function alter(body: Record<string, unknown>, navigate?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/servers/${serverId}/databases/${database}/tables/${table}/alter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      if (navigate) router.push(navigate);
      else router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function dropColumn(field: string) {
    if (confirm(`Drop column "${field}"? This permanently deletes its data.`)) alter({ action: "dropColumn", column: field });
  }
  function dropIndex(name: string) {
    if (confirm(`Drop index "${name}"?`)) alter({ action: "dropIndex", name });
  }
  function truncate() {
    if (confirm(`Empty "${table}"? All rows will be deleted (structure kept).`)) alter({ action: "truncateTable" });
  }
  function renameTable() {
    const nn = prompt("Rename table to:", table);
    if (nn && nn.trim() && nn.trim() !== table) alter({ action: "renameTable", newName: nn.trim() }, `/server/${serverId}/${database}/${encodeURIComponent(nn.trim())}`);
  }
  function dropTable() {
    if (confirm(`Drop table "${table}"? This is permanent and deletes all its data.`)) alter({ action: "dropTable" }, `/server/${serverId}/${database}`);
  }

  return (
    <div className="h-full flex flex-col">
      <div className="pma-tabs shrink-0 items-center">
        <span className="flex items-center gap-1.5 text-sm font-bold px-2 shrink-0">
          <TableIcon style={{ width: 15, height: 15, color: "var(--muted)" }} />
          {table}
        </span>
        <button className="pma-tab" data-active={activeTab === "data"} onClick={() => setActiveTab("data")}>
          <BrowseIcon />
          Browse
        </button>
        <button className="pma-tab" data-active={activeTab === "structure"} onClick={() => setActiveTab("structure")}>
          <StructureIcon />
          Structure
        </button>
      </div>

      <div className={`flex-1 min-h-0 pt-2 flex flex-col ${activeTab === "structure" ? "overflow-auto" : "overflow-hidden"}`}>
        {activeTab === "structure" ? (
          <div className="space-y-6 pb-4">
            {error && (
              <div className="rounded-md p-3 text-sm" style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", border: "1px solid var(--danger)" }}>
                <span style={{ color: "var(--danger)" }}>{error}</span>
              </div>
            )}

            {/* Columns */}
            <section>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-sm font-semibold">Columns</h2>
                {caps.schemaEdit && (
                  <button className="btn text-xs ml-auto py-0.5" disabled={busy} onClick={() => setColModal({})}>
                    <PlusIcon style={{ width: 12, height: 12 }} /> Add column
                  </button>
                )}
              </div>
              <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th>Field</th><th>Type</th><th>Null</th><th>Key</th><th>Default</th><th>Extra</th>
                      {caps.schemaEdit && <th style={{ width: "1%", whiteSpace: "nowrap" }}>Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {columns.map((col) => (
                      <tr key={col.Field}>
                        <td className="font-mono">{col.Field}</td>
                        <td className="font-mono">{col.Type}</td>
                        <td>{col.Null}</td>
                        <td>{col.Key}</td>
                        <td className="font-mono">{col.Default ?? <span style={{ color: "var(--muted)" }}>NULL</span>}</td>
                        <td>{col.Extra}</td>
                        {caps.schemaEdit && (
                          <td>
                            <div className="flex gap-1">
                              <button className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded" style={{ color: "var(--primary)", border: "1px solid var(--primary)" }} disabled={busy} onClick={() => setColModal({ column: col })} title="Change column">
                                <EditIcon style={{ width: 12, height: 12 }} /> Change
                              </button>
                              <button className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded" style={{ color: "var(--danger)", border: "1px solid var(--danger)" }} disabled={busy} onClick={() => dropColumn(col.Field)} title="Drop column">
                                <TrashIcon style={{ width: 12, height: 12 }} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Indexes */}
            <section>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-sm font-semibold">Indexes</h2>
                {caps.schemaEdit && columns.length > 0 && (
                  <button className="btn text-xs ml-auto py-0.5" disabled={busy} onClick={() => setIdxModal(true)}>
                    <PlusIcon style={{ width: 12, height: 12 }} /> Add index
                  </button>
                )}
              </div>
              {indexes.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--muted)" }}>No indexes.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th>Key Name</th><th>Column</th><th>Unique</th><th>Type</th><th>Seq</th><th>Cardinality</th>
                        {caps.schemaEdit && <th style={{ width: "1%", whiteSpace: "nowrap" }}>Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {indexes.map((idx, i) => {
                        const firstOfKey = indexes.findIndex((x) => x.Key_name === idx.Key_name) === i;
                        return (
                          <tr key={`${idx.Key_name}-${idx.Seq_in_index}-${i}`}>
                            <td className="font-mono">{idx.Key_name}</td>
                            <td className="font-mono">{idx.Column_name}</td>
                            <td>{idx.Non_unique === 0 ? "Yes" : "No"}</td>
                            <td>{idx.Index_type}</td>
                            <td>{idx.Seq_in_index}</td>
                            <td>{idx.Cardinality}</td>
                            {caps.schemaEdit && (
                              <td>
                                {firstOfKey && (
                                  <button className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded" style={{ color: "var(--danger)", border: "1px solid var(--danger)" }} disabled={busy} onClick={() => dropIndex(idx.Key_name)} title="Drop index">
                                    <TrashIcon style={{ width: 12, height: 12 }} />
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Foreign Keys */}
            <section>
              <h2 className="text-sm font-semibold mb-1">Foreign Keys</h2>
              {foreignKeys.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--muted)" }}>No foreign keys.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
                  <table className="w-full">
                    <thead>
                      <tr><th>Constraint</th><th>Column</th><th>References</th><th>On Update</th><th>On Delete</th></tr>
                    </thead>
                    <tbody>
                      {foreignKeys.map((fk) => (
                        <tr key={`${fk.CONSTRAINT_NAME}-${fk.COLUMN_NAME}`}>
                          <td className="font-mono">{fk.CONSTRAINT_NAME}</td>
                          <td className="font-mono">{fk.COLUMN_NAME}</td>
                          <td className="font-mono">{fk.REFERENCED_TABLE_SCHEMA}.{fk.REFERENCED_TABLE_NAME}.{fk.REFERENCED_COLUMN_NAME}</td>
                          <td>{fk.UPDATE_RULE}</td>
                          <td>{fk.DELETE_RULE}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Table operations */}
            {caps.tableOps && (
              <section>
                <h2 className="text-sm font-semibold mb-2">Table operations</h2>
                <div className="flex flex-wrap gap-2">
                  <button className="btn text-sm" disabled={busy} onClick={renameTable}>Rename table</button>
                  <button className="btn text-sm" disabled={busy} onClick={truncate}>Empty table</button>
                  <button className="btn btn-danger text-sm" disabled={busy} onClick={dropTable}>Drop table</button>
                </div>
              </section>
            )}
          </div>
        ) : (
          <TableDataBrowser serverId={serverId} database={database} table={table} engine={engine} columns={columns} foreignKeys={foreignKeys} />
        )}
      </div>

      {colModal && (
        <StructureColumnModal serverId={serverId} database={database} table={table} engine={engine} column={colModal.column} onClose={() => setColModal(null)} />
      )}
      {idxModal && (
        <StructureIndexModal serverId={serverId} database={database} table={table} engine={engine} columns={columns.map((c) => c.Field)} onClose={() => setIdxModal(false)} />
      )}
    </div>
  );
}
