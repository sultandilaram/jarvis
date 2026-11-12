import { attentionPending, type AttentionRequest } from "./attention.ts";
import { randomUUID } from "node:crypto";
import type { ActionPlan } from "./desktop/broker.ts";
import type { Snapshot } from "../shared/types.ts";
export type Watch = {
  id: string;
  symbol: string;
  dropPercent: number;
  windowMinutes: number;
  phoneId: string;
  phoneName: string;
  enabled: boolean;
  createdAt: number;
  samples: { at: number; price: number }[];
  lastCheck?: number;
  error?: string;
};
export type Update = {
  id: string;
  watchId: string;
  attention?: AttentionRequest;
  resolvedAt?: number;
  text: string;
  createdAt: number;
  dueAt: number;
  phoneId: string;
  phoneName: string;
  acknowledgedAt?: number;
  state: "local" | "waiting" | "calling" | "requested" | "failed" | "cancelled";
  error?: string;
};
export type WatchState = {
  watches: Watch[];
  updates: Update[];
  taskPhone?: { id: string; name: string };
};
type Persistence = {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
};
type Ports = {
  phones: () => { id: string; name: string; alertsEnabled?: boolean }[];
  ready: () => boolean;
  notify: (update: Update) => void;
  call: (
    text: string,
    phoneId: string,
    attention?: AttentionRequest,
  ) => Promise<any>;
  changed: () => void;
  quote?: (symbol: string) => Promise<number>;
  now?: () => number;
};
export async function spotPrice(symbol: string): Promise<number> {
  const response = await fetch(
    `https://api.coinbase.com/v2/prices/${symbol}-USD/spot`,
    { signal: AbortSignal.timeout(15000), redirect: "error" },
  );
  if (!response.ok)
    throw Error(`Coinbase quote unavailable (${response.status}).`);
  const body = (await response.json()) as any;
  const value = Number(body?.data?.amount);
  if (
    body?.data?.base !== symbol ||
    body?.data?.currency !== "USD" ||
    !Number.isFinite(value) ||
    value <= 0
  )
    throw Error("Invalid quote from Coinbase.");
  return value;
}
export class WatchManager {
  data: WatchState;
  busy = false;
  closed = false;
  constructor(
    public store: Persistence,
    public ports: Ports,
  ) {
    this.data = store.get<WatchState>("watches-v1", {
      watches: [],
      updates: [],
    });
    // An interrupted call request is uncertain. Never replay it on restart.
    for (const u of this.data.updates)
      if (u.state === "calling") {
        u.state = "failed";
        u.error =
          "App stopped during call request; delivery is unknown. No automatic retry.";
      }
    this.save(false);
  }
  now() {
    return this.ports.now?.() ?? Date.now();
  }
  snapshot() {
    return structuredClone(this.data);
  }
  save(publish = true) {
    this.data.updates = this.data.updates.filter(
      (u, i) => i < 100 || u.state === "waiting" || u.state === "calling",
    );
    this.store.set("watches-v1", this.data);
    if (publish) this.ports.changed();
  }
  target(id: unknown) {
    const p = this.ports.phones().find((p) => p.id === id);
    if (!p || !p.alertsEnabled)
      throw Error("Choose a paired phone with background alerts enabled.");
    return p;
  }
  async plan(
    action: string,
    args: Record<string, unknown>,
  ): Promise<ActionPlan> {
    if (action === "watch.list")
      return {
        title: "Inspect watches and unacknowledged updates",
        approval: false,
        preview: {},
        run: async () => this.snapshot(),
      };
    if (action === "watch.ack") {
      if (
        typeof args.updateId !== "string" ||
        !this.data.updates.some((u) => u.id === args.updateId)
      )
        throw Error("Choose an updateId returned by watch.list.");
      return {
        title: "Acknowledge this update",
        approval: false,
        preview: { updateId: args.updateId },
        run: async () => this.ack(String(args.updateId)),
      };
    }
    if (action === "watch.tasks") {
      const phone = this.target(args.phoneId);
      return {
        title: "Enable background task updates",
        approval: true,
        preview: {
          recipient: phone.name,
          phoneId: phone.id,
          scope:
            "Future task completion, missing-information and approval-needed updates. Ping this Mac first, then request one call to this phone after 60 minutes without acknowledgment. Updates may contain task results. No automatic task execution.",
          until:
            "Disabled in Watches settings or through watch.remove with watchId tasks.",
        },
        verify: async () => {
          if (this.target(phone.id).name !== phone.name)
            throw Error("Phone changed.");
        },
        run: async () => {
          this.data.taskPhone = { id: phone.id, name: phone.name };
          this.save();
          return { enabled: true, recipient: phone.name, delayMinutes: 60 };
        },
      };
    }
    if (action === "watch.remove") {
      if (args.watchId === "tasks")
        return {
          title: "Disable background task phone escalation",
          approval: false,
          preview: {},
          run: async () => this.remove("tasks"),
        };
      const w = this.data.watches.find((w) => w.id === args.watchId);
      if (!w) throw Error("Choose a watchId returned by watch.list.");
      return {
        title: "Remove " + w.symbol + " watch",
        approval: true,
        preview: {
          symbol: w.symbol,
          watchId: w.id,
          effect: "Stop polling and cancel its pending phone escalation.",
        },
        run: async () => this.remove(w.id),
      };
    }
    if (action !== "watch.price") throw Error("Unsupported watch action.");
    const symbol = String(args.symbol || "").toUpperCase();
    const dropPercent = args.dropPercent,
      windowMinutes = args.windowMinutes;
    if (
      !/^[A-Z0-9]{2,12}$/.test(symbol) ||
      typeof dropPercent !== "number" ||
      !Number.isFinite(dropPercent) ||
      dropPercent < 0.1 ||
      dropPercent > 90 ||
      typeof windowMinutes !== "number" ||
      !Number.isInteger(windowMinutes) ||
      windowMinutes < 2 ||
      windowMinutes > 1440
    )
      throw Error(
        "Specify symbol, dropPercent (0.1–90) and windowMinutes (2–1440). Ask the operator what “crashing” means; never invent a threshold.",
      );
    if (this.data.watches.length >= 100)
      throw Error("Remove old watches before creating more.");
    if (this.data.watches.filter((w) => w.enabled).length >= 10)
      throw Error("At most ten watches can be active.");
    const phone = this.target(args.phoneId);
    return {
      title: "Watch " + symbol + " for a price drop",
      approval: true,
      preview: {
        source: "Coinbase public USD spot price",
        symbol,
        condition: `At least ${dropPercent}% below the highest observed price in the last ${windowMinutes} minutes`,
        checkFrequency:
          "Once per minute while this Mac is awake, online and JARVIS is running",
        recipient: phone.name,
        phoneId: phone.id,
        escalation:
          "Mac notification first. If not explicitly acknowledged within 60 minutes, request one call to this phone. A notification click alone does not acknowledge it.",
        scope:
          "One alert, then pause this watch. No trades. No AI credits for polling; answered voice uses API credits.",
      },
      verify: async () => {
        const p = this.target(phone.id);
        if (p.name !== phone.name)
          throw Error("Phone changed; request a fresh approval.");
      },
      run: async (signal) => {
        const price = await (this.ports.quote || spotPrice)(symbol);
        signal.throwIfAborted();
        if (this.closed) throw Error("JARVIS is closing.");
        if (this.data.watches.filter((w) => w.enabled).length >= 10)
          throw Error("At most ten watches can be active.");
        const at = this.now();
        const w: Watch = {
          id: randomUUID(),
          symbol,
          dropPercent,
          windowMinutes,
          phoneId: phone.id,
          phoneName: phone.name,
          enabled: true,
          createdAt: at,
          samples: [{ at, price }],
          lastCheck: at,
        };
        this.data.watches.push(w);
        this.save();
        return {
          ...w,
          samples: undefined,
          baseline: price,
          source: "Coinbase",
          note: "No historical backfill. Polls once per minute. A single exchange quote may differ from other markets.",
        };
      },
    };
  }
  ack(id: string) {
    const u = this.data.updates.find((u) => u.id === id);
    if (!u) throw Error("Update not found.");
    u.acknowledgedAt = this.now();
    if (u.state === "waiting") u.state = "cancelled";
    this.save();
    return {
      acknowledged: true,
      callAlreadyRequested: u.state === "calling" || u.state === "requested",
    };
  }
  remove(id: string) {
    if (id === "tasks") {
      delete this.data.taskPhone;
      for (const u of this.data.updates)
        if (u.watchId === "tasks" && u.state === "waiting")
          u.state = "cancelled";
      this.save();
      return { removed: true };
    }
    const w = this.data.watches.find((w) => w.id === id);
    if (!w) throw Error("Watch not found.");
    w.enabled = false;
    this.data.watches = this.data.watches.filter((w) => w.id !== id);
    for (const u of this.data.updates)
      if (u.watchId === id && u.state === "waiting") u.state = "cancelled";
    this.save();
    return { removed: true };
  }
  pauseAll() {
    for (const w of this.data.watches) w.enabled = false;
    for (const u of this.data.updates)
      if (u.state === "waiting") u.state = "cancelled";
    this.save();
  }
  resolveAttention(snapshot: Snapshot) {
    let changed = false;
    for (const u of this.data.updates)
      if (
        u.attention &&
        !u.resolvedAt &&
        !attentionPending(u.attention, snapshot)
      ) {
        u.resolvedAt = this.now();
        if (u.state === "waiting" || u.state === "local") u.state = "cancelled";
        changed = true;
      }
    if (changed) this.save();
  }
  report(text: string, attention?: AttentionRequest) {
    const at = this.now(),
      phone = this.data.taskPhone;
    const u: Update = {
      id: randomUUID(),
      watchId: "tasks",
      attention,
      text: text.slice(0, 1900),
      createdAt: at,
      dueAt: at + 3600000,
      phoneId: phone?.id || "",
      phoneName: phone?.name || "",
      state: phone ? "waiting" : "local",
    };
    this.data.updates.unshift(u);

    this.save();
    try {
      this.ports.notify(u);
    } catch {
      u.error = "Mac notification unavailable. Review Watches.";
      this.save();
    }
  }
  async tick() {
    if (this.busy || this.closed) return;
    this.busy = true;
    try {
      for (const w of this.data.watches.filter((w) => w.enabled)) {
        const now = this.now();
        if (now - (w.lastCheck ?? 0) < 60000) continue;
        try {
          const price = await (this.ports.quote || spotPrice)(w.symbol);
          if (this.closed || !w.enabled) continue;
          const at = this.now();
          const gap = at - (w.lastCheck ?? at);
          w.lastCheck = at;
          w.error = undefined;
          if (gap > 180000) w.samples = []; // Do not imply continuous monitoring through sleep or outages.
          w.samples = w.samples.filter(
            (s) => at - s.at <= w.windowMinutes * 60000 && s.at <= at,
          );
          w.samples.push({ at, price });
          const high = Math.max(...w.samples.map((s) => s.price));
          const drop = ((high - price) / high) * 100;
          if (drop >= w.dropPercent) {
            w.enabled = false;
            const u: Update = {
              id: randomUUID(),
              watchId: w.id,
              text: `${w.symbol} price alert: Coinbase USD spot is $${price.toFixed(2)}, down ${drop.toFixed(2)}% from the highest price observed within ${w.windowMinutes} minutes ($${high.toFixed(2)}). Observed ${new Date(at).toISOString()}. This is a price alert, not a trade.`,
              createdAt: at,
              dueAt: at + 3600000,
              phoneId: w.phoneId,
              phoneName: w.phoneName,
              state: "waiting",
            };
            this.data.updates.unshift(u);

            this.save();
            try {
              this.ports.notify(u);
            } catch {
              u.error =
                "Mac notification could not be shown. Review this update in Watches.";
            }
          }
        } catch (e) {
          w.error = String(e instanceof Error ? e.message : e);
          w.lastCheck = this.now();
          w.samples = [];
        }
      }
      for (const u of this.data.updates) {
        if (
          this.closed ||
          u.state !== "waiting" ||
          u.acknowledgedAt ||
          this.now() < u.dueAt
        )
          continue;
        const phone = this.ports
          .phones()
          .find(
            (p) =>
              p.id === u.phoneId && p.name === u.phoneName && p.alertsEnabled,
          );
        if (!phone) {
          u.state = "failed";
          u.error =
            "The approved phone was revoked, changed or disabled alerts.";
          continue;
        }
        if (!this.ports.ready()) {
          u.error = "Waiting for the permanent phone link to reconnect.";
          continue;
        }
        // Commit before sending: retries after a crash must never ring a second time.
        u.state = "calling";
        this.save();
        try {
          const result = await this.ports.call(u.text, u.phoneId, u.attention);
          if (u.resolvedAt) {
            u.state = "cancelled";
            u.error = undefined;
            continue;
          }
          if (
            result?.accepted === false ||
            result?.push?.some((p: any) => p.error || p.accepted === false)
          )
            throw Error(
              result.reason || "Phone call request was not accepted.",
            );
          u.state = "requested";
          u.error = undefined;
        } catch (e) {
          u.state = "failed";
          u.error = String(e instanceof Error ? e.message : e);
        }
      }
      this.save();
    } finally {
      this.busy = false;
    }
  }
  close() {
    this.closed = true;
  }
}
