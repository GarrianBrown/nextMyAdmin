"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { DatabaseObject, DatabaseObjectKind, DatabaseObjects } from "@/lib/drivers/types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const SECTIONS: { kind: DatabaseObjectKind; key: keyof DatabaseObjects; title: string; blurb: string }[] = [
  { kind: "view", key: "views", title: "Views", blurb: "Saved queries you can browse like a table." },
  { kind: "routine", key: "routines", title: "Routines", blurb: "Stored procedures and functions." },
  { kind: "trigger", key: "triggers", title: "Triggers", blurb: "Statements that fire on row changes." },
];

export default function ObjectsPage() {
  const { serverId, database } = useParams<{ serverId: string; database: string }>();
  const [data, setData] = useState<DatabaseObjects | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchObjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/servers/${serverId}/databases/${database}/objects`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [serverId, database]);

  useEffect(() => {
    fetchObjects();
  }, [fetchObjects]);

  async function drop(kind: DatabaseObjectKind, object: DatabaseObject) {
    if (!confirm(`Drop ${kind} "${object.name}"? This is permanent.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/servers/${serverId}/databases/${database}/objects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "drop", kind, object }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await fetchObjects();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const totalCount = data ? data.views.length + data.routines.length + data.triggers.length : 0;

  return (
    <div className="flex flex-col gap-4 max-w-3xl pb-6">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Database objects</h2>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          Create new ones from the{" "}
          <Link href={`/server/${serverId}/${database}`} className="hover:underline" style={{ color: "var(--primary)" }}>
            SQL console
          </Link>
          .
        </span>
      </div>

      {error && (
        <div className="rounded-md p-3 text-sm" style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", border: "1px solid var(--danger)" }}>
          <span style={{ color: "var(--danger)" }}>{error}</span>
        </div>
      )}

      {loading && !data ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p>
      ) : !data ? null : totalCount === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          This database has no views, routines, or triggers yet.
        </p>
      ) : (
        SECTIONS.map(({ kind, key, title, blurb }) => (
          <ObjectSection
            key={kind}
            title={title}
            blurb={blurb}
            objects={data[key]}
            serverId={serverId}
            database={database}
            kind={kind}
            busy={busy}
            onDrop={drop}
          />
        ))
      )}
    </div>
  );
}

function ObjectSection({
  title,
  blurb,
  objects,
  serverId,
  database,
  kind,
  busy,
  onDrop,
}: {
  title: string;
  blurb: string;
  objects: DatabaseObject[];
  serverId: string;
  database: string;
  kind: DatabaseObjectKind;
  busy: boolean;
  onDrop: (kind: DatabaseObjectKind, object: DatabaseObject) => void;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-1.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs" style={{ color: "var(--muted)" }}>{objects.length}</span>
        <span className="text-xs ml-auto" style={{ color: "var(--muted)" }}>{blurb}</span>
      </div>
      {objects.length === 0 ? (
        <p className="text-xs rounded-md px-3 py-2" style={{ color: "var(--muted)", border: "1px solid var(--border)" }}>
          None.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {objects.map((obj) => (
            <ObjectRow key={obj.name} obj={obj} serverId={serverId} database={database} kind={kind} busy={busy} onDrop={onDrop} />
          ))}
        </div>
      )}
    </section>
  );
}

function ObjectRow({
  obj,
  serverId,
  database,
  kind,
  busy,
  onDrop,
}: {
  obj: DatabaseObject;
  serverId: string;
  database: string;
  kind: DatabaseObjectKind;
  busy: boolean;
  onDrop: (kind: DatabaseObjectKind, object: DatabaseObject) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md" style={{ border: "1px solid var(--border)" }}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button className="font-mono text-sm hover:underline text-left" onClick={() => setOpen((v) => !v)} title="Show definition">
          {obj.name}
        </button>
        {obj.meta && <span className="text-xs" style={{ color: "var(--muted)" }}>{obj.meta}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {kind === "view" && (
            <Link href={`/server/${serverId}/${database}/${encodeURIComponent(obj.name)}`} className="btn text-xs py-0.5">
              Browse
            </Link>
          )}
          <button className="btn btn-danger text-xs py-0.5" disabled={busy} onClick={() => onDrop(kind, obj)}>
            Drop
          </button>
        </div>
      </div>
      {open && (
        <pre className="font-mono text-xs p-3 overflow-x-auto whitespace-pre-wrap break-words" style={{ borderTop: "1px solid var(--border)", background: "var(--background)" }}>
          {obj.definition || "(definition unavailable)"}
        </pre>
      )}
    </div>
  );
}
