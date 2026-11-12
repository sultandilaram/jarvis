import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, rm, cp, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { buildVault } from "./mac/build-vault.mjs";
import { readProfile, signLocal } from "./mac/local-signing.mjs";
const useLocal = !process.argv.includes("--ad-hoc");
if (useLocal) readProfile();
const outputRoot = resolve(useLocal ? "release" : ".jarvis/ad-hoc-build");
await mkdir("dist/native", { recursive: true });
if (
  !(await import("node:fs")).existsSync("dist/native/wake-model/am/final.mdl")
)
  throw new Error(
    "Run python3 scripts/setup-wake.py first to fetch offline wake assets.",
  );
execFileSync(
  "codesign",
  ["--force", "--sign", "-", "dist/native/libvosk.dylib"],
  { stdio: "inherit" },
);
execFileSync(
  "xcrun",
  [
    "swiftc",
    "-O",
    "native/WakeListener.swift",
    "-o",
    "dist/native/jarvis-wake",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: "/tmp/jarvis-swift-cache",
      SWIFT_MODULECACHE_PATH: "/tmp/jarvis-swift-cache",
    },
  },
);
execFileSync(
  "xcrun",
  [
    "swiftc",
    "-O",
    "native/DesktopControl.swift",
    "-o",
    "dist/native/jarvis-desktop-control",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: "/tmp/jarvis-swift-cache",
      SWIFT_MODULECACHE_PATH: "/tmp/jarvis-swift-cache",
    },
  },
);
if (useLocal) await buildVault();
else await rm("dist/native/jarvis-credential-vault", { force: true });
const stage = resolve(".jarvis/package-stage");
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
const manifest = JSON.parse(await readFile("package.json", "utf8"));
await writeFile(
  join(stage, "package.json"),
  JSON.stringify({
    name: "jarvis-desktop",
    productName: "JARVIS",
    version: manifest.version,
    main: "dist/main.cjs",
  }),
);
await cp("dist", join(stage, "dist"), { recursive: true });
await writeFile(
  join(stage, "dist", "workspace.json"),
  JSON.stringify({ workspace: null }),
);
const apps = await packager({
  dir: stage,
  out: outputRoot,
  name: "JARVIS",
  platform: "darwin",
  arch: process.arch,
  electronVersion: manifest.devDependencies.electron,
  overwrite: true,
  asar: false,
  icon: resolve("assets/brand/Jarvis.icns"),
  appBundleId: "com.sultan.jarvis",
  helperBundleId: "com.sultan.jarvis.helper",
  appCategoryType: "public.app-category.productivity",
  extendInfo: {
    NSMicrophoneUsageDescription:
      "JARVIS listens locally for Hey JARVIS and uses microphone audio during an activated conversation.",
  },
});
for (const app of apps) {
  const bundle = join(app, "JARVIS.app");
  if (useLocal) await signLocal(bundle);
  else
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", bundle], {
      stdio: "inherit",
    });
}
console.log(apps.join("\n"));
