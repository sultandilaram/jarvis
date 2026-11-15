import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { LocalReleases } from "../src/main/local-releases.ts";
import { trustedCheckName } from "../src/main/github-maintenance.ts";

test("a changed Windows ZIP prevents the complete release from being published", async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-windows-release-")),
    state = join(root, "private");
  mkdirSync(state, { mode: 0o700 });
  for (const file of [
    "private/local-signing.json",
    "private/vault-v1/identity.json",
    "private/release-signing/ed25519-private.pem",
    "android-tools/environment.json",
    "android-tools/test-signing.json",
  ]) {
    const p = join(state, file);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, "fixture");
  }
  const pair = generateKeyPairSync("ed25519"),
    commit = "a".repeat(40),
    version = "0.8.3";
  let published = false;
  const github: any = {
    token: async () => "fixture",
    ensureRules: async () => {},
    api: async (path: string) =>
      path.includes("/git/ref/")
        ? { object: { type: "commit", sha: commit } }
        : path.includes("/compare/")
          ? { status: "identical" }
          : {
              check_runs: [
                {
                  id: 1,
                  name: trustedCheckName,
                  head_sha: commit,
                  status: "completed",
                  conclusion: "success",
                  app: { slug: "github-actions" },
                },
              ],
            },
  };
  const run = async (_exe: string, args: string[]) => {
    if (args.includes("clone")) {
      mkdirSync(args.at(-1)!);
      writeFileSync(
        join(args.at(-1)!, "package.json"),
        JSON.stringify({ version }),
      );
    }
    if (args[0] === "scripts/release/publish.mjs") {
      published = true;
      return;
    }
    if (args[0] !== "scripts/release/build.mjs") return;
    const dir = join(state, "release-candidate");
    mkdirSync(dir);
    const asset = (name: string) => {
      const data = Buffer.from(name);
      writeFileSync(join(dir, name), data);
      return {
        name,
        size: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
      };
    };
    const m = {
      schema: 1,
      repository: "sultandilaram/jarvis",
      version,
      commit,
      publishedAt: new Date().toISOString(),
      dataSchema: 1,
      notes: "Inert fixture.",
      assets: {
        macArm64: asset(`JARVIS-macOS-AppleSilicon-${version}.zip`),
        macDmg: asset(`JARVIS-macOS-AppleSilicon-${version}.dmg`),
        android: asset(`JARVIS-Android-${version}.apk`),
      },
      downloads: { windowsX64: asset(`JARVIS-Windows-x64-${version}.zip`) },
    };
    const raw = Buffer.from(JSON.stringify(m));
    writeFileSync(join(dir, "release.json"), raw);
    writeFileSync(join(dir, "release.sig"), sign(null, raw, pair.privateKey));
    writeFileSync(join(dir, m.downloads.windowsX64.name), "tampered");
  };
  try {
    const releases = new LocalReleases(
      join(root, "builds"),
      () => state,
      github,
      () => {},
      undefined,
      run,
      pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    );
    await assert.rejects(releases.build(version, commit), /signed hash/);
    assert.equal(published, false);
    assert.equal(releases.state.phase, "failed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
