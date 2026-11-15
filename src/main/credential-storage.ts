import { app, safeStorage } from "electron";
import { existsSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
const prefix = Buffer.from("JARVISVAULT1\n");
function helper() {
  return join(app.getAppPath(), "dist/native/jarvis-credential-vault");
}
export function usesFixedVault() {
  return (
    process.platform === "darwin" && app.isPackaged && existsSync(helper())
  );
}
export function isVaultCipher(data: Buffer) {
  return data.subarray(0, prefix.length).equals(prefix);
}
async function vault(action: "seal" | "open", data: Buffer): Promise<Buffer> {
  if (data.length > (action === "seal" ? 65536 : 65564))
    throw Error("Credential exceeds the local vault limit.");
  return new Promise((resolve, reject) => {
    const child = spawn(helper(), [], { stdio: ["pipe", "pipe", "ignore"] });
    let output = Buffer.alloc(0),
      settled = false;
    const finish = (error?: Error, value?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill();
        reject(error);
      } else resolve(value!);
    };
    const timer = setTimeout(
      () => finish(Error("Local credential vault timed out.")),
      60000,
    );
    child.on("error", () =>
      finish(Error("Local credential vault could not start.")),
    );
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk) => {
      output = Buffer.concat([output, chunk]);
      if (output.length > 131072)
        finish(Error("Invalid local vault response."));
    });
    child.on("close", (code) => {
      if (code !== 0)
        return finish(Error("Local credential vault rejected access."));
      try {
        const response = JSON.parse(output.toString("utf8"));
        if (typeof response.data !== "string") throw Error();
        finish(undefined, Buffer.from(response.data, "base64"));
      } catch {
        finish(Error("Invalid local vault response."));
      }
    });
    child.stdin.end(JSON.stringify({ action, data: data.toString("base64") }));
  });
}
export async function encryptSecret(value: string): Promise<Buffer> {
  if (usesFixedVault())
    return Buffer.concat([
      prefix,
      await vault("seal", Buffer.from(value, "utf8")),
    ]);
  if (!(await safeStorage.isAsyncEncryptionAvailable()))
    throw Error("OS credential encryption is unavailable.");
  return safeStorage.encryptStringAsync(value);
}
export async function decryptSecret(data: Buffer): Promise<string> {
  if (isVaultCipher(data)) {
    if (!usesFixedVault())
      throw Error("Open the installed JARVIS app to unlock this credential.");
    return (await vault("open", data.subarray(prefix.length))).toString("utf8");
  }
  return (await safeStorage.decryptStringAsync(data)).result;
}
export function writeEncrypted(path: string, data: Buffer) {
  const temp = path + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temp, data, { mode: 0o600, flag: "wx" });
    renameSync(temp, path);
  } finally {
    try {
      unlinkSync(temp);
    } catch {}
  }
}
