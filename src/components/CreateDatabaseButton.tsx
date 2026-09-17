"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CreateDatabaseButton({ serverId }: { serverId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/databases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create database");
      } else {
        setOpen(false);
        setName("");
        router.refresh();
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") { setOpen(false); setName(""); setError(null); }
  }

  if (!open) {
    return (
      <button className="btn btn-primary text-sm" onClick={() => setOpen(true)}>
        + New Database
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-center">
        <input
          autoFocus
          className="input text-sm"
          placeholder="database_name"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <button
          className="btn btn-primary text-sm"
          onClick={handleCreate}
          disabled={loading || !name.trim()}
        >
          {loading ? "Creating…" : "Create"}
        </button>
        <button
          className="btn text-sm"
          onClick={() => { setOpen(false); setName(""); setError(null); }}
          disabled={loading}
        >
          Cancel
        </button>
      </div>
      {error && (
        <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>
      )}
    </div>
  );
}
