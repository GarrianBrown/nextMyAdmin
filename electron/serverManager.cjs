// DBngin-style local database server manager (runs in the Electron main process).
//
// Detects DB server binaries already installed on the machine (Homebrew / PATH),
// and creates/starts/stops "instances" — each an isolated data directory on a
// chosen port, supervised as a child process. Running instances are mirrored
// into nextmyadmin.config.json so the admin UI can browse them immediately.
//
// Written as a plain Node module (no electron imports) so it can be unit-tested
// directly with `node`. The Electron layer only injects the userData path and
// wires IPC.
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

// Homebrew keg prefixes to scan (macOS arm64, macOS intel). Each engine's server
// binary lives under <prefix>/<name>/bin.
const BREW_PREFIXES = ["/opt/homebrew/opt", "/usr/local/opt"];

const ENGINES = {
  postgres: { label: "PostgreSQL", server: "postgres", brewPrefixes: ["postgresql"], driver: "postgres", needsInit: true },
  mysql: { label: "MySQL", server: "mysqld", brewPrefixes: ["mysql"], driver: "mysql", needsInit: true },
  mariadb: { label: "MariaDB", server: "mariadbd", brewPrefixes: ["mariadb"], driver: "mariadb", needsInit: true },
  mongodb: { label: "MongoDB", server: "mongod", brewPrefixes: ["mongodb-community", "mongodb"], driver: "mongodb", needsInit: false },
};

// Download-on-demand: self-contained binary sources so a bare machine (nothing
// installed) can still spin up a server. Only the engines with clean, portable
// binary distributions are offered; MySQL/MariaDB are system-install-only for now.
const DOWNLOADS = {
  postgres: {
    versions: ["17.2.0", "16.6.0"],
    // Zonky's embedded-postgres binaries (Maven Central) — a .jar wrapping a .txz.
    resolve(version) {
      const plat = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
      const arch = process.arch === "arm64" ? "arm64v8" : "amd64";
      const artifact = `embedded-postgres-binaries-${plat}-${arch}`;
      return {
        url: `https://repo1.maven.org/maven2/io/zonky/test/postgres/${artifact}/${version}/${artifact}-${version}.jar`,
        archive: "zonky-jar",
      };
    },
  },
  mongodb: {
    versions: ["8.0.4", "7.0.14"],
    resolve(version) {
      if (process.platform === "darwin") {
        const arch = process.arch === "arm64" ? "arm64" : "x86_64";
        return { url: `https://fastdl.mongodb.org/osx/mongodb-macos-${arch}-${version}.tgz`, archive: "tgz", strip: 1 };
      }
      if (process.platform === "win32") {
        return { url: `https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-${version}.zip`, archive: "zip", strip: 1 };
      }
      // Linux: MongoDB ships per-distro tarballs. The Ubuntu 22.04 build runs on
      // most modern glibc distros — best-effort (a mismatched distro may not start).
      const larch = process.arch === "arm64" ? "aarch64" : "x86_64";
      return { url: `https://fastdl.mongodb.org/linux/mongodb-linux-${larch}-ubuntu2204-${version}.tgz`, archive: "tgz", strip: 1 };
    },
  },
};

const exe = (p) => (process.platform === "win32" ? `${p}.exe` : p);

// Standard listening port per engine — used to pick the "primary" port when a
// process listens on several (e.g. mysqld on 3306 + 33060 for mysqlx).
const DEFAULT_LISTEN_PORTS = { postgres: 5432, mysql: 3306, mariadb: 3306, mongodb: 27017 };

/** Map a running process's executable name to one of our engines (or null). */
function engineForProc(name) {
  const c = String(name || "").toLowerCase().replace(/\.exe$/, "");
  if (c === "postgres" || c === "postmaster") return "postgres";
  if (c === "mysqld") return "mysql";
  if (c === "mariadbd") return "mariadb";
  if (c === "mongod") return "mongodb";
  return null;
}

