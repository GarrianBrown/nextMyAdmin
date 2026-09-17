"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TrashIcon } from "./icons";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function DeleteConnectionButton({ serverId, name }: { serverId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Remove the connection "${name}"? (This only removes it from nextMyAdmin — the database itself is untouched.)`)) return;
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/servers/${serverId}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      router.refresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={remove}
      disabled={busy}
      title="Remove connection"
      className="absolute top-2 right-2 p-1 rounded transition-colors"
      style={{ color: "var(--muted)", background: "var(--card)" }}
    >
      <TrashIcon style={{ width: 14, height: 14 }} />
    </button>
  );
}
