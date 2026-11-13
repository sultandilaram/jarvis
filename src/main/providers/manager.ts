import { EventEmitter } from "node:events";
import { randomUUID, randomInt } from "node:crypto";
import { Codex } from "../codex.ts";
import {
  ProviderEngine,
  type TaskEngine,
  type HistoryStore,
} from "./engine.ts";
import {
  complete,
  defaults,
  resultMessages,
  userMessage,
  validateProfile,
  providerIdentity,
  type ProviderKind,
  type ProviderProfile,
} from "./protocol.ts";
import { imageMessage, visionProbeImage } from "./images.ts";
export type ProviderState = {
  selected: ProviderKind;
  profiles: {
    kind: ProviderKind;
    endpoint: string;
    model: string;
    hasKey: boolean;
    toolsVerified: boolean;
    visionVerified: boolean;
  }[];
  testing: boolean;
  error?: string;
};
type Config = {
  selected: ProviderKind;
  profiles: Partial<Record<ProviderKind, ProviderProfile>>;
};
export class ProviderManager extends EventEmitter {
  config: Config = { selected: "codex", profiles: {} };
  testing = false;
  private generation = 0;
  private testAbort?: AbortController;
  get revision() {
    return this.generation;
  }
  constructor(
    private storage: {
      load: () => Promise<Config | null>;
      save: (c: Config) => Promise<void>;
    },
    private fetcher: typeof fetch = fetch,
  ) {
    super();
  }
  async load() {
    const c = await this.storage.load();
    if (c) {
      if (
        !Object.hasOwn(defaults, c.selected) ||
        !c.profiles ||
        typeof c.profiles !== "object"
      )
        throw Error("Invalid saved provider configuration.");
      for (const p of Object.values(c.profiles)) {
        if (!p) continue;
        validateProfile(p);
      }
      this.config = c;
    }
  }
  snapshot(): ProviderState {
    return {
      selected: this.config.selected,
      profiles: Object.keys(defaults).map((kind) => {
        const p = this.config.profiles[kind as ProviderKind];
        return {
          kind: kind as ProviderKind,
          endpoint: p?.endpoint || defaults[kind as ProviderKind],
          model: p?.model || "",
          hasKey: !!p?.key,
          toolsVerified: kind === "codex" || !!p?.toolsVerified,
          visionVerified: kind === "codex" || !!p?.visionVerified,
        };
      }),
      testing: this.testing,
    };
  }
  profile() {
    return this.config.selected === "codex"
      ? undefined
      : this.config.profiles[this.config.selected];
  }
  prepare(value: unknown) {
    const raw = value as ProviderProfile,
      previous = raw && this.config.profiles[raw.kind];
    const endpoint =
      typeof raw?.endpoint === "string" ? raw.endpoint.replace(/\/$/, "") : "";
    const p = validateProfile({
      ...raw,
      key:
        raw?.key ||
        (previous?.endpoint === endpoint ? previous.key : undefined),
    });
    if (["anthropic", "gemini"].includes(p.kind) && !p.key)
      throw Error("Enter a provider API key.");
    p.toolsVerified = false;
    p.visionVerified = false;
    return p;
  }
  async save(value: unknown) {
    if (this.testing)
      throw Error(
        "Cancel the model test before changing provider configuration.",
      );
    const p = this.prepare(value);
    const next: Config = {
      ...this.config,
      profiles: { ...this.config.profiles, [p.kind]: p },
    };
    await this.storage.save(next);
    this.generation++;
    this.testAbort?.abort();
    this.config = next;
    this.emit("change");
  }
  async select(kind: unknown) {
    if (this.testing)
      throw Error(
        "Cancel the model test before changing provider configuration.",
      );
    if (typeof kind !== "string" || !Object.hasOwn(defaults, kind))
      throw Error("Choose a configured provider.");
    if (kind !== "codex" && !this.config.profiles[kind as ProviderKind])
      throw Error("Save the model configuration first.");
    const next = { ...this.config, selected: kind as ProviderKind };
    await this.storage.save(next);
    this.config = next;
    this.generation++;
    this.testAbort?.abort();
    this.emit("change");
  }
  async remove(kind: unknown) {
    if (this.testing)
      throw Error(
        "Cancel the model test before changing provider configuration.",
      );
    if (kind === this.config.selected)
      throw Error(
        "Switch to another provider before removing this configuration.",
      );
    if (typeof kind !== "string" || !Object.hasOwn(defaults, kind))
      throw Error("Unknown provider.");
    const profiles = { ...this.config.profiles };
    delete profiles[kind as ProviderKind];
    const next = { ...this.config, profiles };
    await this.storage.save(next);
    this.config = next;
    this.generation++;
    this.testAbort?.abort();
    this.emit("change");
  }
  cancelTest() {
    this.testAbort?.abort(Error("Provider test cancelled."));
  }
  async test(kind: unknown) {
    return this.probe(kind, "tools");
  }
  async testVision(kind: unknown) {
    return this.probe(kind, "vision");
  }
  private async probe(kind: unknown, feature: "tools" | "vision") {
    if (this.testing) throw Error("A provider test is already running.");
    const original =
      typeof kind === "string"
        ? this.config.profiles[kind as ProviderKind]
        : undefined;
    if (!original || original.kind === "codex")
      throw Error("Save an API or local provider before testing.");
    this.testing = true;
    const abort = new AbortController();
    this.testAbort = abort;
    this.emit("change");
    try {
      const p = {
        ...original,
        [feature === "tools" ? "toolsVerified" : "visionVerified"]: false,
      };
      const reset = {
        ...this.config,
        profiles: { ...this.config.profiles, [p.kind]: p },
      };
      await this.storage.save(reset);
      this.config = reset;
      this.generation++;
      const generation = this.generation;
      this.emit("change");
      abort.signal.throwIfAborted();
      if (feature === "vision") {
        const nonce = String(randomInt(0, 100000000)).padStart(8, "0");
        const result = await complete(
          p,
          [
            imageMessage(
              p.kind,
              "Read the eight digits in this generated compatibility image. Reply with exactly those digits and nothing else.",
              [visionProbeImage(nonce)],
            ),
          ],
          "Read only the supplied test image. Do not call any tools.",
          [],
          abort.signal,
          this.fetcher,
        );
        if (result.calls.length || result.text.trim() !== nonce)
          throw Error(
            "Vision probe did not read the test image correctly. Window images remain disabled for this model.",
          );
      } else {
        const nonce = randomUUID(),
          tool = {
            name: "jarvis_probe",
            description:
              "Return the exact nonce supplied by the operator. Harmless compatibility probe; no external effects.",
            parameters: {
              type: "object",
              properties: { nonce: { type: "string" } },
              required: ["nonce"],
              additionalProperties: false,
            },
          };
        const history = [
          userMessage(
            p.kind,
            "Call jarvis_probe exactly once with nonce " +
              nonce +
              ". Do not answer in prose.",
          ),
        ];
        const result = await complete(
          p,
          history,
          "Test structured tool calling. Use only the provided probe.",
          [tool],
          abort.signal,
          this.fetcher,
        );
        if (
          result.calls.length !== 1 ||
          result.calls[0].name !== tool.name ||
          result.calls[0].args.nonce !== nonce
        )
          throw Error(
            "The model did not produce the required structured tool call. It remains conversation-only.",
          );
        history.push(
          result.assistant,
          ...resultMessages(p.kind, [
            {
              call: result.calls[0],
              text: JSON.stringify({ nonce }),
              failed: false,
            },
          ]),
        );
        history.push(
          userMessage(
            p.kind,
            "Now reply with the exact nonce only, without calling a tool.",
          ),
        );
        const final = await complete(
          p,
          history,
          "Finish the compatibility probe by echoing its nonce.",
          [],
          abort.signal,
          this.fetcher,
        );
        if (final.calls.length || !final.text.includes(nonce))
          throw Error(
            "Tool-result continuation did not pass. The model remains conversation-only.",
          );
      }
      abort.signal.throwIfAborted();
      if (generation !== this.generation || this.config.profiles[p.kind] !== p)
        throw Error("Provider configuration changed during the test.");
      const nextProfile = {
        ...p,
        [feature === "tools" ? "toolsVerified" : "visionVerified"]: true,
      };
      const next = {
        ...this.config,
        profiles: { ...this.config.profiles, [p.kind]: nextProfile },
      };
      await this.storage.save(next);
      // Cancel can arrive while the final encrypted write is pending. Never
      // publish that grant; persist the already-disabled profile before finishing.
      if (abort.signal.aborted) {
        this.config = reset;
        this.generation++;
        this.emit("change");
        try {
          await this.storage.save(reset);
        } catch {
          throw Error(
            "Provider test cancelled, but saving the disabled capability failed. Re-save this connection before restarting JARVIS.",
          );
        }
        abort.signal.throwIfAborted();
      }
      this.config = next;
      this.generation++;
      return {
        toolsVerified: !!nextProfile.toolsVerified,
        visionVerified: !!nextProfile.visionVerified,
        note:
          feature === "vision"
            ? "Synthetic image reading passed. Real desktop acceptance remains separate."
            : "Structured tool call and result continuation passed. Real task acceptance remains separate.",
      };
    } finally {
      this.testing = false;
      this.testAbort = undefined;
      this.emit("change");
    }
  }
}
export class ProviderRouter extends EventEmitter implements TaskEngine {
  desktopMode = false;
  desktopConfig: Record<string, unknown> = {};
  private engine?: TaskEngine;
  constructor(
    private version: string,
    private manager: ProviderManager,
    private store: HistoryStore,
  ) {
    super();
  }
  get identity() {
    const p = this.manager.profile();
    return p ? providerIdentity(p) : "codex";
  }
  async connect(cwd: string) {
    if (this.engine) {
      this.engine.removeAllListeners();
      this.engine.close();
    }
    const profile = this.manager.profile();
    if (this.manager.config.selected !== "codex" && !profile)
      throw Error("The selected provider is not configured.");
    const engine: TaskEngine = profile
      ? new ProviderEngine(profile, this.store)
      : new Codex(this.version);
    this.engine = engine;
    engine.desktopMode = this.desktopMode;
    for (const event of [
      "notification",
      "request",
      "disconnected",
      "diagnostic",
    ])
      engine.on(event, (...args) => this.emit(event, ...args));
    await engine.connect(cwd);
    this.desktopConfig = engine.desktopConfig;
  }
  request(method: string, params?: any, timeout?: number) {
    if (!this.engine)
      return Promise.reject(Error("Task provider is not connected."));
    return this.engine.request(method, params, timeout);
  }
  reply(id: string | number, result: unknown) {
    this.engine?.reply(id, result);
  }
  reject(id: string | number, message: string) {
    this.engine?.reject(id, message);
  }
  close() {
    this.engine?.close();
  }
}
