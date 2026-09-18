"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ServerIcon, EditIcon, TrashIcon } from "./icons";
import AddConnectionModal from "./AddConnectionModal";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const ENGINE_LABELS: Record<string, string> = {
  mysql: "MySQL",
  mariadb: "MariaDB",
  postgres: "PostgreSQL",
  sqlite: "SQLite",
  mongodb: "MongoDB",
};

/** Display-safe view of a saved connection (no password). */
export interface ConnectionCardServer {
  id: string;
  name: string;
  engine?: string;
  host?: string;
  port?: number;
  uri?: string;
  directory?: string;
  file?: string;
  user?: string;
  color?: string;
  readOnly?: boolean;
  managed?: boolean;
  disconnected?: boolean;
}

function KebabIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" {...props}>
      <circle cx="8" cy="3" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="8" cy="13" r="1.4" />
    </svg>
  );
}
function RefreshIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" /><path d="M13.5 2v3h-3" />
    </svg>
  );
}
function PlugIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M8 2v4M5 6h6v2a3 3 0 0 1-6 0V6zM8 11v3" />
    </svg>
  );
}

export default function ConnectionCard({ server }: { server: ConnectionCardServer }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<null | "connect" | "disconnect" | "refresh" | "delete">(null);
  const [flash, setFlash] = useState<{ ok: boolean; msg: string } | null>(null);

  const disconnected = !!server.disconnected;
  const engineLabel = ENGINE_LABELS[server.engine ?? "mysql"] ?? server.engine;
  const target = server.host ? `${server.host}:${server.port}` : server.uri ?? server.directory ?? server.file ?? "";

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(t);
  }, [flash]);

  async function connAction(op: "connect" | "disconnect" | "status") {
    const res = await fetch(`${BASE}/api/servers/${server.id}/connection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op }),
    });
    return { res, json: await res.json().catch(() => ({})) };
  }

  async function doConnect() {
    setMenuOpen(false); setBusy("connect"); setFlash(null);
    try {
      const { res, json } = await connAction("connect");
      if (!res.ok) { setFlash({ ok: false, msg: json.error || "Couldn't reach the server" }); return; }
      router.refresh();
    } catch (e: unknown) {
      setFlash({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(null); }
  }

  async function doDisconnect() {
    setMenuOpen(false); setBusy("disconnect"); setFlash(null);
    try {
      const { res, json } = await connAction("disconnect");
      if (!res.ok) { setFlash({ ok: false, msg: json.error || "Failed" }); return; }
      router.refresh();
    } catch (e: unknown) {
      setFlash({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(null); }
  }

  async function doRefresh() {
    setMenuOpen(false); setBusy("refresh"); setFlash(null);
    try {
      const { json } = await connAction("status");
      if (json.disconnected) setFlash({ ok: false, msg: "Disconnected" });
      else if (json.reachable) setFlash({ ok: true, msg: "Reachable" });
      else setFlash({ ok: false, msg: json.error || "Unreachable" });
      router.refresh();
    } catch (e: unknown) {
      setFlash({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(null); }
  }

  async function doDelete() {
    setMenuOpen(false);
    if (!confirm(`Remove the connection "${server.name}"? (This only removes it from nextMyAdmin — the database itself is untouched.)`)) return;
    setBusy("delete");
    try {
      const res = await fetch(`${BASE}/api/servers/${server.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      router.refresh();
    } catch (e: unknown) {
      setFlash({ ok: false, msg: e instanceof Error ? e.message : String(e) });
      setBusy(null);
    }
  }

  const dotColor = busy === "refresh" || busy === "connect"
    ? "var(--accent)"
    : disconnected ? "var(--border-strong)" : "var(--success)";

  const inner = (
    <div className="flex items-center gap-2 mb-1 pr-8">
      <span
        title={disconnected ? "disconnected" : "connected"}
        className={busy === "refresh" || busy === "connect" ? "animate-pulse" : undefined}
        style={{ width: 9, height: 9, borderRadius: 999, background: dotColor, flexShrink: 0 }}
      />
      <ServerIcon style={{ width: 18, height: 18, color: "var(--primary)" }} />
      <h2 className="text-lg font-semibold flex-1 truncate">{server.name}</h2>
      {server.readOnly && <span className="badge" style={{ color: "var(--accent)", borderColor: "var(--accent)" }}>read-only</span>}
      <span className="badge badge-engine">{engineLabel}</span>
    </div>
  );

  const body = (
    <>
      {inner}
      <p className="text-sm font-mono truncate" style={{ color: "var(--muted)" }}>{target}</p>
      {server.user && <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>User: {server.user}</p>}
      <div className="mt-2 flex items-center gap-2">
        {server.managed && <span className="badge inline-block">managed · local</span>}
        {disconnected && <span className="badge inline-block" style={{ color: "var(--muted)" }}>disconnected</span>}
        {flash && (
          <span className="text-xs" style={{ color: flash.ok ? "var(--success)" : "var(--danger)" }}>
            {flash.ok ? "✓ " : "✗ "}{flash.msg}
          </span>
        )}
      </div>
    </>
  );

  const cardStyle: React.CSSProperties = {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderLeft: server.color ? `4px solid ${server.color}` : "1px solid var(--border)",
    opacity: disconnected ? 0.6 : 1,
  };

  return (
    <div className="relative">
      {disconnected ? (
        <div className="block rounded-lg p-5" style={cardStyle} title="Disconnected — use Connect to open">{body}</div>
      ) : (
        <Link href={`/server/${server.id}`} style={cardStyle} className="block rounded-lg p-5 transition-all hover:shadow-md hover:-translate-y-0.5">
          {body}
        </Link>
      )}

      {/* Actions menu (kebab) */}
      <div className="absolute top-2 right-2">
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen((v) => !v); }}
          disabled={!!busy}
          title="Connection actions"
          className="p-1 rounded transition-colors"
          style={{ color: "var(--muted)", background: "var(--card)" }}
        >
          <KebabIcon style={{ width: 15, height: 15 }} />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={(e) => { e.preventDefault(); setMenuOpen(false); }} />
            <div className="absolute right-0 mt-1 z-20 rounded-md shadow-lg overflow-hidden text-sm" style={{ background: "var(--card)", border: "1px solid var(--border)", minWidth: 170 }}>
              {disconnected ? (
                <MenuItem onClick={doConnect}><PlugIcon style={{ width: 14, height: 14 }} /> Connect</MenuItem>
              ) : (
                !server.managed && <MenuItem onClick={doDisconnect}><PlugIcon style={{ width: 14, height: 14 }} /> Disconnect</MenuItem>
              )}
              {!server.managed && (
                <MenuItem onClick={() => { setMenuOpen(false); setEditing(true); }}><EditIcon style={{ width: 14, height: 14 }} /> Edit connection</MenuItem>
              )}
              <MenuItem onClick={doRefresh}><RefreshIcon style={{ width: 14, height: 14 }} /> Refresh</MenuItem>
              {!server.managed && (
                <MenuItem onClick={doDelete} danger><TrashIcon style={{ width: 14, height: 14 }} /> Delete</MenuItem>
              )}
            </div>
          </>
        )}
      </div>

      {editing && <AddConnectionModal mode="edit" serverId={server.id} onClose={() => setEditing(false)} />}
    </div>
  );
}

function MenuItem({ onClick, children, danger }: { onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      className="flex items-center gap-2 w-full text-left px-3 py-2 hover:opacity-80"
      style={{ color: danger ? "var(--danger)" : "var(--foreground)", borderTop: "1px solid var(--border)" }}
    >
      {children}
    </button>
  );
}
