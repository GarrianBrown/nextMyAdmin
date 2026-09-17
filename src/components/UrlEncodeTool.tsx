"use client";

import { useEffect, useState } from "react";

export default function UrlEncodeTool() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);

  const encoded = input ? encodeURIComponent(input) : "";

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function copy() {
    if (!encoded) return;
    try {
      await navigator.clipboard.writeText(encoded);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <>
      <button
        type="button"
        className="text-xs hover:underline"
        style={{ color: "var(--primary)" }}
        onClick={() => setOpen(true)}
        title="URL-encode a password for DATABASE_URL"
      >
        URL-encode
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded p-5 flex flex-col gap-3"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">URL-encode password</h2>
                <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                  Paste a password to get its URL-encoded form for a DATABASE_URL.
                </p>
              </div>
              <button
                className="btn text-xs"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>
                Password
              </span>
              <input
                autoFocus
                className="input text-sm font-mono"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="paste password"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>
                URL-encoded
              </span>
              <code
                className="text-sm px-2 py-2 rounded font-mono break-all cursor-pointer select-all min-h-[2.25rem]"
                style={{ background: "var(--background)", border: "1px solid var(--border)" }}
                onClick={copy}
                title="Click to copy"
              >
                {encoded || <span style={{ color: "var(--muted)" }}>—</span>}
              </code>
            </label>

            <div className="flex items-center justify-end gap-2">
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                {copied ? "Copied!" : encoded ? "Click output to copy" : ""}
              </span>
              <button
                type="button"
                className="btn btn-primary text-xs"
                onClick={copy}
                disabled={!encoded}
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
