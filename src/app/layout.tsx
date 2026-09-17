import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { getConfig } from "@/lib/db";
import ServerSwitcher from "@/components/ServerSwitcher";
import UrlEncodeTool from "@/components/UrlEncodeTool";
import ThemeToggle from "@/components/ThemeToggle";
import ThemePalette from "@/components/ThemePalette";
import CommandPalette from "@/components/CommandPalette";

// Applied before paint so a saved theme/accent choice doesn't flash the defaults first.
const THEME_INIT = `try{var t=localStorage.getItem('nma-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);var a=localStorage.getItem('nma-accent');if(a){a=JSON.parse(a);if(a&&a.p){document.documentElement.style.setProperty('--primary',a.p);document.documentElement.style.setProperty('--primary-hover',a.h);}}}catch(e){}`;

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "nextMyAdmin",
  description: "A phpMyAdmin replacement built with Next.js",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  let servers: { id: string; name: string }[] = [];
  try {
    servers = getConfig().servers.map((s) => ({ id: s.id, name: s.name }));
  } catch {
    // config not available
  }

  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-full flex flex-col overflow-hidden">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <header
          className="sticky top-0 z-50 px-4 py-1.5 flex items-center shrink-0"
          style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}
        >
          <Link href="/" className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--primary)" }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
              <rect width="32" height="32" rx="6" fill="var(--primary)" />
              <ellipse cx="16" cy="9" rx="9" ry="3" fill="none" stroke="#000" strokeWidth="2" />
              <path d="M7 9v7c0 1.66 4.03 3 9 3s9-1.34 9-3V9" fill="none" stroke="#000" strokeWidth="2" />
              <path d="M7 16v7c0 1.66 4.03 3 9 3s9-1.34 9-3v-7" fill="none" stroke="#000" strokeWidth="2" />
            </svg>
            nextMyAdmin
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <CommandPalette servers={servers} />
            <UrlEncodeTool />
            <ThemePalette />
            <ThemeToggle />
            <ServerSwitcher servers={servers} />
          </div>
        </header>
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </body>
    </html>
  );
}
