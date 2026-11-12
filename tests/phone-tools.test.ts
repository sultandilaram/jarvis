import test from "node:test";
import assert from "node:assert/strict";
import { DesktopBroker } from "../src/main/desktop/broker.ts";
import { phoneAction, type PhoneTarget } from "../src/main/remote/phone-tools.ts";
test("phone status is read-only; calls require exact-recipient approval and reject revoked targets", async () => {
  let phones: PhoneTarget[] = [{ id: "phone-a", name: "Owner phone", online: false, alertsEnabled: true }];
  const sent: unknown[] = [];
  const broker = new DesktopBroker(async (action, args) => phoneAction(action, args, {
    ready: () => true, phones: () => phones,
    call: async (text, id) => { sent.push({ text, id }); return { accepted: true, deliveryVerified: false }; },
  }));
  assert.equal((await broker.execute("phone.status", {})).success, true);
  assert.equal(broker.pending.size, 0);
  let preview: any;
  broker.on("approval", a => { preview = a; });
  const call = broker.execute("phone.call", { phoneId: "phone-a", text: "Your report is ready." });
  await new Promise(setImmediate);
  assert.deepEqual(sent, []);
  assert.equal(preview.params.preview.update, "Your report is ready.");
  assert.equal(preview.params.preview.phoneId, "phone-a");
  broker.decide(preview.id, true);
  assert.equal((await call).success, true);
  assert.deepEqual(sent, [{ text: "Your report is ready.", id: "phone-a" }]);
  const stale = broker.execute("phone.call", { phoneId: "phone-a", text: "Another update" });
  await new Promise(setImmediate);
  phones = [];
  broker.decide(preview.id, true);
  assert.equal((await stale).success, false);
  assert.equal(sent.length, 1);
});
test("a rejected phone-call request is a tool failure, not a delivery claim", async () => {
  const broker = new DesktopBroker(async (action, args) => phoneAction(action, args, {
    ready: () => true,
    phones: () => [{ id: "phone-a", name: "Owner phone", online: true, alertsEnabled: true }],
    call: async () => ({ accepted: false, reason: "Phone is still in another call" }),
  }));
  const call = broker.execute("phone.call", { phoneId: "phone-a", text: "Test update" });
  await new Promise(setImmediate);
  broker.decide([...broker.pending.keys()][0], true);
  const result = await call;
  assert.equal(result.success, false);
  assert.match(JSON.stringify(result), /still in another call/);
});
