import { createHash } from "node:crypto";
import {
  pendingAttention,
  attentionPending,
  type AttentionRequest,
  attentionKey,
  type TaskUpdate,
} from "../attention.ts";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { dialog, type BrowserWindow } from "electron";
import QRCode from "qrcode";
import {
  encryptSecret,
  decryptSecret,
  usesFixedVault,
  isVaultCipher,
  writeEncrypted,
} from "../credential-storage.ts";
import { PhoneGateway, type Phone } from "./gateway.ts";
import { PublicTunnel } from "./tunnel.ts";
import { PhonePush, parsePushConfig, type PushConfig } from "./push.ts";
import { permanentTunnel, type PermanentTunnel } from "./permanent.ts";
import { DesktopCalls } from "./calls.ts";
import { phoneAction } from "./phone-tools.ts";
import type { Snapshot } from "../../shared/types.ts";
export class RemoteLink extends EventEmitter {
  gateway: PhoneGateway;
  tunnel = new PublicTunnel();
  push = new PhonePush();
  starting = false;
  permanent?: PermanentTunnel;
  enabled = false;
  connected = false;
  retry?: NodeJS.Timeout;
  retryCount = 0;
  generation = 0;
  error: string | null = null;
  qrDataURL = "";
  qrExpires = 0;
  voiceOwner: string | null = null;
  voiceLease = 0;
  voiceStarted = false;
  timer: NodeJS.Timeout;
  callRegistry = new DesktopCalls();
  calls = this.callRegistry.calls;
  notified = new Set<string>();
  previousTask: string | null = null;
  lastCallAt = 0;
  handoffLocalVoice?: () => Promise<void>;
  explicitPhoneTasks = new Set<string>();
  checkUpdates?: () => Promise<unknown>;
  androidUpdate?: () => unknown;
  constructor(
    public data: string,
    public helper: string,
    public owner: () => BrowserWindow,
    public snapshotLocal: () => Snapshot,
    public invoke: (method: string, params: any) => Promise<unknown>,
    public remoteVoice: (active: boolean) => void,
    public localVoice: () => boolean,
    public androidApk?: string,
  ) {
    super();
    this.tunnel.onDisconnect = () => {
      this.connected = false;
      if (this.enabled) {
        this.error = "Mobile connection interrupted. Reconnecting…";
        this.emit("state");
        if (!this.starting) this.scheduleRetry();
      }
    };
    this.gateway = new PhoneGateway(
      (m, p, phone) => this.rpc(m, p, phone),
      (phones) => this.writeSecret("phones", phones),
      androidApk,
    );
    this.gateway.on("state", () => this.emit("state"));
    this.gateway.on("disconnect", (id) => {
      if (this.voiceOwner === id) this.releaseVoice();
    });
    this.timer = setInterval(() => {
      if (this.voiceOwner && Date.now() > this.voiceLease) {
        this.releaseVoice();
        void this.gateway.push({ type: "endVoice" });
      }
    }, 5000);
    this.timer.unref();
  }
  async writeSecret(name: string, value: unknown) {
    const encrypted = await encryptSecret(JSON.stringify(value));
    writeEncrypted(join(this.data, `remote-${name}.enc`), encrypted);
  }
  async readSecret<T>(name: string, fallback: T): Promise<T> {
    const path = join(this.data, `remote-${name}.enc`);
    if (!existsSync(path)) return fallback;
    const original = readFileSync(path);
    const value = await decryptSecret(original);
    if (usesFixedVault() && !isVaultCipher(original)) {
      const encrypted = await encryptSecret(value);
      if (existsSync(path) && readFileSync(path).equals(original))
        writeEncrypted(path, encrypted);
    }
    return JSON.parse(value);
  }
  async migrateSecrets() {
    for (const name of ["phones", "push"]) {
      if (existsSync(join(this.data, `remote-${name}.enc`)))
        await this.readSecret(name, null);
    }
  }
  state() {
    return {
      ...this.gateway.snapshot(),
      starting: this.starting,
      error: this.error,
      qrDataURL: this.qrDataURL,
      qrExpires: this.qrExpires,
      pushConfigured: !!this.push.config,
      voiceActive: !!this.voiceOwner,
      connected: this.connected,
      permanent: this.permanent
        ? { url: this.permanent.url, autoStart: this.permanent.autoStart }
        : undefined,
    };
  }
  phonePlan(action: string, args: Record<string, unknown>) {
    return phoneAction(action, args, {
      ready: () => this.connected,
      phones: () =>
        this.gateway.phones.map((p) => ({
          id: p.id,
          name: p.name,
          online: this.gateway.clients.has(p.id),
          alertsEnabled: !!p.pushToken,
        })),
      call: async (reason, id, signal) => {
        const task = this.snapshotLocal().activeTaskId;
        if (task) this.explicitPhoneTasks.add(task);
        await this.handoffLocalVoice?.();
        signal.throwIfAborted();
        return this.notify(reason, id);
      },
    });
  }
  async restore() {
    const stored = await this.readSecret<unknown>("tunnel", null);
    if (!stored) return;
    this.permanent = permanentTunnel(stored);
    this.emit("state");
    if (this.permanent.autoStart) await this.start(false);
  }
  async configurePermanent(value: unknown) {
    if (this.voiceOwner || this.localVoice())
      throw Error(
        "End the active conversation before changing the phone connection.",
      );
    const config = permanentTunnel(value);
    await this.writeSecret("tunnel", config);
    this.stopRuntime();
    this.permanent = config;
    this.emit("state");
    if (config.autoStart) await this.start(false);
  }
  scheduleRetry() {
    if (!this.enabled || !this.permanent || this.retry) return;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.retryCount++, 5));
    this.retry = setTimeout(() => {
      this.retry = undefined;
      if (this.enabled) void this.start(false).catch(() => {});
    }, delay);
    this.retry.unref();
  }
  async start(manual = true) {
    if (this.starting) throw Error("Mobile link is already starting.");
    if (manual && this.permanent && !this.permanent.autoStart) {
      this.permanent.autoStart = true;
      await this.writeSecret("tunnel", this.permanent);
    }
    clearTimeout(this.retry);
    this.retry = undefined;
    this.enabled = true;
    this.starting = true;
    this.error = null;
    const generation = this.generation;
    this.emit("state");
    try {
      if (!this.gateway.server) {
        this.gateway.phones = await this.readSecret<Phone[]>("phones", []);
        this.push.config = await this.readSecret<PushConfig | undefined>(
          "push",
          undefined,
        );
      }
      if (generation !== this.generation || !this.enabled) return;
      const port = await this.gateway.start(this.permanent?.port || 0);
      const url =
        this.permanent && this.tunnel.child
          ? this.permanent.url
          : await this.tunnel.open(this.helper, port, this.permanent);
      if (generation !== this.generation || !this.enabled) return;
      if (this.permanent) {
        let matched = false;
        for (
          let i = 0;
          i < 12 && generation === this.generation && this.enabled;
          i++
        ) {
          try {
            const response = await fetch(url + "/health", {
              cache: "no-store",
              signal: AbortSignal.timeout(3000),
            });
            const health = (await response.json()) as any;
            if (health.instance === this.gateway.instanceId) {
              matched = true;
              break;
            }
          } catch {}
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (!matched)
          throw Error(
            "The permanent hostname is not reaching this Mac. Route it to http://127.0.0.1:47832 in Cloudflare.",
          );
      }
      if (generation !== this.generation || !this.enabled) return;
      this.gateway.url = url;
      this.connected = true;
      this.retryCount = 0;
      await this.refreshQR();
    } catch (e) {
      if (generation !== this.generation) return;
      this.error = e instanceof Error ? e.message : String(e);
      this.connected = false;
      if (!this.permanent) {
        this.tunnel.close();
        this.gateway.close();
      }
      throw e;
    } finally {
      if (generation === this.generation) {
        this.starting = false;
        this.emit("state");
        if (!this.connected) this.scheduleRetry();
      }
    }
  }
  async refreshQR() {
    if (!this.gateway.url) throw Error("Enable the mobile link first.");
    const qr = await this.gateway.createQR(this.gateway.url);
    this.qrDataURL = await QRCode.toDataURL(JSON.stringify(qr), {
      width: 320,
      margin: 2,
      errorCorrectionLevel: "M",
    });
    this.qrExpires = qr.expires;
    this.emit("state");
  }
  stopRuntime() {
    this.enabled = false;
    this.connected = false;
    this.starting = false;
    this.generation++;
    clearTimeout(this.retry);
    this.retry = undefined;
    this.releaseVoice();
    this.gateway.close();
    this.tunnel.close();
    this.qrDataURL = "";
    this.qrExpires = 0;
  }
  async disable() {
    this.stopRuntime();
    if (this.permanent) {
      this.permanent.autoStart = false;
      await this.writeSecret("tunnel", this.permanent);
    }
    this.emit("state");
  }
  releaseVoice() {
    this.voiceOwner = null;
    this.voiceLease = 0;
    this.voiceStarted = false;
    this.remoteVoice(false);
    this.emit("state");
  }
  async configurePush() {
    const android = await dialog.showOpenDialog(this.owner(), {
      title: "Select Firebase Android google-services.json",
      properties: ["openFile"],
    });
    if (android.canceled) return;
    const account = await dialog.showOpenDialog(this.owner(), {
      title: "Select the private FCM service-account JSON (stays on this Mac)",
      properties: ["openFile"],
    });
    if (account.canceled) return;
    const read = (p: string) => {
      const b = readFileSync(p);
      if (b.length > 100000) throw Error("Configuration file is too large.");
      return JSON.parse(b.toString());
    };
    const config = parsePushConfig(
      read(android.filePaths[0]),
      read(account.filePaths[0]),
    );
    await this.writeSecret("push", config);
    this.push.config = config;
    this.push.access = undefined;
    this.emit("state");
    void this.gateway.push({ type: "configuration" });
  }
  async rpc(method: string, p: any, phone: Phone): Promise<unknown> {
    if(method === "updates.check") {if(!this.checkUpdates)throw Error("Updates unavailable.");return this.checkUpdates();}
    if(method === "updates.android") {if(!this.androidUpdate)throw Error("Android release unavailable.");return this.androidUpdate();}
    if (method === "snapshot") {
      const s = this.snapshotLocal();
      const value = {
        ...s,
        remote: undefined,
        memories: [],
        entries: s.entries
          .filter((e) => e.role !== "activity")
          .slice(-60)
          .map((e) => ({
            ...e,
            text:
              e.text.length > 6000
                ? e.text.slice(0, 6000) + "\n[Long message truncated on mobile]"
                : e.text,
          })),
        tasks: s.tasks.slice(0, 20),
        jobs: s.jobs?.slice(0, 30).map((j) => ({
          ...j,
          goal:
            j.goal.length > 2000
              ? j.goal.slice(0, 2000) + "\n[Full goal available on Mac]"
              : j.goal,
          result:
            j.result && j.result.length > 3000
              ? j.result.slice(0, 3000) + "\n[Full result available on Mac]"
              : j.result,
          checkpoint: j.checkpoint?.slice(0, 1500),
          activeMs: Math.floor(j.activeMs / 60000) * 60000,
          updatedAt: Math.floor(j.updatedAt / 60000) * 60000,
        })),
        monitors: s.monitors?.slice(0, 30).map((m) => ({
          ...m,
          goal:
            m.goal.length > 1000
              ? m.goal.slice(0, 1000) + "\n[Full goal available on Mac]"
              : m.goal,
        })),
      };
      if (Buffer.byteLength(JSON.stringify(value)) > 700000)
        throw Error(
          "This approval is too large to review on a phone. Review it on the Mac.",
        );
      const revision = createHash("sha256")
        .update(JSON.stringify(value))
        .digest("hex");
      if (p?.revision === revision) return { unchanged: true, revision };
      return { ...value, revision };
    }
    if (method === "send") {
      if (
        typeof p?.text !== "string" ||
        !p.text.trim() ||
        p.text.length > 100000
      )
        throw Error("Invalid task text.");
      return this.invoke("send", p.text);
    }
    if (method === "monitor.control") {
      if (typeof p?.id !== "string" || !["pause", "remove"].includes(p.action))
        throw Error("Invalid monitor action");
      return this.invoke(method, p);
    }
    if (method === "job.enqueue") {
      if (
        typeof p?.goal !== "string" ||
        !["desktop", "project"].includes(p.profile) ||
        p.goal.length > 100000
      )
        throw Error("Invalid job");
      return this.invoke(method, p);
    }
    if (method === "job.control") {
      if (
        typeof p?.id !== "string" ||
        !["resume", "pause", "cancel"].includes(p.action)
      )
        throw Error("Invalid job action");
      return this.invoke(method, p);
    }
    if (method === "stop.current") return this.invoke(method, null);
    if (method === "stop") return this.invoke("stop", null);
    if (method === "approve") {
      if (
        (typeof p?.id !== "string" && typeof p?.id !== "number") ||
        typeof p?.accept !== "boolean"
      )
        throw Error("Invalid approval");
      return this.invoke("approve", p);
    }
    if (method === "answer") {
      if (
        !p ||
        typeof p.answers !== "object" ||
        JSON.stringify(p).length > 10000
      )
        throw Error("Invalid answer");
      return this.invoke("answer", p);
    }
    if (method === "voice.activity") {
      if (typeof p?.active !== "boolean") throw Error("Invalid voice state");
      if (p.active) {
        if (
          this.localVoice() ||
          (this.voiceOwner && this.voiceOwner !== phone.id)
        )
          throw Error("Another JARVIS voice conversation is active.");
        if (!this.voiceOwner) {
          this.voiceOwner = phone.id;
          this.voiceStarted = false;
        }
        this.voiceLease = Date.now() + 45000;
        this.remoteVoice(true);
        this.emit("state");
      } else if (this.voiceOwner === phone.id) this.releaseVoice();
      return { active: this.voiceOwner === phone.id };
    }
    if (method === "voice.heartbeat") {
      if (this.voiceOwner !== phone.id) throw Error("Voice lease expired");
      this.voiceLease = Date.now() + 45000;
      return {};
    }
    if (method === "voice.connect") {
      if (this.voiceOwner !== phone.id || this.voiceStarted)
        throw Error("Start a new authorized voice call first.");
      this.voiceStarted = true;
      return this.invoke("voice.connect", p?.sdp);
    }
    if (method === "config")
      return {
        firebase: this.push.config?.client || null,
        registered: !!phone.pushToken,
      };
    if (method === "push.register") {
      if (!this.push.config)
        throw Error("Configure Firebase on the Mac first.");
      if (
        typeof p?.token !== "string" ||
        p.token.length < 20 ||
        p.token.length > 5000
      )
        throw Error("Invalid push token");
      for (const other of this.gateway.phones)
        if (other.id !== phone.id && other.pushToken === p.token)
          delete other.pushToken;
      phone.pushToken = p.token;
      await this.writeSecret("phones", this.gateway.phones);
      return { registered: true };
    }
    if (method === "push.disable") {
      delete phone.pushToken;
      await this.writeSecret("phones", this.gateway.phones);
      return { registered: false };
    }
    if (method === "call.info" || method === "call.accept") {
      const call = this.calls.get(p?.id);
      if (
        call?.attention &&
        !attentionPending(call.attention, this.snapshotLocal())
      ) {
        this.calls.delete(p.id);
        throw Error(
          "This information or approval request has already been resolved.",
        );
      }
    }
    if (method === "call.info") return this.callRegistry.info(p?.id, phone.id);
    if (method === "call.decline")
      return this.callRegistry.decline(p?.id, phone.id);
    if (method === "call.accept") {
      if (
        this.localVoice() ||
        (this.voiceOwner && this.voiceOwner !== phone.id)
      )
        throw Error("JARVIS is already in another conversation.");
      const result = this.callRegistry.accept(p?.id, phone.id);
      void this.gateway.push({
        type: "callDismissed",
        id: result.id,
        exceptPhone: phone.id,
      });
      for (const other of this.gateway.phones.filter(
        (x) => x.id !== phone.id && x.pushToken,
      ))
        void this.push
          .send(
            other.pushToken!,
            result.id as string,
            other.id,
            result.expires,
            "cancel",
          )
          .catch(() => {});
      return result;
    }
    throw Error("This operation is not available remotely.");
  }
  async notify(
    reason = "Your desktop has an update.",
    onlyPhone?: string,
    attention?: AttentionRequest,
  ) {
    if (attention && !attentionPending(attention, this.snapshotLocal()))
      return {
        accepted: false,
        reason: "The pending request has already been resolved.",
      };
    if (Date.now() - this.lastCallAt < 10000)
      return { accepted: false, reason: "Rate limited" };
    const phones = this.gateway.phones.filter(
      (p) => p.id !== this.voiceOwner && (!onlyPhone || p.id === onlyPhone),
    );
    if (!phones.length)
      return {
        accepted: false,
        reason: this.voiceOwner
          ? "The paired phone is still in a voice call. End it and wait for the call to disconnect before ringing again."
          : "No eligible phone is paired.",
      };
    this.lastCallAt = Date.now();
    for (const [id, c] of this.calls)
      if (c.expires < Date.now()) this.calls.delete(id);
    const id = crypto.randomUUID();
    const call = this.callRegistry.create(
      id,
      reason,
      phones.map((p) => p.id),
      Date.now(),
      attention,
    );
    await this.gateway.push(
      {
        type: "incoming",
        call: { id, reason: call.reason, expires: call.expires },
      },
      phones.map((p) => p.id),
    );
    if (!this.calls.has(id))
      return {
        accepted: false,
        reason: "The pending request was resolved before ringing.",
      };
    const results = await Promise.all(
      phones
        .filter((p) => p.pushToken)
        .map(async (p) => {
          try {
            return await this.push.send(p.pushToken!, id, p.id, call.expires);
          } catch (e) {
            return {
              accepted: false,
              error: e instanceof Error ? e.message : String(e),
            };
          }
        }),
    );
    return {
      id,
      foregroundClients: this.gateway.clients.size,
      push: results,
      note: "Locked-phone delivery must be verified on the device.",
    };
  }
  onBackgroundUpdate?: (update: TaskUpdate) => void;
  observe(s: Snapshot) {
    for (const { id, call } of this.callRegistry.resolved((ref) =>
      attentionPending(ref, s),
    )) {
      void this.gateway
        .push({ type: "callDismissed", id }, call.phoneIds)
        .catch(() => {});
      for (const p of this.gateway.phones.filter(
        (p) => call.phoneIds.includes(p.id) && p.pushToken,
      ))
        void this.push
          .send(p.pushToken!, id, p.id, call.expires, "cancel")
          .catch(() => {});
    }

    const prior = this.previousTask;
    this.previousTask = s.activeTaskId;
    for (const update of pendingAttention(s)) {
      const key = attentionKey(update.attention!);
      if (!this.notified.has(key)) {
        this.notified.add(key);
        this.onBackgroundUpdate?.(update);
      }
    }
    if (prior && !s.activeTaskId && !this.explicitPhoneTasks.delete(prior)) {
      const t = s.tasks.find((t) => t.id === prior);
      if (t?.status === "interrupted" || t?.status === "cancelled") return;
      const result = s.entries
        .filter((e) => e.taskId === prior && e.role === "assistant")
        .at(-1)?.text;
      this.onBackgroundUpdate?.({
        text: `Desktop task ${t?.status || "finished"}. ${result || ""}`,
      });
    }
  }
  close() {
    clearInterval(this.timer);
    this.stopRuntime();
  }
}