/** Map a Homebrew service name (postgresql@16, mariadb, mongodb-community…) to an engine. */
function brewServiceEngine(svc) {
  const s = String(svc || "").toLowerCase();
  if (s.startsWith("postgresql")) return "postgres";
  if (s.startsWith("mariadb")) return "mariadb";
  if (s.startsWith("mysql")) return "mysql";
  if (s.startsWith("mongodb")) return "mongodb";
  return null;
}

/**
 * Resolve a CLI to an absolute path. GUI apps launched from Finder/Dock get a
 * minimal PATH (no /opt/homebrew/bin, sometimes no /usr/sbin), so bare `spawn`
 * of `brew`/`lsof` fails there. Probe the known locations, then fall back to PATH.
 */
function resolveBin(candidates) {
  for (const c of candidates) {
    try { if (c.includes("/") && fs.existsSync(c)) return c; } catch { /* noop */ }
  }
  return candidates[candidates.length - 1];
}
const LSOF = () => resolveBin(["/usr/bin/lsof", "/usr/sbin/lsof", "lsof"]);
const BREW = () => resolveBin(["/opt/homebrew/bin/brew", "/usr/local/bin/brew", "brew"]);

/** Add `<parent>/<child>/bin` for every child directory of `parent` (optionally name-filtered). */
function addVersionedBins(parent, out, filter) {
  let entries = [];
  try { entries = fs.readdirSync(parent, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (filter && !e.name.toLowerCase().startsWith(filter.toLowerCase())) continue;
    out.push(path.join(parent, e.name, "bin"));
  }
}

/**
 * OS-specific directories where a normally-installed engine's server binary lives
 * (beyond Homebrew + PATH). Covers the standard installer layouts on each OS so a
 * user who installed PostgreSQL/MySQL/MongoDB the usual way is detected.
 */
function systemCandidateBinDirs(engine) {
  const out = [];
  const P = process.platform;
  if (P === "linux") {
    out.push("/usr/bin", "/usr/sbin", "/usr/local/bin", "/usr/local/sbin");
    if (engine === "postgres") {
      addVersionedBins("/usr/lib/postgresql", out); // Debian/Ubuntu: /usr/lib/postgresql/<ver>/bin
      out.push("/usr/local/pgsql/bin");
      try {
        for (const n of fs.readdirSync("/usr")) if (/^pgsql-/.test(n)) out.push(path.join("/usr", n, "bin")); // RHEL: /usr/pgsql-16/bin
      } catch { /* noop */ }
    }
  } else if (P === "win32") {
    const roots = [process.env.ProgramW6432, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
    for (const root of roots) {
      if (engine === "postgres") addVersionedBins(path.join(root, "PostgreSQL"), out); // C:\Program Files\PostgreSQL\<ver>\bin
      else if (engine === "mysql") addVersionedBins(path.join(root, "MySQL"), out, "MySQL Server"); // ...\MySQL\MySQL Server 8.0\bin
      else if (engine === "mariadb") addVersionedBins(root, out, "MariaDB"); // C:\Program Files\MariaDB 11.4\bin
      else if (engine === "mongodb") addVersionedBins(path.join(root, "MongoDB", "Server"), out); // ...\MongoDB\Server\<ver>\bin
    }
  } else if (P === "darwin") {
    out.push("/usr/local/bin", "/opt/homebrew/bin");
  }
  return out;
}

function firstLine(s) {
  return String(s || "").split(/\r?\n/)[0].trim();
}

/** Resolve a version string from `<bin> --version`. */
function versionOf(serverPath) {
  try {
    const r = spawnSync(serverPath, ["--version"], { encoding: "utf8", timeout: 5000 });
    const out = firstLine(`${r.stdout || ""}${r.stderr || ""}`);
    const m = out.match(/\d+\.\d+(\.\d+)?/);
    return m ? m[0] : out.slice(0, 40);
  } catch {
    return "unknown";
  }
}

/** True once something is accepting TCP connections on the port. */
function waitForPort(port, { host = "127.0.0.1", timeoutMs = 30000 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const sock = net.connect(port, host);
      sock.once("connect", () => { sock.destroy(); resolve(); });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error(`Timed out waiting for port ${port}`));
        else setTimeout(tick, 400);
      });
    };
    tick();
  });
}

function portIsFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, host, () => srv.close(() => resolve(true)));
  });
}

class ServerManager {
  /**
   * @param {string} dataRoot Writable base dir (Electron userData) for instances + engines.
   * @param {{ configFile?: string }} [opts] Override the admin config file location
   *   (in dev it must match where `next dev` reads it — the project cwd).
   */
  constructor(dataRoot, opts = {}) {
    this.dataRoot = dataRoot;
    this.instancesFile = path.join(dataRoot, "instances.json");
    this.instancesDir = path.join(dataRoot, "instances");
    this.enginesDir = path.join(dataRoot, "engines"); // downloaded engine binaries
    this.configFile = opts.configFile || path.join(dataRoot, "nextmyadmin.config.json");
    // Unix sockets have a ~104-char path limit and userData/os.tmpdir() are long
    // on macOS, so keep sockets under a short path. (Windows uses TCP only.)
    this.socketDir = process.platform === "win32" ? path.join(os.tmpdir(), "nma-sockets") : "/tmp/nma-sockets";
    /** @type {Map<string, import('child_process').ChildProcess>} */
    this.running = new Map();
    fs.mkdirSync(this.instancesDir, { recursive: true });
    try { fs.mkdirSync(this.socketDir, { recursive: true }); } catch { /* best effort */ }
  }

  // ---- engine detection ----

  detectEngines() {
    const found = [];
    const seen = new Set();
    for (const [engine, def] of Object.entries(ENGINES)) {
      const binDirs = new Set();

      // Homebrew kegs: <prefix>/<name*>/bin
      for (const prefix of BREW_PREFIXES) {
        let entries = [];
        try { entries = fs.readdirSync(prefix); } catch { continue; }
        for (const name of entries) {
          if (def.brewPrefixes.some((p) => name === p || name.startsWith(`${p}@`) || name.startsWith(`${p}`))) {
            binDirs.add(path.join(prefix, name, "bin"));
          }
        }
      }
      // PATH
      const onPath = spawnSync(process.platform === "win32" ? "where" : "which", [def.server], { encoding: "utf8" });
      if (onPath.status === 0) {
        const p = firstLine(onPath.stdout);
        if (p) binDirs.add(path.dirname(p));
      }

      // Standard OS installer locations (Windows Program Files, Linux distro paths, …).
      for (const d of systemCandidateBinDirs(engine)) binDirs.add(d);

      for (const binDir of binDirs) {
        const serverPath = path.join(binDir, exe(def.server));
        if (fs.existsSync(serverPath)) {
          found.push({ engine, label: def.label, binDir, serverPath, version: versionOf(serverPath), source: "system" });
          seen.add(engine);
          break; // first working keg per engine is enough for v1
        }
      }
    }
    // Engines we downloaded on demand (only if not already found on the system).
    for (const d of this._downloadedEngines()) {
      if (!seen.has(d.engine)) { found.push(d); seen.add(d.engine); }
    }
    return found;
  }

  _downloadedEngines() {
    const out = [];
    let engines = [];
    try { engines = fs.readdirSync(this.enginesDir); } catch { return out; }
    for (const engine of engines) {
      const def = ENGINES[engine];
      if (!def) continue;
      let versions = [];
      try { versions = fs.readdirSync(path.join(this.enginesDir, engine)); } catch { continue; }
      for (const version of versions.sort().reverse()) {
        const binDir = path.join(this.enginesDir, engine, version, "bin");
        const serverPath = path.join(binDir, exe(def.server));
        if (fs.existsSync(serverPath)) {
          out.push({ engine, label: def.label, binDir, serverPath, version, source: "downloaded" });
          break;
        }
      }
    }
    return out;
  }

  // ---- discover servers actually running on the machine ----

