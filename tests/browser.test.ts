import test from "node:test";
import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { registerHooks } from "node:module";
const stub =
  "data:text/javascript," +
  encodeURIComponent(`
import {EventEmitter}from'node:events';export const views=[];export const security={};
const profile={setPermissionRequestHandler(f){security.permission=f},setPermissionCheckHandler(f){security.check=f},on(){}};
export const session={fromPartition(p){security.partition=p;return profile}};
class WC extends EventEmitter{constructor(){super();this.url='about:blank';this.title='Fixture';this.loading=false;this.executions=[];this.dead=false;this.inspection=null;this.navigationHistory={canGoBack:()=>false,canGoForward:()=>false,goBack(){},goForward(){}};}isDestroyed(){return this.dead}getURL(){return this.url}getTitle(){return this.title}isLoading(){return this.loading}setWindowOpenHandler(f){this.openHandler=f}async loadURL(url){this.emit('did-start-navigation',{},url,false,true);this.url=url;this.emit('did-navigate',{},url);return undefined}stop(){}reload(){}close(){this.dead=true;this.emit('destroyed')}async executeJavaScriptInIsolatedWorld(_world,[{code}]){if(this.evaluate)return this.evaluate(code);if(code.includes('const visible=')&&!code.includes('const expectedPage=')){if(this.pendingInspection)await this.pendingInspection;return this.inspection||{url:this.url,title:this.title,text:'Inert fixture',elements:[{id:'0',tag:'BUTTON',type:'',label:'Preview',href:'',value:'',sensitive:false}]};}this.executions.push(code);return {dispatched:true};}}
export class WebContentsView{constructor(options){this.options=options;this.webContents=new WC();this.visible=false;views.push(this)}setBounds(b){this.bounds=b}setVisible(v){this.visible=v}}
`);
const hook = registerHooks({
  resolve(s, c, next) {
    return s === "electron" ? { url: stub, shortCircuit: true } : next(s, c);
  },
});
const { ControlledBrowser, sensitiveBrowserURL, validBrowserBounds } =
  await import("../src/main/desktop/browser.ts");
const { DesktopBroker } = await import("../src/main/desktop/broker.ts");
const fake = await import(stub);
const tick = () => new Promise<void>((r) => setImmediate(r));
function fixture() {
  const start = fake.views.length,
    browser = new ControlledBrowser();
  browser.taskKey = () => "fixture-task";
  browser.navigationTargets = () => ["https://example.com/first"];
  const broker = new DesktopBroker(
    (a, args) => browser.plan(a, args),
    () => "critical",
  );
  return { browser, broker, views: () => fake.views.slice(start) };
}
const result = (r: any) =>
  JSON.parse(r.contentItems.find((i: any) => i.type === "inputText").text);
