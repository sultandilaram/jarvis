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
