// One-time migration from the development Electron identity. The credential is
// returned only through a private inherited pipe, never stdout or the renderer.
const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
app.setName("JARVIS");
app.commandLine.appendSwitch("use-mock-keychain");
app.commandLine.appendSwitch("password-store", "basic");
app.setPath("userData", path.join(os.tmpdir(), "jarvis-key-migration"));
app.whenReady().then(() => {
  try {
    const key = safeStorage.decryptString(fs.readFileSync(process.argv[2]));
    if (!key) throw new Error("Empty credential");
    fs.writeSync(3, JSON.stringify({ key }));
  } catch {
    fs.writeSync(
      3,
      JSON.stringify({
        error: "The development credential could not be decrypted.",
      }),
    );
  }
  app.quit();
});
