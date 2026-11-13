import test from "node:test";
import assert from "node:assert/strict";
import { PluginCatalog } from "../src/main/extensions/catalog.ts";
function fixture(accounts: any = {}) {
  const values = new Map<string, any>();
  let changes = 0;
  const catalog = new PluginCatalog(
    {
      get: (k, f) => values.get(k) ?? f,
      set: (k, v) => values.set(k, structuredClone(v)),
    },
    () => accounts,
    () => changes++,
  );
  return { catalog, accounts, values, changes: () => changes };
}
test("embedded browser cannot be disabled and external IDs cannot replace built-ins", () => {
  const f = fixture();
  assert.throws(() => f.catalog.set("browser", false), /embedded/);
  assert.throws(() => f.catalog.set("external-id", true), /built-in/);
  assert.equal(f.catalog.enabled("browser"), true);
  assert.deepEqual(
    f.catalog.entries().map((p) => p.kind),
    ["embedded", "built-in", "built-in"],
  );
  assert.equal(f.catalog.entries()[0].required, true);
});
test("Google plugins preserve connected accounts on upgrade but can be disabled independently", () => {
  const f = fixture({
    gmail: { email: "fixture@example.com", write: false },
    calendar: { email: "fixture@example.com", write: true },
  });
  assert(f.catalog.enabled("gmail"));
  assert(f.catalog.enabled("calendar"));
  f.catalog.set("gmail", false);
  assert(!f.catalog.enabled("gmail"));
  assert(f.catalog.enabled("calendar"));
  assert(f.accounts.gmail);
  assert(
    !f.catalog
      .entries()
      .find((p) => p.id === "gmail")!
      .capabilities.includes("email.send"),
  );
  assert(
    f.catalog
      .entries()
      .find((p) => p.id === "calendar")!
      .capabilities.includes("calendar.create"),
  );
  f.catalog.set("gmail", true);
  assert(f.catalog.enabled("gmail"));
});
test("disabled or cancelled plugins cannot be re-enabled by a late OAuth completion", () => {
  for (const operation of ["disable", "cancel"]) {
    const f = fixture(),
      revision = f.catalog.beginConnect("gmail");
    f.catalog.set("gmail", false);
    f.accounts.gmail = { email: "fixture@example.com", write: false };
    f.catalog.finishConnect("gmail", revision);
    assert.equal(f.catalog.enabled("gmail"), false, operation);
  }
  const f = fixture(),
    revision = f.catalog.beginConnect("calendar");
  f.accounts.calendar = { email: "fixture@example.com", write: false };
  f.catalog.finishConnect("calendar", revision);
  assert(f.catalog.enabled("calendar"));
  assert.throws(() => fixture().catalog.set("gmail", true), /Connect/);
});