test("public research defaults to exact review and model arguments cannot enable it", async () => {
  const f = fixture();
  try {
    f.browser.researchText = () => "Explain a log excerpt about blue whales";
    const pending = f.broker.execute("browser.search", {
      query: "blue whales",
      publicResearchEnabled: true,
      researchText: "blue whales",
    });
    await tick();
    assert.equal(f.broker.pending.size, 1);
    assert.equal(f.views()[0].webContents.getURL(), "about:blank");
    f.broker.decide([...f.broker.pending.keys()][0], false);
    assert.equal((await pending).success, false);
    f.browser.publicResearchAllowed = () => true;
    assert(
      (await f.broker.execute("browser.search", { query: "blue whales" }))
        .success,
    );
  } finally {
    f.browser.destroy();
  }
});
test("labelled credentials cannot enter automatic searches even without their label", async () => {
  for (const [request, query] of [
    ["My password is hunter2. Research blue whales", "hunter2"],
    ["My password is hunter2. Research blue whales", "password hunter2"],
    ["My API key is demo-secret. Research blue whales", "demo-secret"],
    ["My API key is demo-secret. Research blue whales", "api key demo-secret"],
    ...[
      "session token",
      "backup codes",
      "backupCodes",
      "passcode",
      "passcodes",
      "recovery seed",
      "recoveryPhrase",
      "unlock phrase",
      "security answer",
      "keys",
      "ssh",
      "wallet phrase",
      "TOTP",
      "MFA",
      "2FA",
      "PINs",
      "JWTs",
      "signing material",
      "connection URI",
      "session_token",
      "AuthorizationHeader",
      "Authorization: Bearer",
      "accessToken",
      "sessionToken",
      "Cookie",
      "refresh token",
      "password",
      "passwd",
      "passphrase",
      "credential",
      "secret",
      "signature",
      "assertion",
      "SAML",
      "CSRF",
      "XSRF",
      "ticket",
      "nonce",
      "API key",
      "access key",
      "private key",
      "auth code",
      "verification code",
      "one time code",
      "connection string",
      "database URL",
      "recovery phrase",
      "seed phrase",
      "mnemonic",
      "OTP",
      "PIN",
      "pwd",
      "SID",
      "sig",
      "JWT",
      "PEM",
      "DSN",
      "oobcode",
    ].map((label) => [
      "My " + label + " is demoabc123. Research blue whales",
      "demoabc123",
    ]),
  ]) {
    const f = fixture();
    try {
      f.browser.publicResearchAllowed = () => true;
      f.browser.researchText = () => request;
      const pending = f.broker.execute("browser.search", { query });
      await tick();
      assert.equal(f.broker.pending.size, 1);
      assert.equal(f.views()[0].webContents.getURL(), "about:blank");
      f.broker.decide([...f.broker.pending.keys()][0], false);
      assert.equal((await pending).success, false);
    } finally {
      f.browser.destroy();
    }
  }
});
test("explicit searches run without approval only in Autopilot and use fresh task tabs", async () => {
  const f = fixture();
  try {
    const { requestedNavigationTargets, searchURL } =
      await import("../src/main/desktop/approval-policy.ts");
    let request = "Search for blue whales";
    f.browser.researchText = () => request;
    f.browser.publicResearchAllowed = () => true;
    const manual = f.browser.create(true);
    await f.browser.navigate(manual, "https://example.com/draft");
    const r = await f.broker.execute("browser.search", {
      query: "blue whales",
    });
    assert(r.success);
    assert.equal(f.broker.pending.size, 0);
    assert.equal(
      f.views()[0].webContents.getURL(),
      "https://example.com/draft",
    );
    assert.equal(f.views()[1].webContents.getURL(), searchURL("blue whales"));
    assert(f.browser.state().tabs.find((t) => t.id === manual)!.manual);
    for (const query of ["private-file-contents", "blue whales PRIVATE"]) {
      const pending = f.broker.execute("browser.search", { query });
      await tick();
      assert.equal(f.broker.pending.size, 1);
      f.broker.decide([...f.broker.pending.keys()][0], false);
      assert.equal((await pending).success, false);
      assert.equal(f.views().at(-1)!.webContents.getURL(), "about:blank");
    }
    const always = new DesktopBroker(
      (a, args) => f.browser.plan(a, args),
      () => "always",
    );
    const pending = always.execute("browser.search", { query: "blue whales" });
    await tick();
    assert.equal(always.pending.size, 1);
    always.decide([...always.pending.keys()][0], false);
    assert.equal((await pending).success, false);
    const plan = await f.browser.plan("browser.search", {
      query: "blue whales",
    });
    request = "";
    await assert.rejects(plan.verify!(), /authority changed/);
    await assert.rejects(
      plan.run(new AbortController().signal),
      /authority changed/,
    );
    assert.equal(f.views().at(-1)!.webContents.getURL(), "about:blank");
    request = "Search for blue whales";
    const stopped = await f.browser.plan("browser.search", {
      query: "blue whales",
    });
    await stopped.verify!();
    f.browser.stop();
    await assert.rejects(stopped.run(new AbortController().signal));
    assert.equal(f.views().at(-1)!.webContents.getURL(), "about:blank");
  } finally {
    f.browser.destroy();
  }
});
test("research follows only observed public links and loses authority on takeover or Stop", async () => {
  const f = fixture();
  try {
    const { requestedNavigationTargets } =
      await import("../src/main/desktop/approval-policy.ts");
    f.browser.researchText = () => "Search for blue whales";
    f.browser.publicResearchAllowed = () => true;
    const searched = result(
      await f.broker.execute("browser.search", { query: "blue whales" }),
    );
    const source = f.views()[0].webContents;
    source.inspection = {
      url: source.url,
      title: "Results",
      text: "Public research",
      elements: [
        {
          id: "0",
          tag: "A",
          type: "",
          label: "Source",
          href: "https://example.org/whales",
          value: "",
          sensitive: false,
        },
        {
          id: "1",
          tag: "A",
          type: "",
          label: "Action",
          href: "https://example.org/delete/1",
          value: "",
          sensitive: false,
        },
        {
          id: "2",
          tag: "BUTTON",
          type: "submit",
          label: "Submit",
          href: "",
          value: "",
          sensitive: false,
        },
      ],
    };
    const read = result(
      await f.broker.execute("browser.read", { tabId: searched.tabId }),
    );
    const followed = await f.broker.execute("browser.follow", {
      snapshotId: read.snapshotId,
      elementId: "0",
    });
    assert(followed.success);
    assert.equal(f.broker.pending.size, 0);
    assert.equal(
      f.views()[1].webContents.getURL(),
      "https://example.org/whales",
    );
    assert(source.url.includes("duckduckgo.com"));
    for (const elementId of ["2", "3"])
      assert.equal(
        (
          await f.broker.execute("browser.follow", {
            snapshotId: read.snapshotId,
            elementId,
          })
        ).success,
        false,
      );
    const critical = f.broker.execute("browser.follow", {
      snapshotId: read.snapshotId,
      elementId: "1",
    });
    await tick();
    assert.equal(f.broker.pending.size, 1);
    f.broker.decide([...f.broker.pending.keys()][0], false);
    assert.equal((await critical).success, false);
    const stale = await f.browser.plan("browser.follow", {
      snapshotId: read.snapshotId,
      elementId: "0",
    });
    f.browser.takeControl(searched.tabId);
    await assert.rejects(stale.run(new AbortController().signal));
    assert.equal(f.views().at(-1)!.webContents.getURL(), "about:blank");
    assert.equal(
      (
        await f.broker.execute("browser.follow", {
          snapshotId: read.snapshotId,
          elementId: "0",
        })
      ).success,
      false,
    );
    const manual = f.browser.create(true);
    await f.browser.navigate(manual, "https://example.net/read");
    await f.browser.resume(manual);
    const w = f.views().at(-1)!.webContents;
    w.inspection = { ...source.inspection, url: w.url };
    const ownerRead = result(
      await f.broker.execute("browser.read", { tabId: manual }),
    );
    const ownerFollow = f.broker.execute("browser.follow", {
      snapshotId: ownerRead.snapshotId,
      elementId: "0",
    });
    await tick();
    assert.equal(f.broker.pending.size, 1);
    f.broker.decide([...f.broker.pending.keys()][0], false);
    assert.equal((await ownerFollow).success, false);
    f.browser.stop();
    assert.equal(
      (
        await f.broker.execute("browser.follow", {
          snapshotId: ownerRead.snapshotId,
          elementId: "0",
        })
      ).success,
      false,
    );
  } finally {
    f.browser.destroy();
  }
});
test("observed opaque and action-host links still require exact review", async () => {
  for (const href of [
    "https://delete.example.org/item",
    "https://example.org/7f83b1657ff1fc53b92dc18148a1d65dfa13514e08761d044fe41ef747bb431a",
  ]) {
    const f = fixture();
    try {
      f.browser.researchText = () => "Research blue whales";
      f.browser.publicResearchAllowed = () => true;
      const root = result(
        await f.broker.execute("browser.search", { query: "blue whales" }),
      );
      const w = f.views()[0].webContents;
      w.inspection = {
        url: w.url,
        title: "Public",
        text: "Public",
        elements: [
          {
            id: "0",
            tag: "A",
            type: "",
            label: "Result",
            href,
            value: "",
            sensitive: false,
          },
        ],
      };
      const read = result(
        await f.broker.execute("browser.read", { tabId: root.tabId }),
      );
      const pending = f.broker.execute("browser.follow", {
        snapshotId: read.snapshotId,
        elementId: "0",
      });
      await tick();
      assert.equal(f.broker.pending.size, 1, href);
      assert.equal(f.views().at(-1)!.webContents.getURL(), "about:blank");
      f.broker.decide([...f.broker.pending.keys()][0], false);
      assert.equal((await pending).success, false);
    } finally {
      f.browser.destroy();
    }
  }
});
test("descendant research cannot survive ancestor revocation, unrelated navigation or grant renewal", async () => {
  const { requestedNavigationTargets } =
    await import("../src/main/desktop/approval-policy.ts");
  for (const revoke of [
    "takeover",
    "close",
    "input",
    "open",
    "grants",
    "epoch",
    "permission",
    "stop",
  ]) {
    const f = fixture();
    try {
      let request = "Search for blue whales",
        epoch = 1,
        enabled = true;
      f.browser.researchText = () => request;
      f.browser.publicResearchAllowed = () => enabled;
      f.browser.researchEpoch = () => epoch;
      const root = result(
        await f.broker.execute("browser.search", { query: "blue whales" }),
      );
      const rootWC = f.views()[0].webContents;
      const page = (url: string) => ({
        url,
        title: "Public research",
        text: "Inert",
        elements: [
          {
            id: "0",
            tag: "A",
            type: "",
            label: "Source",
            href: "https://example.org/child",
            value: "",
            sensitive: false,
          },
          {
            id: "1",
            tag: "INPUT",
            type: "text",
            label: "Draft",
            href: "",
            value: "Initial",
            sensitive: false,
          },
        ],
      });
      rootWC.inspection = page(rootWC.url);
      const rootRead = result(
        await f.broker.execute("browser.read", { tabId: root.tabId }),
      );
      const child = result(
        await f.broker.execute("browser.follow", {
          snapshotId: rootRead.snapshotId,
          elementId: "0",
        }),
      );
      const childWC = f.views()[1].webContents;
      childWC.inspection = page(childWC.url);
      const childRead = result(
        await f.broker.execute("browser.read", { tabId: child.tabId }),
      );
      const prepared = await f.browser.plan("browser.follow", {
        snapshotId: childRead.snapshotId,
        elementId: "0",
      });
      await prepared.verify!();
      if (revoke === "takeover") f.browser.takeControl(root.tabId);
      if (revoke === "close") f.browser.close(root.tabId);
      if (revoke === "input" || revoke === "open") {
        const pending =
          revoke === "input"
            ? f.broker.execute("browser.type", {
                snapshotId: rootRead.snapshotId,
                elementId: "1",
                text: "Owner draft",
              })
            : f.broker.execute("browser.open", {
                tabId: child.tabId,
                url: "https://unrelated.example/read",
              });
        await tick();
        assert.equal(f.broker.pending.size, 1);
        f.broker.decide([...f.broker.pending.keys()][0], true);
        assert((await pending).success);
        if (revoke === "input") assert(rootWC.executions.length > 0);
      }
      if (revoke === "grants") request = "";
      if (revoke === "epoch") {
        request = "";
        epoch++;
        request = "Search for blue whales";
      }
      if (revoke === "permission") enabled = false;
      if (revoke === "stop") f.browser.stop();
      await assert.rejects(
        prepared.run(new AbortController().signal),
        /./,
        revoke,
      );
      assert.equal(f.views()[2].webContents.getURL(), "about:blank", revoke);
      let snapshotId = childRead.snapshotId;
      if (revoke === "open") {
        childWC.inspection = page(childWC.url);
        snapshotId = result(
          await f.broker.execute("browser.read", { tabId: child.tabId }),
        ).snapshotId;
      }
      const retried = f.broker.execute("browser.follow", {
        snapshotId,
        elementId: "0",
      });
      await tick();
      if (f.broker.pending.size)
        f.broker.decide([...f.broker.pending.keys()][0], false);
      assert.equal((await retried).success, false, revoke);
    } finally {
      f.browser.destroy();
    }
  }
});
test("awaited search and follow cannot restore research after takeover/handover or unrelated navigation", async () => {
  for (const action of ["browser.search", "browser.follow"])
    for (const revoke of [
      "takeover-resume",
      "unrelated-open",
      "renderer-navigation",
      "same-url-reload",
      "in-page",
      "redirect-commit",
      "redirect-roundtrip",
      "redirect-will",
    ]) {
      const f = fixture();
      try {
        f.browser.researchText = () => "Research blue whales";
        f.browser.publicResearchAllowed = () => true;
        let args: Record<string, unknown> = { query: "blue whales" };
        if (action === "browser.follow") {
          const root = result(await f.broker.execute("browser.search", args));
          const w = f.views()[0].webContents;
          w.inspection = {
            url: w.url,
            title: "Public",
            text: "Public",
            elements: [
              {
                id: "0",
                tag: "A",
                type: "",
                label: "Source",
                href: "https://example.org/article",
                value: "",
                sensitive: false,
              },
            ],
          };
          const read = result(
            await f.broker.execute("browser.read", { tabId: root.tabId }),
          );
          args = { snapshotId: read.snapshotId, elementId: "0" };
        }
        const plan = await f.browser.plan(action, args),
          tab = f.browser.state().tabs.at(-1)!,
          w = f.views().at(-1)!.webContents,
          load = w.loadURL.bind(w);
        let once = false;
        w.loadURL = async (url: string) => {
          await load(url);
          if (once) return;
          once = true;
          if (
            revoke === "renderer-navigation" ||
            revoke === "same-url-reload"
          ) {
            await load(
              revoke === "same-url-reload"
                ? url
                : "https://unrelated.example/article",
            );
          } else if (revoke === "in-page") {
            w.url = url + "#owner";
            w.emit("did-navigate-in-page", {}, w.url, true);
          } else if (revoke === "redirect-roundtrip") {
            w.emit(
              "did-redirect-navigation",
              {},
              "https://unrelated.example/article",
              false,
              true,
            );
            w.emit("did-redirect-navigation", {}, url, false, true);
          } else if (revoke === "redirect-will") {
            let blocked = false;
            w.emit(
              "will-redirect",
              {
                preventDefault() {
                  blocked = true;
                },
              },
              "https://unrelated.example/article",
              false,
              true,
            );
            assert.equal(blocked, true);
          } else if (revoke === "redirect-commit") {
            w.url = "https://redirected.example/article";
            w.emit("did-navigate", {}, w.url);
          } else if (revoke === "takeover-resume") {
            f.browser.takeControl(tab.id);
            await f.browser.resume(tab.id);
          } else {
            const other = await f.browser.plan("browser.open", {
              tabId: tab.id,
              url: "https://unrelated.example/article",
            });
            await other.run(new AbortController().signal);
          }
        };
        await assert.rejects(plan.run(new AbortController().signal));
        w.inspection = {
          url: w.url,
          title: "Public",
          text: "Public",
          elements: [
            {
              id: "0",
              tag: "A",
              type: "",
              label: "Source",
              href: "https://example.org/next",
              value: "",
              sensitive: false,
            },
          ],
        };
        const current = result(
          await f.broker.execute("browser.read", { tabId: tab.id }),
        );
        const attempt = f.broker.execute("browser.follow", {
          snapshotId: current.snapshotId,
          elementId: "0",
        });
        await tick();
        assert.equal(f.broker.pending.size, 1);
        f.broker.decide([...f.broker.pending.keys()][0], false);
        assert.equal((await attempt).success, false);
      } finally {
        f.browser.destroy();
      }
    }
});
test("revocation before renderer entry prevents input, navigation and tab closure", async () => {
  for (const action of [
    "browser.click",
    "browser.type",
    "browser.open",
    "browser.close_tab",
  ]) {
    for (const revoke of ["none", "stop", "takeover"]) {
      let blocked = 0;
      for (let hops = 0; hops < (revoke === "none" ? 1 : 14); hops++) {
        const f = fixture(),
          trace: string[] = [];
        try {
          const id = f.browser.create(false),
            w = f.views()[0].webContents;
          await w.loadURL("https://example.com/form");
          const needsSnapshot =
            action === "browser.click" || action === "browser.type";
          const revokeNow = () => {
            if (
              revoke === "takeover" &&
              !f.browser.state().tabs.some((t) => t.id === id)
            )
              return;
            trace.push("revocation");
            if (revoke === "stop") {
              f.broker.cancel();
              f.browser.stop();
            } else f.browser.takeControl(id);
          };
          const schedule = (remaining: number) =>
            queueMicrotask(() =>
              remaining ? schedule(remaining - 1) : revokeNow(),
            );
          let inspections = 0;
          w.evaluate = async (code: string) => {
            if (code.includes("const expectedPage=")) {
              trace.push("mutation");
              return { dispatched: true };
            }
            if (++inspections === 3 && needsSnapshot && revoke !== "none")
              schedule(hops);
            return {
              url: w.url,
              title: w.title,
              text: "Inert fixture",
              elements: [
                {
                  id: "0",
                  tag: "INPUT",
                  type: "text",
                  label: "Comment",
                  href: "",
                  value: "",
                  sensitive: false,
                },
              ],
            };
          };
          const load = w.loadURL.bind(w),
            close = w.close.bind(w);
          w.loadURL = (...args: any[]) => {
            trace.push("mutation");
            return load(...args);
          };
          w.close = () => {
            trace.push("mutation");
            return close();
          };
          const page = needsSnapshot ? await f.browser.read(id) : undefined;
          f.broker.on("approval", (a) => {
            f.broker.decide(a.id, true);
            if (!needsSnapshot && revoke !== "none") schedule(hops);
          });
          const response = await f.broker.execute(
            action,
            needsSnapshot
              ? {
                  snapshotId: page!.snapshotId,
                  elementId: "0",
                  ...(action === "browser.type" ? { text: "Blue" } : {}),
                }
              : {
                  tabId: id,
                  ...(action === "browser.open"
                    ? { url: "https://example.com/next" }
                    : {}),
                },
          );
          await tick();
          const revocation = trace.indexOf("revocation"),
            mutation = trace.indexOf("mutation");
          if (revoke === "none") {
            assert.equal(response.success, true, action);
            assert.equal(mutation, 0, action);
          } else if (
            revocation >= 0 &&
            (mutation < 0 || revocation < mutation)
          ) {
            assert.equal(mutation, -1, `${action}/${revoke}/${hops}: ${trace}`);
            assert.equal(response.success, false);
            blocked++;
          }
          // Calls already dispatched before revocation may finish; they cannot be undone.
        } finally {
          f.browser.destroy();
        }
      }
      if (revoke !== "none")
        assert(
          blocked > 0,
          `${action}/${revoke} must exercise pre-dispatch revocation`,
        );
    }
  }
});
test("tab discovery and control previews withhold uninspected page metadata", async () => {
  for (const kind of ["visible-link", "current-url", "password", "manual"]) {
    const f = fixture();
    try {
      const id = f.browser.create(false),
        w = f.views()[0].webContents;
      const nested = "https:user:FAKE-CREDENTIAL;tail@example.com/";
      await w.loadURL(
        "https://example.com/FAKE-CREDENTIAL" +
          (kind === "current-url" ? "?next=" + nested : ""),
      );
      w.title = "FAKE-CREDENTIAL";
      const control = {
        href:
          kind === "visible-link" ? "https://example.com/?next=" + nested : "",
        type: kind === "password" ? "password" : "",
        name: "",
        id: "fixture",
        autocomplete: "",
        labels: [],
        innerText: "Destination",
        getClientRects: () => [{}],
        getAttribute: () => null,
      };
      const context = createContext({
        URL,
        URLSearchParams,
        document: {
          querySelectorAll: () => [control],
          body: { innerText: "PRIVATE-PAGE-TEXT" },
          title: w.title,
        },
        location: { href: w.url },
        getComputedStyle: () => ({ visibility: "visible" }),
      });
      w.evaluate = (code: string) => runInContext(code, context);
      if (kind === "manual") f.browser.takeControl(id);
      const activity: any[] = [];
      f.broker.on("activity", (e) => activity.push(e));
      const surfaces: any[] = [await f.broker.execute("browser.tabs", {})];
      if (!f.browser.state().tabs[0].manual)
        surfaces.push(
          (await f.browser.plan("browser.close_tab", { tabId: id })).preview,
        );
      surfaces.push(
        (await f.browser.plan("browser.request_control", { tabId: id }))
          .preview,
      );
      const read = await f.broker.execute("browser.read", { tabId: id });
      assert.equal(read.success, false);
      surfaces.push(read, await f.broker.execute("browser.tabs", {}));
      w.title = "Changed FAKE-CREDENTIAL";
      surfaces.push(
        (await f.browser.plan("browser.request_control", { tabId: id }))
          .preview,
      );
      surfaces.push(activity);
      assert(!JSON.stringify(surfaces).includes("FAKE-CREDENTIAL"), kind);
      assert(!JSON.stringify(surfaces).includes("PRIVATE-PAGE-TEXT"), kind);
      assert.equal(f.browser.agentTabs()[0].url, "https://example.com");
      assert(f.browser.state().tabs[0].title.includes("FAKE-CREDENTIAL"));
      assert(f.browser.state().tabs[0].url.includes("FAKE-CREDENTIAL"));
    } finally {
      f.browser.destroy();
    }
  }
});
test("the actual DOM guard inspects sensitive controls beyond the actionable target limit", async () => {
  const variants: ({
    type?: string;
    name?: string;
    autocomplete?: string;
    placeholder?: string;
    ariaLabelledBy?: string;
    labels?: { innerText: string }[];
  } | null)[] = [
    null,
    { type: "password" },
    { name: "api_key" },
    { autocomplete: "section-billing cc-number" },
    { placeholder: "Enter API key" },
    { ariaLabelledBy: "field-label" },
    { labels: [{ innerText: "Security code" }] },
  ];
  for (const ordinaryCount of [149, 150, 300, 10000])
    for (const secret of variants) {
      const f = fixture();
      try {
        const id = f.browser.create(true),
          w = f.views()[0].webContents;
        await w.loadURL("https://example.com/form");
        const controls = Array.from({ length: ordinaryCount + 1 }, (_, i) => ({
          tagName: i === ordinaryCount ? "INPUT" : "BUTTON",
          type: i === ordinaryCount ? secret?.type || "text" : "",
          name: i === ordinaryCount ? secret?.name || "" : "",
          id: String(i),
          autocomplete: i === ordinaryCount ? secret?.autocomplete || "" : "",
          labels: i === ordinaryCount ? secret?.labels || [] : [],
          innerText: "Ordinary control",
          value: i === ordinaryCount && secret ? "FAKE-CREDENTIAL" : "",
          getClientRects: () => [{}],
          getAttribute: (key: string) =>
            i === ordinaryCount && key === "placeholder"
              ? secret?.placeholder || null
              : i === ordinaryCount && key === "aria-labelledby"
                ? secret?.ariaLabelledBy || null
                : null,
        }));
        const context = createContext({
          document: {
            querySelectorAll: () => controls,
            getElementById: (id: string) =>
              id === "field-label" ? { innerText: "API key" } : null,
            body: { innerText: "PRIVATE-PAGE-TEXT" },
            title: "Fixture",
          },
          location: { href: w.url },
          getComputedStyle: () => ({ visibility: "visible" }),
        });
        w.evaluate = (code: string) => runInContext(code, context);
        if (secret || ordinaryCount >= 10000) {
          await assert.rejects(
            f.browser.resume(id),
            /sensitive controls|inspection limits/,
          );
          assert.equal(f.browser.state().tabs[0].manual, true);
          const read = await f.broker.execute("browser.read", { tabId: id });
          assert.equal(read.success, false);
          assert(!JSON.stringify(read).includes("PRIVATE-PAGE-TEXT"));
          assert(!JSON.stringify(read).includes("FAKE-CREDENTIAL"));
        } else {
          await f.browser.resume(id);
          const read = await f.browser.read(id);
          assert.equal(read.elements.length, 150);
          assert.equal(read.text, "PRIVATE-PAGE-TEXT");
        }
      } finally {
        f.browser.destroy();
      }
    }
});
test("Stop during page inspection cannot publish a fresh snapshot or complete owner handover", async () => {
  for (const handover of [false, true]) {
    const f = fixture();
    try {
      const id = f.browser.create(handover);
      const w = f.views()[0].webContents;
      await w.loadURL("https://example.com/first");
      let release!: () => void;
      w.pendingInspection = new Promise<void>((r) => {
        release = r;
      });
      const operation = handover ? f.browser.resume(id) : f.browser.read(id);
      const rejected = assert.rejects(operation, /changed/);
      await tick();
      f.browser.stop();
      release();
      await rejected;
      if (handover) assert.equal(f.browser.state().tabs[0].manual, true);
      assert.equal(w.executions.length, 0);
    } finally {
      f.browser.destroy();
    }
  }
});
test("atomic browser dispatch rechecks credential controls and still permits unchanged benign input", async () => {
  for (const change of ["none", "new-field", "password", "title"]) {
    const f = fixture();
    try {
      const id = f.browser.create(false),
        w = f.views()[0].webContents;
      await w.loadURL("https://example.com/form");
      let events = 0;
      class Input {
        tagName = "INPUT";
        type = "text";
        id = "comment";
        name = "comment";
        autocomplete = "";
        labels: any[] = [];
        innerText = "";
        stored = "";
        isConnected = true;
        declare value: string;
        getClientRects() {
          return [{}];
        }
        getAttribute() {
          return null;
        }
        dispatchEvent() {
          events++;
        }
      }
      Object.defineProperty(Input.prototype, "value", {
        get() {
          return this.stored;
        },
        set(v) {
          this.stored = v;
        },
      });
      const field = new Input(),
        controls = [field];
      const context = createContext({
        document: {
          querySelectorAll: () => controls,
          body: { innerText: "Inert fixture" },
          title: "Fixture",
        },
        location: { href: w.url },
        getComputedStyle: () => ({ visibility: "visible" }),
        HTMLInputElement: Input,
        Event: class {},
      });
      w.evaluate = (code: string) => {
        if (code.includes("const expected=")) {
          if (change === "password") field.type = "password";
          if (change === "title") context.document.title = "Changed page";
          if (change === "new-field") {
            const password = new Input();
            password.type = "password";
            password.id = "secret";
            controls.push(password);
          }
        }
        return runInContext(code, context);
      };
      const read = await f.browser.read(id);
      const pending = f.broker.execute("browser.type", {
        snapshotId: read.snapshotId,
        elementId: "0",
        text: "FAKE-INPUT",
      });
      await tick();
      f.broker.decide([...f.broker.pending.keys()][0], true);
      assert.equal((await pending).success, change === "none");
      assert.equal(field.value, change === "none" ? "FAKE-INPUT" : "");
      assert.equal(events, change === "none" ? 2 : 0);
      if (change === "new-field" || change === "password")
        assert.equal(f.browser.state().tabs[0].manual, true);
    } finally {
      f.browser.destroy();
    }
  }
});
test("credential query and fragment parameters remain manual without leaking their values", async () => {
  const f = fixture();
  try {
    const id = f.browser.create(true);
    for (const key of [
      "api_key",
      "API-KEY",
      "key",
      "auth",
      "session_id",
      "PHPSESSID",
      "jwt",
      "signature",
      "X-Amz-Credential",
      "SAMLResponse",
    ])
      for (const prefix of ["?", "#"]) {
        const url =
          "https://example.com/form" +
          prefix +
          encodeURIComponent(key) +
          "=FAKE-CREDENTIAL?view=summary";
        assert(sensitiveBrowserURL(url), key);
        await f.browser.navigate(id, url);
        await assert.rejects(
          f.browser.resume(id),
          /Sign-in, credential and payment/,
        );
        const read = await f.broker.execute("browser.read", { tabId: id });
        assert.equal(read.success, false);
        assert(!JSON.stringify(read).includes("FAKE-CREDENTIAL"));
      }
    assert(
      !sensitiveBrowserURL("https://example.com/search?q=auth+token&page=2"),
    );
    assert(!sensitiveBrowserURL("https://example.com/articles?author=Sultan"));
    assert(sensitiveBrowserURL("https://fixture:FAKE-CREDENTIAL@example.com/"));
  } finally {
    f.browser.destroy();
  }
});
test("a credential-bearing visible link blocks inspection before labels, URLs or page text can leak", async () => {
  const f = fixture();
  try {
    const id = f.browser.create(true),
      w = f.views()[0].webContents;
    await w.loadURL("https://example.com/account");
    const link = {
      tagName: "A",
      type: "",
      name: "",
      id: "download",
      autocomplete: "",
      innerText: "FAKE-CREDENTIAL",
      href: "https://example.com/file?api_key=FAKE-CREDENTIAL",
      getClientRects: () => [{}],
      getAttribute: () => null,
    };
    const context = createContext({
      document: {
        querySelectorAll: () => [link],
        body: { innerText: "FAKE-CREDENTIAL" },
        title: "Fixture",
      },
      location: { href: w.url },
      URL,
      URLSearchParams,
      getComputedStyle: () => ({ visibility: "visible" }),
    });
    w.evaluate = (code: string) => runInContext(code, context);
    await assert.rejects(f.browser.resume(id), /sensitive controls/);
    const read = await f.broker.execute("browser.read", { tabId: id });
    assert.equal(read.success, false);
    assert(!JSON.stringify(read).includes("FAKE-CREDENTIAL"));
  } finally {
    f.browser.destroy();
  }
});
test("browser tabs share an isolated session; visible tab switches cannot retarget a reviewed action", async () => {
  const f = fixture();
  try {
    const opened = await f.broker.execute("browser.open", {
      url: "https://example.com/first",
    });
    assert(opened.success);
    const first = result(opened);
    const manual = f.browser.create(true);
    f.browser.activate(manual);
    assert.equal(f.browser.state().activeTabId, manual);
    const read = result(await f.broker.execute("browser.read", {}));
    assert.equal(read.tabId, first.tabId);
    assert.equal(
      (
        await f.broker.execute("browser.click", {
          snapshotId: read.snapshotId,
          tabId: manual,
          elementId: "0",
        })
      ).success,
      false,
    );
    const pending = f.broker.execute("browser.click", {
      snapshotId: read.snapshotId,
      elementId: "0",
    });
    await tick();
    assert.equal(f.broker.pending.size, 1);
    assert.equal(f.views()[0].webContents.executions.length, 0);
    f.broker.decide([...f.broker.pending.keys()][0], true);
    assert.equal((await pending).success, true);
    assert.equal(f.views()[0].webContents.executions.length, 1);
    assert.equal(f.views()[1].webContents.executions.length, 0);
    assert.equal(fake.security.partition, "persist:jarvis-controlled-browser");
    assert.equal(fake.security.check(), false);
    let allowed = true;
    fake.security.permission(null, null, (value: boolean) => (allowed = value));
    assert.equal(allowed, false);
    const options = f.views()[0].options.webPreferences;
    assert.equal(options.nodeIntegration, false);
    assert.equal(options.sandbox, true);
    assert.equal(options.contextIsolation, true);
    assert.equal(options.webSecurity, true);
  } finally {
    f.browser.destroy();
  }
});
test("manual takeover, closure and Stop invalidate exact tab snapshots without replay", async () => {
  for (const change of ["manual", "close", "stop"]) {
    const f = fixture();
    try {
      const read = result(
        await f.broker.execute("browser.open", {
          url: "https://example.com/first",
        }),
      );
      const pending = f.broker.execute("browser.click", {
        snapshotId: read.snapshotId,
        elementId: "0",
      });
      await tick();
      if (change === "manual") f.browser.takeControl(read.tabId);
      else if (change === "close") f.browser.close(read.tabId);
      else f.browser.stop();
      f.broker.decide([...f.broker.pending.keys()][0], true);
      assert.equal((await pending).success, false);
      assert.equal(f.views()[0].webContents.executions.length, 0);
      if (change === "close")
        assert.doesNotThrow(() => f.views()[0].webContents.emit("focus"));
    } finally {
      f.browser.destroy();
    }
  }
});
test("sensitive pages and owner tabs need manual handover; credentials never enter tool output", async () => {
  const f = fixture();
  try {
    const manual = f.browser.create(true);
    await f.browser.navigate(
      manual,
      "https://example.com/login?code=fixture-secret",
    );
    const response = await f.broker.execute("browser.read", { tabId: manual });
    assert.equal(response.success, false);
    assert(!JSON.stringify(response).includes("fixture-secret"));
    assert(
      sensitiveBrowserURL("https://example.com/callback?code=fixture-secret"),
    );
    assert(!sensitiveBrowserURL("https://example.com/articles"));
    for (const hash of [
      "#access_token=fake-secret",
      "#/callback?code=fake-secret",
      "#token=fake-secret",
      "#/login",
      "#access%5Ftoken=fake-secret",
      "#access_token%3Dfake-secret",
      "#access_token=FAKE?view=summary",
      "#/route?api_key=FAKE?view=summary",
    ])
      assert(sensitiveBrowserURL("https://example.com/" + hash));
    assert(!sensitiveBrowserURL(""));
    const proposed = f.broker.execute("browser.request_control", {
      tabId: manual,
    });
    await tick();
    f.broker.decide([...f.broker.pending.keys()][0], true);
    assert.equal((await proposed).success, false);
    assert(f.browser.state().tabs[0].manual);
  } finally {
    f.browser.destroy();
  }
});
test("native page surfaces stay inside the reserved browser area and hide for owner review", () => {
  const f = fixture();
  try {
    const id = f.browser.create(true);
    let attached: any;
    f.browser.owner = () =>
      ({
        isDestroyed: () => false,
        getContentBounds: () => ({ width: 1280, height: 900 }),
        contentView: {
          addChildView(v: any) {
            attached = v;
          },
          removeChildView() {
            attached = null;
          },
        },
      }) as any;
    f.browser.canEmbed = () => true;
    f.browser.surface(true);
    f.browser.layout({ x: 72, y: 180, width: 1000, height: 600 });
    assert.equal(f.views()[0].visible, true);
    assert(attached);
    f.browser.surface(false);
    assert.equal(f.views()[0].visible, false);
    assert.equal(attached, null);
    assert.throws(
      () => f.browser.layout({ x: 0, y: 0, width: 1280, height: 900 }),
      /bounds/,
    );
    assert.equal(
      validBrowserBounds(
        { x: 72, y: 180, width: 2000, height: 600 },
        { width: 1280, height: 900 },
      ),
      false,
    );
    f.browser.activate(id);
  } finally {
    f.browser.destroy();
  }
});
test("Autopilot reviews navigation of an existing tab, even to an explicitly requested URL", async () => {
  const f = fixture();
  try {
    const first = result(
      await f.broker.execute("browser.open", {
        url: "https://example.com/first",
      }),
    );
    const pending = f.broker.execute("browser.open", {
      tabId: first.tabId,
      url: "https://example.com/first",
    });
    await tick();
    assert.equal(f.broker.pending.size, 1);
    f.broker.decide([...f.broker.pending.keys()][0], false);
    assert.equal((await pending).success, false);
  } finally {
    f.browser.destroy();
  }
});
test("isolated project jobs cannot list, create, inspect or mutate browser sessions", async () => {
  const f = fixture();
  try {
    f.browser.accessAllowed = () => false;
    for (const action of [
      "browser.tabs",
      "browser.new_tab",
      "browser.search",
      "browser.follow",
      "browser.read",
      "browser.open",
    ]) {
      const response = await f.broker.execute(action, {
        url: "https://example.com/first",
      });
      assert.equal(response.success, false);
      assert.match(JSON.stringify(response), /isolated project workers/);
    }
    assert.equal(f.views().length, 0);
  } finally {
    f.browser.destroy();
  }
});

