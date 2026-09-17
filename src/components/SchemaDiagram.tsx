"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnInfo, ForeignKeyInfo } from "@/lib/types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

interface SchemaTable {
  table: string;
  columns: ColumnInfo[];
  foreignKeys: ForeignKeyInfo[];
}

const BOX_W = 214;
const HEADER_H = 28;
const ROW_H = 20;
const GAP_X = 72;
const GAP_Y = 44;
const PAD = 40;
const MAX_ROWS = 24; // very wide tables get truncated so a box doesn't run off-screen

function boxHeight(t: SchemaTable): number {
  return HEADER_H + Math.min(t.columns.length, MAX_ROWS) * ROW_H + 6;
}

/** Simple masonry grid layout — packs boxes into columns, shortest-column-first. */
function autoLayout(tables: SchemaTable[]): Record<string, { x: number; y: number }> {
  const cols = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
  const colHeights = new Array(cols).fill(PAD);
  const pos: Record<string, { x: number; y: number }> = {};
  for (const t of tables) {
    // place in the currently shortest column
    let c = 0;
    for (let i = 1; i < cols; i++) if (colHeights[i] < colHeights[c]) c = i;
    pos[t.table] = { x: PAD + c * (BOX_W + GAP_X), y: colHeights[c] };
    colHeights[c] += boxHeight(t) + GAP_Y;
  }
  return pos;
}

