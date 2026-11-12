import test from "node:test";
import assert from "node:assert/strict";
import { DesktopCalls } from "../src/main/remote/calls.ts";
test("incoming calls are scoped, expire, and can only be answered once", () => {
  const calls = new DesktopCalls();
  calls.create("one", "A verified update", ["phone-a", "phone-b"], 1000);
  assert.throws(() => calls.info("one", "unknown", 2000));
  assert.throws(() => calls.info("one", "phone-a", 122000));
  calls.decline("one", "phone-b");
  assert.throws(() => calls.accept("one", "phone-b", 2000));
  assert.equal(
    calls.accept("one", "phone-a", 2000).reason,
    "A verified update",
  );
  assert.throws(() => calls.accept("one", "phone-a", 2001));
  assert.throws(() => calls.accept("one", "phone-b", 2001));
  calls.create("two", "Later update", ["phone-a"], 123000);
  assert.equal(calls.calls.has("one"), false);
});

test("resolved operator requests revoke unanswered calls without ending an answered conversation", () => {
  const calls = new DesktopCalls();
  const attention = { taskId: "t", requestId: 1, kind: "question" as const };
  calls.create("pending", "Need input", ["phone"], 1000, attention);
  calls.create("answered", "Need input", ["phone"], 1000, attention);
  calls.accept("answered", "phone", 1001);
  const removed = calls.resolved(() => false);
  assert.deepEqual(
    removed.map((r) => r.id),
    ["pending"],
  );
  assert.throws(() => calls.info("pending", "phone", 1002), /expired/);
  assert(calls.calls.has("answered"));
});