  /**
   * Every database server currently listening on this machine — regardless of who
   * started it (Homebrew service, a manual launch, or one of our own instances).
   * Each entry carries enough context (pid, source, brew service name, managed
   * instance id) for {@link stopRunning} to shut it down the right way.
   */
  discoverRunning() {
    const rows = process.platform === "win32" ? this._listeningWin() : this._listeningPosix();

    // Collapse to one entry per pid, collecting every port that pid listens on.
    const byPid = new Map();
    for (const r of rows) {
      const engine = engineForProc(r.command);
      if (!engine) continue;
      if (!byPid.has(r.pid)) byPid.set(r.pid, { engine, pid: r.pid, ports: new Set() });
      byPid.get(r.pid).ports.add(r.port);
    }

    const brew = this._brewStarted();                       // engine -> service name
    const versions = {};
    for (const e of this.detectEngines()) versions[e.engine] = e.version;
    const managedByPid = new Map();
    for (const [id, child] of this.running) if (child && child.pid) managedByPid.set(child.pid, id);
    const instMeta = {};
    for (const i of this._read()) instMeta[i.id] = i;

    const out = [];
    for (const { engine, pid, ports } of byPid.values()) {
      const def = ENGINES[engine];
      const preferred = DEFAULT_LISTEN_PORTS[engine];
      const port = ports.has(preferred) ? preferred : Math.min(...ports);
      let source = "external";
      let serviceName;
      let instanceId;
      let name = `${def.label} (:${port})`;
      if (managedByPid.has(pid)) {
        source = "managed";
        instanceId = managedByPid.get(pid);
        name = instMeta[instanceId]?.name || name;
      } else if (brew.get(engine)) {
        source = "brew";
        serviceName = brew.get(engine);
        name = `${def.label} (brew)`;
      }
      out.push({
        engine,
        label: def.label,
        driver: def.driver,
        host: "127.0.0.1",
        port,
        otherPorts: [...ports].filter((p) => p !== port),
        pid,
        source,
        serviceName,
        instanceId,
        name,
        version: versions[engine] || "",
      });
    }
    out.sort((a, b) => a.port - b.port);
    return out;
  }

