import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { mkdir, copyFile, cp } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/main/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outfile: "dist/main.cjs",
  external: ["electron", "node:sqlite"],
  sourcemap: true,
});
await build({
  entryPoints: ["src/main/preload.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/preload.cjs",
  external: ["electron"],
});
await build({
  entryPoints: ["src/renderer/app.tsx"],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome140",
  outfile: "dist/app.js",
  sourcemap: true,
});
await copyFile("src/renderer/index.html", "dist/index.html");

await mkdir("dist/native", { recursive: true });
await copyFile("native/migrate-key.cjs", "dist/native/migrate-key.cjs");
await copyFile("scripts/release/installer.cjs", "dist/native/update-installer.cjs");

await mkdir("dist/brand", { recursive: true });
for (const name of [
  "jarvis-icon.png",
  "jarvis-64.png",
  "jarvisTrayTemplate.png",
  "jarvisTrayTemplate@2x.png",
])
  await copyFile(`assets/brand/${name}`, `dist/brand/${name}`);

await mkdir("dist/mobile", { recursive: true });
if (
  (await import("node:fs")).existsSync("deliverables/JARVIS-Android-test.apk")
)
  await copyFile(
    "deliverables/JARVIS-Android-test.apk",
    "dist/mobile/JARVIS.apk",
  );

execFileSync(process.execPath,["scripts/export-source.mjs","--bundle"],{stdio:"inherit"});

execFileSync(process.execPath,["scripts/licenses.mjs"],{stdio:"inherit"});
