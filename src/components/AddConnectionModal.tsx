"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ENGINES = [
  { value: "mysql", label: "MySQL" },
  { value: "mariadb", label: "MariaDB" },
  { value: "postgres", label: "PostgreSQL" },
  { value: "sqlite", label: "SQLite" },
  { value: "mongodb", label: "MongoDB" },
];
const DEFAULT_PORT: Record<string, string> = { mysql: "3306", mariadb: "3306", postgres: "5432" };
const URL_PLACEHOLDER: Record<string, string> = {
  mysql: "mysql://user:pass@host:3306/db",
  mariadb: "mysql://user:pass@host:3306/db",
  postgres: "postgresql://user:pass@host:5432/db",
};

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function AddConnectionModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [engine, setEngine] = useState("mysql");
  const [mode, setMode] = useState<"fields" | "url">("fields");
  const [ssl, setSsl] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [color, setColor] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [f, setF] = useState<Record<string, string>>({
    name: "",
    host: "127.0.0.1",
    port: "3306",
    user: "root",
    password: "",
    database: "",
    url: "",
    directory: "",
    file: "",
    uri: "mongodb://127.0.0.1:27017",
  });
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function set(key: string, value: string) {
    setF((prev) => ({ ...prev, [key]: value }));
    setTest(null);
  }
  function changeEngine(e: string) {
    setEngine(e);
    setTest(null);
    setShowAdvanced(false);
    if (DEFAULT_PORT[e]) set("port", DEFAULT_PORT[e]);
    if (e === "postgres") setF((p) => ({ ...p, user: "postgres" }));
  }

  const isSql = engine === "mysql" || engine === "mariadb" || engine === "postgres";

  function payload() {
    const base: Record<string, unknown> = { name: f.name, engine, color: color || undefined, readOnly };
    if (engine === "sqlite") return { ...base, directory: f.directory, file: f.file };
    if (engine === "mongodb") return { ...base, uri: f.uri };
    if (mode === "url") return { ...base, url: f.url, ssl };
    return { ...base, host: f.host, port: f.port, user: f.user, password: f.password, database: f.database, ssl };
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/servers/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
      const j = await res.json();
      setTest(j.ok ? { ok: true, msg: `Connected${j.databases != null ? ` — ${j.databases} database(s) visible` : ""}` } : { ok: false, msg: j.error || "Connection failed" });
    } catch (e: unknown) {
      setTest({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/servers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
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
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="rounded-lg shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <h3 className="font-semibold">Add Connection</h3>
          <button onClick={onClose} className="text-lg leading-none px-1" style={{ color: "var(--muted)" }}>&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <Field label="Engine">
            <select className="input w-full" value={engine} onChange={(e) => changeEngine(e.target.value)}>
              {ENGINES.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </Field>
          <Field label="Name">
            <input className="input w-full" value={f.name} placeholder="My database" onChange={(e) => set("name", e.target.value)} />
          </Field>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-sm" style={{ color: "var(--muted)" }}>Color</span>
              {["", "#e05a5a", "#e8933f", "#e6c34a", "#4fae5a", "#4a90d9", "#8b5cf6"].map((c) => (
                <button
                  key={c || "none"}
                  type="button"
                  onClick={() => setColor(c)}
                  title={c ? c : "None"}
                  className="rounded-full"
                  style={{
                    width: 18, height: 18,
                    background: c || "var(--surface)",
                    border: `2px solid ${color === c ? "var(--foreground)" : "var(--border)"}`,
                    fontSize: 9, color: "var(--muted)", lineHeight: "14px",
                  }}
                >
                  {c ? "" : "∅"}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-sm ml-auto" title="Hide write controls and reject changes (safe mode)">
              <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
              Read-only (safe mode)
            </label>
          </div>

          {isSql && (
            <>
              <div className="flex items-center gap-3 text-sm">
                <span style={{ color: "var(--muted)" }}>Connect by:</span>
                <Segmented value={mode} onChange={(m) => { setMode(m as "fields" | "url"); setTest(null); }} options={[{ value: "fields", label: "Fields" }, { value: "url", label: "URL" }]} />
              </div>

              {mode === "url" ? (
                <>
                  <Field label="Connection URL">
                    <input className="input w-full font-mono" value={f.url} placeholder={URL_PLACEHOLDER[engine]} onChange={(e) => set("url", e.target.value)} />
                  </Field>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ssl} onChange={(e) => { setSsl(e.target.checked); setTest(null); }} /> Use SSL/TLS</label>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2"><Field label="Host"><input className="input w-full font-mono" value={f.host} onChange={(e) => set("host", e.target.value)} /></Field></div>
                    <Field label="Port"><input className="input w-full font-mono" value={f.port} onChange={(e) => set("port", e.target.value.replace(/[^0-9]/g, ""))} /></Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="User"><input className="input w-full" value={f.user} onChange={(e) => set("user", e.target.value)} /></Field>
                    <Field label="Password"><input type="password" className="input w-full" value={f.password} onChange={(e) => set("password", e.target.value)} /></Field>
                  </div>

                  <button type="button" className="text-sm flex items-center gap-1" style={{ color: "var(--primary)" }} onClick={() => setShowAdvanced((v) => !v)}>
                    <span style={{ display: "inline-block", transform: showAdvanced ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▸</span>
                    Advanced
                  </button>
                  {showAdvanced && (
                    <div className="space-y-3 pl-3" style={{ borderLeft: "2px solid var(--border)" }}>
                      <Field label={engine === "postgres" ? "Database (connect to)" : "Database (optional default)"}>
                        <input className="input w-full font-mono" value={f.database} placeholder={engine === "postgres" ? "postgres" : ""} onChange={(e) => set("database", e.target.value)} />
                      </Field>
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ssl} onChange={(e) => { setSsl(e.target.checked); setTest(null); }} /> Use SSL/TLS</label>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {engine === "sqlite" && (
            <>
              <Field label="Directory (folder of .db files)">
                <input className="input w-full font-mono" value={f.directory} placeholder="/path/to/sqlite/folder" onChange={(e) => set("directory", e.target.value)} />
              </Field>
              <p className="text-xs" style={{ color: "var(--muted)" }}>— or a single file below. Paths are on the machine running the app.</p>
              <Field label="File (single .db)">
                <input className="input w-full font-mono" value={f.file} placeholder="/path/to/data.db" onChange={(e) => set("file", e.target.value)} />
              </Field>
            </>
          )}

          {engine === "mongodb" && (
            <Field label="Connection URI">
              <input className="input w-full font-mono" value={f.uri} onChange={(e) => set("uri", e.target.value)} />
            </Field>
          )}

          {test && (
            <div className="rounded-md p-2.5 text-sm" style={{ background: `color-mix(in srgb, var(--${test.ok ? "success" : "danger"}) 12%, transparent)`, border: `1px solid var(--${test.ok ? "success" : "danger"})` }}>
              <span style={{ color: `var(--${test.ok ? "success" : "danger"})` }}>{test.ok ? "✓ " : "✗ "}{test.msg}</span>
            </div>
          )}
          {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        </div>

        <div className="px-4 py-3 flex items-center gap-2 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
          <button className="btn text-sm" onClick={runTest} disabled={testing || saving}>{testing ? "Testing…" : "Test connection"}</button>
          <div className="flex gap-2 ml-auto">
            <button className="btn text-sm" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-primary text-sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="block mb-1" style={{ color: "var(--muted)" }}>{label}</span>
      {children}
    </label>
  );
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="inline-flex rounded-md overflow-hidden" style={{ border: "1px solid var(--border-strong)" }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className="px-3 py-1 text-sm"
          style={{
            background: value === o.value ? "var(--primary)" : "var(--card)",
            color: value === o.value ? "var(--on-primary)" : "var(--foreground)",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
