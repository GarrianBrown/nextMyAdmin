# nextMyAdmin

A fast, local-first database admin UI built with Next.js — a lighter, phpMyAdmin-
inspired alternative that speaks more than one engine.

**Installing on a Mac? See [INSTALL-MAC.md](INSTALL-MAC.md).**

## Engines

Each server declares an `engine` in the config (defaults to `mysql`):

| Engine | Browse · structure · row CRUD | SQL console | Users | Create / drop DB | Rename / copy | Export / import |
| --- | --- | --- | --- | --- | --- | --- |
| MySQL / MariaDB | ✅ | ✅ | ✅ | ✅ / ✅ | ✅ | ✅ |
| PostgreSQL | ✅ | ✅ | — | ✅ / ✅ | — | — |
| SQLite | ✅ | ✅ | — | ✅ / ✅ | — | — |
| MongoDB | ✅ | — (no SQL) | — | — / ✅ | — | — |

MongoDB maps databases → databases, collections → tables, documents → rows; its
"structure" is inferred by sampling documents. The UI hides actions an engine
doesn't support via each driver's capability flags.

## What it does

- Browse servers, databases and tables through a phpMyAdmin-style nav tree, breadcrumbs and tabbed sub-navigation (light + dark)
- Run SQL with an editor, inline-edit and delete result rows, export results to CSV
- Insert / edit / delete rows in the table browser
- Create, rename, copy and drop databases
- Import and export SQL dumps
- Manage users, passwords and privileges (MySQL/MariaDB)
- Handy extras: MySQL function dictionary, URL encode/decode tool

## Quick start

```bash
npm install
cp nextmyadmin.config.example.json nextmyadmin.config.json   # then edit it
npm run dev
```

Open http://localhost:3000/nextMyAdmin

## Configuration

All configuration lives in `nextmyadmin.config.json` at the project root — a list of
servers, each with an `engine`, host, port, user and password (Postgres also takes an
optional `defaultDatabase` and `ssl`). It is gitignored and must be created by each
user; see [`nextmyadmin.config.example.json`](nextmyadmin.config.example.json) for the shape.

## Layout

```
src/app/api/...      REST routes — one folder per operation
src/app/server/...   UI pages, routed by [serverId]/[database]/[table]
src/components/...    Client components (modals, editors, browsers)
src/lib/drivers/...   Per-engine drivers behind a shared DatabaseDriver interface
src/lib/db.ts         Config loading + raw MySQL connections (legacy routes)
```

Adding an engine means implementing the `DatabaseDriver` interface in
`src/lib/drivers/` and registering it in `getDriver()`; the routes and UI are
engine-agnostic.

## Desktop app (Electron)

nextMyAdmin also ships as a native desktop app that wraps the Next server.

```bash
npm run electron:dev     # run the app in a desktop window (dev)
npm run electron:build   # build an installer for the current OS into dist-electron/
```

- **macOS** builds a **universal** (Apple Silicon + Intel) `.dmg`.
- **Windows** builds an NSIS `.exe`; **Linux** builds `.AppImage` + `.deb`.
- In the packaged app, config lives at a per-user path (macOS: `~/Library/Application Support/nextMyAdmin/nextmyadmin.config.json`), seeded empty on first run.

Cross-building Windows/Linux from macOS is unreliable, so [`.github/workflows/release.yml`](.github/workflows/release.yml)
builds all three on their native runners and, on a `v*` tag, publishes the
installers to a GitHub Release. The macOS build is currently **unsigned** — add
Apple Developer ID certs as CI secrets to sign + notarize for clean downloads.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · mysql2 · pg ·
better-sqlite3 · mongodb · Electron · electron-builder
