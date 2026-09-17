"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnInfo } from "@/lib/types";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  serverId: string;
  database: string;
  rows?: number;
  placeholder?: string;
  onAcceptTable?: (tableName: string) => void;
}

export interface TableReference {
  table: string;
  columns: ColumnInfo[] | null;
  loading: boolean;
  error: string | null;
}

const SQL_KEYWORDS = new Set([
  "SELECT","FROM","WHERE","AND","OR","NOT","NULL","INSERT","INTO","VALUES","UPDATE","SET",
  "DELETE","CREATE","DROP","ALTER","TABLE","INDEX","VIEW","DATABASE","JOIN","INNER","LEFT",
  "RIGHT","OUTER","FULL","CROSS","ON","AS","ORDER","BY","GROUP","HAVING","LIMIT","OFFSET",
  "UNION","ALL","DISTINCT","IN","EXISTS","BETWEEN","LIKE","IS","TRUE","FALSE","CASE","WHEN",
  "THEN","ELSE","END","IF","PRIMARY","KEY","FOREIGN","REFERENCES","DEFAULT","AUTO_INCREMENT",
  "USE","SHOW","DESCRIBE","EXPLAIN","COUNT","SUM","AVG","MIN","MAX","COALESCE","CAST","CONVERT",
  "ASC","DESC","WITH","RECURSIVE","REPLACE","TRUNCATE","RENAME","ADD","COLUMN","CONSTRAINT",
  "UNIQUE","CHECK","GRANT","REVOKE","COMMIT","ROLLBACK","BEGIN","START","TRANSACTION",
  "INT","INTEGER","BIGINT","SMALLINT","TINYINT","MEDIUMINT","VARCHAR","CHAR","TEXT","TINYTEXT",
  "MEDIUMTEXT","LONGTEXT","DATE","DATETIME","TIMESTAMP","TIME","YEAR","BOOLEAN","BOOL",
  "DECIMAL","NUMERIC","FLOAT","DOUBLE","BLOB","LONGBLOB","MEDIUMBLOB","TINYBLOB","JSON","ENUM",
  "USING","NATURAL","OVER","PARTITION","ROWS","RANGE","FIRST","LAST",
]);

const COLORS: Record<string, string> = {
  keyword: "#569cd6",
  string: "#ce9178",
  number: "#b5cea8",
  comment: "#6a9955",
  ident: "#9cdcfe",
  mention: "#dcdcaa",
  op: "#d4d4d4",
  word: "#e4e4e7",
};

const EDITOR_BG = "#1e1e1e";
const EDITOR_FG = "#e4e4e7";

type Tok = { type: keyof typeof COLORS | "ws"; text: string };

