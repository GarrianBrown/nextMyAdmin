// Preload runs in an isolated context. It exposes a minimal, safe desktop API on
// window.nextMyAdminDesktop — including the local server manager, bridged to the
// main process over IPC. Handlers return { ok, data, error }; unwrap to clean
// promises so the web UI can use them like normal async calls.
const { contextBridge, ipcRenderer } = require("electron");

async function invoke(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (res && res.ok === false) throw new Error(res.error);
  return res ? res.data : undefined;
}

// Tag the document so CSS can adapt the header to the native window chrome
// (reserve space for the macOS traffic lights, make the header draggable).
window.addEventListener("DOMContentLoaded", () => {
  const el = document.documentElement;
  el.classList.add("nma-electron");
  if (process.platform === "darwin") el.classList.add("nma-mac");
});

contextBridge.exposeInMainWorld("nextMyAdminDesktop", {
  isElectron: true,
  platform: process.platform,
  getVersion: () => invoke("app:version"),
  checkForUpdates: () => invoke("app:checkForUpdates"),
  serverManager: {
    detectEngines: () => invoke("sm:detect"),
    downloadableEngines: () => invoke("sm:downloadable"),
    downloadEngine: (engine, version) => invoke("sm:download", engine, version),
    listInstances: () => invoke("sm:list"),
    createInstance: (opts) => invoke("sm:create", opts),
    startInstance: (id) => invoke("sm:start", id),
    stopInstance: (id) => invoke("sm:stop", id),
    deleteInstance: (id) => invoke("sm:delete", id),
  },
});
