# nextMyAdmin — Install on macOS

A local-first MySQL admin UI. Runs on your own machine and talks straight to your
MySQL servers — nothing is hosted, nothing phones home.

## 1. Prerequisites

You need **Node.js 20 or newer**. Check what you have:

```bash
node -v
```

If that errors or shows something older than v20, install it. Easiest route is
[Homebrew](https://brew.sh):

```bash
brew install node
```

You also need a MySQL server to point it at. If you don't already have one running
locally:

```bash
brew install mysql
brew services start mysql
```

That gives you MySQL on `127.0.0.1:3306` with user `root` and an empty password.

## 2. Unpack and install dependencies

```bash
cd ~/Downloads          # or wherever you unzipped it
cd nextMyAdmin
npm install
```

This pulls down `node_modules` (a few hundred MB) and takes a minute or two.

## 3. Add your server credentials

The app reads a single config file at the project root. It is **not** included in
this zip — you create your own from the example:

```bash
cp nextmyadmin.config.example.json nextmyadmin.config.json
```

Then open `nextmyadmin.config.json` and fill in your servers:

```json
{
  "servers": [
    {
      "id": "local",
      "name": "Local MySQL",
      "host": "127.0.0.1",
      "port": 3306,
      "user": "root",
      "password": ""
    }
  ]
}
```

- `id` — short slug, used in URLs. Letters, numbers and dashes.
- `name` — whatever you want shown in the server switcher.
- Add as many entries to the `servers` array as you like; the UI lets you switch
  between them.

Credentials are stored in plain text in this file, so keep it local. It is already
listed in `.gitignore`.

## 4. Run it

```bash
npm run dev
```

Then open:

**http://localhost:3000/nextMyAdmin**

Note the `/nextMyAdmin` path — the app is configured with a base path (see
`basePath` in `next.config.ts`). If you'd rather have it at the bare root, delete
the `basePath` line and set `NEXT_PUBLIC_BASE_PATH` to `""` in that same file, then
restart.

## 5. Optional — run it as a build instead of dev mode

Dev mode recompiles on the fly and is a bit slower to click around. For everyday
use:

```bash
npm run build
npm start
```

Same URL. Re-run `npm run build` after any code change.

## Troubleshooting

**`ECONNREFUSED 127.0.0.1:3306`** — MySQL isn't running. `brew services start mysql`.

**`Access denied for user ...`** — wrong user/password in `nextmyadmin.config.json`.
Verify with `mysql -u root -p` from the terminal first.

**`Server "xyz" not found in config`** — the `id` in the URL doesn't match any `id`
in your config file.

**Port 3000 already in use** — `npm run dev -- -p 3001`, then browse to
`http://localhost:3001/nextMyAdmin`.

**Connecting to a remote MySQL server** — most hosts don't expose 3306 publicly.
Open an SSH tunnel and point the config at the local end of it:

```bash
ssh -L 3307:127.0.0.1:3306 you@your-server
```

...then use `"host": "127.0.0.1", "port": 3307` in the config.

## A word of caution

This tool does exactly what you tell it to — dropping databases, editing rows and
changing user privileges all happen without much ceremony. Point it at a production
server only if you mean it.
