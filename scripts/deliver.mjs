import { cp, mkdir, rm, writeFile, readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const stage = resolve(".jarvis/delivery-stage");
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await mkdir("deliverables", { recursive: true });
const app = join(stage, "JARVIS.app");
execFileSync("ditto", ["release/JARVIS-darwin-arm64/JARVIS.app", app], {
  stdio: "inherit",
});
const hint = JSON.parse(
  await readFile(
    join(app, "Contents/Resources/app/dist/workspace.json"),
    "utf8",
  ),
);
if (hint.workspace !== null)
  throw Error(
    "Rebuild the portable app before delivery. A signed app must never be mutated or re-signed by the archive step.",
  );
execFileSync("codesign", ["--verify", "--deep", "--strict", app], {
  stdio: "inherit",
});
const archive = resolve("deliverables/JARVIS-macOS-AppleSilicon-test.zip");
await rm(archive, { force: true });
execFileSync(
  "ditto",
  ["-c", "-k", "--sequesterRsrc", "--keepParent", app, archive],
  { stdio: "inherit" },
);
const files = (await readdir("deliverables")).filter((x) =>
  /\.(apk|zip|dmg)$/.test(x),
);
await writeFile(
  "deliverables/SHA256SUMS.txt",
  (
    await Promise.all(
      files.map(
        async (name) =>
          `${createHash("sha256")
            .update(await readFile(join("deliverables", name)))
            .digest("hex")}  ${name}`,
      ),
    )
  ).join("\n") + "\n",
);
console.log(
  "Shareable local test builds written without changing their signing identity.",
);
