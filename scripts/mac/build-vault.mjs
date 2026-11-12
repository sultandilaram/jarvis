import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { readProfile, requirement } from "./local-signing.mjs";
export async function buildVault() {
  const profile = readProfile();
  const directory = resolve(".jarvis/private/vault-v1");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const source = readFileSync("native/CredentialVault.swift", "utf8").replace(
    "__JARVIS_PARENT_REQUIREMENT__",
    requirement("com.sultan.jarvis", profile.fingerprint).replaceAll(
      '"',
      '\\"',
    ),
  );
  const digest = createHash("sha256").update(source).digest("hex");
  const binary = join(directory, "jarvis-credential-vault"),
    meta = join(directory, "identity.json");
  const dr =
    "=" +
    requirement("com.sultan.jarvis.credential-vault", profile.fingerprint);
  if (existsSync(meta)) {
    const old = JSON.parse(readFileSync(meta, "utf8"));
    if (old.sourceDigest !== digest || old.signer !== profile.fingerprint)
      throw Error(
        "Vault v1 source or signer changed. Explicit vault migration is required; do not silently replace it.",
      );
    if (
      createHash("sha256").update(readFileSync(binary)).digest("hex") !==
      old.binaryDigest
    )
      throw Error("Fixed vault executable changed. Refusing to package it.");
  } else {
    const swift = join(directory, "CredentialVault.swift");
    await writeFile(swift, source, { mode: 0o600 });
    execFileSync(
      "xcrun",
      ["swiftc", "-O", "-suppress-warnings", swift, "-o", binary],
      {
        env: {
          ...process.env,
          CLANG_MODULE_CACHE_PATH: "/tmp/jarvis-swift-cache",
          SWIFT_MODULECACHE_PATH: "/tmp/jarvis-swift-cache",
        },
      },
    );
    execFileSync("/usr/bin/codesign", [
      "--force",
      "--sign",
      profile.fingerprint,
      "--keychain",
      profile.keychain,
      "--timestamp=none",
      "--identifier",
      "com.sultan.jarvis.credential-vault",
      "--requirements",
      "=designated => " +
        requirement("com.sultan.jarvis.credential-vault", profile.fingerprint),
      binary,
    ]);
    await writeFile(
      meta,
      JSON.stringify(
        {
          sourceDigest: digest,
          signer: profile.fingerprint,
          binaryDigest: createHash("sha256")
            .update(readFileSync(binary))
            .digest("hex"),
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
  }
  execFileSync("/usr/bin/codesign", ["--verify", "--strict", "-R", dr, binary]);
  await copyFile(binary, resolve("dist/native/jarvis-credential-vault"));
}
