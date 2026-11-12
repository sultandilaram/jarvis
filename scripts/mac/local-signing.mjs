import { execFileSync } from "node:child_process";
import {
  readFileSync,
  openSync,
  readSync,
  closeSync,
  lstatSync,
  existsSync,
} from "node:fs";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join, basename, relative } from "node:path";
import { sign } from "@electron/osx-sign";
export const profilePath = resolve(".jarvis/private/local-signing.json");
export function requirement(id, fingerprint) {
  if (!/^[a-zA-Z0-9.-]+$/.test(id) || !/^([A-Fa-f0-9]{40})$/.test(fingerprint))
    throw Error("Invalid signing requirement input");
  return `identifier "${id}" and certificate leaf = H"${fingerprint.toUpperCase()}"`;
}
export function readProfile() {
  if (!existsSync(profilePath))
    throw Error(
      "Local signing is not initialized. Run npm run setup:local-signing first.",
    );
  const p = JSON.parse(readFileSync(profilePath, "utf8"));
  requirement("com.sultan.jarvis", p.fingerprint);
  if (
    p.kind !== "local-only" ||
    typeof p.keychain !== "string" ||
    !p.keychain.startsWith("/")
  )
    throw Error("Invalid local signing profile");
  return p;
}
function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", ...options });
}
export async function initialize() {
  if (existsSync(profilePath)) {
    const p = readProfile();
    console.log(
      "Using the existing local identity; it will not be regenerated.",
    );
    return p;
  }
  const keychain = run("/usr/bin/security", ["default-keychain", "-d", "user"])
    .trim()
    .replace(/^"|"$/g, "");
  if (!keychain.startsWith("/")) throw Error("No login keychain found");
  await mkdir(resolve(".jarvis/private"), { recursive: true, mode: 0o700 });
  const temp = await mkdtemp(resolve(".jarvis/private/signing-import-"));
  try {
    const config = join(temp, "certificate.cnf");
    await writeFile(
      config,
      `[req]\nprompt=no\ndistinguished_name=subject\nx509_extensions=extensions\n[subject]\nCN=JARVIS Local Code Signing\nO=JARVIS Personal Development\n[extensions]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,codeSigning\nsubjectKeyIdentifier=hash\n`,
      { mode: 0o600 },
    );
    const key = join(temp, "private.pem"),
      cert = join(temp, "certificate.pem"),
      p12 = join(temp, "identity.p12");
    run(
      "/usr/bin/openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:3072",
        "-sha256",
        "-nodes",
        "-days",
        "3650",
        "-config",
        config,
        "-keyout",
        key,
        "-out",
        cert,
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    // Public transport-only password works around empty-passphrase PKCS12 import incompatibility.
    // Confidentiality comes from the private 0700 temporary directory and login Keychain, not this wrapper password.
    run(
      "/usr/bin/openssl",
      [
        "pkcs12",
        "-export",
        "-name",
        "JARVIS Local Code Signing",
        "-inkey",
        key,
        "-in",
        cert,
        "-out",
        p12,
        "-keypbe",
        "PBE-SHA1-3DES",
        "-certpbe",
        "PBE-SHA1-3DES",
        "-passout",
        "pass:temporary-jarvis-import",
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    const fingerprint = run("/usr/bin/openssl", [
      "x509",
      "-in",
      cert,
      "-noout",
      "-fingerprint",
      "-sha1",
    ])
      .trim()
      .split("=")
      .at(-1)
      .replaceAll(":", "");
    requirement("com.sultan.jarvis", fingerprint);
    run(
      "/usr/bin/security",
      [
        "import",
        p12,
        "-k",
        keychain,
        "-P",
        "temporary-jarvis-import",
        "-T",
        "/usr/bin/codesign",
      ],
      { stdio: "inherit" },
    );
    // Only public certificate metadata persists in the workspace. No trust database is modified.
    run("/usr/bin/openssl", [
      "x509",
      "-in",
      cert,
      "-outform",
      "DER",
      "-out",
      resolve(".jarvis/private/local-signing.cer"),
    ]);
    const profile = {
      kind: "local-only",
      name: "JARVIS Local Code Signing",
      fingerprint,
      keychain,
      createdAt: new Date().toISOString(),
    };
    await writeFile(profilePath, JSON.stringify(profile, null, 2) + "\n", {
      mode: 0o600,
    });
    console.log(
      "Local signing identity imported into login Keychain. System trust settings were not changed.",
    );
    return profile;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
function machO(path) {
  try {
    if (!lstatSync(path).isFile()) return false;
    const fd = openSync(path, "r");
    const b = Buffer.alloc(4);
    try {
      readSync(fd, b, 0, 4, 0);
    } finally {
      closeSync(fd);
    }
    return [
      "cffaedfe",
      "cefaedfe",
      "feedfacf",
      "feedface",
      "cafebabe",
      "bebafeca",
      "cafebabf",
      "bfbafeca",
    ].includes(b.toString("hex"));
  } catch {
    return false;
  }
}
function bundleId(bundle) {
  for (const info of [
    join(bundle, "Contents/Info.plist"),
    join(bundle, "Resources/Info.plist"),
  ])
    if (existsSync(info)) {
      try {
        return run("/usr/bin/plutil", [
          "-extract",
          "CFBundleIdentifier",
          "raw",
          "-o",
          "-",
          info,
        ]).trim();
      } catch {}
    }
  return null;
}
export function identityForFile(path, app) {
  const native = {
    "jarvis-wake": "com.sultan.jarvis.wake",
    "jarvis-desktop-control": "com.sultan.jarvis.desktop-control",
    cloudflared: "com.sultan.jarvis.tunnel",
    "libvosk.dylib": "com.sultan.jarvis.vosk",
  };
  if (native[basename(path)]) return native[basename(path)];
  if (path === app) return "com.sultan.jarvis";
  if (path.endsWith(".app") || path.endsWith(".framework"))
    return (
      bundleId(path) ||
      "com.sultan.jarvis.component." +
        basename(path).replace(/[^a-zA-Z0-9.-]/g, "-")
    );
  const main = path.match(/^(.*\.app)\/Contents\/MacOS\/[^/]+$/);
  if (main) return bundleId(main[1]) || "com.sultan.jarvis";
  return (
    "com.sultan.jarvis.component." +
    relative(app, path).replace(/[^a-zA-Z0-9.-]/g, "-")
  );
}
export async function signLocal(app) {
  const p = readProfile();
  app = resolve(app);
  const vault = join(
    app,
    "Contents/Resources/app/dist/native/jarvis-credential-vault",
  );
  if (existsSync(vault))
    run("/usr/bin/codesign", [
      "--verify",
      "--strict",
      "-R",
      "=" + requirement("com.sultan.jarvis.credential-vault", p.fingerprint),
      vault,
    ]);
  await sign({
    app,
    identity: p.fingerprint,
    keychain: p.keychain,
    identityValidation: false,
    platform: "darwin",
    type: "development",
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    gatekeeperAssess: false,
    ignore: [
      (path) =>
        basename(path) === "jarvis-credential-vault" ||
        (lstatSync(path).isFile() && !machO(path)),
    ],
    optionsForFile: (path) => ({
      hardenedRuntime: false,
      timestamp: "none",
      entitlements:
        basename(path) === "jarvis-wake"
          ? ["com.apple.security.device.audio-input"]
          : [],
      requirements:
        "=designated => " +
        requirement(identityForFile(path, app), p.fingerprint),
      additionalArguments: ["--identifier", identityForFile(path, app)],
    }),
  });
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  run("/usr/bin/codesign", [
    "--verify",
    "--strict",
    "-R",
    "=" + requirement("com.sultan.jarvis", p.fingerprint),
    app,
  ]);
  console.log("Verified certificate-bound local signature for " + app);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  if (process.argv[2] === "init") await initialize();
  else if (process.argv[2] === "sign" && process.argv[3])
    await signLocal(process.argv[3]);
  else
    throw Error("Usage: node scripts/mac/local-signing.mjs init | sign PATH");
}