test("nested and encoded credential URLs are guarded by the same host and actual DOM parser", async () => {
  const tails = [
    "?view=summary?api_key=FAKE-CREDENTIAL",
    "?view=summary?access_token=FAKE-CREDENTIAL?next=done",
    "?view=summary;api_key=FAKE-CREDENTIAL",
    "?next=" +
      encodeURIComponent("https://example.com/file?api_key=FAKE-CREDENTIAL"),
    "?next=" +
      encodeURIComponent(
        encodeURIComponent("https://example.com/file?api_key=FAKE-CREDENTIAL"),
      ),
    ...[
      "https://user:FAKE-CREDENTIAL@example.com/",
      "//user:FAKE-CREDENTIAL@example.com/",
      "https:/user:FAKE-CREDENTIAL@example.com/",
      "https:user:FAKE-CREDENTIAL@example.com/",
      String.raw`https:\\user:FAKE-CREDENTIAL@example.com`,
      String.raw`\\user:FAKE-CREDENTIAL@example.com`,
    ].flatMap((value) =>
      ["?", "#"].map((prefix) => prefix + "next=" + encodeURIComponent(value)),
    ),
    ...[
      ";",
      "&",
      ":",
      "=",
      "+",
      ",",
      "$",
      "!",
      "'",
      "(",
      ")",
      "%2F",
      "%3F",
      "%23",
      "%40",
    ].flatMap((mark) =>
      [
        "https://",
        "//",
        "https:/",
        "https:",
        String.raw`https:\\`,
        String.raw`\\`,
      ].flatMap((form) => {
        const nested = form + "user:Z9a" + mark + "tail@example.com/";
        return ["?", "#"].flatMap((prefix) => [
          prefix + "next=" + nested,
          prefix + "next=" + encodeURIComponent(nested),
        ]);
      }),
    ),
    ...["?", "#"].map(
      (prefix) =>
        prefix +
        "next=" +
        encodeURIComponent(
          JSON.stringify("https:user:Z9a;\ntail@example.com/"),
        ),
    ),
    "#view=summary?api_key=FAKE-CREDENTIAL",
    "#next=" +
      encodeURIComponent(encodeURIComponent("?api_key=FAKE-CREDENTIAL")),
  ];
  const rows = [
    ...tails.map((tail) => ({ tail, sensitive: true })),
    ...[
      "?view=summary",
      "?q=auth+token&page=2",
      "?author=Sultan",
      "?email=friend@example.com",
      "?next=" + encodeURIComponent("//example.com/help?page=2"),
      "?next=" + encodeURIComponent("https://example.com/help?page=2"),
    ].map((tail) => ({ tail, sensitive: false })),
  ];
  for (const { tail, sensitive } of rows)
    for (const target of ["page", "link"]) {
      const f = fixture();
      try {
        const url = "https://example.com/form" + tail,
          id = f.browser.create(true),
          w = f.views()[0].webContents;
        assert.equal(sensitiveBrowserURL(url), sensitive, tail);
        await w.loadURL(target === "page" ? url : "https://example.com/public");
        const link = {
          tagName: "A",
          type: "",
          name: "",
          id: "download",
          autocomplete: "",
          innerText: "Download",
          href: url,
          getClientRects: () => [{}],
          getAttribute: () => null,
        };
        const context = createContext({
          document: {
            querySelectorAll: () => (target === "link" ? [link] : []),
            body: {
              innerText: sensitive ? "FAKE-CREDENTIAL" : "Public fixture",
            },
            title: "Fixture",
          },
          location: { href: w.url },
          URL,
          URLSearchParams,
          getComputedStyle: () => ({ visibility: "visible" }),
        });
        w.evaluate = (code: string) => runInContext(code, context);
        if (sensitive) await assert.rejects(f.browser.resume(id));
        else await f.browser.resume(id);
        const read = await f.broker.execute("browser.read", { tabId: id });
        assert.equal(read.success, !sensitive, target + tail);
        if (!sensitive) assert(JSON.stringify(read).includes("Public fixture"));
        assert(!JSON.stringify(read).includes("FAKE-CREDENTIAL"));
      } finally {
        f.browser.destroy();
      }
    }
  assert(
    !sensitiveBrowserURL("https://example.com/search?q=auth+token&page=2"),
  );
  assert(
    !sensitiveBrowserURL(
      "https://example.com/form?next=" +
        encodeURIComponent("https://example.com/help?page=2"),
    ),
  );
});

test('navigation waits for resource completion and still rejects navigation changes during that wait',async()=>{
 for(const changed of [false,true]){
  const f=fixture();try{
   const tabId=f.browser.create(false),w=f.views()[0].webContents;
   const original=w.loadURL.bind(w);w.loadURL=async(url:string)=>{await original(url);w.loading=true;};
   let settled=false;const pending=f.broker.execute('browser.open',{tabId,url:'https://example.com/first'}).then(r=>{settled=true;return r;});
   await tick();assert.equal(settled,false);assert.equal(w.loading,true);
   if(changed){w.emit('did-start-navigation',{},'https://example.com/changed',false,true);w.url='https://example.com/changed';}
   w.loading=false;w.emit('did-stop-loading');
   const r=await pending;assert.equal(r.success,!changed);
   if(changed)assert.match(JSON.stringify(r),/superseded/);
  }finally{f.browser.destroy();}
 }
});
