"use client";

import { useState, useEffect } from "react";
import { ALL_PRIVILEGES, DB_PRIVILEGES, PRIVILEGE_GROUPS } from "@/lib/privileges";

interface DbPrivEntry {
  database: string;
  privileges: string[];
}

interface GrantedRole {
  user: string;
  host: string;
  isDefault: boolean;
}

interface EditUserModalProps {
  serverId: string;
  username: string;
  host: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditUserModal({ serverId, username, host, onClose, onSaved }: EditUserModalProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [globalPrivs, setGlobalPrivs] = useState<string[]>([]);
  const [dbPrivs, setDbPrivs] = useState<DbPrivEntry[]>([]);
  const [grantedRoles, setGrantedRoles] = useState<GrantedRole[]>([]);
  const [allDatabases, setAllDatabases] = useState<string[]>([]);
  const [dbToAdd, setDbToAdd] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const [userRes, dbRes] = await Promise.all([
          fetch(`${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/users/${encodeURIComponent(username)}/${encodeURIComponent(host)}`),
          fetch(`${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/databases`),
        ]);
        const userData = await userRes.json();
        const databases = await dbRes.json();
        if (!userRes.ok) throw new Error(userData.error);
        if (!dbRes.ok) throw new Error("Failed to load databases");
        setGlobalPrivs(userData.globalPrivileges);
        setDbPrivs(userData.databasePrivileges);
        setGrantedRoles(userData.grantedRoles ?? []);
        setAllDatabases(databases);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [serverId, username, host]);

  function toggleGlobal(priv: string) {
    setGlobalPrivs(prev =>
      prev.includes(priv) ? prev.filter(p => p !== priv) : [...prev, priv]
    );
    setSaveSuccess(false);
  }

  function toggleDbPriv(db: string, priv: string) {
    setDbPrivs(prev =>
      prev.map(entry =>
        entry.database === db
          ? {
              ...entry,
              privileges: entry.privileges.includes(priv)
                ? entry.privileges.filter(p => p !== priv)
                : [...entry.privileges, priv],
            }
          : entry
      )
    );
    setSaveSuccess(false);
  }

  function addDatabase() {
    if (!dbToAdd || dbPrivs.some(e => e.database === dbToAdd)) return;
    setDbPrivs(prev => [...prev, { database: dbToAdd, privileges: [] }]);
    setDbToAdd("");
    setSaveSuccess(false);
  }

  function removeDatabase(db: string) {
    setDbPrivs(prev => prev.filter(e => e.database !== db));
    setSaveSuccess(false);
  }

