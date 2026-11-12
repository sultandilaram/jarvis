import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { PhoneGateway } from "../src/main/remote/gateway.ts";
import {
  pairKeys,
  derivePairKey,
  seal,
  unseal,
  comparisonCode,
  parsePairQR,
  randomSecret,
  base64,
  unbase64,
} from "../src/shared/link-crypto.ts";
function inbox(url: string) {
  const ws = new WebSocket(url),
    queue: any[] = [],
    waiting: ((x: any) => void)[] = [];
  ws.on("message", (raw) => {
    const value = JSON.parse(String(raw));
    const next = waiting.shift();
    next ? next(value) : queue.push(value);
  });
  ws.on("error", () => {});
  return {
    ws,
    next: () =>
      queue.length
        ? Promise.resolve(queue.shift())
        : new Promise<any>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(Error("Timed out waiting for link message")),
              3000,
            );
            waiting.push((value) => {
              clearTimeout(timer);
              resolve(value);
            });
          }),
    send: (v: unknown) => ws.send(JSON.stringify(v)),
  };
}
test("a targeted phone call is encrypted only for the approved recipient", async () => {
  const gateway = new PhoneGateway(async () => ({}), async () => {});
  const a = { id: "a", key: randomSecret(), name: "A", createdAt: "fixture" };
  const b = { id: "b", key: randomSecret(), name: "B", createdAt: "fixture" };
  gateway.phones = [a, b];
  const receivedA: string[] = [], receivedB: string[] = [];
  gateway.clients.set("a", { readyState: WebSocket.OPEN, send: (text: string) => receivedA.push(text) } as any);
  gateway.clients.set("b", { readyState: WebSocket.OPEN, send: (text: string) => receivedB.push(text) } as any);
  await gateway.push({ type: "incoming", call: { id: "test-call", reason: "Approved update" } }, ["a"]);
  assert.equal(receivedA.length, 1);
  assert.equal(receivedB.length, 0);
  const event = await unseal(a.key, JSON.parse(receivedA[0]).box, "mac->phone");
  assert.equal(event.call.reason, "Approved update");
});
test("encrypted link supports large approval payloads and rejects tampering/direction reflection", async () => {
  const k = randomSecret(),
    value = { text: "a".repeat(200000) };
  assert.deepEqual(
    await unseal(k, await seal(k, value, "mac->phone"), "mac->phone"),
    value,
  );
  const box = await seal(k, { send: "fixture" }, "phone->mac");
  await assert.rejects(() => unseal(k, box, "mac->phone"));
  const bytes = unbase64(box.data);
  bytes[0] ^= 1;
  await assert.rejects(() =>
    unseal(k, { ...box, data: base64(bytes) }, "phone->mac"),
  );
});
test("QR validation rejects insecure origins, stale tickets and embedded credentials", () => {
  const q = {
    v: 1,
    url: "https://jarvis.example/",
    ticket: randomSecret(),
    publicKey: { kty: "EC" },
    expires: Date.now() + 100000,
    desktop: "test",
  };
  assert.equal(parsePairQR(JSON.stringify(q)).url, q.url);
  for (const value of [
    { ...q, url: "http://jarvis.example/" },
    { ...q, url: "https://user:password@jarvis.example/" },
    { ...q, expires: Date.now() - 1 },
  ])
    assert.throws(() => parsePairQR(JSON.stringify(value)));
});
test("phone pairing requires desktop confirmation, challenge auth, idempotent RPC and revocation", async () => {
  let actions = 0,
    saved = 0;
  const gateway = new PhoneGateway(
    async (m, p) => {
      actions++;
      return { method: m, text: p.text };
    },
    async () => {
      saved++;
    },
  );
  const port = await gateway.start();
  const sockets: WebSocket[] = [];
  try {
    const qr = await gateway.createQR("https://jarvis.example/");
    const phone = await pairKeys(),
      key = await derivePairKey(phone.privateKey, qr.publicKey, qr.ticket);
    const pairing = inbox(`ws://127.0.0.1:${port}/link`);
    sockets.push(pairing.ws);
    const hello = await pairing.next();
    pairing.send({
      type: "pair",
      ticket: qr.ticket,
      publicKey: phone.publicKey,
      box: await seal(
        key,
        { challenge: hello.challenge, name: "Test phone" },
        "pair",
      ),
    });
    const pending = await pairing.next();
    assert.equal(
      (await unseal(key, pending.box, "mac->phone")).code,
      await comparisonCode(key),
    );
    assert.equal(gateway.phones.length, 0);
    assert.equal(actions, 0);
    await gateway.decide(gateway.pending!.id, true);
    const accepted = await pairing.next();
    const id = (await unseal(key, accepted.box, "mac->phone")).id;
    assert.equal(saved, 1);
    assert.equal(gateway.phones[0].id, id);
    const link = inbox(`ws://127.0.0.1:${port}/link`);
    sockets.push(link.ws);
    const challenge = (await link.next()).challenge;
    link.send({
      type: "auth",
      deviceId: id,
      box: await seal(key, { challenge }, "auth"),
    });
    assert.equal((await link.next()).type, "ready");
    const request = {
      id: crypto.randomUUID(),
      at: Date.now(),
      challenge,
      method: "send",
      params: { text: "Synthetic request" },
    };
    const packet = {
      type: "packet",
      box: await seal(key, request, "phone->mac"),
    };
    link.send(packet);
    assert.equal(
      (await unseal(key, (await link.next()).box, "mac->phone")).ok,
      true,
    );
    link.send(packet);
    await link.next();
    assert.equal(actions, 1);
    await gateway.revoke(id);
    assert.equal(gateway.phones.length, 0);
    const bad = inbox(`ws://127.0.0.1:${port}/link`);
    sockets.push(bad.ws);
    const badChallenge = (await bad.next()).challenge;
    const closed = new Promise((r) => bad.ws.once("close", r));
    bad.send({
      type: "auth",
      deviceId: id,
      box: await seal(key, { challenge: badChallenge }, "auth"),
    });
    await closed;
    assert.equal(actions, 1);
  } finally {
    for (const s of sockets) s.terminate();
    gateway.close();
  }
});
