"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { Engine } from "@/lib/drivers/types";
import { DatabaseIcon, TableIcon, SearchIcon, PlusIcon } from "./icons";
import CreateTableModal from "./CreateTableModal";

interface DatabaseSidebarProps {
  serverId: string;
  database: string;
  databases: string[];
  tables: string[];
  serverName: string;
  engine: Engine;
  readOnly?: boolean;
  color?: string;
}

export default function DatabaseSidebar({
  serverId,
  database,
  databases,
  tables,
  engine,
  readOnly = false,
  color,
}: DatabaseSidebarProps) {
  const isMongo = engine === "mongodb";
  const tablesLabel = isMongo ? "Collections" : "Tables";
  const pathname = usePathname();
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  // Re-fetch the server layout (database + table lists) to pick up schema
  // changes made here, in the SQL console, or by another tool. useTransition
  // keeps the spinner accurate — it stays pending until the refetch completes.
  const [isRefreshing, startRefresh] = useTransition();

  // Extract active table from pathname
  const basePath = `/server/${serverId}/${database}`;
  const remainder = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : "";
  const segments = remainder.split("/").filter(Boolean);
  // Active table is the first segment after /server/[id]/[db]/ unless it's a reserved action
  const reservedSegments = new Set(["import", "export", "query", "operations", "objects", "diagram"]);
  const activeTable = segments.length > 0 && !reservedSegments.has(segments[0])
    ? decodeURIComponent(segments[0])
    : null;

  function handleDatabaseChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newDb = e.target.value;
    if (newDb !== database) {
      router.push(`/server/${serverId}/${newDb}`);
    }
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => t.toLowerCase().includes(q));
  }, [tables, filter]);

  return (
    <aside
      className="w-60 shrink-0 flex flex-col overflow-hidden"
      style={{ background: "var(--surface)", borderRight: "1px solid var(--border)", borderTop: color ? `3px solid ${color}` : undefined }}
    >
      {/* Database selector */}
      <div className="p-2.5 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>
          <DatabaseIcon style={{ width: 13, height: 13 }} />
          Database
        </label>
        <select
          className="input w-full text-sm"
          value={database}
          onChange={handleDatabaseChange}
        >
          {databases.map((db) => (
            <option key={db} value={db}>{db}</option>
          ))}
        </select>
      </div>

      {/* Table filter (phpMyAdmin signature) */}
      <div className="px-2.5 pt-2.5 pb-2 shrink-0">
        <div className="relative">
          <SearchIcon
            style={{ width: 13, height: 13, position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }}
          />
          <input
            className="input w-full text-xs"
            style={{ paddingLeft: "1.9rem" }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${tablesLabel.toLowerCase()}…`}
            spellCheck={false}
            aria-label={`Filter ${tablesLabel.toLowerCase()}`}
          />
        </div>
      </div>

      {/* Tables list */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-2.5 py-1 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            {tablesLabel}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px]" style={{ color: "var(--muted)" }}>
              {filter ? `${filtered.length}/${tables.length}` : tables.length}
            </span>
            <button
              onClick={() => startRefresh(() => router.refresh())}
              disabled={isRefreshing}
              title={`Refresh ${tablesLabel.toLowerCase()}`}
              aria-label={`Refresh ${tablesLabel.toLowerCase()}`}
              className="p-0.5 rounded hover:opacity-70"
              style={{ color: "var(--muted)" }}
            >
              <RefreshIcon style={{ width: 12, height: 12 }} className={isRefreshing ? "animate-spin" : undefined} />
            </button>
          </div>
        </div>
        <nav>
          {filtered.map((table) => {
            const isActive = activeTable === table;
            return (
              <Link
                key={table}
                href={`/server/${serverId}/${database}/${table}`}
                className="nav-item font-mono truncate"
                data-active={isActive}
                title={table}
              >
                <TableIcon />
                <span className="truncate">{table}</span>
              </Link>
            );
          })}
          {tables.length === 0 && (
            <p className="px-2.5 py-2 text-xs" style={{ color: "var(--muted)" }}>
              No {tablesLabel.toLowerCase()} found.
            </p>
          )}
          {tables.length > 0 && filtered.length === 0 && (
            <p className="px-2.5 py-2 text-xs" style={{ color: "var(--muted)" }}>
              No {tablesLabel.toLowerCase()} match “{filter}”.
            </p>
          )}
        </nav>
      </div>

      {/* New table / collection */}
      {readOnly ? (
        <div className="p-2.5 shrink-0 text-center text-xs" style={{ borderTop: "1px solid var(--border)", color: "var(--muted)" }}>
          Read-only connection
        </div>
      ) : (
        <div className="p-2.5 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
          <button className="btn w-full text-sm justify-center" onClick={() => setShowCreate(true)}>
            <PlusIcon style={{ width: 13, height: 13 }} /> New {isMongo ? "collection" : "table"}
          </button>
        </div>
      )}

      {showCreate && (
        <CreateTableModal serverId={serverId} database={database} engine={engine} onClose={() => setShowCreate(false)} />
      )}
    </aside>
  );
}

function RefreshIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 2v3h-3" />
    </svg>
  );
}
