// Electron main process — the native shell around the Next.js app.
// Dev:  Next runs via `next dev` (system Node); we just load its URL.
// Prod: we fork the bundled standalone `server.js` on a free port using
//       Electron's own Node, then load it. (Native modules like better-sqlite3
//       are rebuilt for Electron's ABI at packaging time.)
const { app, BrowserWindow, shell, ipcMain, dialog, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const { fork } = require("node:child_process");
const { ServerManager } = require("./serverManager.cjs");
const { autoUpdater } = require("electron-updater");

const BASE_PATH = "/nextMyAdmin";
const isDev = !app.isPackaged;
const RELEASES_URL = "https://github.com/GarrianBrown/nextMyAdmin/releases/latest";

/** @type {ServerManager | null} */
let manager = null;

/** Wire the renderer's window.nextMyAdminDesktop.serverManager calls to the manager. */
function registerServerManagerIpc() {
  manager = new ServerManager(app.getPath("userData"), { configFile: ensureConfig() });
  // Fresh install: populate the connection list from whatever DBs are already
  // running locally, so the app doesn't open empty.
  try { manager.seedDiscoveredIfEmpty(); } catch (err) { console.error("seed discovered failed:", err); }
  const wrap = (fn) => async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
  ipcMain.handle("sm:detect", wrap(() => manager.detectEngines()));
  ipcMain.handle("sm:downloadable", wrap(() => manager.downloadableEngines()));
  ipcMain.handle("sm:download", wrap((engine, version) => manager.downloadEngine(engine, version)));
  ipcMain.handle("sm:list", wrap(() => manager.listInstances()));
  ipcMain.handle("sm:create", wrap((opts) => manager.createInstance(opts)));
  ipcMain.handle("sm:start", wrap((id) => manager.startInstance(id)));
  ipcMain.handle("sm:stop", wrap((id) => manager.stopInstance(id)));
  ipcMain.handle("sm:delete", wrap((id) => manager.deleteInstance(id)));
  ipcMain.handle("sm:discover", wrap(() => manager.discoverRunning()));
  ipcMain.handle("sm:stopRunning", wrap((desc) => manager.stopRunning(desc)));
  ipcMain.handle("sm:connectRunning", wrap((desc) => manager.connectRunning(desc)));
}

/**
 * Where the admin config lives — and, importantly, the SAME file the running Next
 * server reads: the project cwd in dev (what `next dev` reads), userData in prod.
 * Keeping the manager and the server pointed at one file means instances you start
 * appear in the browsable server list immediately.
 */
function configFilePath() {
  const dir = isDev ? process.cwd() : app.getPath("userData");
  return path.join(dir, "nextmyadmin.config.json");
}

/** Seed an empty config if missing; return its full file path. */
function ensureConfig() {
  const file = configFilePath();
  try {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ servers: [] }, null, 2));
    }
  } catch (err) {
    console.error("could not seed config:", err);
  }
  return file;
}

// ---- auto-update (packaged builds only) ----

let manualUpdateCheck = false;

function msgBox(opts) {
  return mainWindow ? dialog.showMessageBox(mainWindow, opts) : dialog.showMessageBox(opts);
}

/** On unsigned macOS an update can't be applied automatically — offer a manual download. */
function notifyUpdateProblem(err) {
  const onMac = process.platform === "darwin";
  msgBox({
    type: "info",
    title: "Update",
    message: onMac ? "Automatic update isn't available for this build." : "Couldn't check for updates.",
    detail: onMac ? "You can download the latest version from the Releases page." : String((err && err.message) || err),
    buttons: onMac ? ["Open Releases", "Close"] : ["Close"],
    defaultId: 0,
    cancelId: onMac ? 1 : 0,
  }).then(({ response }) => {
    if (onMac && response === 0) shell.openExternal(RELEASES_URL);
  });
}

function checkForUpdates(manual = false) {
  if (isDev) {
    if (manual) msgBox({ type: "info", title: "Updates", message: "Update checks run in the installed app only." });
    return;
  }
  manualUpdateCheck = manual;
  autoUpdater.checkForUpdates().catch((err) => {
    console.error("update check failed:", err);
    if (manual) { manualUpdateCheck = false; notifyUpdateProblem(err); }
  });
}

