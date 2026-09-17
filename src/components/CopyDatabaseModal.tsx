"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  serverId: string;
  database: string;
  onClose: () => void;
}

type Mode = "structure_data" | "structure";

export default function CopyDatabaseModal({ serverId, database, onClose }: Props) {
  const router = useRouter();
  const [targetName, setTargetName] = useState("");
  const [mode, setMode] = useState<Mode>("structure_data");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Block navigation / reload while the copy is in flight.
  useEffect(() => {
    if (!loading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue =
        "A database copy is in progress. Leaving now may leave the new database in an incomplete state.";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [loading]);

  async function handleConfirm() {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/databases/${encodeURIComponent(
          database
        )}/copy`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetName: targetName.trim(),
            includeData: mode === "structure_data",
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Copy failed");
        setLoading(false);
        return;
      }
      // Success — navigate to new database. Keep loading=true so the modal stays
      // blocking until navigation happens.
      router.push(`/server/${serverId}/${encodeURIComponent(data.database)}`);
      router.refresh();
    } catch {
      setError("Network error");
      setLoading(false);
    }
  }

  function handleBackdropClick() {
    if (loading) return;
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (loading) return;
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && targetName.trim()) handleConfirm();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-md rounded p-5 flex flex-col gap-4"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-lg font-semibold">Copy database</h2>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            Source: <span className="font-mono">{database}</span>
          </p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>
            New database name
          </span>
          <input
            autoFocus
            className="input text-sm"
            placeholder="new_database_name"
            value={targetName}
            onChange={(e) => {
              setTargetName(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium mb-1" style={{ color: "var(--muted)" }}>
            Copy options
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mode === "structure_data"}
              onChange={() => setMode("structure_data")}
              disabled={loading}
            />
            Copy Structure &amp; Data
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mode === "structure"}
              onChange={() => setMode("structure")}
              disabled={loading}
            />
            Copy Structure
          </label>
        </fieldset>

        {error && (
          <p className="text-xs" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        {loading && (
          <div
            className="flex items-center gap-2 text-sm"
            style={{ color: "var(--muted)" }}
          >
            <span className="spinner" aria-hidden="true" />
            Copying database… please don&apos;t close this window or navigate away.
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            className="btn text-sm"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary text-sm"
            onClick={handleConfirm}
            disabled={loading || !targetName.trim()}
          >
            {loading ? "Copying…" : "Copy"}
          </button>
        </div>
      </div>

      <style jsx>{`
        .spinner {
          width: 14px;
          height: 14px;
          border: 2px solid var(--border);
          border-top-color: var(--primary);
          border-radius: 50%;
          display: inline-block;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
