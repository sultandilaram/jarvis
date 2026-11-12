import test from "node:test";
import assert from "node:assert/strict";
import {
  permanentTunnel,
  permanentPort,
} from "../src/main/remote/permanent.ts";
const token = Buffer.from(
  JSON.stringify({
    a: "a".repeat(32),
    t: "00000000-0000-4000-8000-000000000001",
    s: "synthetic-connector-secret",
  }),
).toString("base64");
test("permanent connector accepts a public root and never executes copied commands", () => {
  const value = permanentTunnel({
    url: "https://jarvis.example.com",
    token: `cloudflared tunnel run --token ${token}`,
    autoStart: true,
  });
  assert.equal(value.url, "https://jarvis.example.com");
  assert.equal(value.token, token);
  assert.equal(value.port, permanentPort);
  for (const url of [
    "http://example.com",
    "https://user:pass@example.com",
    "https://127.0.0.1",
    "https://localhost",
    "https://foo.local",
    "https://test.trycloudflare.com",
    "https://example.com/path",
    "https://example.com/?token=x",
  ])
    assert.throws(() => permanentTunnel({ url, token }));
  assert.throws(() =>
    permanentTunnel({
      url: "https://jarvis.example.com",
      token: "not-a-connector-token",
    }),
  );
});
