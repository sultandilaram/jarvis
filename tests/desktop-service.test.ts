import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import cp from "node:child_process";

test("browser mutation planning refuses incomplete context before offering approval", async () => {
  // No Electron runtime or UI is started: only the real service planner is exercised.
  const stub = "data:text/javascript," + encodeURIComponent("export const dialog={};export const shell={};export class BrowserWindow{};export class WebContentsView{};export const session={};");
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

test("pointer fallback keeps exact approval, rejects changed bounds and ignores caller metadata overrides", async () => {
  const stub = "data:text/javascript," + encodeURIComponent("export const dialog={};export const shell={};export class BrowserWindow{};export class WebContentsView{};export const session={};");
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    return specifier === "electron" ? { url: stub, shortCircuit: true } : nextResolve(specifier, context);
  } });
  const original = cp.execFile;
  let current: any;
  const dispatched: any[] = [];
  (cp as any).execFile = (_file: unknown, _args: unknown, _options: unknown, callback: any) => ({ stdin: { end(raw: string) {
    const args = JSON.parse(raw);
    if (args.action !== "desktop.observe") dispatched.push(args);
    queueMicrotask(() => callback(null, JSON.stringify(args.action === "desktop.observe" ? current : { dispatched: true, verified: false })));
  } } });
  syncBuiltinESMExports();
  try {
    const { DesktopService } = await import("../src/main/desktop/service.ts");
    const field = { id: "0.1", role: "AXButton", subrole: "", label: "Preview test form", value: "", secure: false, actions: [], pressMethod: "pointer", frame: { x: 100, y: 200, width: 120, height: 40 } };
    const base = { bundleId: "company.thebrowser.Browser", pid: 123, window: "Local test", windowIdentifier: "window-1", documentURL: "https://example.com/form", pageContentAvailable: true, truncated: false, elements: [field] };
    const make = () => new DesktopService("synthetic-only", () => [], () => {}, () => { throw Error("No UI"); });
    for (const mode of ["approve", "bounds changed", "decline", "stop"]) {
      const service = make();
      current = structuredClone(base);
      service.snapshots.set("test", structuredClone(current));
      const before = dispatched.length;
      service.broker.once("approval", (a: any) => {
        assert.equal(dispatched.length, before);
        assert.deepEqual(a.params.preview.element.frame, field.frame);
        assert.equal(a.params.preview.page, base.documentURL);
        if (mode === "bounds changed") current.elements[0].frame.x++;
        if (mode === "stop") service.stop();
        else service.broker.decide(a.id, mode !== "decline");
      });
      const result = await service.broker.execute("desktop.press", { snapshotId: "test", elementId: field.id, frame: { x: 99999, y: 99999, width: 1, height: 1 }, contextSnapshot: { malicious: true }, pressMethod: "accessibility", role: "AXLink", label: "Injected", value: "Injected", pid: 999 });
      assert.equal(result.success, mode === "approve");
      assert.equal(dispatched.length - before, mode === "approve" ? 1 : 0);
      if (mode === "approve") {
        assert.deepEqual(dispatched.at(-1).frame, field.frame);
        for (const key of ["role", "label", "value", "pressMethod"] as const) assert.equal(dispatched.at(-1)[key], field[key]);
        assert.equal(dispatched.at(-1).pid, base.pid);
        assert.deepEqual(dispatched.at(-1).contextSnapshot, base);
      }
    }
    for (const patch of [{ role: "AXTextField" }, { pressMethod: "none" }, { actions: ["AXPress"], pressMethod: "none" }, { secure: true }, { frame: { ...field.frame, width: 0 } }, { frame: { ...field.frame, x: Infinity } }, { frame: { ...field.frame, width: "120" } }]) {
      const service = make();
      service.snapshots.set("test", { ...base, elements: [{ ...field, ...patch }] });
      await assert.rejects(() => service.plan("desktop.press", { snapshotId: "test", elementId: field.id }, new AbortController().signal));
      assert.equal(service.broker.pending.size, 0);
    }
    const missingWindow = make();
    missingWindow.snapshots.set("test", { ...base, windowIdentifier: "" });
    await assert.rejects(() => missingWindow.plan("desktop.press", { snapshotId: "test", elementId: field.id }, new AbortController().signal));
  } finally { cp.execFile = original; syncBuiltinESMExports(); hooks.deregister(); }
});