function setupAutoUpdate() {
  if (isDev) return;
  // Don't download automatically — ask first (below), then download on consent.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    manualUpdateCheck = false;
    msgBox({
      type: "info",
      title: "Update available",
      message: `nextMyAdmin ${info.version} is available (you have ${app.getVersion()}).`,
      detail: "Would you like to download and install it?",
      buttons: ["Download & Install", "Not now"],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.downloadUpdate().catch((err) => {
          console.error("update download failed:", err);
          notifyUpdateProblem(err);
        });
      }
    });
  });
  autoUpdater.on("update-not-available", () => {
    if (manualUpdateCheck) {
      manualUpdateCheck = false;
      msgBox({ type: "info", title: "You're up to date", message: `nextMyAdmin ${app.getVersion()} is the latest version.` });
    }
  });
  autoUpdater.on("download-progress", (p) => console.log(`downloading update: ${Math.round(p.percent)}%`));
  autoUpdater.on("update-downloaded", (info) => {
    manualUpdateCheck = false;
    msgBox({
      type: "info",
      title: "Update ready",
      message: `nextMyAdmin ${info.version} has been downloaded.`,
      detail: "Restart the app now to finish installing it?",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) setImmediate(() => autoUpdater.quitAndInstall());
    });
  });
  autoUpdater.on("error", (err) => {
    console.error("auto-update error:", err);
    if (manualUpdateCheck) { manualUpdateCheck = false; notifyUpdateProblem(err); }
  });

  // Check once, shortly after launch.
  setTimeout(() => checkForUpdates(false), 8000);
}

/** App menu with standard roles + a "Check for Updates…" item (app menu on macOS, Help elsewhere). */
function buildAppMenu() {
  const isMac = process.platform === "darwin";
  const updateItem = { label: "Check for Updates…", click: () => checkForUpdates(true) };
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: "about" },
            updateItem,
            { type: "separator" },
            { role: "services" }, { type: "separator" },
            { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" },
            { role: "quit" },
          ],
        }]
      : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Releases", click: () => shell.openExternal(RELEASES_URL) },
        ...(!isMac ? [updateItem] : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
/** @type {import('child_process').ChildProcess | null} */
let serverProcess = null;

/** Grab a free localhost port. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Resolve once `url` answers an HTTP request, or reject after `timeoutMs`. */
function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error(`Timed out waiting for ${url}`));
        else setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

/** In production, launch the standalone Next server and return its base URL. */
async function startProductionServer() {
  const port = await getFreePort();
  // The standalone build is bundled with the app; server.js reads PORT/HOSTNAME.
  const serverJs = path.join(process.resourcesPath, "app", ".next", "standalone", "server.js");
  serverProcess = fork(serverJs, [], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NMA_CONFIG_DIR: path.dirname(ensureConfig()),
    },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  const url = `http://127.0.0.1:${port}${BASE_PATH}`;
  await waitForServer(url);
  return url;
}

async function createWindow() {
  const startUrl = isDev
    ? process.env.ELECTRON_START_URL || `http://localhost:3000${BASE_PATH}`
    : await startProductionServer();

  if (isDev) await waitForServer(startUrl).catch(() => {});

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "nextMyAdmin",
    backgroundColor: "#16191f",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open external links (target=_blank / MySQL docs, etc.) in the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(startUrl);

  // Headless smoke test: capture the rendered window to a PNG, then quit.
  if (process.env.ELECTRON_SMOKE_TEST) {
    setTimeout(async () => {
      try {
        const image = await mainWindow.webContents.capturePage();
        require("node:fs").writeFileSync(process.env.ELECTRON_SMOKE_TEST, image.toPNG());
      } catch (err) {
        console.error("smoke capture failed:", err);
      }
      app.quit();
    }, 3000);
  }
}

// Single-instance: focus the existing window instead of opening a second app.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerServerManagerIpc();
    ipcMain.handle("app:checkForUpdates", () => { checkForUpdates(true); return { ok: true }; });
    ipcMain.handle("app:version", () => app.getVersion());
    buildAppMenu();
    setupAutoUpdate();
    // Dev dock icon on macOS (packaged builds get the icon from the .icns bundle).
    if (isDev && process.platform === "darwin" && app.dock) {
      const iconPath = path.join(__dirname, "..", "build", "icon.png");
      try {
        app.dock.setIcon(iconPath);
      } catch {
        /* icon not generated yet — ignore */
      }
    }
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  let stoppingServers = false;
  app.on("before-quit", async (e) => {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
    // Shut down any managed DB servers before the app exits.
    if (manager && manager.running.size > 0 && !stoppingServers) {
      stoppingServers = true;
      e.preventDefault();
      await manager.stopAll();
      app.quit();
    }
  });
}
