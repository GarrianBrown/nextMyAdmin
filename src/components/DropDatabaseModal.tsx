"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  serverId: string;
  database: string;
  onClose: () => void;
}

export default function DropDatabaseModal({ serverId, database, onClose }: Props) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!loading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "A database drop is in progress.";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [loading]);

  const canConfirm = confirmText === database && !loading;

  async function handleConfirm() {
    if (!canConfirm) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/databases/${encodeURIComponent(
          database
        )}/drop`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Drop failed");
        setLoading(false);
        return;
      }
      router.push(`/server/${serverId}`);
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
    if (e.key === "Enter" && canConfirm) handleConfirm();
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
          <h2 className="text-lg font-semibold" style={{ color: "var(--danger)" }}>
            Drop database
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            This permanently deletes <span className="font-mono">{database}</span> and all of its
            tables. This cannot be undone.
          </p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>
            Type <span className="font-mono">{database}</span> to confirm
          </span>
          <input
            autoFocus
            className="input text-sm"
            value={confirmText}
            onChange={(e) => {
              setConfirmText(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
        </label>

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
            Dropping database…
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button className="btn text-sm" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn text-sm"
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{
              background: canConfirm ? "var(--danger)" : undefined,
              color: canConfirm ? "white" : undefined,
              borderColor: canConfirm ? "var(--danger)" : undefined,
            }}
          >
            {loading ? "Dropping…" : "Drop database"}
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