export default function SchemaDiagram({ serverId, database }: { serverId: string; database: string }) {
  const [schema, setSchema] = useState<SchemaTable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [drag, setDrag] = useState<{ table: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const storageKey = `nma-diagram-${serverId}-${database}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/servers/${serverId}/databases/${database}/schema`);
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
        if (!cancelled) {
          setSchema(j);
          // Restore saved box positions for still-existing tables; auto-layout the rest.
          let saved: Record<string, { x: number; y: number }> = {};
          try { saved = JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch { /* ignore */ }
          const base = autoLayout(j);
          for (const t of j as SchemaTable[]) if (saved[t.table]) base[t.table] = saved[t.table];
          setPositions(base);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [serverId, database, storageKey]);

  // Persist positions after a drag settles (not on every mousemove frame).
  useEffect(() => {
    if (!schema || drag) return;
    try { localStorage.setItem(storageKey, JSON.stringify(positions)); } catch { /* ignore */ }
  }, [positions, drag, schema, storageKey]);

  // Drag a table box by its header.
  useEffect(() => {
    if (!drag) return;
    function move(e: MouseEvent) {
      setPositions((p) => ({
        ...p,
        [drag!.table]: { x: Math.max(0, drag!.origX + (e.clientX - drag!.startX)), y: Math.max(0, drag!.origY + (e.clientY - drag!.startY)) },
      }));
    }
    function up() { setDrag(null); }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [drag]);

  const byName = useMemo(() => {
    const m = new Map<string, SchemaTable>();
    for (const t of schema ?? []) m.set(t.table, t);
    return m;
  }, [schema]);

  const colYOffset = useCallback((t: SchemaTable, colName: string) => {
    const idx = t.columns.findIndex((c) => c.Field === colName);
    const row = idx >= 0 && idx < MAX_ROWS ? idx : 0;
    return HEADER_H + (row + 0.5) * ROW_H;
  }, []);

  // Flatten same-database foreign keys into drawable connectors.
  const links = useMemo(() => {
    if (!schema) return [];
    const out: { from: string; fromCol: string; to: string; toCol: string }[] = [];
    for (const t of schema) {
      for (const fk of t.foreignKeys) {
        const to = fk.REFERENCED_TABLE_NAME;
        if (to && byName.has(to)) {
          out.push({ from: t.table, fromCol: fk.COLUMN_NAME, to, toCol: fk.REFERENCED_COLUMN_NAME });
        }
      }
    }
    return out;
  }, [schema, byName]);

  const fkColsByTable = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const t of schema ?? []) m.set(t.table, new Set(t.foreignKeys.map((fk) => fk.COLUMN_NAME)));
    return m;
  }, [schema]);

  const canvas = useMemo(() => {
    let w = 800, h = 500;
    for (const t of schema ?? []) {
      const p = positions[t.table];
      if (!p) continue;
      w = Math.max(w, p.x + BOX_W + PAD);
      h = Math.max(h, p.y + boxHeight(t) + PAD);
    }
    return { w, h };
  }, [schema, positions]);

  // CSS custom properties don't resolve in a detached SVG — inline concrete values for export.
  function serializedSvg(): { str: string; bg: string } {
    const cs = getComputedStyle(document.documentElement);
    const bg = cs.getPropertyValue("--surface").trim() || "#ffffff";
    let str = new XMLSerializer().serializeToString(svgRef.current!);
    const names = ["--primary", "--primary-hover", "--card", "--border", "--border-strong", "--foreground", "--muted", "--on-primary", "--accent", "--row-even", "--surface", "--background"];
    for (const n of names) str = str.split(`var(${n})`).join(cs.getPropertyValue(n).trim() || "#888");
    return { str, bg };
  }

  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function exportSvg() {
    if (!svgRef.current) return;
    const { str } = serializedSvg();
    download(new Blob([str], { type: "image/svg+xml;charset=utf-8" }), `${database}-schema.svg`);
  }

  function exportPng() {
    if (!svgRef.current) return;
    const { str, bg } = serializedSvg();
    const url = URL.createObjectURL(new Blob([str], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const c = document.createElement("canvas");
      c.width = canvas.w * scale; c.height = canvas.h * scale;
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.scale(scale, scale);
        ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.w, canvas.h);
        ctx.drawImage(img, 0, 0);
        c.toBlob((b) => { if (b) download(b, `${database}-schema.png`); URL.revokeObjectURL(url); }, "image/png");
      }
    };
    img.src = url;
  }

  if (error) {
    return (
      <div className="rounded-md p-3 text-sm m-2" style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", border: "1px solid var(--danger)" }}>
        <span style={{ color: "var(--danger)" }}>{error}</span>
      </div>
    );
  }
  if (!schema) return <p className="text-sm p-4" style={{ color: "var(--muted)" }}>Loading schema…</p>;
  if (schema.length === 0) return <p className="text-sm p-4" style={{ color: "var(--muted)" }}>No tables to diagram.</p>;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-3 py-2 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        <h2 className="text-sm font-semibold">Schema diagram</h2>
        <span className="text-xs" style={{ color: "var(--muted)" }}>{schema.length} tables · {links.length} relations</span>
        <span className="text-xs ml-auto" style={{ color: "var(--muted)" }}>Drag a header to move</span>
        <button className="btn text-xs py-0.5" onClick={() => setPositions(autoLayout(schema))}>Auto-arrange</button>
        <button className="btn text-xs py-0.5" onClick={exportPng} title="Export as PNG image">PNG</button>
        <button className="btn text-xs py-0.5" onClick={exportSvg} title="Export as SVG">SVG</button>
      </div>

      <div className="flex-1 overflow-auto" style={{ background: "var(--surface)" }}>
        <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={canvas.w} height={canvas.h} style={{ display: "block", minWidth: "100%", userSelect: "none" }}>
          <defs>
            <marker id="fk-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="var(--primary)" />
            </marker>
          </defs>

          {/* FK connectors */}
          {links.map((l, i) => {
            const sp = positions[l.from], tp = positions[l.to];
            const sT = byName.get(l.from), tT = byName.get(l.to);
            if (!sp || !tp || !sT || !tT) return null;
            const sy = sp.y + colYOffset(sT, l.fromCol);
            const ty = tp.y + colYOffset(tT, l.toCol);
            const leftToRight = sp.x + BOX_W / 2 <= tp.x + BOX_W / 2;
            const sx = leftToRight ? sp.x + BOX_W : sp.x;
            const tx = leftToRight ? tp.x : tp.x + BOX_W;
            const c1x = sx + (leftToRight ? GAP_X / 2 : -GAP_X / 2);
            const c2x = tx + (leftToRight ? -GAP_X / 2 : GAP_X / 2);
            return (
              <path
                key={i}
                d={`M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${tx} ${ty}`}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={1.5}
                markerEnd="url(#fk-arrow)"
                opacity={0.75}
              />
            );
          })}

          {/* Table boxes */}
          {schema.map((t) => {
            const p = positions[t.table];
            if (!p) return null;
            const h = boxHeight(t);
            const fkCols = fkColsByTable.get(t.table) ?? new Set<string>();
            const shown = t.columns.slice(0, MAX_ROWS);
            return (
              <g key={t.table} transform={`translate(${p.x}, ${p.y})`}>
                <rect width={BOX_W} height={h} rx={6} fill="var(--card)" stroke="var(--border-strong)" strokeWidth={1} />
                {/* header (drag handle) */}
                <g style={{ cursor: "grab" }} onMouseDown={(e) => { e.preventDefault(); setDrag({ table: t.table, startX: e.clientX, startY: e.clientY, origX: p.x, origY: p.y }); }}>
                  <path d={`M0 6 a6 6 0 0 1 6 -6 h${BOX_W - 12} a6 6 0 0 1 6 6 v${HEADER_H - 6} h-${BOX_W} z`} fill="var(--primary)" />
                  <text x={10} y={HEADER_H / 2 + 4} fontSize={12.5} fontWeight={700} fill="var(--on-primary)" fontFamily="var(--font-geist-mono), monospace">
                    {t.table.length > 24 ? t.table.slice(0, 23) + "…" : t.table}
                  </text>
                </g>
                {/* columns */}
                {shown.map((c, ri) => {
                  const y = HEADER_H + ri * ROW_H;
                  const isPk = c.Key === "PRI";
                  const isFk = fkCols.has(c.Field);
                  return (
                    <g key={c.Field} transform={`translate(0, ${y})`}>
                      {ri % 2 === 1 && <rect x={1} y={0} width={BOX_W - 2} height={ROW_H} fill="var(--row-even)" />}
                      {isFk && <circle cx={7} cy={ROW_H / 2} r={2.5} fill="var(--accent)" />}
                      <text x={14} y={ROW_H / 2 + 3.5} fontSize={11} fontFamily="var(--font-geist-mono), monospace" fill="var(--foreground)" fontWeight={isPk ? 700 : 400}>
                        {c.Field.length > 16 ? c.Field.slice(0, 15) + "…" : c.Field}{isPk ? " ✦" : ""}
                      </text>
                      <text x={BOX_W - 8} y={ROW_H / 2 + 3.5} fontSize={9.5} textAnchor="end" fontFamily="var(--font-geist-mono), monospace" fill="var(--muted)">
                        {(c.Type || "").split("(")[0].slice(0, 10)}
                      </text>
                    </g>
                  );
                })}
                {t.columns.length > MAX_ROWS && (
                  <text x={14} y={HEADER_H + MAX_ROWS * ROW_H + 2} fontSize={10} fill="var(--muted)">+{t.columns.length - MAX_ROWS} more…</text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