function tokenize(sql: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      let j = i;
      while (j < sql.length && /\s/.test(sql[j])) j++;
      out.push({ type: "ws", text: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      let j = i;
      while (j < sql.length && sql[j] !== "\n") j++;
      out.push({ type: "comment", text: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      let j = i + 2;
      while (j < sql.length - 1 && !(sql[j] === "*" && sql[j + 1] === "/")) j++;
      j = Math.min(sql.length, j + 2);
      out.push({ type: "comment", text: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const q = ch;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "\\" && j + 1 < sql.length) { j += 2; continue; }
        if (sql[j] === q) { j++; break; }
        j++;
      }
      out.push({ type: "string", text: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === "`") {
      let j = i + 1;
      while (j < sql.length && sql[j] !== "`") j++;
      j = Math.min(sql.length, j + 1);
      out.push({ type: "ident", text: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < sql.length && /[0-9.]/.test(sql[j])) j++;
      out.push({ type: "number", text: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === "@") {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
      out.push({ type: "mention", text: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
      const word = sql.slice(i, j);
      out.push({ type: SQL_KEYWORDS.has(word.toUpperCase()) ? "keyword" : "word", text: word });
      i = j;
      continue;
    }
    out.push({ type: "op", text: ch });
    i++;
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderHighlighted(sql: string): string {
  const tokens = tokenize(sql);
  let html = "";
  for (const t of tokens) {
    if (t.type === "ws") {
      html += escapeHtml(t.text);
    } else {
      html += `<span style="color:${COLORS[t.type]}">${escapeHtml(t.text)}</span>`;
    }
  }
  // Trailing newline needs a char so the <pre> matches textarea height
  if (sql.endsWith("\n")) html += " ";
  return html;
}

const KEYWORDS = Array.from(SQL_KEYWORDS).sort();

// Clause keywords that steer what to suggest next.
const CLAUSE_KW = new Set([
  "SELECT","FROM","WHERE","JOIN","INTO","UPDATE","SET","GROUP","ORDER","HAVING","ON","BY",
  "VALUES","TABLE","RETURNING","USING","AND","OR",
]);
const TABLE_CLAUSES = new Set(["FROM","JOIN","INTO","UPDATE","TABLE","USING"]);
const COLUMN_CLAUSES = new Set(["SELECT","WHERE","SET","GROUP","ORDER","HAVING","ON","BY","RETURNING","AND","OR"]);
const TABLE_REF_KW = new Set(["FROM","JOIN","INTO","UPDATE"]);

type SuggestKind = "keyword" | "table" | "column";
interface Candidate { label: string; kind: SuggestKind; detail?: string }
type SuggestMode = "keyword" | "table" | "column" | "columnOf";
interface Analysis {
  start: number;
  end: number;
  partial: string;
  mode: SuggestMode;
  isMention: boolean;
  qualifier?: string;
}

function stripQuotes(s: string): string {
  return s.replace(/^[`"]|[`"]$/g, "");
}

/** Tables named in FROM/JOIN/INTO/UPDATE, with any alias, for column suggestions. */
function extractTableRefs(sql: string): { table: string; alias?: string }[] {
  const toks = tokenize(sql).filter((t) => t.type !== "ws" && t.type !== "comment");
  const refs: { table: string; alias?: string }[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === "keyword" && TABLE_REF_KW.has(t.text.toUpperCase())) {
      const nxt = toks[i + 1];
      if (nxt && (nxt.type === "word" || nxt.type === "ident")) {
        const table = stripQuotes(nxt.text);
        let alias: string | undefined;
        const a1 = toks[i + 2];
        if (a1 && a1.type === "keyword" && a1.text.toUpperCase() === "AS") {
          const a2 = toks[i + 3];
          if (a2 && (a2.type === "word" || a2.type === "ident")) alias = stripQuotes(a2.text);
        } else if (a1 && a1.type === "word" && !SQL_KEYWORDS.has(a1.text.toUpperCase())) {
          alias = stripQuotes(a1.text);
        }
        refs.push({ table, alias });
      }
    }
  }
  return refs;
}

/** True when the caret sits inside a string literal or a comment (skip suggesting there). */
function isInStringOrComment(value: string, caret: number): boolean {
  let inS = false, inD = false, inB = false, inLine = false, inBlock = false;
  for (let i = 0; i < caret; i++) {
    const c = value[i], n = value[i + 1];
    if (inLine) { if (c === "\n") inLine = false; continue; }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++; } continue; }
    if (inS) { if (c === "\\") { i++; continue; } if (c === "'") inS = false; continue; }
    if (inD) { if (c === "\\") { i++; continue; } if (c === '"') inD = false; continue; }
    if (inB) { if (c === "`") inB = false; continue; }
    if (c === "-" && n === "-") { inLine = true; i++; continue; }
    if (c === "/" && n === "*") { inBlock = true; i++; continue; }
    if (c === "'") { inS = true; continue; }
    if (c === '"') { inD = true; continue; }
    if (c === "`") { inB = true; continue; }
  }
  return inS || inD || inB || inLine || inBlock;
}

/** The most recent clause keyword before the caret, plus whether we're inside an open paren. */
function lastClause(pre: string): { kw: string; openParen: boolean } | null {
  const toks = tokenize(pre).filter((t) => t.type !== "ws" && t.type !== "comment");
  let kw: string | null = null;
  for (const t of toks) {
    if (t.type === "keyword" && CLAUSE_KW.has(t.text.toUpperCase())) kw = t.text.toUpperCase();
  }
  if (!kw) return null;
  const opens = (pre.match(/\(/g) || []).length;
  const closes = (pre.match(/\)/g) || []).length;
  return { kw, openParen: opens > closes };
}

/**
 * Work out what the caret is asking for: a keyword, a table, a column, or the columns
 * of a specific `alias.`-qualified table. Also flags `@table` mentions (reference cards).
 */
function analyzeCaret(value: string, caret: number): Analysis | null {
  if (isInStringOrComment(value, caret)) return null;

  let s = caret;
  while (s > 0 && /[A-Za-z0-9_]/.test(value[s - 1])) s--;
  const partial = value.slice(s, caret);
  const prevChar = s > 0 ? value[s - 1] : "";

  // @table mention → table list, and accepting pins a reference card.
  if (prevChar === "@") {
    return { start: s - 1, end: caret, partial, mode: "table", isMention: true };
  }

  // alias.  → columns of that table (partial may be empty)
  if (prevChar === ".") {
    let qs = s - 1;
    while (qs > 0 && /[A-Za-z0-9_`"]/.test(value[qs - 1])) qs--;
    const qualifier = stripQuotes(value.slice(qs, s - 1));
    if (qualifier) return { start: s, end: caret, partial, mode: "columnOf", qualifier, isMention: false };
  }

  if (partial.length === 0) return null;

  const clause = lastClause(value.slice(0, s));
  let mode: SuggestMode = "keyword";
  if (clause) {
    if (TABLE_CLAUSES.has(clause.kw)) mode = clause.openParen ? "column" : "table";
    else if (COLUMN_CLAUSES.has(clause.kw)) mode = "column";
  }
  return { start: s, end: caret, partial, mode, isMention: false };
}

/**
 * Pixel coords of the caret within the textarea (top/left relative to the textarea's padding box),
 * using a mirror div so wrapping is accounted for.
 */
function getCaretCoords(ta: HTMLTextAreaElement, pos: number): { top: number; left: number; lineHeight: number } {
  const style = getComputedStyle(ta);
  const mirror = document.createElement("div");
  const props = [
    "boxSizing", "width", "height", "overflowX", "overflowY",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "fontSizeAdjust",
    "lineHeight", "fontFamily", "textAlign", "textTransform", "textIndent", "textDecoration",
    "letterSpacing", "wordSpacing", "tabSize",
  ] as const;
  for (const p of props) {
    (mirror.style as unknown as Record<string, string>)[p] = (style as unknown as Record<string, string>)[p];
  }
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.textContent = ta.value.substring(0, pos);
  const marker = document.createElement("span");
  marker.textContent = ta.value.substring(pos) || ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  const left = marker.offsetLeft;
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
  document.body.removeChild(mirror);
  return { top, left, lineHeight };
}

export default function SqlCodeEditor({
  value,
  onChange,
  onSubmit,
  serverId,
  database,
  rows = 6,
  placeholder,
  onAcceptTable,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [tables, setTables] = useState<string[]>([]);
  const [columnsByTable, setColumnsByTable] = useState<Record<string, ColumnInfo[]>>({});
  const inflight = useRef<Set<string>>(new Set());

  const [suggest, setSuggest] = useState<(Analysis & {
    top: number;
    left: number;
    index: number;
  }) | null>(null);

  // Fetch the table list (drives table suggestions and column prefetch).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/databases/${database}/tables`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) setTables(data);
      } catch {
        /* ignore — autocomplete just won't populate */
      }
    })();
    return () => { cancelled = true; };
  }, [serverId, database]);

  // Tables named in the query, and an alias→table map for `alias.` completion.
  const refs = useMemo(() => extractTableRefs(value), [value]);
  const aliasMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of refs) {
      const real = tables.find((t) => t.toLowerCase() === r.table.toLowerCase()) ?? r.table;
      m.set(r.table.toLowerCase(), real);
      if (r.alias) m.set(r.alias.toLowerCase(), real);
    }
    return m;
  }, [refs, tables]);

  // Lazily fetch columns for every table referenced in the query, once.
  useEffect(() => {
    const wanted = new Set<string>();
    for (const r of refs) {
      const real = tables.find((t) => t.toLowerCase() === r.table.toLowerCase());
      if (real) wanted.add(real);
    }
    wanted.forEach((t) => {
      if (columnsByTable[t] !== undefined || inflight.current.has(t)) return;
      inflight.current.add(t);
      fetch(`${process.env.NEXT_PUBLIC_BASE_PATH}/api/servers/${serverId}/databases/${database}/tables/${encodeURIComponent(t)}/structure`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j && Array.isArray(j.columns)) setColumnsByTable((prev) => ({ ...prev, [t]: j.columns }));
        })
        .catch(() => {})
        .finally(() => inflight.current.delete(t));
    });
  }, [refs, tables, columnsByTable, serverId, database]);

  // Columns of all tables referenced in the query (for unqualified column suggestions).
  const referencedColumns = useMemo(() => {
    const out: { name: string; type: string }[] = [];
    const seen = new Set<string>();
    for (const r of refs) {
      const real = aliasMap.get(r.table.toLowerCase()) ?? r.table;
      for (const c of columnsByTable[real] ?? []) {
        if (seen.has(c.Field.toLowerCase())) continue;
        seen.add(c.Field.toLowerCase());
        out.push({ name: c.Field, type: c.Type });
      }
    }
    return out;
  }, [refs, aliasMap, columnsByTable]);

  // Build the ranked candidate list for the current caret context.
  const candidates = useMemo<Candidate[]>(() => {
    if (!suggest) return [];
    const p = suggest.partial.toLowerCase();
    const kw: Candidate[] = KEYWORDS.filter((k) => k.toLowerCase().includes(p)).map((k) => ({ label: k, kind: "keyword" as const }));
    const tbl: Candidate[] = tables.filter((t) => t.toLowerCase().includes(p)).map((t) => ({ label: t, kind: "table" as const }));
    const col: Candidate[] = referencedColumns.filter((c) => c.name.toLowerCase().includes(p)).map((c) => ({ label: c.name, kind: "column" as const, detail: c.type }));

    let list: Candidate[];
    if (suggest.mode === "columnOf") {
      const real = aliasMap.get((suggest.qualifier ?? "").toLowerCase())
        ?? tables.find((t) => t.toLowerCase() === (suggest.qualifier ?? "").toLowerCase())
        ?? suggest.qualifier ?? "";
      const cols = columnsByTable[real] ?? [];
      list = cols.filter((c) => c.Field.toLowerCase().includes(p)).map((c) => ({ label: c.Field, kind: "column" as const, detail: c.Type }));
    } else if (suggest.mode === "table") {
      list = [...tbl, ...kw];
    } else if (suggest.mode === "column") {
      list = [...col, ...tbl, ...kw];
    } else {
      list = [...kw, ...tbl];
    }

    // Dedupe by label (keep highest-priority occurrence), then prefix-first, then group order.
    const byLabel = new Map<string, { c: Candidate; order: number }>();
    list.forEach((c, order) => {
      const key = c.label.toLowerCase();
      if (!byLabel.has(key)) byLabel.set(key, { c, order });
    });
    const ranked = Array.from(byLabel.values());
    ranked.sort((a, b) => {
      const ap = a.c.label.toLowerCase().startsWith(p) ? 0 : 1;
      const bp = b.c.label.toLowerCase().startsWith(p) ? 0 : 1;
      return ap - bp || a.order - b.order || a.c.label.localeCompare(b.c.label);
    });
    const result = ranked.slice(0, 10).map((r) => r.c);
    // Hide a lone suggestion that just echoes what's already typed.
    if (result.length === 1 && result[0].label.toLowerCase() === p) return [];
    return result;
  }, [suggest, tables, referencedColumns, columnsByTable, aliasMap]);

  const syncScroll = useCallback(() => {
    const ta = textareaRef.current, pre = preRef.current;
    if (!ta || !pre) return;
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  }, []);

  const updateSuggestFromCaret = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const caret = ta.selectionStart;
    // Only suggest for a collapsed caret (no active selection).
    const hit = ta.selectionStart === ta.selectionEnd ? analyzeCaret(ta.value, caret) : null;
    if (!hit) {
      setSuggest(null);
      return;
    }
    const { top, left, lineHeight } = getCaretCoords(ta, hit.start);
    const rect = ta.getBoundingClientRect();
    setSuggest((prev) => ({
      ...hit,
      top: rect.top + top + lineHeight - ta.scrollTop,
      left: rect.left + left - ta.scrollLeft,
      index: prev && prev.partial === hit.partial && prev.mode === hit.mode ? prev.index : 0,
    }));
  }, []);

  // Sync pre-overlay scroll when value changes (e.g. programmatic update).
  useEffect(() => {
    syncScroll();
  }, [value, syncScroll]);

  function acceptSuggestion(cand: Candidate) {
    if (!suggest) return;
    const insert = cand.label + (cand.kind === "keyword" ? " " : "");
    const before = value.slice(0, suggest.start);
    const after = value.slice(suggest.end);
    const newValue = before + insert + after;
    const newCaret = (before + insert).length;
    onChange(newValue);
    setSuggest(null);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = newCaret;
      }
    });
    if (suggest.isMention && cand.kind === "table") onAcceptTable?.(cand.label);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // suggestion popup handling takes priority (but Ctrl+Enter still runs the query)
    if (suggest && candidates.length > 0 && !(e.ctrlKey && e.key === "Enter")) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSuggest({ ...suggest, index: (suggest.index + 1) % candidates.length });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSuggest({ ...suggest, index: (suggest.index - 1 + candidates.length) % candidates.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        acceptSuggestion(candidates[Math.min(suggest.index, candidates.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSuggest(null);
        return;
      }
    }

    if (e.ctrlKey && e.key === "Enter") {
      e.preventDefault();
      onSubmit?.();
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      if (start === end) {
        if (e.shiftKey) {
          // de-indent current line
          const lineStart = value.lastIndexOf("\n", start - 1) + 1;
          if (value.slice(lineStart, lineStart + 2) === "  ") {
            const newVal = value.slice(0, lineStart) + value.slice(lineStart + 2);
            onChange(newVal);
            requestAnimationFrame(() => {
              ta.selectionStart = ta.selectionEnd = Math.max(lineStart, start - 2);
            });
          }
        } else {
          const newVal = value.slice(0, start) + "  " + value.slice(end);
          onChange(newVal);
          requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = start + 2;
          });
        }
      } else {
        // indent/de-indent all selected lines
        const lineStart = value.lastIndexOf("\n", start - 1) + 1;
        const before = value.slice(0, lineStart);
        const selected = value.slice(lineStart, end);
        const lines = selected.split("\n");
        const transformed = e.shiftKey
          ? lines.map((l) => (l.startsWith("  ") ? l.slice(2) : l.startsWith(" ") ? l.slice(1) : l))
          : lines.map((l) => "  " + l);
        const newSelected = transformed.join("\n");
        const newVal = before + newSelected + value.slice(end);
        onChange(newVal);
        const diff = newSelected.length - selected.length;
        const firstLineDelta = transformed[0].length - lines[0].length;
        requestAnimationFrame(() => {
          ta.selectionStart = start + firstLineDelta;
          ta.selectionEnd = end + diff;
        });
      }
    }
  }

  return (
    <div>
      <div
        ref={wrapperRef}
        className="relative rounded-md overflow-hidden"
        style={{ background: EDITOR_BG, border: "1px solid var(--border)" }}
      >
        <pre
          ref={preRef}
          aria-hidden
          className="m-0 pointer-events-none"
          style={{
            position: "absolute",
            inset: 0,
            padding: "8px 12px",
            margin: 0,
            overflow: "hidden",
            whiteSpace: "pre-wrap",
            wordWrap: "break-word",
            fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
            fontSize: "13px",
            lineHeight: "1.5",
            color: EDITOR_FG,
            background: "transparent",
          }}
          dangerouslySetInnerHTML={{ __html: renderHighlighted(value) || "&nbsp;" }}
        />
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            // Run after state commits so the mirror div reads the new value.
            requestAnimationFrame(updateSuggestFromCaret);
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={updateSuggestFromCaret}
          onClick={updateSuggestFromCaret}
          onScroll={syncScroll}
          onBlur={() => {
            // Keep popup a moment so clicks register; then hide
            setTimeout(() => setSuggest(null), 150);
          }}
          rows={rows}
          spellCheck={false}
          placeholder={placeholder}
          style={{
            position: "relative",
            display: "block",
            width: "100%",
            padding: "8px 12px",
            margin: 0,
            border: "none",
            outline: "none",
            resize: "vertical",
            background: "transparent",
            color: "transparent",
            caretColor: EDITOR_FG,
            fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
            fontSize: "13px",
            lineHeight: "1.5",
            whiteSpace: "pre-wrap",
            wordWrap: "break-word",
            overflow: "auto",
          }}
        />

        {suggest && candidates.length > 0 && (
          <ul
            className="rounded-md shadow-lg overflow-auto"
            style={{
              position: "fixed",
              top: suggest.top,
              left: suggest.left,
              zIndex: 9999,
              minWidth: 220,
              maxHeight: 260,
              background: "#252526",
              border: "1px solid #3f3f46",
              color: EDITOR_FG,
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              fontSize: "12px",
            }}
          >
            {candidates.map((c, i) => (
              <li
                key={`${c.kind}:${c.label}`}
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent textarea blur before click handled
                  acceptSuggestion(c);
                }}
                onMouseEnter={() => setSuggest((s) => (s ? { ...s, index: i } : s))}
                className="px-2 py-1 cursor-pointer flex items-center gap-2"
                style={{ background: i === suggest.index ? "#094771" : "transparent" }}
              >
                <span
                  aria-hidden
                  title={c.kind}
                  style={{
                    width: 14, textAlign: "center", flexShrink: 0, fontWeight: 700,
                    color: c.kind === "keyword" ? COLORS.keyword : c.kind === "table" ? COLORS.mention : COLORS.ident,
                  }}
                >
                  {c.kind === "keyword" ? "K" : c.kind === "table" ? "T" : "C"}
                </span>
                <span className="truncate">{c.label}</span>
                {c.detail && (
                  <span className="ml-auto truncate" style={{ color: "#858585", maxWidth: 90 }}>{c.detail}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

    </div>
  );
}

export function TableReferenceList({
  references,
  onRemove,
}: {
  references: TableReference[];
  onRemove: (tableName: string) => void;
}) {
  if (references.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {references.map((ref) => (
        <div
          key={ref.table}
          className="rounded-md text-xs"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            minWidth: 180,
            maxWidth: 260,
          }}
        >
          <div
            className="flex items-center justify-between px-2 py-1 rounded-t-md"
            style={{
              background: "color-mix(in srgb, var(--primary) 12%, transparent)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span className="font-mono font-semibold truncate">{ref.table}</span>
            <button
              onClick={() => onRemove(ref.table)}
              className="ml-2 px-1.5 rounded hover:opacity-80"
              style={{ color: "var(--muted)" }}
              title="Remove reference"
              aria-label={`Remove ${ref.table} reference`}
            >
              ×
            </button>
          </div>
          <div className="p-1.5">
            {ref.loading && (
              <div className="font-mono" style={{ color: "var(--muted)" }}>Loading…</div>
            )}
            {ref.error && (
              <div className="font-mono" style={{ color: "var(--danger)" }}>{ref.error}</div>
            )}
            {ref.columns && (
              <ul className="font-mono space-y-0.5">
                {ref.columns.map((c) => (
                  <li key={c.Field} className="flex gap-2 justify-between">
                    <span style={{ color: c.Key === "PRI" ? "var(--primary)" : "var(--foreground)" }}>
                      {c.Field}
                      {c.Key === "PRI" && <span style={{ color: "var(--muted)" }}> [PK]</span>}
                    </span>
                    <span style={{ color: "var(--muted)" }} className="truncate">{c.Type}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
