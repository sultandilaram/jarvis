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
    const frame = { x: 100, y: 200, width: 120, height: 40 };
    for (const [role, actions, allowed] of [["AXStaticText", [], true], ["AXImage", [], true], ["AXGroup", [], true], ["AXHeading", [], true], ["AXLink", [], false], ["AXButton", [], false], ["AXTextField", [], false], ["AXCheckBox", [], false], ["AXUnknown", [], false], ["AXGroup", ["AXPress"], false], ["AXImage", ["AXPress"], false]] as const) {
      const result = spawnSync(helper, [], { input: JSON.stringify({ action: "test.hitPolicy", role, actions }), encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).allowed, allowed, role);
    }
    const context = { documentURL: "https://example.com/form", windowIdentifier: "window-1", window: "Form", pid: 123, pageContentAvailable: true, truncated: false, elements: [{ id: "0.1", role: "AXTextField", value: "approved" }] };
    for (const [patch, allowed] of [[{}, true], [{ elements: [{ id: "0.1", role: "AXTextField", value: "changed" }] }, false], [{ window: "Other" }, false], [{ pid: 456 }, false], [{ windowIdentifier: "window-2" }, false], [{ documentURL: "https://example.com/other" }, false], [{ truncated: true }, false], [{ pageContentAvailable: false }, false]] as const) {
      const result = spawnSync(helper, [], { input: JSON.stringify({ action: "test.contextPolicy", expected: context, actual: { ...context, ...patch } }), encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).allowed, allowed, JSON.stringify(patch));
    }
    for (const patch of [{ windowIdentifier: "" }, { documentURL: "arc://settings" }, { documentURL: "https://user:secret@example.com" }, { truncated: true }, { pageContentAvailable: false }]) {
      const invalid = { ...context, ...patch };
      const result = spawnSync(helper, [], { input: JSON.stringify({ action: "test.contextPolicy", expected: invalid, actual: invalid }), encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).allowed, false);
    }
    for (const [values, timeout, expected, reads] of [[["", "", "settled"], 0.2, "settled", 3], [[""], 0, "", 1]] as const) {
      const result = spawnSync(helper, [], { input: JSON.stringify({ action: "test.readback", values, expected: "settled", timeout }), encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { value: expected, reads });
    }
    const button = { role: "AXButton", browser: true, enabled: true, actions: [], frame };
    for (const [patch, method] of [
      [{}, "pointer"],
      [{ role: "AXLink" }, "pointer"],
      [{ role: "AXTextField" }, "none"],
      [{ role: "AXGroup" }, "none"],
      [{ browser: false }, "none"],
      [{ secure: true }, "none"],
      [{ enabled: false }, "none"],
      [{ enabled: null }, "none"],
      [{ frame: { ...frame, width: 0 } }, "none"],
      [{ frame: { ...frame, height: -1 } }, "none"],
      [{ frame: { ...frame, width: 10001 } }, "none"],
      [{ frame: { ...frame, x: 100001 } }, "none"],
      [{ frame: { x: 1, width: 10, height: 10 } }, "none"],
      [{ actions: ["AXPress"] }, "accessibility"],
      [{ actions: ["AXPress"], browser: false }, "accessibility"],
      [{ actions: ["AXPress"], secure: true }, "none"],
      [{ actions: ["AXPress"], enabled: false }, "none"],
    ] as const) {
      const result = spawnSync(helper, [], { input: JSON.stringify({ action: "test.pressPolicy", ...button, ...patch }), encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).method, method, JSON.stringify(patch));
    }
    for (const [input, expected] of cases) {
      const result = spawnSync(helper, [], { input: JSON.stringify({ action: "test.fieldPolicy", ...input }), encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).sensitive, expected, JSON.stringify(input));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
