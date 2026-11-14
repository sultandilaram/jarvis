import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { desktopFunction } from "../desktop/broker.ts";
import {
  complete,
  userMessage,
  resultMessages,
  providerIdentity,
  type ProviderProfile,
  type ProviderCall,
  type ToolSpec,
} from "./protocol.ts";
import { imageSource } from "./images.ts";
import { withoutInlineImages } from "../../shared/image-history.ts";
export interface TaskEngine extends EventEmitter {
  readonly identity?: string;
  desktopMode: boolean;
  desktopConfig: Record<string, unknown>;
  connect(cwd: string): Promise<void>;
  request(method: string, params?: any, timeout?: number): Promise<any>;
  reply(id: string | number, result: unknown): void;
  reject(id: string | number, message: string): void;
  close(): void;
}
export type HistoryStore = {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
};
type Thread = {
  signature: string;
  system: string;
  messages: any[];
  interrupted: boolean;
};
export class ProviderEngine extends EventEmitter implements TaskEngine {
  desktopMode = true;
  desktopConfig = {};
  private signature: string;
  private threads = new Map<string, Thread>();
  private active?: {
    threadId: string;
    turnId: string;
    abort: AbortController;
    corrections: string[];
  };
  private replies = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (e: Error) => void;
      cleanup: () => void;
    }
  >();
  constructor(
    public profile: ProviderProfile,
    private store: HistoryStore,
    private fetcher: typeof fetch = fetch,
    private toolSpecs: ToolSpec[] = [{name:"jarvis_desktop",description:desktopFunction.description,parameters:desktopFunction.inputSchema}],
  ) {
    super();
    this.profile = { ...profile };
    this.signature = providerIdentity(profile);
  }
  get identity() {
    return this.signature;
  }
  async connect(_cwd: string) {}
  private save(id: string, t: Thread) {
    const saved = withoutInlineImages(t);
    if (Buffer.byteLength(JSON.stringify(saved)) > 2 * 1024 * 1024)
      throw Error(
        "Provider conversation reached its local size limit. Start a new conversation; no text context was silently discarded.",
      );
    this.store.set("providerThread:" + id, saved);
  }
  private thread(id: string) {
    let t = this.threads.get(id);
    if (!t) {
      t =
        this.store.get<Thread | null>("providerThread:" + id, null) ||
        undefined;
      if (t) this.threads.set(id, t);
    }
    if (!t || t.signature !== this.signature)
      throw Error(
        "This conversation belongs to another provider. Start a new conversation.",
      );
    return t;
  }
  async request(method: string, p: any = {}): Promise<any> {
    if (method === "model/list")
      return { data: [{ model: this.profile.model, isDefault: true }] };
    if (method === "thread/start") {
      const id = "provider-" + randomUUID(),
        t: Thread = {
          signature: this.signature,
          system: String(p.developerInstructions || ""),
          messages: [],
          interrupted: false,
        };
      this.threads.set(id, t);
      this.save(id, t);
      return { thread: { id } };
    }
    if (method === "thread/resume") {
      const t = this.thread(p.threadId);
      if (t.interrupted)
        throw Error(
          "This provider conversation was interrupted. Inspect prior task effects and start a new conversation; unfinished tool calls will not be replayed.",
        );
      t.system = String(p.developerInstructions || t.system);
      this.save(p.threadId, t);
      return { thread: { id: p.threadId } };
    }
    if (method === "turn/steer") {
      if (
        !this.active ||
        p.threadId !== this.active.threadId ||
        p.expectedTurnId !== this.active.turnId
      )
        throw Error("The active provider turn changed.");
      this.active.corrections.push(this.input(p.input));
      return {};
    }
    if (method === "turn/interrupt") {
      if (
        this.active &&
        p.threadId === this.active.threadId &&
        p.turnId === this.active.turnId
      )
        this.active.abort.abort(Error("Stopped by the user."));
      return {};
    }
    if (method !== "turn/start")
      throw Error("Provider adapter does not support this operation.");
    if (this.active) throw Error("A provider task is already running.");
    const t = this.thread(p.threadId);
    if (t.interrupted)
      throw Error("Interrupted provider context requires a new conversation.");
    const text = this.input(p.input),
      active = {
        threadId: p.threadId as string,
        turnId: randomUUID(),
        abort: new AbortController(),
        corrections: [] as string[],
      };
    t.messages.push(userMessage(this.profile.kind, text));
    t.interrupted = true;
    this.save(active.threadId, t);
    this.active = active;
    // Start after the request response is delivered to the existing orchestrator.
    setImmediate(() => void this.run(active, t));
    return { turn: { id: active.turnId } };
  }
  private input(value: any) {
    if (
      !Array.isArray(value) ||
      value.some((v) => v.type !== "text" || typeof v.text !== "string")
    )
      throw Error("This provider adapter currently accepts text tasks only.");
    return value.map((v) => v.text).join("\n");
  }
  private notify(method: string, params: Record<string, unknown>) {
    this.emit("notification", { method, params });
  }
  private invoke(
    call: ProviderCall,
    active: NonNullable<ProviderEngine["active"]>,
  ): Promise<any> {
    if (call.name !== "jarvis_desktop")
      throw Error("Provider requested an unknown tool; nothing executed.");
    if (typeof call.args.action !== "string")
      throw Error("Provider tool call has no action.");
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.replies.delete(id);
        reject(Error("Tool wait cancelled; inspect effects before resuming."));
      };
      this.replies.set(id, {
        resolve,
        reject,
        cleanup: () => active.abort.signal.removeEventListener("abort", abort),
      });
      active.abort.signal.addEventListener("abort", abort, { once: true });
      this.emit("request", {
        id,
        method: "item/tool/call",
        params: {
          threadId: active.threadId,
          turnId: active.turnId,
          namespace: "jarvis",
          tool: "desktop",
          arguments: call.args,
        },
      });
    });
  }
  private async run(active: NonNullable<ProviderEngine["active"]>, t: Thread) {
    const signal = active.abort.signal,
      context = { threadId: active.threadId, turnId: active.turnId };
    this.notify("turn/started", { ...context, turn: { id: active.turnId } });
    let status = "completed",
      error: { message: string } | undefined,
      usage = 0;
    try {
      for (let round = 0; round < 40; round++) {
        signal.throwIfAborted();
        for (const text of active.corrections.splice(0))
          t.messages.push(
            userMessage(this.profile.kind, "Operator correction: " + text),
          );
        this.save(active.threadId, t);
        const tools = this.profile.toolsVerified ? this.toolSpecs : [];
        const result = await complete(
          this.profile,
          t.messages,
          t.system +
            (!this.profile.toolsVerified
              ? "\nThis model has not passed JARVIS tool verification. Conversation only: do not claim to access files, accounts or execute tasks."
              : ""),
          tools,
          signal,
          this.fetcher,
        );
        signal.throwIfAborted();
        usage += result.usage;
        t.messages = withoutInlineImages(t.messages);
        this.notify("thread/tokenUsage/updated", {
          ...context,
          tokenUsage: { total: { totalTokens: usage } },
        });
        // A correction arriving during inference invalidates the unsent tool proposal.
        // Keep the response in history, but reject all calls before any can execute.
        t.messages.push(result.assistant);
        if (result.text)
          this.notify("item/completed", {
            ...context,
            item: { id: randomUUID(), type: "agentMessage", text: result.text },
          });
        if (!result.calls.length) {
          if (active.corrections.length) continue;
          t.interrupted = false;
          this.save(active.threadId, t);
          return;
        }
        if (!this.profile.toolsVerified)
          throw Error("Unverified model attempted tools; nothing executed.");
        if (result.calls.some((c) => c.name !== "jarvis_desktop"))
          throw Error("Provider requested an unknown tool; nothing executed.");
        const outputs: {
          call: ProviderCall;
          text: string;
          failed: boolean;
          images?: string[];
        }[] = [];
        for (const call of result.calls) {
          signal.throwIfAborted();
          if (active.corrections.length) {
            outputs.push({
              call,
              text: "Operator corrected this task before execution. This tool call was not executed. Replan after the correction.",
              failed: true,
            });
            continue;
          }
          this.save(active.threadId, t);
          const response = await this.invoke(call, active);
          signal.throwIfAborted();
          if (
            response.contentItems?.some(
              (b: any) => !["inputText", "inputImage"].includes(b.type),
            )
          )
            throw Error(
              "Provider adapter cannot consume this tool’s result; inspect outcome before continuing.",
            );
          const images = (response.contentItems || [])
            .filter((b: any) => b.type === "inputImage")
            .map((b: any) => {
              imageSource(b.imageUrl);
              return b.imageUrl as string;
            });
          if (images.length && !this.profile.visionVerified)
            throw Error(
              "This model has not passed JARVIS’s vision probe. Window images were not sent to it.",
            );
          outputs.push({
            call,
            text: JSON.stringify({
              ...response,
              contentItems: response.contentItems?.filter(
                (b: any) => b.type === "inputText",
              ),
            }),
            failed: response.success !== true,
            images,
          });
        }
        t.messages.push(...resultMessages(this.profile.kind, outputs));
        this.save(active.threadId, t);
      }
      throw Error(
        "Provider task reached its 40-round limit. Inspect completed effects before continuing.",
      );
    } catch (e) {
      status = signal.aborted ? "interrupted" : "failed";
      error = {
        message: signal.aborted
          ? "Stopped. Prior effects were not undone."
          : e instanceof Error
            ? e.message
            : "Provider task failed.",
      };
    } finally {
      if (this.active === active) this.active = undefined;
      // An interrupted history stays marked so restart/resume cannot replay tools.
      this.notify("turn/completed", {
        ...context,
        turn: { id: active.turnId, status, ...(error ? { error } : {}) },
      });
    }
  }
  reply(id: string | number, result: unknown) {
    const p = this.replies.get(String(id));
    if (!p) return;
    p.cleanup();
    this.replies.delete(String(id));
    p.resolve(result);
  }
  reject(id: string | number, message: string) {
    const p = this.replies.get(String(id));
    if (!p) return;
    p.cleanup();
    this.replies.delete(String(id));
    p.reject(Error(message));
  }
  close() {
    this.active?.abort.abort(Error("Provider closed."));
    for (const p of this.replies.values()) {
      p.cleanup();
      p.reject(Error("Provider closed."));
    }
    this.replies.clear();
  }
}
