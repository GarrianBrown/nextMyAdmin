"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const ORDER: Theme[] = ["system", "light", "dark"];
const STORAGE_KEY = "nma-theme";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  // Load persisted choice on mount (the inline layout script already applied it pre-paint).
  useEffect(() => {
    const saved = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
    // Sync UI state from localStorage on mount — can't read it in the useState
    // initializer without causing an SSR/client hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(ORDER.includes(saved) ? saved : "system");
  }, []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(next);
    applyTheme(next);
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore storage errors */
    }
  }

  const label = theme === "system" ? "System theme" : theme === "light" ? "Light theme" : "Dark theme";

  return (
    <button
      onClick={cycle}
      className="btn py-1 px-2 text-xs"
      title={`${label} — click to change`}
      aria-label={`${label}. Click to change theme.`}
    >
      <span style={{ display: "inline-flex", width: 15, height: 15 }} aria-hidden>
        {theme === "system" ? <MonitorIcon /> : theme === "light" ? <SunIcon /> : <MoonIcon />}
      </span>
    </button>
  );
}

const svg = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function SunIcon() {
  return (
    <svg {...svg}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg {...svg}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
function MonitorIcon() {
  return (
    <svg {...svg}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
