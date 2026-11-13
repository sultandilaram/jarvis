import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

test("browser mutation planning refuses incomplete context before offering approval", async () => {
  // No Electron runtime or UI is started: only the real service planner is exercised.
  const stub = "data:text/javascript," + encodeURIComponent("export const dialog={};export const shell={};export class BrowserWindow{};export const session={};");
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    return specifier === "electron" ? { url: stub, shortCircuit: true } : nextResolve(specifier, context);
  } });
  try {
    const { DesktopService } = await import("../src/main/desktop/service.ts");
    const service = new DesktopService("/must-not-execute", () => [], () => {}, () => { throw Error("No UI in planner test"); });
    const field = { id: "0.1", role: "AXTextField", subrole: "", label: "Display name", value: "", secure: false, actions: ["AXPress"] };
    const snapshot = { bundleId: "company.thebrowser.Browser", pid: 123, window: "Test form", windowIdentifier: "test-window", documentURL: "https://example.com/form", pageContentAvailable: true, truncated: false, elements: [field] };
    for (const action of ["desktop.press", "desktop.type"]) {
      const args = { snapshotId: "test", elementId: field.id, text: "Sultan Test" };
      for (const changed of [
        { truncated: true },
        { pageContentAvailable: false },
        { pageContentAvailable: undefined },
        { documentURL: "" },
        { documentURL: "arc://settings" },
        { documentURL: "https://user:secret@example.com" },
        { elements: [{ ...field, secure: true }] },
      ]) {
        service.snapshots.set("test", { ...snapshot, ...changed });
        await assert.rejects(() => service.plan(action, args, new AbortController().signal));
        const result = await service.broker.execute(action, args);
        assert.equal(result.success, false);
        assert.equal(service.broker.pending.size, 0);
      }
      service.snapshots.set("test", snapshot);
      const plan = await service.plan(action, args, new AbortController().signal);
      assert.equal(plan.approval, true);
      assert.equal(plan.preview.page, snapshot.documentURL);
      assert.equal(plan.preview.window, snapshot.window);
      assert.equal(typeof plan.verify, "function");
    }
  } finally { hooks.deregister(); }
});
