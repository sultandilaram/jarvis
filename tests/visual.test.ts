import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import cp from "node:child_process";
import { createHash } from "node:crypto";
import { visionProbeImage, imageSource } from "../src/main/providers/images.ts";
import { withoutInlineImages } from "../src/shared/image-history.ts";
import {
  checkVisualApproval,
  phoneApprovals,
} from "../src/main/remote/visual-approvals.ts";
test("visual clicks require exact image approval, ignore metadata overrides and invalidate on Stop or replay", async () => {
  const stub =
    "data:text/javascript," +
    encodeURIComponent(
      "export const dialog={};export const shell={};export class BrowserWindow{};export class WebContentsView{};export const session={};",
    );
  const hooks = registerHooks({
    resolve(s, c, next) {
      return s === "electron" ? { url: stub, shortCircuit: true } : next(s, c);
    },
  });
  const original = cp.execFile,
    dispatched: any[] = [];
  const imageUrl = visionProbeImage("12345678"),
    image = imageSource(imageUrl);
  const context = {
    bundleId: "net.whatsapp.WhatsApp",
    pid: 123,
    window: "Inert messaging fixture",
    windowKind: "native",
    windowIdentifier: "fixture-window",
    documentURL: "",
    pageContentAvailable: true,
    truncated: false,
    elements: [{ id: "0", role: "AXWindow", secure: false, value: "" }],
  };
  const scene = {
    imageUrl,
    width: 240,
    height: 64,
    frame: { x: 10, y: 20, width: 240, height: 64 },
    windowId: 42,
    sceneHash: createHash("sha256")
      .update(Buffer.from(image.data, "base64"))
      .digest("hex"),
    contextSnapshot: context,
  };
  (cp as any).execFile = (
    _file: any,
    _args: any,
    _options: any,
    callback: any,
  ) => ({
    stdin: {
      end(raw: string) {
        const a = JSON.parse(raw);
        if (a.action === "desktop.click_image") dispatched.push(a);
        queueMicrotask(() =>
          callback(
            null,
            JSON.stringify(
              a.action === "desktop.capture"
                ? scene
                : { dispatched: true, verified: false },
            ),
          ),
        );
      },
    },
  });
  syncBuiltinESMExports();
  try {
    const { DesktopService } = await import("../src/main/desktop/service.ts");
    for (const mode of ["approve", "stop", "expired", "decline"]) {
      const service = new DesktopService(
        "fixture",
        () => [],
        () => {},
        () => {
          throw Error("No UI");
        },
      );
      service.visionAllowed = () => true;
      service.broker.approvalMode = () => "critical";
      const events: any[] = [];
      service.broker.on("activity", (e) => events.push(e));
      const captured = await service.broker.execute("desktop.capture", {
        bundleId: context.bundleId,
      });
      assert(captured.success);
      assert(captured.contentItems.some((i) => i.type === "inputImage"));
      const metadata = JSON.parse(
          (captured.contentItems.find((i) => i.type === "inputText") as any)
            .text,
        ),
        before = dispatched.length;
      if (mode === "expired")
        service.captures.get(metadata.captureId)!.at -= 120001;
      service.broker.on("approval", (a) => {
        assert.equal(a.params.preview.imageUrl, imageUrl);
        assert.deepEqual(a.params.preview.point, { x: 25, y: 30 });
        assert.equal(dispatched.length, before);
        if (mode === "stop") service.stop();
        else service.broker.decide(a.id, mode !== "decline");
      });
      const result = await service.broker.execute("desktop.click_image", {
        captureId: metadata.captureId,
        x: 25,
        y: 30,
        frame: { x: 999 },
        sceneHash: "forged",
        windowId: 999,
        contextSnapshot: {},
      });
      assert.equal(result.success, mode === "approve");
      assert.equal(dispatched.length - before, mode === "approve" ? 1 : 0);
      if (mode === "approve") {
        const sent = dispatched.at(-1);
        assert.deepEqual(sent.frame, scene.frame);
        assert.equal(sent.windowId, 42);
        assert.equal(sent.sceneHash, scene.sceneHash);
        assert.deepEqual(sent.contextSnapshot, context);
        assert.equal(
          (
            await service.broker.execute("desktop.click_image", {
              captureId: metadata.captureId,
              x: 25,
              y: 30,
            })
          ).success,
          false,
        );
      }
      assert(!JSON.stringify(events).includes(imageUrl));
      service.stop();
    }
  } finally {
    (cp as any).execFile = original;
    syncBuiltinESMExports();
    hooks.deregister();
  }
});
test("inline tool images remain available for delivery but are removed from local history formats", () => {
  const unusual = JSON.parse(
    '{"__proto__":{"note":"Preserve exact argument keys"},"constructor":"fixture"}',
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(withoutInlineImages(unusual))),
    unusual,
  );
  const unrelated = {
    images: ["avatar", "cover"],
    content: { toString: "field", valueOf: "field" },
    type: "image_url",
    image_url: { url: "https://example.com/image.png" },
    inlineData: "ordinary metadata",
  };
  assert.deepEqual(withoutInlineImages(unrelated), unrelated);
  const url = visionProbeImage("87654321"),
    data = imageSource(url).data;
  for (const value of [
    { imageUrl: url },
    { content: JSON.stringify({ imageUrl: url }) },
    { type: "image", source: { type: "base64", data } },
    { type: "image_url", image_url: { url } },
    { inlineData: { mimeType: "image/png", data } },
    { role: "user", content: "image", images: [data] },
  ]) {
    const redacted = JSON.stringify(withoutInlineImages(value));
    assert(!redacted.includes(data));
    assert(!redacted.includes("data:image/"));
  }
});
test("older phones cannot approve an unavailable visual preview; decline remains available", () => {
  const a = {
    id: "desktop:901",
    method: "jarvis/desktop/requestApproval",
    params: {
      action: "desktop.click_image",
      preview: { imageUrl: visionProbeImage("12345678") },
    },
  };
  assert.equal(
    phoneApprovals([a], undefined)[0].params.preview.imageUrl,
    undefined,
  );
  assert.equal(
    phoneApprovals([a], 1)[0].params.preview.imageUrl,
    a.params.preview.imageUrl,
  );
  assert.throws(
    () => checkVisualApproval([a], a.id, true, undefined),
    /cannot review/,
  );
  assert.doesNotThrow(() => checkVisualApproval([a], a.id, false, undefined));
  assert.doesNotThrow(() => checkVisualApproval([a], a.id, true, 1));
});
