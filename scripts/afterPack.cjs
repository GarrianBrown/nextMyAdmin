// electron-builder afterPack hook.
//
// electron-builder skips folders named `node_modules` when copying
// `extraResources`, which drops the standalone server's traced dependencies.
// Copy them into the packed app ourselves — after the .app is assembled but
// before the installer (.dmg/.nsis/AppImage) is built from it.
const { cpSync, existsSync } = require("node:fs");
const path = require("node:path");

module.exports = async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;

  const resourcesDir =
    typeof packager.getResourcesDir === "function"
      ? packager.getResourcesDir(appOutDir)
      : electronPlatformName === "darwin"
        ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "Resources")
        : path.join(appOutDir, "resources");

  const src = path.join(process.cwd(), ".next", "standalone", "node_modules");
  const dest = path.join(resourcesDir, "app", ".next", "standalone", "node_modules");

  if (!existsSync(src)) {
    console.warn("afterPack: no standalone node_modules at", src, "— did prepare-standalone run?");
    return;
  }
  if (existsSync(dest)) return; // already present

  cpSync(src, dest, { recursive: true });
  console.log("afterPack: copied standalone node_modules ->", dest);
};
