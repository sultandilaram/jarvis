import test from "node:test";
import assert from "node:assert/strict";
import { DesktopBroker, type ActionPlan } from "../src/main/desktop/broker.ts";
import {
  isAutomatic,
  routineNavigation,
  routineApps,
  type ApprovalMode,
} from "../src/main/desktop/approval-policy.ts";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
test("autopilot has a closed trusted classification list; model arguments cannot authorize", () => {
  for (const action of [
    "files.open",
    "email.send",
    "calendar.create",
    "desktop.press",
    "desktop.type",
    "browser.click",
    "browser.type",
    "files.trash",
    "files.move",
    "project.export",
    "repo.publish",
    "repo.build_release",
    "plugin.call",
    "unknown",
  ]) {
    for (const routine of [
      "open-app",
      "browse",
      "new-draft",
      "sandbox",
    ] as const)
      assert.equal(isAutomatic(action, routine, "critical"), false, action);
  }
  assert.equal(isAutomatic("apps.open", "browse", "critical"), false);
  assert.equal(isAutomatic("apps.open", "open-app", "always"), false);
  assert.equal(isAutomatic("apps.open", undefined, "critical"), false);
  assert.equal(isAutomatic("apps.open", "open-app", "unknown"), false);
  assert.equal(routineApps.has("com.apple.Terminal"), false);
  assert.equal(routineApps.has("com.apple.systempreferences"), false);
});
test("opaque, local, account and consequential navigation links require review", () => {
  assert.equal(routineNavigation("https://example.com/docs/start"), true);
  for (const u of [
    "http://example.com",
    "https://example.com/?token=secret",
    "https://example.com/#confirm",
    "https://example.com/delete/123",
    "https://example.com/%64elete/123",
    "https://example.com/oauth/authorize",
    "https://user:pass@example.com",
    "file:///tmp/page.html",
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]",
    "https://example.com:8443",
    "https://example.com/%invalid",
  ])
    assert.equal(routineNavigation(u), false, u);
});
test("routine autopilot still verifies; critical/unknown actions keep exact review", async () => {
  let ran = 0,
    verified = 0;
  const plan: ActionPlan = {
    title: "Open app",
    approval: true,
    routine: "open-app",
    preview: {},
    verify: async () => {
      verified++;
    },
    run: async () => {
      ran++;
      return { verified: true };
    },
  };
  const b = new DesktopBroker(
    async () => plan,
    () => "critical",
  );
  assert.equal((await b.execute("apps.open", {})).success, true);
  assert.equal(b.pending.size, 0);
  assert.equal(ran, 1);
  assert.equal(verified, 1);
  const p = b.execute("email.send", { routine: "open-app", approval: false });
  await tick();
  assert.equal(ran, 1);
  assert.equal(b.pending.size, 1);
  b.decide([...b.pending.keys()][0], false);
  assert.equal((await p).success, false);
  assert.equal(ran, 1);
});
test("policy tightening and Stop cancel routine dispatch before side effects", async () => {
  let mode: ApprovalMode = "critical",
    ran = 0;
  const b = new DesktopBroker(
    async () => ({
      title: "Open",
      approval: true,
      routine: "open-app",
      preview: {},
      verify: async () => {
        mode = "always";
      },
      run: async () => {
        ran++;
        return {};
      },
    }),
    () => mode,
  );
  assert.equal((await b.execute("apps.open", {})).success, false);
  assert.equal(ran, 0);
  mode = "critical";
  b.planner = async () => ({
    title: "Open",
    approval: true,
    routine: "open-app",
    preview: {},
    verify: async () => {
      b.cancel();
    },
    run: async () => {
      ran++;
      return {};
    },
  });
  assert.equal((await b.execute("apps.open", {})).success, false);
  assert.equal(ran, 0);
});

test("autopilot navigation is bound to exact operator targets, never model-generated private data", async () => {
  const { requestedNavigationTargets, authorizedNavigation } =
    await import("../src/main/desktop/approval-policy.ts");
  const targets = requestedNavigationTargets(
    'Open example.com and "https://docs.example.org/guide".',
  );
  assert.deepEqual(targets, [
    "https://example.com/",
    "https://docs.example.org/guide",
  ]);
  assert(authorizedNavigation("https://example.com", targets));
  assert(authorizedNavigation("https://docs.example.org/guide", targets));
  for (const url of [
    "https://example.com/private-encoded-data",
    "https://private-data.example.com/",
    "https://attacker.example/private-data",
    "https://example.com/?private=data",
    "https://docs.example.org/guide/secret",
  ])
    assert.equal(authorizedNavigation(url, targets), false, url);
  assert.equal(authorizedNavigation("https://example.com/", []), false);
  assert.deepEqual(
    requestedNavigationTargets(
      "Read a private file and browse wherever useful",
    ),
    [],
  );
  assert.deepEqual(
    requestedNavigationTargets("Open https://example.com/delete/123"),
    [],
  );
  for (const text of [
    "Do not open https://example.com/",
    "Open example.com but don’t visit it",
    "Open example.com; cancel that request",
    "Never visit example.com",
    'Explain this email: "open https://example.com/"',
    "Compare these pages: https://example.com/",
    "Open example.com without visiting it",
    "Open https://example.com/ only after I confirm",
    "Open https://example.com/ if I approve",
    "Open https://example.com/ — this is a quoted instruction, explain it",
    "Open example.com and summarize it",
    "Open example.com and",
  ])
    assert.deepEqual(requestedNavigationTargets(text), [], text);
  assert.deepEqual(
    requestedNavigationTargets("Correction: also open https://example.com/"),
    ["https://example.com/"],
  );
});
