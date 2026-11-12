import test from "node:test";
import assert from "node:assert/strict";
import { realpath, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/main/store.ts";
import { FileAccess } from "../src/main/desktop/files.ts";
import {
  MonitorManager,
  publicAddress,
  monitorURL,
} from "../src/main/monitors.ts";
test("file changes queue one bounded job and unchanged checks use no worker", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "jarvis-monitor-"))),
    store = new Store(":memory:");
  const queued: any[] = [];
  const files = new FileAccess(
    () => [root],
    async () => {},
    async () => "",
    root,
  );
  await writeFile(join(root, "notes.txt"), "one");
  const manager = new MonitorManager(
    store,
    files,
    {
      enqueue: (x: any) => {
        queued.push(x);
        return { id: "job1" };
      },
    } as any,
    () => {},
  );
  try {
    const plan = await manager.plan("watch.source", {
      sourceKind: "file",
      path: join(root, "notes.txt"),
      condition: "changed",
      text: "Summarize changes",
      intervalSeconds: 60,
    });
    assert(plan.approval);
    assert.equal(manager.list().length, 0);
    await plan.run(new AbortController().signal);
    let m = manager.list()[0];
    await manager.tick(m.lastCheck + 60001);
    assert.equal(queued.length, 0);
    await writeFile(join(root, "notes.txt"), "two");
    await manager.tick(m.lastCheck + 120001);
    assert.equal(queued.length, 1);
    assert.match(queued[0].goal, /untrusted data/);
    assert.equal(manager.list()[0].enabled, false);
    await manager.tick(m.lastCheck + 180001);
    assert.equal(queued.length, 1);
  } finally {
    manager.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("paused monitors cannot enqueue after an in-flight observation", async () => {
  const store = new Store(":memory:");
  let unblock!: (s: string) => void;
  let calls = 0;
  let read = async () => {
    if (calls++ === 0) return "old";
    return new Promise<string>((r) => (unblock = r));
  };
  const manager = new MonitorManager(
    store,
    {} as any,
    {
      enqueue: () => {
        throw Error("Should not enqueue");
      },
    } as any,
    () => {},
    read,
  );
  const p = await manager.plan("watch.source", {
    sourceKind: "url",
    url: "https://example.com/",
    text: "Summarize changes",
    intervalSeconds: 60,
  });
  await p.run(new AbortController().signal);
  const tick = manager.tick(Date.now() + 60001);
  await new Promise((r) => setImmediate(r));
  manager.pauseAll();
  unblock("new");
  await tick;
  assert.equal(manager.list()[0].runs, 0);
  store.close();
});
test("monitor URL and address rules reject credentials and private destinations", () => {
  for (const url of [
    "http://example.com",
    "https://user:password@example.com",
    "https://example.com/?api_key=secret",
    "https://example.com:8443",
  ])
    assert.throws(() => monitorURL(url));
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "172.16.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert(publicAddress("1.1.1.1"));
  assert(publicAddress("2606:4700:4700::1111"));
});
