import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

test("native desktop controller compiles and its real field policy protects sensitive inputs", { skip: process.platform !== "darwin", timeout: 120000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-native-policy-"));
  try {
    const helper = join(dir, "desktop-policy-test");
    const compiled = spawnSync("/usr/bin/xcrun", ["swiftc", "-D", "JARVIS_TESTING", "-module-cache-path", join(dir, "modules"), resolve("native/DesktopControl.swift"), "-o", helper], { encoding: "utf8", timeout: 100000 });
    assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
    const cases: Array<[Record<string, string>, boolean]> = [
      [{ role: "AXTextField", label: "Display name" }, false],
      [{ role: "AXTextArea", label: "Test message" }, false],
      [{ role: "AXTextField", label: "Shipping address" }, false],
      [{ role: "AXTextField", subrole: "AXSecureTextField" }, true],
      [{ role: "AXTextField", label: "Password" }, true],
      [{ role: "AXTextField", label: "Card number" }, true],
      [{ role: "AXTextField", label: "Verification code" }, true],
      [{ role: "AXTextField", label: "PIN" }, true],
      [{ role: "AXTextField", label: "Value", identifier: "api_token" }, true],
      [{ role: "AXTextField", label: "Value", placeholder: "One-time code" }, true],
      [{ role: "AXTextField", label: "Value", help: "credit card security code" }, true],
      [{ role: "AXTextArea", label: "Recovery code" }, true],
    ];
    for (const [url, allowed] of [["https://example.com", true], ["http://127.0.0.1:1234/", true], ["file:///tmp/test.html", true], ["chrome://password-manager/", false], ["arc://settings", false], ["data:text/html,private", false], ["https://user:secret@example.com", false], ["", false]] as const) {
      const result = spawnSync(helper, [], { input: JSON.stringify({ action: "test.browserPagePolicy", url }), encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).allowed, allowed, url);
    }
    for (const [value, secure, expected, truncated] of [["x".repeat(1000), false, "x".repeat(1000), false], ["x".repeat(1000) + "hidden tail", false, "x".repeat(1000), true], ["secret", true, "[redacted]", false]] as const) {
      const result = spawnSync(helper, [], { input: JSON.stringify({ action: "test.snapshotValue", value, secure }), encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { value: expected, truncated });
    }
    for (const [input, expected] of cases) {
      const result = spawnSync(helper, [], { input: JSON.stringify({ action: "test.fieldPolicy", ...input }), encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).sensitive, expected, JSON.stringify(input));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
