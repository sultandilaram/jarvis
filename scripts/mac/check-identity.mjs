import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { readProfile, requirement } from "./local-signing.mjs";
const profile = readProfile(),
  dir = resolve(".jarvis/verification/local-signing");
await mkdir(dir, { recursive: true });
const id = "com.sultan.jarvis.signing-probe",
  dr = requirement(id, profile.fingerprint);
function metadata(path) {
  const r = spawnSync("codesign", ["-d", "-r-", "--verbose=4", path], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
  const output = r.stdout + r.stderr;
  return {
    requirement: output.match(/designated =>[^\n]+/)?.[0],
    hash: output.match(/^CDHash=(.+)$/m)?.[1],
  };
}
const results = [];
for (const version of ["A", "B"]) {
  const source = join(dir, "probe-" + version + ".swift"),
    binary = join(dir, "probe-" + version);
  await writeFile(source, `print("JARVIS local identity probe ${version}")\n`);
  execFileSync("xcrun", ["swiftc", source, "-o", binary], {
    env: {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: "/tmp/jarvis-swift-cache",
      SWIFT_MODULECACHE_PATH: "/tmp/jarvis-swift-cache",
    },
  });
  execFileSync(
    "codesign",
    [
      "--force",
      "--sign",
      profile.fingerprint,
      "--keychain",
      profile.keychain,
      "--timestamp=none",
      "--identifier",
      id,
      "--requirements",
      "=designated => " + dr,
      binary,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  execFileSync("codesign", ["--verify", "--strict", "-R", "=" + dr, binary]);
  execFileSync(binary, [], { stdio: "ignore" });
  results.push(metadata(binary));
}
assert.equal(results[0].requirement, results[1].requirement);
assert.notEqual(results[0].hash, results[1].hash);
assert(!results[0].requirement.includes("cdhash"));
const wrong = join(dir, "wrong-signer");
execFileSync("ditto", [join(dir, "probe-A"), wrong]);
execFileSync(
  "codesign",
  ["--force", "--sign", "-", "--identifier", id, wrong],
  { stdio: "ignore" },
);
const rejected = spawnSync("codesign", ["--verify", "-R", "=" + dr, wrong], {
  encoding: "utf8",
});
assert.notEqual(rejected.status, 0);
const report = {
  sameRequirementAcrossDifferentBuilds: true,
  differentCodeHashes: true,
  wrongSignerRejected: true,
  systemTrustChanges: false,
  requirement: results[0].requirement,
};
await writeFile(
  join(dir, "identity-proof.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