  /** Parse `lsof` for TCP listeners: [{ command, pid, port }]. (macOS / Linux) */
  _listeningPosix() {
    const r = spawnSync(LSOF(), ["+c", "0", "-nP", "-iTCP", "-sTCP:LISTEN"], { encoding: "utf8", timeout: 8000 });
    const out = [];
    for (const line of String(r.stdout || "").split(/\r?\n/).slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 9) continue;
      // The NAME column is an address like `*:5432`, `127.0.0.1:3306` or
      // `[::1]:27017`, and lsof appends a `(LISTEN)` state token after it — so
      // find the address token rather than assuming a fixed position.
      const addr = parts.find((p) => /:\d+$/.test(p));
      if (!addr) continue;
      out.push({ command: parts[0], pid: Number(parts[1]), port: Number(addr.match(/:(\d+)$/)[1]) });
    }
    return out;
  }

  /** Parse `netstat -ano` + `tasklist` for TCP listeners. (Windows) */
  _listeningWin() {
    const ns = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8", timeout: 8000 });
    const pidPort = [];
    for (const line of String(ns.stdout || "").split(/\r?\n/)) {
      const p = line.trim().split(/\s+/);
      if (p.length < 5 || p[0] !== "TCP" || p[3] !== "LISTENING") continue;
      const m = p[1].match(/:(\d+)$/);
      if (m) pidPort.push({ pid: Number(p[4]), port: Number(m[1]) });
    }
    if (pidPort.length === 0) return [];
    const tl = spawnSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8", timeout: 8000 });
    const nameByPid = new Map();
    for (const line of String(tl.stdout || "").split(/\r?\n/)) {
      const cols = line.split(/","/).map((c) => c.replace(/^"|"$/g, ""));
      if (cols.length < 2) continue;
      nameByPid.set(Number(cols[1]), cols[0]);
    }
    return pidPort.map(({ pid, port }) => ({ command: nameByPid.get(pid) || "", pid, port }));
  }

  /** Homebrew services that are `started`, as engine -> service name. (macOS / Linux) */
  _brewStarted() {
    const map = new Map();
    if (process.platform === "win32") return map;
    const r = spawnSync(BREW(), ["services", "list"], { encoding: "utf8", timeout: 8000 });
    if (r.status !== 0) return map;
    for (const line of String(r.stdout || "").split(/\r?\n/).slice(1)) {
      const [svc, status] = line.trim().split(/\s+/);
      if (!svc || status !== "started") continue;
      const engine = brewServiceEngine(svc);
      if (engine && !map.has(engine)) map.set(engine, svc);
    }
    return map;
  }

  /**
   * Stop a server returned by {@link discoverRunning}. Uses the gentlest correct
   * mechanism: our own child for managed instances, `brew services stop` for brew
   * services (so launchd doesn't relaunch them), else a graceful signal to the pid.
   */
  async stopRunning(desc) {
    if (!desc || !desc.engine) throw new Error("Nothing to stop.");
    if (desc.source === "managed" && desc.instanceId) {
      return this.stopInstance(desc.instanceId);
    }
    if (desc.source === "brew" && desc.serviceName) {
      const r = spawnSync(BREW(), ["services", "stop", desc.serviceName], { encoding: "utf8", timeout: 25000 });
      if (r.status !== 0) {
        throw new Error(`brew services stop ${desc.serviceName} failed: ${firstLine(r.stderr || r.stdout) || `exit ${r.status}`}`);
      }
      return { ok: true, stopped: desc.serviceName };
    }
    if (desc.pid) return this._killPid(desc.pid, desc.engine);
    throw new Error("Don't know how to stop this server.");
  }

  _killPid(pid, engine) {
    if (process.platform === "win32") {
      const r = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" });
      if (r.status !== 0) throw new Error(firstLine(r.stderr || r.stdout) || `taskkill exit ${r.status}`);
      return { ok: true, killed: pid };
    }
    try {
      // SIGTERM triggers a graceful shutdown for postgres/mysql/mariadb/mongod.
      process.kill(pid, "SIGTERM");
    } catch (e) {
      if (e.code === "ESRCH") return { ok: true, killed: pid }; // already gone
      if (e.code === "EPERM") throw new Error(`Not permitted to stop PID ${pid} — it's owned by another user. Try stopping it from where it was started.`);
      throw e;
    }
    return { ok: true, killed: pid };
  }

  /**
   * Add a browsable connection for a discovered server (guessing the conventional
   * local credentials for its engine). Persisted with `discovered: true` so it
   * survives — unlike the transient `managed` mirror entries.
   */
  connectRunning(desc) {
    if (!desc || !desc.engine) throw new Error("Nothing to connect to.");
    const config = this._readConfig();
    const target = this._discoveredConfigEntry(desc);
    const dup = config.servers.find((s) =>
      s.engine === target.engine && (target.uri ? s.uri === target.uri : s.host === target.host && Number(s.port) === Number(target.port))
    );
    if (dup) return { id: dup.id, already: true };
    config.servers.push(target);
    this._writeConfig(config);
    return { id: target.id, already: false };
  }

  /**
   * First-run convenience: if the config has no servers yet, add a connection for
   * every server already running on the machine — so a fresh install opens with
   * your local databases instead of an empty list. Runs only while the list is
   * empty, so it never fights a user who has curated their own connections.
   */
  seedDiscoveredIfEmpty() {
    try {
      if (this._readConfig().servers.length > 0) return { seeded: 0 };
      let seeded = 0;
      for (const r of this.discoverRunning()) {
        if (r.source === "managed") continue;
        if (!this.connectRunning(r).already) seeded += 1;
      }
      return { seeded };
    } catch {
      return { seeded: 0 };
    }
  }

  _discoveredConfigEntry(desc) {
    const id = `disc-${desc.engine}-${desc.port}`;
    const base = { id, name: desc.name, engine: ENGINES[desc.engine].driver, discovered: true };
    if (desc.engine === "mongodb") return { ...base, uri: `mongodb://${desc.host}:${desc.port}` };
    if (desc.engine === "postgres") {
      // brew/local postgres conventionally trusts the OS user with no password.
      return { ...base, host: desc.host, port: desc.port, user: os.userInfo().username, password: "", defaultDatabase: "postgres", ssl: false };
    }
    return { ...base, host: desc.host, port: desc.port, user: "root", password: "" };
  }

  // ---- download on demand ----

  /** Downloadable engines (with whether they're already available). */
  downloadableEngines() {
    const available = new Set(this.detectEngines().map((e) => e.engine));
    return Object.entries(DOWNLOADS).map(([engine, def]) => ({
      engine,
      label: ENGINES[engine].label,
      versions: def.versions,
      installed: available.has(engine),
    }));
  }

  _run(cmd, args, label) {
    const r = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    if (r.error && r.error.code === "ENOENT") {
      throw new Error(`${label || cmd} failed: "${cmd}" not found on this system.`);
    }
    if (r.status !== 0) {
      throw new Error(`${label || cmd} failed: ${firstLine(r.stderr) || `exit ${r.status}`}`);
    }
  }

  /**
   * Cross-platform archive extraction. `tar` is present everywhere (bsdtar on
   * macOS/Windows-10+ reads zip and xz natively; GNU tar on Linux does not read
   * zip, so we fall back to `unzip` there).
   */
  _extract(archiveFile, destDir, kind, strip = 0) {
    const stripArg = strip ? [`--strip-components=${strip}`] : [];
    if (kind === "tgz") return this._run("tar", ["xzf", archiveFile, "-C", destDir, ...stripArg], "Extracting");
    if (kind === "txz") return this._run("tar", ["xJf", archiveFile, "-C", destDir, ...stripArg], "Extracting");
    if (kind === "zip") {
      if (process.platform === "linux") {
        return this._run("unzip", ["-oq", archiveFile, "-d", destDir], "Extracting (needs `unzip`)");
      }
      return this._run("tar", ["-xf", archiveFile, "-C", destDir, ...stripArg], "Extracting");
    }
    throw new Error(`Unknown archive kind "${kind}"`);
  }

  /** Fetch + extract a self-contained server binary into userData/engines/<engine>/<version>. */
  async downloadEngine(engine, version) {
    const def = DOWNLOADS[engine];
    if (!def) throw new Error(`No download available for ${engine}.`);
    version = version || def.versions[0];
    const versionDir = path.join(this.enginesDir, engine, version);
    const serverPath = path.join(versionDir, "bin", exe(ENGINES[engine].server));
    if (fs.existsSync(serverPath)) {
      return { engine, version, binDir: path.dirname(serverPath), source: "downloaded" };
    }

    const spec = def.resolve(version);
    const cacheDir = path.join(this.enginesDir, ".cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.mkdirSync(versionDir, { recursive: true });
    const archiveFile = path.join(cacheDir, `${engine}-${version}-${path.basename(spec.url)}`);

    try {
      // curl follows redirects (-L), fails on HTTP error (-f); present on macOS/Linux/Win10+.
      this._run("curl", ["-fSL", "-o", archiveFile, spec.url], `Downloading ${ENGINES[engine].label} ${version}`);

      if (spec.archive === "tgz") {
        this._extract(archiveFile, versionDir, "tgz", spec.strip || 0);
      } else if (spec.archive === "zip") {
        this._extract(archiveFile, versionDir, "zip", spec.strip || 0);
      } else if (spec.archive === "zonky-jar") {
        // .jar (a zip) contains a single .txz that unpacks to bin/lib/share at the root.
        const tmp = path.join(cacheDir, `${engine}-${version}-jar`);
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.mkdirSync(tmp, { recursive: true });
        this._extract(archiveFile, tmp, "zip");
        const txz = fs.readdirSync(tmp).find((f) => f.endsWith(".txz"));
        if (!txz) throw new Error("Unexpected PostgreSQL archive layout (no .txz found).");
        this._extract(path.join(tmp, txz), versionDir, "txz");
        fs.rmSync(tmp, { recursive: true, force: true });
      }

      if (!fs.existsSync(serverPath)) {
        throw new Error(`Downloaded ${ENGINES[engine].label} but its server binary wasn't where expected.`);
      }
    } catch (err) {
      fs.rmSync(versionDir, { recursive: true, force: true });
      throw err;
    } finally {
      try { fs.rmSync(archiveFile, { force: true }); } catch { /* noop */ }
    }

    return { engine, version, binDir: path.dirname(serverPath), source: "downloaded" };
  }

  // ---- instance store ----

  _read() {
    try { return JSON.parse(fs.readFileSync(this.instancesFile, "utf8")); } catch { return []; }
  }
  _write(list) {
    fs.writeFileSync(this.instancesFile, JSON.stringify(list, null, 2));
  }

  listInstances() {
    return this._read().map((inst) => ({ ...inst, status: this.running.has(inst.id) ? "running" : "stopped" }));
  }

  createInstance({ name, engine, port }) {
    if (!ENGINES[engine]) throw new Error(`Unknown engine "${engine}"`);
    const detected = this.detectEngines().find((e) => e.engine === engine);
    if (!detected) throw new Error(`${ENGINES[engine].label} is not installed on this machine.`);
    const id = `${engine}-${Date.now().toString(36)}`;
    const inst = {
      id,
      name: name || `${ENGINES[engine].label} ${port}`,
      engine,
      port: Number(port),
      binDir: detected.binDir,
      version: detected.version,
      dataDir: path.join(this.instancesDir, id, "data"),
      initialized: false,
    };
    const list = this._read();
    list.push(inst);
    this._write(list);
    return { ...inst, status: "stopped" };
  }

  _get(id) {
    const inst = this._read().find((i) => i.id === id);
    if (!inst) throw new Error(`No instance "${id}"`);
    return inst;
  }
  _update(id, patch) {
    const list = this._read();
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) { list[i] = { ...list[i], ...patch }; this._write(list); }
  }

  // ---- lifecycle ----

  async startInstance(id) {
    const inst = this._get(id);
    if (this.running.has(id)) return { ...inst, status: "running" };
    if (!(await portIsFree(inst.port))) throw new Error(`Port ${inst.port} is already in use.`);

    if (ENGINES[inst.engine].needsInit && !inst.initialized) {
      this._initDataDir(inst);
      this._update(id, { initialized: true });
    } else {
      fs.mkdirSync(inst.dataDir, { recursive: true });
    }

    const { cmd, args } = this._runCommand(inst);
    const logFile = path.join(this.instancesDir, id, "server.log");
    const out = fs.openSync(logFile, "a");
    const child = spawn(cmd, args, { stdio: ["ignore", out, out] });
    this.running.set(id, child);

    child.on("exit", () => this.running.delete(id));

    try {
      await waitForPort(inst.port);
    } catch (err) {
      this.running.delete(id);
      try { child.kill(); } catch { /* noop */ }
      throw new Error(`${ENGINES[inst.engine].label} failed to start on port ${inst.port}. See ${logFile}`);
    }

    this._syncConfig();
    return { ...inst, status: "running" };
  }

  async stopInstance(id) {
    const child = this.running.get(id);
    if (child) {
      await new Promise((resolve) => {
        child.once("exit", resolve);
        child.kill(); // SIGTERM — graceful shutdown
        setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* noop */ } resolve(); }, 8000);
      });
      this.running.delete(id);
    }
    this._syncConfig();
    return { ...this._get(id), status: "stopped" };
  }

  async deleteInstance(id) {
    await this.stopInstance(id).catch(() => {});
    const list = this._read().filter((i) => i.id !== id);
    this._write(list);
    try { fs.rmSync(path.join(this.instancesDir, id), { recursive: true, force: true }); } catch { /* noop */ }
    this._syncConfig();
    return { ok: true };
  }

  async stopAll() {
    await Promise.all([...this.running.keys()].map((id) => this.stopInstance(id).catch(() => {})));
  }

  // ---- per-engine init + run ----

  _bin(inst, name) {
    return path.join(inst.binDir, exe(name));
  }
  _socket(inst) {
    return path.join(this.socketDir, `${inst.engine}-${inst.port}.sock`);
  }

  _initDataDir(inst) {
    fs.mkdirSync(path.dirname(inst.dataDir), { recursive: true });
    const baseDir = path.dirname(inst.binDir);
    let r;
    if (inst.engine === "postgres") {
      // --auth-local is Unix-socket auth; skip it on Windows (host/TCP auth only).
      const initArgs = ["-D", inst.dataDir, "-U", "postgres", "--auth-host=trust", "-E", "UTF8"];
      if (process.platform !== "win32") initArgs.splice(4, 0, "--auth-local=trust");
      r = spawnSync(this._bin(inst, "initdb"), initArgs, { encoding: "utf8" });
    } else if (inst.engine === "mysql") {
      fs.mkdirSync(inst.dataDir, { recursive: true });
      r = spawnSync(this._bin(inst, "mysqld"), [`--initialize-insecure`, `--datadir=${inst.dataDir}`, `--basedir=${baseDir}`], { encoding: "utf8" });
    } else if (inst.engine === "mariadb") {
      fs.mkdirSync(inst.dataDir, { recursive: true });
      r = spawnSync(this._bin(inst, "mariadb-install-db"), [`--datadir=${inst.dataDir}`, `--basedir=${baseDir}`, `--auth-root-authentication-method=normal`, `--skip-test-db`], { encoding: "utf8" });
    } else {
      return;
    }
    if (r.status !== 0) {
      throw new Error(`Initializing ${ENGINES[inst.engine].label} data dir failed: ${firstLine(r.stderr || r.stdout)}`);
    }
  }

  _runCommand(inst) {
    // Windows has no Unix domain sockets — everything connects over TCP (127.0.0.1),
    // so omit the socket args there (postgres -k / mysql|mariadb --socket).
    const isWin = process.platform === "win32";
    const socket = this._socket(inst);
    if (inst.engine === "postgres") {
      const args = ["-D", inst.dataDir, "-p", String(inst.port), "-c", "listen_addresses=127.0.0.1"];
      if (!isWin) args.push("-k", this.socketDir);
      return { cmd: this._bin(inst, "postgres"), args };
    }
    if (inst.engine === "mysql") {
      const args = [`--datadir=${inst.dataDir}`, `--port=${inst.port}`, `--bind-address=127.0.0.1`, `--mysqlx=OFF`];
      if (!isWin) args.push(`--socket=${socket}`);
      return { cmd: this._bin(inst, "mysqld"), args };
    }
    if (inst.engine === "mariadb") {
      const args = [`--datadir=${inst.dataDir}`, `--port=${inst.port}`, `--bind-address=127.0.0.1`];
      if (!isWin) args.push(`--socket=${socket}`);
      return { cmd: this._bin(inst, "mariadbd"), args };
    }
    // mongodb
    fs.mkdirSync(inst.dataDir, { recursive: true });
    return { cmd: this._bin(inst, "mongod"), args: [`--dbpath=${inst.dataDir}`, `--port=${inst.port}`, `--bind_ip=127.0.0.1`] };
  }

  // ---- mirror running instances into the admin config ----

  _readConfig() {
    let config = { servers: [] };
    try { config = JSON.parse(fs.readFileSync(this.configFile, "utf8")); } catch { /* seed below */ }
    if (!Array.isArray(config.servers)) config.servers = [];
    return config;
  }
  _writeConfig(config) {
    fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2));
  }

  _syncConfig() {
    const config = this._readConfig();
    // Drop previously-managed entries, then re-add currently-running ones.
    config.servers = config.servers.filter((s) => !s.managed);
    for (const inst of this._read()) {
      if (!this.running.has(inst.id)) continue;
      config.servers.push(this._configEntry(inst));
    }
    this._writeConfig(config);
  }

  _configEntry(inst) {
    const base = { id: inst.id, name: inst.name, engine: ENGINES[inst.engine].driver, managed: true };
    if (inst.engine === "mongodb") {
      return { ...base, uri: `mongodb://127.0.0.1:${inst.port}` };
    }
    if (inst.engine === "postgres") {
      return { ...base, host: "127.0.0.1", port: inst.port, user: "postgres", password: "", defaultDatabase: "postgres", ssl: false };
    }
    // mysql / mariadb
    return { ...base, host: "127.0.0.1", port: inst.port, user: "root", password: "" };
  }
}

module.exports = { ServerManager, ENGINES, systemCandidateBinDirs };
