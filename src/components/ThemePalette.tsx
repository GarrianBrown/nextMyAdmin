"use client";

import { useEffect, useState } from "react";

interface Preset { name: string; p: string; h: string }

// Accent presets — mid-tone saturated colors that read well in both light and dark.
const PRESETS: Preset[] = [
  { name: "Blue", p: "#3b82f6", h: "#2563eb" },
  { name: "Emerald", p: "#10b981", h: "#059669" },
  { name: "Violet", p: "#8b5cf6", h: "#7c3aed" },
  { name: "Rose", p: "#f43f5e", h: "#e11d48" },
  { name: "Amber", p: "#f59e0b", h: "#d97706" },
  { name: "Cyan", p: "#06b6d4", h: "#0891b2" },
  { name: "Gold", p: "#c99a2e", h: "#a87f22" },
];

const STORAGE_KEY = "nma-accent";

function apply(preset: Preset | null) {
  const root = document.documentElement;
  if (!preset) {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--primary-hover");
  } else {
    root.style.setProperty("--primary", preset.p);
    root.style.setProperty("--primary-hover", preset.h);
  }
}

export default function ThemePalette() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>("Default"); // "Default" = follow theme

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Preset;
        // localStorage isn't available during render, so sync it on mount.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (p?.name) setSelected(p.name);
      }
    } catch {
      /* ignore */
    }
  }, []);

  function pick(preset: Preset | null) {
    apply(preset);
    setSelected(preset?.name ?? "Default");
    setOpen(false);
    try {
      if (preset) localStorage.setItem(STORAGE_KEY, JSON.stringify(preset));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="btn py-1 px-2 text-xs" title={`Accent: ${selected}`} aria-label="Change accent color">
        <span aria-hidden style={{ width: 13, height: 13, borderRadius: "50%", background: "var(--primary)", display: "inline-block", border: "1px solid var(--border-strong)" }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 rounded-md shadow-lg p-2" style={{ background: "var(--card)", border: "1px solid var(--border)", width: 168 }}>
            <div className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 px-0.5" style={{ color: "var(--muted)" }}>Accent color</div>
            <div className="grid grid-cols-4 gap-1.5">
              <button
                onClick={() => pick(null)}
                title="Default (follows theme)"
                className="flex items-center justify-center rounded"
                style={{ height: 28, background: "var(--surface)", border: `2px solid ${selected === "Default" ? "var(--foreground)" : "var(--border)"}`, fontSize: 10, color: "var(--muted)" }}
              >
                Auto
              </button>
              {PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => pick(preset)}
                  title={preset.name}
                  className="rounded"
                  style={{ height: 28, background: preset.p, border: `2px solid ${selected === preset.name ? "var(--foreground)" : "transparent"}` }}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
