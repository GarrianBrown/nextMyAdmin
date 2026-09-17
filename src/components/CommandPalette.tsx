"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

interface Server { id: string; name: string }
interface Item { label: string; sub: string; href: string; kind: "table" | "database" | "server" }

export default function CommandPalette({ servers }: { servers: Server[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [databases, setDatabases] = useState<string[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const cache = useRef<{ db?: string; tables?: string; key?: string }>({});

  // Current server / database from the URL (basePath is stripped by usePathname).
  const [, seg1, seg2] = pathname.split("/"); // ["", "server", sid, db, ...]
  const serverId = seg1 === "server" ? seg2 : undefined;
  const database = seg1 === "server" ? pathname.split("/")[3] : undefined;

  // Global ⌘K / Ctrl+K toggle.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // When opened, focus the input and (lazily) load the current server's schema.
  useEffect(() => {
    if (!open) return;
    // Reset the search box each time the palette opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery("");
    setIndex(0);
    setTimeout(() => inputRef.current?.focus(), 0);
    if (!serverId) return;
    const dbKey = serverId;
    if (cache.current.db !== dbKey) {
      cache.current.db = dbKey;
      fetch(`${BASE}/api/servers/${serverId}/databases`)
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => Array.isArray(d) && setDatabases(d))
        .catch(() => {});
    }
    const tKey = `${serverId}/${database}`;
    if (database && cache.current.tables !== tKey) {
      cache.current.tables = tKey;
      fetch(`${BASE}/api/servers/${serverId}/databases/${database}/tables`)
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => Array.isArray(d) && setTables(d))
        .catch(() => {});
    }
  }, [open, serverId, database]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (serverId && database) {
      for (const t of tables) out.push({ label: t, sub: `table · ${database}`, href: `/server/${serverId}/${database}/${encodeURIComponent(t)}`, kind: "table" });
    }
    if (serverId) {
      for (const db of databases) out.push({ label: db, sub: "database", href: `/server/${serverId}/${db}`, kind: "database" });
    }
    for (const s of servers) out.push({ label: s.name, sub: "connection", href: `/server/${s.id}`, kind: "server" });
    return out;
  }, [tables, databases, servers, serverId, database]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
    matches.sort((a, b) => {
      const ap = a.label.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.label.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp;
    });
    return matches.slice(0, 30);
  }, [items, query]);

  const go = useCallback((item: Item) => {
    setOpen(false);
    router.push(item.href);
  }, [router]);

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[index]) go(filtered[index]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  }

  const badge = { table: "T", database: "D", server: "S" };
  const badgeColor = { table: "var(--primary)", database: "var(--accent)", server: "var(--muted)" };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn py-1 px-2 text-xs"
        title="Search (⌘K)"
        aria-label="Open command palette"
      >
        <span style={{ opacity: 0.7 }}>Search</span>
        <kbd className="ml-1.5 font-mono" style={{ fontSize: 10, opacity: 0.7 }}>⌘K</kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-start justify-center"
          style={{ background: "rgba(0,0,0,0.45)", paddingTop: "12vh" }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            className="w-full max-w-lg rounded-lg shadow-xl overflow-hidden flex flex-col"
            style={{ background: "var(--card)", border: "1px solid var(--border)", maxHeight: "70vh" }}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
              onKeyDown={onInputKey}
              placeholder="Jump to a table, database, or connection…"
              className="w-full px-4 py-3 text-sm outline-none"
              style={{ background: "transparent", color: "var(--foreground)", borderBottom: "1px solid var(--border)" }}
              spellCheck={false}
            />
            <div className="overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-4 py-6 text-sm text-center" style={{ color: "var(--muted)" }}>No matches.</p>
              ) : (
                filtered.map((item, i) => (
                  <button
                    key={`${item.kind}:${item.href}`}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => go(item)}
                    className="w-full flex items-center gap-3 px-4 py-2 text-left"
                    style={{ background: i === index ? "var(--primary-soft)" : "transparent" }}
                  >
                    <span
                      aria-hidden
                      className="font-mono font-bold shrink-0 text-center"
                      style={{ width: 16, color: badgeColor[item.kind] }}
                    >
                      {badge[item.kind]}
                    </span>
                    <span className="font-mono text-sm truncate">{item.label}</span>
                    <span className="ml-auto text-xs truncate" style={{ color: "var(--muted)" }}>{item.sub}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
