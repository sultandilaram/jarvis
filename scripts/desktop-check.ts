// Local application integration test. All interactions target this script's fixture page.
import { app } from "electron";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { ControlledBrowser } from "../src/main/desktop/browser.ts";
import { nativeCall } from "../src/main/desktop/service.ts";
import { resolve } from "node:path";
app.setName("JARVIS Desktop Test");
app.setPath("userData", "/tmp/jarvis-desktop-test-profile");
void app.whenReady().then(async () => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<title>JARVIS local test</title><h1>Local fixture</h1><input aria-label="Note"><input type="password" aria-label="Password"><button onclick="document.querySelector(\'h1\').textContent=\'Clicked\'">Apply test</button>',
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const browser = new ControlledBrowser();
  try {
    const address = server.address() as any;
    const opened = await browser.plan("browser.open", {
      url: `http://127.0.0.1:${address.port}`,
    });
    assert.equal(opened.approval, true);
    const first: any = await opened.run(new AbortController().signal);
    assert.match(first.title, /JARVIS local test/);
    const note = first.elements.find((e: any) => e.label === "Note");
    const plan = await browser.plan("browser.type", {
      snapshotId: first.snapshotId,
      elementId: note.id,
      text: "fixture only",
    });
    assert.equal(plan.approval, true);
    await plan.verify!();
    await plan.run(new AbortController().signal);
    const filled = await browser.read();
    assert.equal(
      filled.elements.find((e: any) => e.label === "Note").value,
      "fixture only",
    );
    const sensitive = filled.elements.find((e: any) => e.label === "Password");
    await assert.rejects(
      () =>
        browser.plan("browser.type", {
          snapshotId: filled.snapshotId,
          elementId: sensitive.id,
          text: "forbidden",
        }),
      /Sensitive/,
    );
    const button = filled.elements.find((e: any) => e.label === "Apply test");
    const stale = await browser.plan("browser.click", {
      snapshotId: filled.snapshotId,
      elementId: button.id,
    });
    await browser.evaluate(
      "document.querySelector('button').textContent='Changed target'",
    );
    await assert.rejects(() => stale.verify!(), /changed/);
    const current = await browser.read();
    const click = await browser.plan("browser.click", {
      snapshotId: current.snapshotId,
      elementId: current.elements.find((e: any) => e.tag === "BUTTON").id,
    });
    await click.verify!();
    await click.run(new AbortController().signal);
    assert.match((await browser.read()).text, /Clicked/);
    const permission = await nativeCall(
      resolve("dist/native/jarvis-desktop-control"),
      { action: "permissions" },
      new AbortController().signal,
    );
    const apps = await nativeCall(
      resolve("dist/native/jarvis-desktop-control"),
      { action: "apps.list" },
      new AbortController().signal,
    );
    console.log(
      JSON.stringify({
        browser: {
          navigation: true,
          textVerified: true,
          sensitiveBlocked: true,
          staleBlocked: true,
          clickVerified: true,
        },
        native: { permission, runningApps: apps.apps.length },
      }),
    );
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    browser.window?.destroy();
    server.close();
    app.quit();
  }
});
