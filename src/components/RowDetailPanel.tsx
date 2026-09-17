"use client";

import { useEffect, useMemo, useState } from "react";

interface RowDetailPanelProps {
  rows: Record<string, unknown>[];
  fields: string[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}

/**
 * A read-only right-side panel that shows the selected row as clean, formatted
 * JSON — auto-parsing JSON stored inside text columns so it nests — with a
 * key/value search box and prev/next row navigation. (Beekeeper-style.)
 */
export default function RowDetailPanel({ rows, fields, index, onIndexChange, onClose }: RowDetailPanelProps) {
  const [query, setQuery] = useState("");
  const row = rows[index];

  // Arrow keys move between rows; Escape closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (e.key === "Escape") onClose();
        return;
      }
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown" && index < rows.length - 1) { e.preventDefault(); onIndexChange(index + 1); }
      else if (e.key === "ArrowUp" && index > 0) { e.preventDefault(); onIndexChange(index - 1); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, rows.length, onIndexChange, onClose]);

  // Build a display object: each field's value, with JSON-in-text parsed into structure.
  const pretty = useMemo(() => {
    if (!row) return "";
    const obj: Record<string, unknown> = {};
    for (const f of fields) {
      const v = row[f];
      obj[f] = maybeParseJson(v);
    }
    return JSON.stringify(obj, jsonReplacer, 2);
  }, [row, fields]);

  if (!row) return null;

  return (
    <aside
      className="shrink-0 flex flex-col h-full"
      style={{ width: 380, borderLeft: "1px solid var(--border)", background: "var(--card)" }}
    >
      <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        <span className="text-sm font-semibold">Row details</span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>{index + 1} / {rows.length}</span>
        <div className="ml-auto flex items-center gap-1">
          <button className="btn py-0.5 px-1.5 text-xs" disabled={index <= 0} onClick={() => onIndexChange(index - 1)} title="Previous row (↑)">↑</button>
          <button className="btn py-0.5 px-1.5 text-xs" disabled={index >= rows.length - 1} onClick={() => onIndexChange(index + 1)} title="Next row (↓)">↓</button>
          <button className="btn py-0.5 px-1.5 text-xs" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
      </div>

      <div className="px-3 py-2 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        <input
          className="input w-full text-xs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by key or value…"
          spellCheck={false}
        />
      </div>

      <div className="flex-1 overflow-auto p-3">
        <pre className="font-mono text-xs whitespace-pre-wrap break-words" style={{ margin: 0, lineHeight: 1.55 }}>
          {highlight(pretty, query)}
        </pre>
      </div>

      <div className="px-3 py-1.5 shrink-0 text-xs" style={{ borderTop: "1px solid var(--border)", color: "var(--muted)" }}>
        ↑ / ↓ to move between rows · Esc to close
      </div>
    </aside>
  );
}

/** Parse a string that holds JSON into its structure; otherwise return the value as-is. */
function maybeParseJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      const parsed = JSON.parse(t);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* not JSON — keep the string */
    }
  }
  return v;
}

/** Render null/undefined and Buffers readably in the JSON output. */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value === undefined) return null;
  return value;
}

const COLORS = { key: "#9cdcfe", string: "#ce9178", number: "#b5cea8", keyword: "#569cd6" };

/**
 * Lightweight JSON syntax highlighting + case-insensitive search highlighting,
 * returned as an array of React nodes (no dangerouslySetInnerHTML).
 */
function highlight(json: string, query: string): React.ReactNode[] {
  const tokenRe = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = tokenRe.exec(json)) !== null) {
    if (m.index > last) out.push(...withSearch(json.slice(last, m.index), query, k++));
    let color = COLORS.string;
    if (m[1]) color = COLORS.key;
    else if (m[3]) color = COLORS.number;
    else if (m[4]) color = COLORS.keyword;
    out.push(<span key={`t${k++}`} style={{ color }}>{withSearch(m[0], query, k)}</span>);
    last = tokenRe.lastIndex;
  }
  if (last < json.length) out.push(...withSearch(json.slice(last), query, k++));
  return out;
}

/** Wrap case-insensitive matches of `query` in a highlight mark. */
function withSearch(text: string, query: string, keyBase: number): React.ReactNode[] {
  const q = query.trim();
  if (!q) return [text];
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  let i = 0, n = 0;
  while (i < text.length) {
    const hit = lower.indexOf(ql, i);
    if (hit === -1) { parts.push(text.slice(i)); break; }
    if (hit > i) parts.push(text.slice(i, hit));
    parts.push(
      <mark key={`m${keyBase}-${n++}`} style={{ background: "var(--accent)", color: "#111", borderRadius: 2 }}>
        {text.slice(hit, hit + q.length)}
      </mark>
    );
    i = hit + q.length;
  }
  return parts;
}
