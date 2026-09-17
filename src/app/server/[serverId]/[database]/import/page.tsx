"use client";

import { useState, useRef } from "react";
import { useParams } from "next/navigation";

export default function ImportPage() {
  const params = useParams<{ serverId: string; database: string }>();
  const serverId = params.serverId;
  const database = params.database;

  const [file, setFile] = useState<File | null>(null);
  const [tableName, setTableName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isCsv = file?.name.toLowerCase().endsWith(".csv");

  async function handleUpload() {
    if (!file) return;
    if (isCsv && !tableName.trim()) {
      setStatus({ type: "error", message: "Please enter a table name for the CSV import." });
      return;
    }

    setUploading(true);
    setStatus(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (isCsv && tableName.trim()) {
        formData.append("table", tableName.trim());
      }

      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/databases/${database}/import`, {
        method: "POST",
        body: formData,
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      setStatus({ type: "success", message: json.message || "Import completed successfully." });
      setFile(null);
      setTableName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e: unknown) {
      setStatus({ type: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-4">Import</h1>

      <div style={{ background: "var(--card)", border: "1px solid var(--border)" }} className="rounded-lg p-6">
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">File (.sql or .csv)</label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".sql,.csv"
            className="input w-full"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setStatus(null); }}
          />
        </div>

        {isCsv && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Target Table Name</label>
            <input
              type="text"
              className="input w-full"
              placeholder="Enter table name for CSV import"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
            />
            <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
              The first row of the CSV will be used as column headers.
            </p>
          </div>
        )}

        <button className="btn btn-primary" onClick={handleUpload} disabled={uploading || !file}>
          {uploading ? "Uploading..." : "Upload & Import"}
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
            <p className="font-semibold" style={{ color: status.type === "success" ? "var(--success)" : "var(--danger)" }}>
              {status.type === "success" ? "Success" : "Error"}
            </p>
            <p className="mt-1">{status.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
