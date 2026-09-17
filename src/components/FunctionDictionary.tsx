"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { MYSQL_FUNCTIONS, docUrl, type MysqlFunction } from "@/lib/mysqlFunctions";

const STORAGE_KEY = "nma.functionDictionary.open";

/**
 * Open/closed lives in localStorage so the panel stays where you left it.
 * Backed by useSyncExternalStore: the server always snapshots "closed", so hydration
 * matches, and the client swaps to the stored value without a cascading render.
 */
const openStore = {
  listeners: new Set<() => void>(),
  subscribe(cb: () => void) {
    openStore.listeners.add(cb);
    return () => openStore.listeners.delete(cb);
  },
  get() {
    return localStorage.getItem(STORAGE_KEY) === "1";
  },
  getServer() {
    return false;
  },
  set(next: boolean) {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    openStore.listeners.forEach((l) => l());
  },
};

/**
 * Rank a function against the query. Lower score = better match; null = no match.
 * Name matches always beat alias matches, which beat description matches.
 */
function score(fn: MysqlFunction, q: string): number | null {
  const name = fn.name.toLowerCase();
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  if (fn.aliases?.some((a) => a.toLowerCase().startsWith(q))) return 3;
  if (fn.aliases?.some((a) => a.toLowerCase().includes(q))) return 4;
  if (fn.syntax.toLowerCase().includes(q)) return 5;
  if (fn.description.toLowerCase().includes(q)) return 6;
  return null;
}

export default function FunctionDictionary() {
  const open = useSyncExternalStore(openStore.subscribe, openStore.get, openStore.getServer);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  function toggle(next: boolean) {
    openStore.set(next);
    if (next) requestAnimationFrame(() => searchRef.current?.focus());
  }

  // Ctrl+/ focuses the dictionary search from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === "/") {
        e.preventDefault();
        toggle(true);
        requestAnimationFrame(() => searchRef.current?.select());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const q = query.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!q) return MYSQL_FUNCTIONS;
    return MYSQL_FUNCTIONS.map((fn) => ({ fn, s: score(fn, q) }))
      .filter((m): m is { fn: MysqlFunction; s: number } => m.s !== null)
      .sort((a, b) => a.s - b.s || a.fn.name.localeCompare(b.fn.name))
      .map((m) => m.fn);
  }, [q]);

  // With no query, browse by category. With a query, show one flat relevance-ranked list.
  const groups = useMemo(() => {
    if (q) return [{ category: null as string | null, fns: matches }];
    const byCategory = new Map<string, MysqlFunction[]>();
    for (const fn of matches) {
      const list = byCategory.get(fn.category) ?? [];
      list.push(fn);
      byCategory.set(fn.category, list);
    }
    return [...byCategory].map(([category, fns]) => ({ category, fns }));
  }, [matches, q]);

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
    } catch {
      /* clipboard unavailable — nothing to do */
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => toggle(true)}
        title="MySQL function reference (Ctrl+/)"
        className="shrink-0 flex items-start justify-center pt-3 px-1.5 text-xs hover:opacity-80 cursor-pointer"
        style={{ borderLeft: "1px solid var(--border)", background: "var(--card)", color: "var(--muted)" }}
      >
        <span style={{ writingMode: "vertical-rl" }} className="font-medium tracking-wide">
          ƒ&nbsp; Functions
        </span>
      </button>
    );
  }

  return (
    <aside
      className="shrink-0 flex flex-col min-h-0"
      style={{ width: 300, borderLeft: "1px solid var(--border)", background: "var(--card)" }}
    >
      <div className="shrink-0 px-2.5 py-2 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
        <span className="text-xs font-semibold">MySQL functions</span>
        <span className="text-xs ml-auto" style={{ color: "var(--muted)" }}>
          {matches.length}
        </span>
        <button
          onClick={() => toggle(false)}
          className="text-sm leading-none px-1 cursor-pointer hover:opacity-70"
          style={{ color: "var(--muted)" }}
          title="Hide"
          aria-label="Hide function dictionary"
        >
          ×
        </button>
      </div>

      <div className="shrink-0 p-2" style={{ borderBottom: "1px solid var(--border)" }}>
        <input
          ref={searchRef}
          className="input text-xs w-full py-1.5"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (query) setQuery("");
              else toggle(false);
            }
            // Enter opens the top hit — type "sub", hit Enter, read the syntax.
            if (e.key === "Enter" && matches.length > 0) {
              setSelected(matches[0].name);
            }
          }}
          placeholder="Search — SUBSTRING, days between…"
          spellCheck={false}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {matches.length === 0 && (
          <p className="text-xs p-3" style={{ color: "var(--muted)" }}>
            No function matches “{query}”.
          </p>
        )}

        {groups.map(({ category, fns }) => (
          <div key={category ?? "results"}>
            {category && (
              <div
                className="sticky top-0 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider z-10"
                style={{
                  background: "var(--background)",
                  color: "var(--muted)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                {category}
              </div>
            )}

            {fns.map((fn) => {
              const isOpen = selected === fn.name;
              return (
                <div key={fn.name} style={{ borderBottom: "1px solid var(--border)" }}>
                  <button
                    onClick={() => setSelected(isOpen ? null : fn.name)}
                    className="w-full text-left px-2.5 py-1.5 flex items-baseline gap-2 cursor-pointer"
                    style={{
                      background: isOpen ? "color-mix(in srgb, var(--primary) 12%, transparent)" : "transparent",
                    }}
                  >
                    <span className="font-mono text-xs font-semibold" style={{ color: "var(--primary)" }}>
                      {fn.name}
                    </span>
                    {!isOpen && (
                      <span className="text-[10px] truncate" style={{ color: "var(--muted)" }}>
                        {q ? fn.description : fn.syntax.split("\n")[0]}
                      </span>
                    )}
                  </button>

                  {isOpen && (
                    <div className="px-2.5 pb-2.5 pt-0.5 flex flex-col gap-2">
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                            Syntax
                          </span>
                          <button
                            onClick={() => copy(fn.syntax, `syn:${fn.name}`)}
                            className="text-[10px] cursor-pointer hover:underline"
                            style={{ color: "var(--primary)" }}
                          >
                            {copied === `syn:${fn.name}` ? "Copied!" : "Copy"}
                          </button>
                        </div>
                        <pre
                          className="font-mono text-[11px] p-1.5 rounded whitespace-pre-wrap break-words m-0"
                          style={{ background: "var(--background)", border: "1px solid var(--border)" }}
                        >
                          {fn.syntax}
                        </pre>
                      </div>

                      <p className="text-[11px] leading-relaxed" style={{ color: "var(--foreground)" }}>
                        {fn.description}
                      </p>

                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                            Example
                          </span>
                          <button
                            onClick={() => copy(fn.example, `ex:${fn.name}`)}
                            className="text-[10px] cursor-pointer hover:underline"
                            style={{ color: "var(--primary)" }}
                          >
                            {copied === `ex:${fn.name}` ? "Copied!" : "Copy"}
                          </button>
                        </div>
                        <pre
                          className="font-mono text-[11px] p-1.5 rounded whitespace-pre-wrap break-words m-0"
                          style={{ background: "var(--background)", border: "1px solid var(--border)" }}
                        >
                          {fn.example}
                        </pre>
                        {fn.result && (
                          <p className="font-mono text-[10px] mt-1" style={{ color: "var(--muted)" }}>
                            → {fn.result}
                          </p>
                        )}
                      </div>

                      <a
                        href={docUrl(fn)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] hover:underline"
                        style={{ color: "var(--primary)" }}
                      >
                        MySQL docs ↗
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
