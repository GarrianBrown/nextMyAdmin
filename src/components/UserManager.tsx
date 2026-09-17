"use client";

import { useState, useEffect, useCallback } from "react";
import EditUserModal from "./EditUserModal";

interface MySQLUser {
  User: string;
  Host: string;
  account_locked: string;
  isRole?: boolean;
}

export default function UserManager({ serverId }: { serverId: string }) {
  const [users, setUsers] = useState<MySQLUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingUser, setEditingUser] = useState<MySQLUser | null>(null);
  const [deletingUser, setDeletingUser] = useState<MySQLUser | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [tab, setTab] = useState<"users" | "roles">("users");
  const [showCreate, setShowCreate] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newHost, setNewHost] = useState("localhost");
  const [newPassword, setNewPassword] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [suggestedPassword, setSuggestedPassword] = useState("");
  const [copiedSuggested, setCopiedSuggested] = useState(false);

  function generatePassword() {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}";
    const bytes = new Uint32Array(20);
    crypto.getRandomValues(bytes);
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += chars[bytes[i] % chars.length];
    setSuggestedPassword(out);
    setCopiedSuggested(false);
  }

  async function copySuggested() {
    if (!suggestedPassword) return;
    try {
      await navigator.clipboard.writeText(suggestedPassword);
      setCopiedSuggested(true);
      setTimeout(() => setCopiedSuggested(false), 1500);
    } catch {
      // ignore
    }
  }

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/users`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUsers(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function handleCreate() {
    setCreateError(null);
    setCreating(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername, host: newHost, password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowCreate(false);
      setNewUsername("");
      setNewHost("localhost");
      setNewPassword("");
      setSuggestedPassword("");
      setCopiedSuggested(false);
      await loadUsers();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!deletingUser) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(
        `/api/servers/${serverId}/users/${encodeURIComponent(deletingUser.User)}/${encodeURIComponent(deletingUser.Host)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDeletingUser(null);
      await loadUsers();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Failed to delete user");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Users & Roles</h1>
        {tab === "users" && (
          <button className="btn btn-primary text-sm" onClick={() => setShowCreate(v => !v)}>
            {showCreate ? "Cancel" : "+ New User"}
          </button>
        )}
      </div>

      <div className="flex gap-1 mb-4 text-sm" style={{ borderBottom: "1px solid var(--border)" }}>
        {(["users", "roles"] as const).map(t => {
          const count = users.filter(u => (t === "roles" ? u.isRole : !u.isRole)).length;
          const active = tab === t;
          return (
            <button
              key={t}
              className="px-3 py-1.5 -mb-px capitalize"
              style={{
                borderBottom: active ? "2px solid var(--primary)" : "2px solid transparent",
                color: active ? "var(--primary)" : "var(--muted)",
                fontWeight: active ? 600 : 400,
              }}
              onClick={() => setTab(t)}
            >
              {t} <span className="text-xs">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Create form */}
      {showCreate && tab === "users" && (
        <div
          className="rounded-lg p-4 mb-6"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <h2 className="text-sm font-semibold mb-3">Create User</h2>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: "var(--muted)" }}>Username</label>
              <input
                className="input text-sm"
                placeholder="username"
                value={newUsername}
                onChange={e => { setNewUsername(e.target.value); setCreateError(null); }}
                disabled={creating}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: "var(--muted)" }}>Host</label>
              <input
                className="input text-sm"
                placeholder="localhost"
                value={newHost}
                onChange={e => { setNewHost(e.target.value); setCreateError(null); }}
                disabled={creating}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: "var(--muted)" }}>Password</label>
              <input
                className="input text-sm"
                type="password"
                placeholder="password"
                value={newPassword}
                onChange={e => { setNewPassword(e.target.value); setCreateError(null); }}
                disabled={creating}
              />
            </div>
            <button
              className="btn btn-primary text-sm"
              onClick={handleCreate}
              disabled={creating || !newUsername.trim() || !newHost.trim()}
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
          {createError && (
            <p className="text-xs mt-2" style={{ color: "var(--danger)" }}>{createError}</p>
          )}

          <div className="mt-4 pt-3 flex flex-wrap items-center gap-2" style={{ borderTop: "1px solid var(--border)" }}>
            <button
              type="button"
              className="btn text-xs"
              onClick={generatePassword}
              disabled={creating}
            >
              Generate password
            </button>
            {suggestedPassword && (
              <>
                <code
                  className="text-xs px-2 py-1 rounded font-mono cursor-pointer select-all"
                  style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                  onClick={copySuggested}
                  title="Click to copy"
                >
                  {suggestedPassword}
                </code>
                <button
                  type="button"
                  className="btn btn-primary text-xs"
                  onClick={() => { setNewPassword(suggestedPassword); setCreateError(null); }}
                  disabled={creating}
                >
                  Use
                </button>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {copiedSuggested ? "Copied!" : "Click password to copy"}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* User list */}
      {loading ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p>
      ) : error ? (
        <div
          className="rounded-md p-4 text-sm"
          style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", border: "1px solid var(--danger)" }}
        >
          <p style={{ color: "var(--danger)" }}>{error}</p>
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border)" }} className="rounded-lg overflow-hidden">
          <table className="w-full" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold" style={{ background: "var(--card)", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>User</th>
                <th className="text-left px-4 py-2 text-xs font-semibold" style={{ background: "var(--card)", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>Host</th>
                <th className="text-left px-4 py-2 text-xs font-semibold" style={{ background: "var(--card)", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>Status</th>
                <th className="px-4 py-2" style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}></th>
              </tr>
            </thead>
            <tbody>
              {users
                .filter(u => (tab === "roles" ? u.isRole : !u.isRole))
                .map((u, i) => (
                  <tr key={`${u.User}@${u.Host}`} style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                    <td className="px-4 py-2 font-mono text-sm">{u.User}</td>
                    <td className="px-4 py-2 font-mono text-sm" style={{ color: "var(--muted)" }}>{u.Host}</td>
                    <td className="px-4 py-2 text-xs">
                      {u.account_locked === "Y" ? (
                        <span style={{ color: "var(--danger)" }}>Locked</span>
                      ) : (
                        <span style={{ color: "var(--success)" }}>Active</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2 justify-end">
                        <button className="btn text-xs" onClick={() => setEditingUser(u)}>
                          {tab === "roles" ? "View" : "Edit"}
                        </button>
                        <button
                          className="btn text-xs"
                          style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
                          onClick={() => { setDeletingUser(u); setDeleteError(null); }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              {users.filter(u => (tab === "roles" ? u.isRole : !u.isRole)).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-sm text-center" style={{ color: "var(--muted)" }}>
                    No {tab === "roles" ? "roles" : "users"} found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deletingUser && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={e => { if (e.target === e.currentTarget) setDeletingUser(null); }}
        >
          <div
            className="rounded-lg p-6 w-full max-w-sm shadow-xl"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <h2 className="font-semibold mb-2">Delete User</h2>
            <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
              Are you sure you want to drop{" "}
              <span className="font-mono" style={{ color: "var(--foreground)" }}>
                {deletingUser.User}@{deletingUser.Host}
              </span>
              ? This cannot be undone.
            </p>
            {deleteError && (
              <p className="text-xs mb-3" style={{ color: "var(--danger)" }}>{deleteError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button className="btn text-sm" onClick={() => setDeletingUser(null)} disabled={deleting}>Cancel</button>
              <button
                className="btn text-sm"
                style={{ background: "var(--danger)", color: "white", borderColor: "var(--danger)" }}
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editingUser && (
        <EditUserModal
          serverId={serverId}
          username={editingUser.User}
          host={editingUser.Host}
          onClose={() => setEditingUser(null)}
          onSaved={() => { setEditingUser(null); loadUsers(); }}
        />
      )}
    </>
  );
}
