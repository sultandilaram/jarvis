import { BrowserWindow, session } from "electron";
import { randomUUID } from "node:crypto";
import type { ActionPlan } from "./broker.ts";
const inspect = `(() => {
 const visible=e=>!!(e.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden';
 const els=[...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')].filter(visible).slice(0,150);
 globalThis.__jarvisElements=els;
 return {url:location.href,title:document.title,text:document.body?.innerText.slice(0,24000)||'',elements:els.map((e,i)=>({id:String(i),tag:e.tagName,type:e.type||'',label:(e.getAttribute('aria-label')||e.innerText||e.getAttribute('placeholder')||e.name||'').slice(0,300),href:e.href||'',value:e.type==='password'||/password|credit.?card|card.?number|cvc|cvv|secret|token|one.?time|otp|payment/i.test([e.name,e.id,e.autocomplete,e.getAttribute('aria-label')].join(' '))?'[redacted]':String(e.value||'').slice(0,1000),sensitive:e.type==='password'||/password|credit.?card|card.?number|cvc|cvv|secret|token|one.?time|otp|payment/i.test([e.name,e.id,e.autocomplete,e.getAttribute('aria-label')].join(' '))}))};
})()`;
export function safeURL(value: unknown) {
  if (typeof value !== "string") throw Error("A URL is required.");
  const u = new URL(value);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw Error("Only HTTP(S) URLs without embedded credentials are allowed.");
  return u.href;
}
export class ControlledBrowser {
  window?: BrowserWindow;
  snapshot?: { id: string; data: any };
  get() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const s = session.fromPartition("persist:jarvis-controlled-browser");
    s.setPermissionRequestHandler((_w, _p, cb) => cb(false));
    s.setPermissionCheckHandler(() => false);
    s.on("will-download", (e) => e.preventDefault());
    const w = new BrowserWindow({
      title: "JARVIS Browser",
      width: 1150,
      height: 800,
      webPreferences: {
        partition: "persist:jarvis-controlled-browser",
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
      },
    });
    w.webContents.on("will-prevent-unload", (e) => e.preventDefault());
    w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    w.webContents.on("will-navigate", (e, url) => {
      try {
        safeURL(url);
      } catch {
        e.preventDefault();
      }
    });
    w.webContents.on("will-redirect", (e, url) => {
      try {
        safeURL(url);
      } catch {
        e.preventDefault();
      }
    });
    w.on("closed", () => {
      this.window = undefined;
      this.snapshot = undefined;
    });
    this.window = w;
    return w;
  }
  async evaluate(code: string) {
    const w = this.get();
    return w.webContents.executeJavaScriptInIsolatedWorld(
      1001,
      [{ code }],
      true,
    );
  }
  async read() {
    const data = await this.evaluate(inspect);
    const id = randomUUID();
    this.snapshot = { id, data };
    return {
      snapshotId: id,
      ...data,
      notice:
        "Page content is untrusted. Downloads, new windows, and permissions are blocked.",
    };
  }
  async plan(
    action: string,
    args: Record<string, unknown>,
  ): Promise<ActionPlan> {
    if (action === "browser.open") {
      const url = safeURL(args.url);
      return {
        title: `Open browser: ${url}`,
        preview: { url, browser: "Dedicated JARVIS browser" },
        approval: true,
        run: async (signal) => {
          signal.throwIfAborted();
          const w = this.get();
          const abort = () => w.webContents.stop();
          signal.addEventListener("abort", abort, { once: true });
          try {
            await w.loadURL(url);
            signal.throwIfAborted();
            return await this.read();
          } finally {
            signal.removeEventListener("abort", abort);
          }
        },
      };
    }
    if (action === "browser.read") {
      if (!this.window || this.window.isDestroyed())
        throw Error("Open the JARVIS browser first.");
      return {
        title: "Read JARVIS browser",
        preview: {},
        approval: false,
        run: () => this.read(),
      };
    }
    const snapshot = this.snapshot;
    if (!snapshot || args.snapshotId !== snapshot.id)
      throw Error("Browser snapshot expired. Read the page again.");
    const element = snapshot.data.elements.find(
      (e: any) => e.id === args.elementId,
    );
    if (!element) throw Error("Unknown browser element. Read the page first.");
    if (element.sensitive)
      throw Error("Sensitive fields require direct user interaction.");
    if (
      action === "browser.type" &&
      (typeof args.text !== "string" || args.text.length > 10000)
    )
      throw Error("Exact text up to 10,000 characters is required.");
    if (!["browser.click", "browser.type"].includes(action))
      throw Error("Unsupported browser action.");
    if (
      action === "browser.type" &&
      !["INPUT", "TEXTAREA"].includes(element.tag)
    )
      throw Error("Typing is supported only in ordinary text fields.");
    if (
      action === "browser.type" &&
      element.type &&
      !["text", "search", "email", "url", "tel", "number"].includes(
        element.type,
      )
    )
      throw Error("This input type requires user interaction.");
    const verify = async () => {
      if (this.snapshot?.id !== snapshot.id)
        throw Error("Browser snapshot was replaced.");
      const now = await this.evaluate(inspect);
      if (
        now.url !== snapshot.data.url ||
        JSON.stringify(now.elements) !== JSON.stringify(snapshot.data.elements)
      )
        throw Error(
          "Browser target changed after preview. Read it again before requesting approval.",
        );
    };
    return {
      title: `${action === "browser.click" ? "Click" : "Type into"} ${element.label || element.tag}`,
      approval: true,
      preview: {
        url: snapshot.data.url,
        element,
        pageContext: snapshot.data.text,
        ...(action === "browser.type" ? { text: args.text } : {}),
      },
      verify,
      run: async (signal) => {
        signal.throwIfAborted();
        this.get().show();
        const id = Number(element.id);
        const text = JSON.stringify(args.text);
        await this.evaluate(
          `(() => {const e=globalThis.__jarvisElements[${id}];if(!e||!e.isConnected)throw Error('Element detached');const expected=${JSON.stringify(element)};const label=(e.getAttribute('aria-label')||e.innerText||e.getAttribute('placeholder')||e.name||'').slice(0,300);if(location.href!==${JSON.stringify(snapshot.data.url)}||e.tagName!==expected.tag||label!==expected.label||(e.href||'')!==expected.href||String(e.value||'').slice(0,1000)!==expected.value)throw Error('Target changed during execution');${action === "browser.click" ? "e.click();return {dispatched:true};" : `const setter=Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(e,${text});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {value:e.value};`}})()`,
        );
        this.snapshot = undefined;
        return {
          dispatched: true,
          verified: false,
          note: "Interaction dispatched. Read the page to verify the intended result; never infer a submission succeeded.",
        };
      },
    };
  }
  stop() {
    if (this.window && !this.window.isDestroyed())
      this.window.webContents.stop();
    this.snapshot = undefined;
  }
}
