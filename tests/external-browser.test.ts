import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, writeFile, rm, symlink, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileAccess } from "../src/main/desktop/files.ts";
import { DesktopBroker, desktopFunction } from "../src/main/desktop/broker.ts";
import { planExternalBrowser } from "../src/main/desktop/external-browser.ts";

const arc = "company.thebrowser.Browser";
const tick = () => new Promise<void>(r => setImmediate(r));
const files = () => new FileAccess(() => [], async () => {}, async () => "");

test("external navigation requires exact approval and reports only native launch acceptance", async () => {
  const calls: unknown[] = [];
  const broker = new DesktopBroker(async (_action, args) => planExternalBrowser(args, files(), async (target) => {
    calls.push(target); return { launchAccepted: true, verified: false };
  }));
  const result = broker.execute("browser.open_external", { bundleId: arc, url: "https://example.com/path?q=hello%20there" });
  await tick();
  assert.equal(calls.length, 0);
  const approval = [...broker.pending.keys()][0];
  assert.ok(approval);
  broker.decide(approval, true);
  assert.equal((await result).success, true);
  assert.deepEqual(calls, [{ bundleId: arc, url: "https://example.com/path?q=hello%20there" }]);
  assert.throws(() => broker.decide(approval, true), /expired/);
});

test("external navigation rejects executable schemes, credentials, ambiguous targets and non-browser apps", async () => {
  const plan = (args: Record<string, unknown>) => planExternalBrowser({ bundleId: arc, ...args }, files(), async () => assert.fail("must not launch"));
  for (const url of ["javascript:alert(1)", "file:///tmp/x.html", "data:text/html,test", "https://user:password@example.com", "https://example.com/\nfoo", "https://example.com/a b", "not a url"])
    await assert.rejects(() => plan({ url }));
  await assert.rejects(() => plan({ url: "https://example.com", path: "/tmp/x.html" }), /exactly one/);
  await assert.rejects(() => plan({}), /exactly one/);
  await assert.rejects(() => plan({ url: "https://example.com", bundleId: "com.apple.Terminal" }), /Choose/);
  await assert.rejects(() => plan({ url: "https://example.com", bundleId: "toString" }), /Choose/);
});

test("HTML opening is scoped, previewed by hash and invalidated by edits or replacement", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "jarvis-external-")));
  try {
    const f = new FileAccess(() => [root], async () => {}, async () => "");
    const path = join(root, "preview space.html");
    await writeFile(path, "<h1>Original</h1>");
    let calls = 0;
    const launch = async () => { calls++; return {}; };
    const plan = await planExternalBrowser({ bundleId: arc, path }, f, launch);
    assert.equal(plan.approval, true);
    assert.equal(plan.preview.path, path);
    assert.match(String(plan.preview.url), /preview%20space\.html$/);
    assert.equal(String(plan.preview.sha256).length, 64);
    await writeFile(path, "<h1>Changed</h1>");
    await assert.rejects(() => plan.verify!(), /changed/);
    await assert.rejects(() => plan.run(new AbortController().signal), /changed/);
    const replacement = await planExternalBrowser({ bundleId: arc, path }, f, launch);
    await rename(path, path + ".old");
    await writeFile(path, "<h1>Changed</h1>");
    await assert.rejects(() => replacement.run(new AbortController().signal), /changed/);
    await symlink(path, join(root, "link.html"));
    await assert.rejects(() => planExternalBrowser({ bundleId: arc, path: join(root, "link.html") }, f, launch), /Symlink/);
    await writeFile(join(root, "app.command"), "echo unsafe");
    await assert.rejects(() => planExternalBrowser({ bundleId: arc, path: join(root, "app.command") }, f, launch), /HTML/);
    await assert.rejects(() => planExternalBrowser({ bundleId: arc, path }, files(), launch), /outside/);
    const approved = await planExternalBrowser({ bundleId: arc, path }, f, launch);
    await approved.run(new AbortController().signal);
    assert.equal(calls, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("decline and Stop never launch an external browser", async () => {
  let calls = 0;
  const broker = new DesktopBroker(async (_action, args) => planExternalBrowser(args, files(), async () => { calls++; return {}; }));
  const args = { bundleId: arc, url: "https://example.com" };
  const declined = broker.execute("browser.open_external", args);
  await tick(); broker.decide([...broker.pending.keys()][0], false);
  assert.equal((await declined).success, false);
  const stopped = broker.execute("browser.open_external", args);
  await tick(); broker.cancel();
  assert.equal((await stopped).success, false);
  const controller = new AbortController(); controller.abort();
  const plan = await planExternalBrowser(args, files(), async () => { calls++; return {}; });
  await assert.rejects(() => plan.run(controller.signal));
  assert.equal(calls, 0);
});

test("the exposed tool includes external browser navigation", () => {
  assert.ok(desktopFunction.inputSchema.properties.action.enum.includes("browser.open_external"));
});