  async function handleSavePrivileges() {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/users/${encodeURIComponent(username)}/${encodeURIComponent(host)}/privileges`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            global: globalPrivs,
            databases: dbPrivs,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSaveSuccess(true);
      onSaved(); // let the parent refresh its user list
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }
    if (!newPassword) {
      setPasswordError("Password cannot be empty");
      return;
    }
    setChangingPassword(true);
    setPasswordError(null);
    setPasswordSuccess(false);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/users/${encodeURIComponent(username)}/${encodeURIComponent(host)}/password`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: newPassword }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSuccess(true);
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : "Failed to change password");
    } finally {
      setChangingPassword(false);
    }
  }

  const availableDatabases = allDatabases.filter(db => !dbPrivs.some(e => e.database === db));

  return (
    <div
      className="fixed inset-0 flex items-start justify-center z-50 overflow-y-auto py-8"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-lg w-full max-w-3xl mx-4 shadow-xl flex flex-col"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <h2 className="font-semibold">Edit User</h2>
            <p className="text-xs font-mono mt-0.5" style={{ color: "var(--muted)" }}>
              {username}@{host}
            </p>
          </div>
          <button className="btn text-sm" onClick={onClose}>Close</button>
        </div>

        {loading ? (
          <div className="p-6 text-sm" style={{ color: "var(--muted)" }}>Loading…</div>
        ) : loadError ? (
          <div className="p-6 text-sm" style={{ color: "var(--danger)" }}>{loadError}</div>
        ) : (
          <div className="overflow-y-auto">

            {/* ── Granted Roles ── */}
            {grantedRoles.length > 0 && (
              <section className="px-6 py-5" style={{ borderBottom: "1px solid var(--border)" }}>
                <h3 className="text-sm font-semibold mb-3">
                  Granted Roles
                  <span className="font-normal text-xs ml-2" style={{ color: "var(--muted)" }}>
                    open the role to see its privileges
                  </span>
                </h3>
                <div className="flex flex-wrap gap-2">
                  {grantedRoles.map(r => (
                    <span
                      key={`${r.user}@${r.host}`}
                      className="text-xs font-mono px-2 py-1 rounded"
                      style={{
                        background: "color-mix(in srgb, var(--primary) 10%, transparent)",
                        border: "1px solid var(--primary)",
                        color: "var(--primary)",
                      }}
                      title={r.isDefault ? "Default role (active at login)" : "Granted role"}
                    >
                      {r.user}@{r.host}
                      {r.isDefault && <span className="ml-1.5 opacity-70">(default)</span>}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* ── Global Privileges ── */}
            <section className="px-6 py-5" style={{ borderBottom: "1px solid var(--border)" }}>
              <h3 className="text-sm font-semibold mb-4">Global Privileges <span className="font-normal font-mono text-xs ml-1" style={{ color: "var(--muted)" }}>ON *.*</span></h3>
              <div className="flex flex-col gap-4">
                {PRIVILEGE_GROUPS.map(group => {
                  const privs = ALL_PRIVILEGES.filter(p => p.group === group);
                  return (
                    <div key={group}>
                      <p className="text-xs font-medium mb-2" style={{ color: "var(--muted)" }}>{group}</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                        {privs.map(p => (
                          <label key={p.sql} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={globalPrivs.includes(p.sql)}
                              onChange={() => toggleGlobal(p.sql)}
                              className="cursor-pointer"
                            />
                            <span className="text-xs font-mono">{p.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ── Database Privileges ── */}
            <section className="px-6 py-5" style={{ borderBottom: "1px solid var(--border)" }}>
              <h3 className="text-sm font-semibold mb-4">Database Privileges</h3>

              {dbPrivs.length === 0 && (
                <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>No per-database grants.</p>
              )}

              {dbPrivs.map(entry => (
                <div key={entry.database} className="mb-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-mono font-medium">
                      {entry.database}
                      <span style={{ color: "var(--muted)" }}>.*</span>
                    </p>
                    <button
                      className="text-xs"
                      style={{ color: "var(--danger)" }}
                      onClick={() => removeDatabase(entry.database)}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 pl-2">
                    {DB_PRIVILEGES.map(p => (
                      <label key={p.sql} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={entry.privileges.includes(p.sql)}
                          onChange={() => toggleDbPriv(entry.database, p.sql)}
                          className="cursor-pointer"
                        />
                        <span className="text-xs font-mono">{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              {/* Add database */}
              <div className="flex gap-2 items-center mt-3">
                <select
                  className="input text-sm flex-1"
                  value={dbToAdd}
                  onChange={e => setDbToAdd(e.target.value)}
                >
                  <option value="">— select database —</option>
                  {availableDatabases.map(db => (
                    <option key={db} value={db}>{db}</option>
                  ))}
                </select>
                <button
                  className="btn text-sm"
                  onClick={addDatabase}
                  disabled={!dbToAdd}
                >
                  Add Database
                </button>
              </div>
            </section>

            {/* ── Save Privileges ── */}
            <div className="px-6 py-4 flex items-center gap-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <button
                className="btn btn-primary text-sm"
                onClick={handleSavePrivileges}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save Privileges"}
              </button>
              {saveError && <p className="text-xs" style={{ color: "var(--danger)" }}>{saveError}</p>}
              {saveSuccess && <p className="text-xs" style={{ color: "var(--success)" }}>Privileges saved.</p>}
            </div>

            {/* ── Change Password ── */}
            <section className="px-6 py-5">
              <h3 className="text-sm font-semibold mb-4">Change Password</h3>
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <label className="text-xs" style={{ color: "var(--muted)" }}>New Password</label>
                  <input
                    className="input text-sm"
                    type="password"
                    value={newPassword}
                    onChange={e => { setNewPassword(e.target.value); setPasswordError(null); setPasswordSuccess(false); }}
                    disabled={changingPassword}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs" style={{ color: "var(--muted)" }}>Confirm Password</label>
                  <input
                    className="input text-sm"
                    type="password"
                    value={confirmPassword}
                    onChange={e => { setConfirmPassword(e.target.value); setPasswordError(null); setPasswordSuccess(false); }}
                    disabled={changingPassword}
                  />
                </div>
                <button
                  className="btn btn-primary text-sm"
                  onClick={handleChangePassword}
                  disabled={changingPassword || !newPassword}
                >
                  {changingPassword ? "Changing…" : "Change Password"}
                </button>
              </div>
              {passwordError && <p className="text-xs mt-2" style={{ color: "var(--danger)" }}>{passwordError}</p>}
              {passwordSuccess && <p className="text-xs mt-2" style={{ color: "var(--success)" }}>Password changed.</p>}
            </section>

          </div>
        )}
      </div>
    </div>
  );
}
