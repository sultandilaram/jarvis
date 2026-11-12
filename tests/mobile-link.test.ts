import { test } from "node:test";
import assert from "node:assert/strict";
import { MobileLink } from "../mobile/web/link.ts";
import { randomSecret, seal } from "../src/shared/link-crypto.ts";

test("phone reconnects with its existing pairing, rejects uncertain requests and never replays them", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  class Socket {
    static instances: Socket[] = [];
    onclose: any; onmessage: any; onerror: any;
    sent: string[] = [];
    constructor(public url: string) { Socket.instances.push(this); }
    send(value: string) { this.sent.push(value); }
    close() {}
    async message(value: unknown) { await this.onmessage({ data: JSON.stringify(value) }); }
  }
  const original = globalThis.WebSocket;
  Object.assign(globalThis, { WebSocket: Socket });
  t.after(() => Object.assign(globalThis, { WebSocket: original }));
  const link = new MobileLink();
  const pair = { id: "paired-phone", name: "Mac", url: "https://jarvis.example.com/", key: randomSecret() };
  await link.connect(pair);
  const first = Socket.instances[0];
  await first.message({ type: "hello", challenge: "first" });
  await first.message({ type: "ready", box: await seal(pair.key, { id: pair.id }, "mac->phone") });
  assert.equal(link.connected, true);
  const pending = link.rpc("send", { text: "Create the approved file" });
  const rejected = assert.rejects(pending, /outcomes must be checked/);
  // Wait for AES-GCM to finish and the request to reach the first socket.
  while (!first.sent.some((x) => JSON.parse(x).type === "packet")) await new Promise(setImmediate);
  first.onclose({ code: 1006 });
  await rejected;
  t.mock.timers.tick(1000);
  const second = Socket.instances[1];
  assert.equal(second.url, first.url);
  await second.message({ type: "hello", challenge: "second" });
  await second.message({ type: "ready", box: await seal(pair.key, { id: pair.id }, "mac->phone") });
  assert.equal(link.connected, true);
  assert.deepEqual(second.sent.map((x) => JSON.parse(x).type), ["auth"]);
  second.onclose({ code: 1008 });
  t.mock.timers.tick(60000);
  assert.equal(Socket.instances.length, 2);
  link.disconnect();
});
