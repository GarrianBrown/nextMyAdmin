"use client";

import { useState } from "react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      // Full navigation so the layout re-renders with the session.
      window.location.assign(`${BASE}${next}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg shadow-xl w-full max-w-sm p-6 space-y-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <h1 className="text-lg font-semibold">Sign in to nextMyAdmin</h1>
      <label className="block text-sm">
        <span className="block mb-1" style={{ color: "var(--muted)" }}>Password</span>
        <input type="password" className="input w-full" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
      <button type="submit" className="btn btn-primary text-sm w-full" disabled={busy || !password}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
