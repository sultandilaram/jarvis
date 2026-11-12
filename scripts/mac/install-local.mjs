import { execFileSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { readProfile, requirement } from "./local-signing.mjs";
const source = resolve(
  process.argv[2] || "release/JARVIS-darwin-arm64/JARVIS.app",
);
const destination = resolve(
  process.env.JARVIS_INSTALL_DIR || "/Applications",
  "JARVIS.app",
);
const p = readProfile();
function expectedBundle(path) {
  const id = execFileSync(
    "/usr/bin/plutil",
    [
      "-extract",
      "CFBundleIdentifier",
      "raw",
      "-o",
      "-",
      join(path, "Contents/Info.plist"),
    ],
    { encoding: "utf8" },
  ).trim();
  if (id !== "com.sultan.jarvis")
    throw Error("Refusing an unexpected app bundle identifier");
}
if (source === destination || !existsSync(source))
  throw Error("A distinct built source app is required");
if (existsSync(destination) && lstatSync(destination).isSymbolicLink())
  throw Error("Refusing a symlinked install destination");
const running = execFileSync("/bin/ps", ["-A", "-o", "command="], {
  encoding: "utf8",
})
  .split("\n")
  .some(
    (s) =>
      s.trim().includes("/JARVIS.app/Contents/MacOS/JARVIS") &&
      !s.includes("/bin/ps"),
  );
if (running)
  throw Error(
    "Quit JARVIS before installing. No running app will be overwritten.",
  );
const verify = (path) =>
  execFileSync("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "-R",
    "=" + requirement("com.sultan.jarvis", p.fingerprint),
    path,
  ]);
expectedBundle(source);
if (existsSync(destination)) expectedBundle(destination);
verify(source);
await mkdir(dirname(destination), { recursive: true });
const stage = join(
  dirname(destination),
  ".JARVIS-install-" + process.pid + ".app",
);
const backup = join(
  dirname(destination),
  ".JARVIS-previous-" + process.pid + ".app",
);
let replaced = false;
try {
  execFileSync("/usr/bin/ditto", [source, stage]);
  verify(stage);
  if (existsSync(destination)) {
    await rename(destination, backup);
    replaced = true;
  }
  try {
    await rename(stage, destination);
    verify(destination);
  } catch (e) {
    if (existsSync(destination))
      await rm(destination, { recursive: true, force: true });
    if (replaced) await rename(backup, destination);
    throw e;
  }
  if (replaced) await rm(backup, { recursive: true, force: true });
  await mkdir(".jarvis/private", { recursive: true, mode: 0o700 });
  await writeFile(
    ".jarvis/private/installed-app.json",
    JSON.stringify(
      {
        path: destination,
        signer: p.fingerprint,
        installedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.log(
    "Installed " + destination + " without modifying or re-signing the app.",
  );
} finally {
  await rm(stage, { recursive: true, force: true });
}
