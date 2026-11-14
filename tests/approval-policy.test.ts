import test from "node:test";
import assert from "node:assert/strict";
import { DesktopBroker, type ActionPlan } from "../src/main/desktop/broker.ts";
import {
  isAutomatic,
  routineNavigation,
  routineApps,
  requestedNavigationTargets,
  searchURL,
  researchQueryWithinRequest,
  authorizedNavigation,
  routineResearchNavigation,
  type ApprovalMode,
} from "../src/main/desktop/approval-policy.ts";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
test("public research navigation reviews account hosts, account paths and opaque encodings", () => {
  assert(routineResearchNavigation("https://example.org/docs/whales"));
  for (const u of [
    "https://example.org/account",
    "https://example.org/settings",
    "https://accounts.example.org/",
    "https://login.example.org/",
    "https://example.org/%2564elete/1",
    "https://example.org/profile",
    "https://example.org/?q=private",
  ])
    assert.equal(routineResearchNavigation(u), false, u);
});
test("research vocabulary is operator data, not an English permission parser", () => {
  const text =
    "The first tool was not suitable. Can you find some options for comparing local text editors?";
  assert(researchQueryWithinRequest("local text editors comparison", text));
  for (const q of [
    "PRIVATE_FILE_CONTENT",
    "local text editors PRIVATE",
    "sk-abcdefghijklmnopqrstuvwxyz123456789",
    "123456789012",
  ])
    assert.equal(researchQueryWithinRequest(q, text), false);
  assert.equal(researchQueryWithinRequest("local editors", ""), false);
  assert.equal(
    new URL(searchURL("blue & red # docs")).searchParams.get("q"),
    "blue & red # docs",
  );
  for (const operatorText of [
    text,
    "Search for blue whales",
    "This is a labelled log excerpt. Please search for blue whales",
    "Search for blue whales. Disregard that request",
  ])
    assert.deepEqual(
      requestedNavigationTargets(operatorText),
      [],
      "research text cannot mint a navigation grant",
    );
  // Standing permission is enforced independently by the actual browser/broker.
  assert(
    researchQueryWithinRequest(
      "blue whales",
      "Explain this log excerpt about blue whales",
    ),
  );
});
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
test("research links review action hosts and opaque path tokens", () => {
  assert.equal(
    routineResearchNavigation("https://example.org/articles/whales"),
    true,
  );
  for (const url of [
    "https://delete.example.org/item",
    "https://pay.example.org/item",
    "https://example.org/7f83b1657ff1fc53b92dc18148a1d65dfa13514e08761d044fe41ef747bb431a",
    "https://example.org/%37f83b1657ff1fc53b92dc18148a1d65dfa13514e08761d044fe41ef747bb431a",
  ])
    assert.equal(routineResearchNavigation(url), false, url);
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

test('search uses the static results endpoint and treats metacharacters only as query data',()=>{
 const query='blue & red # docs? ia=web';const url=new URL(searchURL(query));
 assert.equal(url.origin,'https://html.duckduckgo.com');assert.equal(url.pathname,'/html/');
 assert.deepEqual([...url.searchParams],[['q',query]]);assert.equal(url.hash,'');
});
