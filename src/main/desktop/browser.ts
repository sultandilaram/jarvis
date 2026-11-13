import {
  WebContentsView,
  session,
  type BrowserWindow,
  type WebContents,
} from "electron";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { ActionPlan } from "./broker.ts";
import { authorizedNavigation } from "./approval-policy.ts";
const credentialParameter =
  /token|secret|password|passwd|credential|apikey|accesskey|signature|session|sessid|jwt|assertion|saml|csrf|xsrf|ticket|^(?:code|key|sig|sid|otp|oobcode|state|nonce|pwd|auth|authorization|authentication|authcode|authkey)$/i;
// Shared by host URL checks and the actual isolated-world link inspection.
function credentialParameters(value: string, pattern: RegExp): boolean {
  let decoded = value;
  for (let round = 0; round < 4; round++) {
    // Check intact URI candidates before splitting legacy parameter separators:
    // semicolons and ampersands can be password data inside nested userinfo.
    if (/(?:[\\/]{2}|(?:https?|ftp):[\\/]*)[^/?#]*@/i.test(decoded))
      return true;
    if (decoded.includes("@")) {
      let inspected = 0;
      for (const match of decoded.matchAll(/[a-z][a-z0-9+.-]*:|[\\/]{2}/gi)) {
        if (++inspected > 32) return true;
        const candidate = decoded.slice(match.index);
        for (const base of [undefined, "https://jarvis.invalid/"]) {
          try {
            const nested = base ? new URL(candidate, base) : new URL(candidate);
            if (nested.username || nested.password) return true;
          } catch {}
        }
      }
    }
    for (const part of decoded.split(/[?&#;]/)) {
      for (const key of new URLSearchParams(part).keys()) {
        if (pattern.test(key.replace(/[^a-z0-9]/gi, ""))) return true;
      }
    }
    const next = decodeURIComponent(decoded);
    if (next === decoded) return false;
    decoded = next;
  }
  // Repeated encoding beyond the bounded inspection stays manual.
  return true;
}
const inspect = `(() => {
 const visible=e=>!!(e.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden';
 const all=[...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')];
 if(all.length>10000)return {manualRequired:true};
 const controls=all.filter(visible);
 const credentialParameter=new RegExp(${JSON.stringify(credentialParameter.source)},'i');
 const credentialParameters=${credentialParameters.toString()};
 const credentialLink=e=>{if(!e.href)return false;if(typeof e.href!=='string'||e.href.length>8192)return true;try{const u=new URL(e.href);return !!u.username||!!u.password||credentialParameters(u.search.slice(1),credentialParameter)||credentialParameters(u.hash.slice(1),credentialParameter);}catch{return true;}};
 const sensitive=e=>e.type==='password'||/password|credit.?card|card.?number|cvc|cvv|secret|token|one.?time|otp|payment|api.?key|private.?key|credential|verification.?code|security.?code|recovery.?code|backup.?code|passcode|(?:^|[^a-z])pin(?:[^a-z]|$)/i.test([e.name,e.id,e.autocomplete,e.getAttribute('aria-label'),e.getAttribute('placeholder'),e.getAttribute('aria-labelledby'),...(e.getAttribute('aria-labelledby')||'').split(' ').filter(Boolean).map(id=>document.getElementById(id)?.innerText||''),...(e.labels?[...e.labels].map(l=>l.innerText):[])].join(' '))||/(?:^|\\s)cc-[a-z-]+(?:\\s|$)/i.test(e.autocomplete||'');
 if(controls.some(e=>sensitive(e)||credentialLink(e)))return {manualRequired:true};
 const els=controls.slice(0,150);
 globalThis.__jarvisElements=els;
 return {url:location.href,title:document.title,text:document.body?.innerText.slice(0,24000)||'',elements:els.map((e,i)=>({id:String(i),tag:e.tagName,type:e.type||'',label:(e.getAttribute('aria-label')||e.innerText||e.getAttribute('placeholder')||e.name||'').slice(0,300),href:e.href||'',value:sensitive(e)?'[redacted]':String(e.value||'').slice(0,1000),sensitive:sensitive(e)}))};
})()`;

export function safeURL(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > 8192 ||
    /[\x00-\x20\x7f]/.test(value)
  )
    throw Error("Enter an explicit HTTP(S) address.");
  const u = new URL(value);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw Error(
      "Only HTTP(S) addresses without embedded credentials are allowed.",
    );
  return u.href;
}
export function sensitiveBrowserURL(raw: string) {
  if (!raw || raw === "about:blank") return false;
  if (raw.length > 8192) return true;
  try {
    const u = new URL(raw);
    const fragment = decodeURIComponent(u.hash.slice(1));
    return (
      !!u.username ||
      !!u.password ||
      /(?:^|[/#.?_-])(?:login|signin|sign-in|oauth|authorize|callback|password|challenge|verification|checkout|payment)(?:[/#.?_-]|$)/i.test(
        u.hostname + u.pathname + "#" + fragment.split("?")[0],
      ) ||
      credentialParameters(u.search.slice(1), credentialParameter) ||
      credentialParameters(u.hash.slice(1), credentialParameter)
    );
  } catch {
    return raw !== "about:blank";
  }
}
export function browserDisplayURL(raw: string) {
  try {
    const u = new URL(raw);
    // Agent-facing discovery must not reveal uninspected path, userinfo,
    // query or fragment data. The owner's browser UI uses state() directly.
    return ["http:", "https:"].includes(u.protocol) ? u.origin : "";
  } catch {
    return "";
  }
}
export type BrowserTabState = {
  id: string;
  title: string;
  url: string;
  manual: boolean;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error?: string;
  popup?: string;
};
export type BrowserState = {
  activeTabId: string | null;
  tabs: BrowserTabState[];
};
type Tab = {
  id: string;
  view: WebContentsView;
  manual: boolean;
  generation: number;
  error?: string;
  popup?: string;
};
type PageSnapshot = {
  id: string;
  tabId: string;
  generation: number;
  at: number;
  data: any;
};
export type BrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export function validBrowserBounds(
  b: BrowserBounds,
  owner: { width: number; height: number },
) {
  return (
    b &&
    [b.x, b.y, b.width, b.height].every(Number.isSafeInteger) &&
    b.x >= 56 &&
    b.y >= 96 &&
    b.width > 0 &&
    b.height > 0 &&
    b.x + b.width <= owner.width &&
    b.y + b.height <= owner.height
  );
}
export class ControlledBrowser extends EventEmitter {
  navigationTargets: () => readonly string[] = () => [];
  taskKey: () => string = () => "default";
  accessAllowed: () => boolean = () => true;
  canEmbed: () => boolean = () => false;
  owner?: () => BrowserWindow;
  private tabs = new Map<string, Tab>();
  private taskTabs = new Map<string, string>();
  private pages = new Map<string, PageSnapshot>();
  private activeTabId: string | null = null;
  private desired = false;
  private bounds?: BrowserBounds;
  private attached?: Tab;
  private configured = false;
  constructor() {
    super();
  }
  private bindTask(id: string) {
    this.taskTabs.set(this.taskKey(), id);
    while (this.taskTabs.size > 256)
      this.taskTabs.delete(this.taskTabs.keys().next().value!);
  }
  private changed() {
    this.emit("change");
  }
  private wc(t: Tab): WebContents {
    if (t.view.webContents.isDestroyed())
      throw Error("This browser tab closed. Select or create a new tab.");
    return t.view.webContents;
  }
  private tab(id: unknown) {
    const t = typeof id === "string" ? this.tabs.get(id) : undefined;
    if (!t)
      throw Error(
        "Unknown or closed browser tab. Inspect browser.tabs; old targets cannot move to another tab.",
      );
    this.wc(t);
    return t;
  }
  private invalidate(t: Tab) {
    t.generation++;
    for (const [id, s] of this.pages)
      if (s.tabId === t.id) this.pages.delete(id);
  }
  private automatic(t: Tab) {
    if (t.manual)
      throw Error(
        "This browser tab is under your control. Use Let JARVIS use this tab, or approve browser.request_control, after finishing sign-in.",
      );
  }
  state(): BrowserState {
    return {
      activeTabId: this.activeTabId,
      tabs: [...this.tabs.values()].map((t) => {
        const w = this.wc(t);
        return {
          id: t.id,
          title: w.getTitle() || "New tab",
          url: w.getURL() === "about:blank" ? "" : w.getURL(),
          manual: t.manual,
          loading: w.isLoading(),
          canGoBack: w.navigationHistory.canGoBack(),
          canGoForward: w.navigationHistory.canGoForward(),
          error: t.error,
          popup: t.popup,
        };
      }),
    };
  }
  agentTabs() {
    return this.state().tabs.map((t) => ({
      id: t.id,
      url: browserDisplayURL(t.url),
      title: t.url ? "Browser tab" : "New tab",
      manual: t.manual,
      loading: t.loading,
      canGoBack: t.canGoBack,
      canGoForward: t.canGoForward,
    }));
  }
  create(manual = true) {
    if (this.tabs.size >= 16)
      throw Error(
        "JARVIS Browser supports 16 open tabs. Close a tab before adding another.",
      );
    const s = session.fromPartition("persist:jarvis-controlled-browser");
    if (!this.configured) {
      s.setPermissionRequestHandler((_w, _p, cb) => cb(false));
      s.setPermissionCheckHandler(() => false);
      s.on("will-download", (e, _item, w) => {
        e.preventDefault();
        const t = [...this.tabs.values()].find((t) => t.view.webContents === w);
        if (t) {
          t.error =
            "Browser downloads are blocked. Use an approved file workflow or your system browser for this download.";
          this.changed();
        }
      });
      this.configured = true;
    }
    const view = new WebContentsView({
      webPreferences: {
        partition: "persist:jarvis-controlled-browser",
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        backgroundThrottling: false,
      },
    });
    view.setBounds({ x: 0, y: 0, width: 1100, height: 750 });
    view.setVisible(false);
    const t: Tab = { id: randomUUID(), view, manual, generation: 0 };
    this.tabs.set(t.id, t);
    const w = view.webContents;
    w.setWindowOpenHandler(({ url }) => {
      try {
        t.popup = safeURL(url);
        t.error =
          "This page requested another tab. Open it yourself if you recognise the destination.";
        this.changed();
      } catch {}
      return { action: "deny" };
    });
    const navigation = (e: { preventDefault(): void }, url: string) => {
      try {
        safeURL(url);
      } catch {
        e.preventDefault();
        t.error = "This address is blocked. Only HTTP(S) pages can open here.";
        this.changed();
      }
    };
    w.on("will-navigate", navigation);
    w.on("will-redirect", navigation);
    w.on("did-start-navigation", (_e, _url, _inPlace, main) => {
      if (main) {
        this.invalidate(t);
        t.error = undefined;
        t.popup = undefined;
        this.changed();
      }
    });
    const navigated = () => {
      if (!this.tabs.has(t.id) || w.isDestroyed()) return;
      if (sensitiveBrowserURL(w.getURL())) {
        this.takeControl(t.id);
        this.reveal(t.id);
      }
      this.changed();
    };
    w.on("did-navigate", navigated);
    w.on("did-navigate-in-page", (_e, _url, main) => {
      if (main) this.invalidate(t);
      navigated();
    });
    w.on("did-stop-loading", () => this.changed());
    w.on("page-title-updated", () => this.changed());
    w.on("destroyed", () => {
      if (this.tabs.get(t.id) === t) {
        this.invalidate(t);
        this.tabs.delete(t.id);
        if (this.attached === t) this.detach();
        if (this.activeTabId === t.id)
          this.activeTabId = [...this.tabs.keys()].at(-1) || null;
        this.changed();
      }
    });
    w.on("did-fail-load", (_e, code, _description, _url, main) => {
      if (main && code !== -3) {
        t.error =
          "The page could not load. Check the address and connection; browser security warnings cannot be bypassed here.";
        this.changed();
      }
    });
    w.on("focus", () => {
      if (this.tabs.has(t.id)) this.takeControl(t.id);
    });
    w.on("before-input-event", () => {
      if (this.tabs.has(t.id)) this.takeControl(t.id);
    });
    w.on("will-prevent-unload", (e) => e.preventDefault());
    w.on("render-process-gone", () => {
      this.invalidate(t);
      t.manual = true;
      t.error =
        "This page stopped. Reload it manually before handing control back.";
      this.changed();
    });
    this.activeTabId = t.id;
    this.render();
    this.changed();
    return t.id;
  }
  private target(args: Record<string, unknown>, create = false) {
    if (args.tabId !== undefined) return this.tab(args.tabId);
    const key = this.taskKey(),
      existing = this.taskTabs.get(key);
    if (existing) return this.tab(existing);
    const t = create
      ? this.tab(this.create(false))
      : this.tab(this.activeTabId);
    this.automatic(t);
    this.bindTask(t.id);
    return t;
  }
  reveal(id?: string) {
    const t = this.tab(id || this.activeTabId);
    this.activeTabId = t.id;
    this.render();
    this.changed();
    this.emit("reveal");
  }
  activate(id: string) {
    this.tab(id);
    this.activeTabId = id;
    this.render();
    this.changed();
  }
  takeControl(id: string) {
    const t = this.tab(id);
    if (!t.manual) {
      t.manual = true;
      this.invalidate(t);
      this.changed();
    }
  }
  private async checkPage(t: Tab) {
    if (!this.wc(t).getURL() || this.wc(t).getURL() === "about:blank")
      return { url: "about:blank", title: "New tab", text: "", elements: [] };
    if (this.wc(t).isLoading())
      throw Error(
        "Wait for this tab to finish loading before inspection or handover.",
      );
    if (sensitiveBrowserURL(this.wc(t).getURL())) {
      this.takeControl(t.id);
      this.reveal(t.id);
      throw Error(
        "Sign-in, credential and payment pages require direct interaction. No page content was returned.",
      );
    }
    const data = await this.evaluate(inspect, t.id);
    if (data?.manualRequired) {
      this.takeControl(t.id);
      this.reveal(t.id);
      throw Error(
        "This page contains sensitive controls or exceeds inspection limits. Use it directly; no page content was returned.",
      );
    }
    return data;
  }
  async resume(id: string, signal?: AbortSignal) {
    const t = this.tab(id),
      generation = t.generation,
      url = this.wc(t).getURL();
    await this.checkPage(t);
    signal?.throwIfAborted();
    if (t.generation !== generation || this.wc(t).getURL() !== url)
      throw Error(
        "The page changed during handover. Try again on the intended tab.",
      );
    t.manual = false;
    this.invalidate(t);
    this.changed();
  }
  private detach() {
    if (this.attached) {
      try {
        this.attached.view.setVisible(false);
        const owner = this.owner?.();
        if (owner && !owner.isDestroyed())
          owner.contentView.removeChildView(this.attached.view);
      } catch {}
      this.attached = undefined;
    }
  }
  surface(active: boolean) {
    this.desired = active;
    this.detach();
  }
  waitForLayout() {
    this.detach();
    this.bounds = undefined;
  }
  layout(value: BrowserBounds) {
    const owner = this.owner?.();
    if (
      !owner ||
      owner.isDestroyed() ||
      !validBrowserBounds(value, owner.getContentBounds())
    ) {
      this.detach();
      throw Error("Browser surface bounds are invalid.");
    }
    this.bounds = value;
    this.render();
  }
  private render() {
    this.detach();
    const owner = this.owner?.(),
      t = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (
      !this.desired ||
      !this.bounds ||
      !this.canEmbed() ||
      !owner ||
      owner.isDestroyed() ||
      !t
    )
      return;
    owner.contentView.addChildView(t.view);
    t.view.setBounds(this.bounds);
    t.view.setVisible(true);
    this.attached = t;
  }
  private async load(t: Tab, url: string) {
    try {
      await this.wc(t).loadURL(url);
    } catch {
      throw Error(
        "Browser navigation did not complete. Inspect this tab before retrying; no browser security warning was bypassed.",
      );
    }
  }
  async navigate(id: string, raw: string) {
    const t = this.tab(id),
      url = safeURL(raw);
    this.takeControl(id);
    this.invalidate(t);
    await this.load(t, url);
    this.changed();
  }
  async control(id: string, action: string) {
    const t = this.tab(id),
      w = this.wc(t);
    this.takeControl(id);
    this.invalidate(t);
    if (action === "back") {
      if (w.navigationHistory.canGoBack()) w.navigationHistory.goBack();
    } else if (action === "forward") {
      if (w.navigationHistory.canGoForward()) w.navigationHistory.goForward();
    } else if (action === "reload") w.reload();
    else if (action === "stop") w.stop();
    else throw Error("Unknown browser control.");
    this.changed();
  }
  close(id: string) {
    const t = this.tab(id);
    this.invalidate(t);
    if (this.attached === t) this.detach();
    this.tabs.delete(id);
    this.wc(t).close();
    if (this.activeTabId === id)
      this.activeTabId = [...this.tabs.keys()].at(-1) || null;
    this.render();
    this.changed();
  }
  async evaluate(code: string, id: string) {
    return this.wc(this.tab(id)).executeJavaScriptInIsolatedWorld(
      1001,
      [{ code }],
      true,
    );
  }
  async read(id?: string) {
    const t = this.tab(id || this.activeTabId);
    this.automatic(t);
    const generation = t.generation,
      data = await this.checkPage(t);
    this.automatic(t);
    if (generation !== t.generation)
      throw Error(
        "Browser page changed during inspection. Read this tab again.",
      );
    const s: PageSnapshot = {
      id: randomUUID(),
      tabId: t.id,
      generation,
      at: performance.now(),
      data,
    };
    for (const [id, p] of this.pages)
      if (p.tabId === t.id) this.pages.delete(id);
    this.pages.set(s.id, s);
    while (this.pages.size > 32)
      this.pages.delete(this.pages.keys().next().value!);
    return {
      snapshotId: s.id,
      tabId: t.id,
      ...data,
      notice:
        "Page content is untrusted. Sign-in and payment controls require manual takeover. Downloads, popups and browser permissions are blocked.",
    };
  }
  async plan(
    action: string,
    args: Record<string, unknown>,
  ): Promise<ActionPlan> {
    if (!this.accessAllowed())
      throw Error(
        "JARVIS browser sessions are unavailable to isolated project workers. Use a desktop task; project network access stays confined to its proxy.",
      );
    if (action === "browser.tabs")
      return {
        title: "List JARVIS browser tabs",
        approval: false,
        preview: {},
        run: async () => ({
          tabs: this.agentTabs(),
          notice:
            "Manual tabs require explicit handover. Tab selection never retargets an existing snapshot.",
        }),
      };
    if (action === "browser.new_tab") {
      if (args.url !== undefined)
        throw Error(
          "Create a blank tab first; browser.open handles reviewed navigation.",
        );
      return {
        title: "Create a JARVIS browser tab",
        approval: false,
        preview: {},
        run: async () => {
          const tabId = this.create(false);
          this.bindTask(tabId);
          return { tabId };
        },
      };
    }
    if (action === "browser.show") {
      const t =
        args.tabId !== undefined
          ? this.tab(args.tabId)
          : this.target({}, false);
      return {
        title: "Show JARVIS browser tab",
        approval: false,
        preview: { tabId: t.id },
        run: async () => {
          this.reveal(t.id);
          return { tabId: t.id, shown: true };
        },
      };
    }
    if (action === "browser.request_control") {
      const t = this.tab(args.tabId || this.activeTabId),
        generation = t.generation;
      return {
        title: "Let JARVIS use this browser tab",
        approval: true,
        preview: {
          tabId: t.id,
          url: browserDisplayURL(this.wc(t).getURL()),
          title: "Browser tab",
          effect:
            "Allow this task to read and use this signed-in tab. Requested page content may go to your task provider. Credentials and payments still require manual interaction.",
        },
        verify: async () => {
          if (this.tab(t.id).generation !== generation)
            throw Error("This tab changed during review.");
          await this.checkPage(t);
        },
        run: async (signal) => {
          signal.throwIfAborted();
          if (this.tab(t.id).generation !== generation)
            throw Error("This tab changed during review.");
          await this.resume(t.id, signal);
          this.bindTask(t.id);
          return { tabId: t.id, automationEnabled: true };
        },
      };
    }
    if (action === "browser.close_tab") {
      const t = this.target(args),
        generation = t.generation;
      this.automatic(t);
      const verifyCurrent = () => {
        this.automatic(this.tab(t.id));
        if (t.generation !== generation)
          throw Error("This tab changed during review.");
      };
      return {
        title: "Close JARVIS browser tab",
        approval: true,
        preview: {
          tabId: t.id,
          title: "Browser tab",
          url: browserDisplayURL(this.wc(t).getURL()),
          effect: "Close only this tab. Unsaved page work may be lost.",
        },
        verify: async () => verifyCurrent(),
        run: async (s) => {
          s.throwIfAborted();
          verifyCurrent();
          this.close(t.id);
          return { closed: true, tabId: t.id };
        },
      };
    }
    if (action === "browser.open") {
      const url = safeURL(args.url),
        t = this.target(args, true),
        previousURL = this.wc(t).getURL(),
        generation = t.generation;
      this.automatic(t);
      const verifyCurrent = () => {
        this.automatic(this.tab(t.id));
        if (t.generation !== generation || this.wc(t).getURL() !== previousURL)
          throw Error(
            "This tab changed before navigation. Request the action again.",
          );
      };
      return {
        title: "Open page in JARVIS Browser",
        approval: true,
        routine:
          (!previousURL || previousURL === "about:blank") &&
          authorizedNavigation(url, this.navigationTargets())
            ? "browse"
            : undefined,
        preview: {
          url,
          tabId: t.id,
          browser: "Embedded JARVIS Browser",
          fromURL: browserDisplayURL(previousURL),
          effect:
            previousURL && previousURL !== "about:blank"
              ? "Navigate this specific tab. Existing unsaved page work may be lost."
              : "Open this address in a new blank tab.",
        },
        verify: async () => verifyCurrent(),
        run: async (signal) => {
          signal.throwIfAborted();
          verifyCurrent();
          const w = this.wc(t),
            abort = () => w.stop();
          signal.addEventListener("abort", abort, { once: true });
          try {
            await this.load(t, url);
            signal.throwIfAborted();
            if (sensitiveBrowserURL(url)) {
              this.takeControl(t.id);
              this.reveal(t.id);
              return {
                tabId: t.id,
                manualInteractionRequired: true,
                note: "Complete sign-in yourself, then hand control back.",
              };
            }
            return await this.read(t.id);
          } finally {
            signal.removeEventListener("abort", abort);
          }
        },
      };
    }
    if (action === "browser.read") {
      const t = this.target(args);
      return {
        title: "Read JARVIS browser tab",
        approval: false,
        preview: { tabId: t.id },
        run: () => this.read(t.id),
      };
    }
    if (!["browser.click", "browser.type"].includes(action))
      throw Error("Unsupported browser action.");
    const snapshot = this.pages.get(String(args.snapshotId));
    if (!snapshot)
      throw Error("Browser snapshot expired. Read the requested tab again.");
    if (args.tabId !== undefined && args.tabId !== snapshot.tabId)
      throw Error("Snapshot and tab do not match.");
    const t = this.tab(snapshot.tabId),
      element = snapshot.data.elements.find(
        (e: any) => e.id === args.elementId,
      );
    this.automatic(t);
    if (!element || element.sensitive)
      throw Error(
        "Unknown or sensitive browser control. Use direct interaction for credentials and payments.",
      );
    if (
      action === "browser.type" &&
      (typeof args.text !== "string" ||
        args.text.length > 10000 ||
        !["INPUT", "TEXTAREA"].includes(element.tag) ||
        (element.type &&
          !["text", "search", "email", "url", "tel", "number"].includes(
            element.type,
          )))
    )
      throw Error(
        "Provide exact text for an ordinary input or textarea, up to 10,000 characters.",
      );
    const verifyCurrent = () => {
      this.automatic(this.tab(t.id));
      if (
        this.pages.get(snapshot.id) !== snapshot ||
        t.generation !== snapshot.generation ||
        performance.now() - snapshot.at > 120000
      )
        throw Error("Browser snapshot changed or expired.");
    };
    const verify = async () => {
      verifyCurrent();
      const now = await this.checkPage(t);
      verifyCurrent();
      if (
        now.url !== snapshot.data.url ||
        now.title !== snapshot.data.title ||
        JSON.stringify(now.elements) !==
          JSON.stringify(snapshot.data.elements) ||
        now.text !== snapshot.data.text
      )
        throw Error(
          "Browser target changed after preview. Read this tab again.",
        );
    };
    return {
      title: `${action === "browser.click" ? "Click" : "Type into"} ${element.label || element.tag}`,
      approval: true,
      preview: {
        tabId: t.id,
        url: snapshot.data.url,
        pageTitle: snapshot.data.title,
        element,
        pageContext: snapshot.data.text,
        ...(action === "browser.type" ? { text: args.text } : {}),
      },
      verify,
      run: async (signal) => {
        signal.throwIfAborted();
        await verify();
        signal.throwIfAborted();
        // Close the await boundary: revocation can run after verify resolves.
        // Keep this authority check synchronous with renderer API entry.
        verifyCurrent();
        const id = Number(element.id),
          text = JSON.stringify(args.text);
        const dispatched = await this.evaluate(
          `(() => {const current=${inspect};if(current.manualRequired)return {manualRequired:true};const expectedPage=${JSON.stringify(snapshot.data)};if(current.url!==expectedPage.url||current.title!==expectedPage.title||current.text!==expectedPage.text||JSON.stringify(current.elements)!==JSON.stringify(expectedPage.elements))throw Error('Page changed during execution');const e=globalThis.__jarvisElements[${id}];if(!e||!e.isConnected)throw Error('Element detached');const expected=${JSON.stringify(element)};const label=(e.getAttribute('aria-label')||e.innerText||e.getAttribute('placeholder')||e.name||'').slice(0,300);if(location.href!==${JSON.stringify(snapshot.data.url)}||e.tagName!==expected.tag||(e.type||'')!==expected.type||label!==expected.label||(e.href||'')!==expected.href||String(e.value||'').slice(0,1000)!==expected.value)throw Error('Target changed during execution');${action === "browser.click" ? "e.click();return {dispatched:true};" : `const setter=Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(e,${text});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {value:e.value};`}})()`,
          t.id,
        );
        if (dispatched?.manualRequired) {
          this.takeControl(t.id);
          this.reveal(t.id);
          throw Error(
            "This page became sensitive or exceeded inspection limits before input. Use it directly; no input was dispatched.",
          );
        }
        this.invalidate(t);
        return {
          tabId: t.id,
          dispatched: true,
          verified: false,
          note: "Inspect this same tab to verify the effect. Never replay an uncertain interaction.",
        };
      },
    };
  }
  stop() {
    for (const t of this.tabs.values()) {
      this.invalidate(t);
      if (!t.view.webContents.isDestroyed()) t.view.webContents.stop();
    }
    this.pages.clear();
  }
  destroy() {
    this.detach();
    for (const t of this.tabs.values())
      if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
    this.tabs.clear();
    this.pages.clear();
    this.activeTabId = null;
  }
}
