import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
export type WakeStatus = {
  state: "disabled" | "starting" | "listening" | "paused" | "error";
  detail: string;
  lastWakeAt: string | null;
  diagnostics?: {
    rms?: number;
    updates?: number;
    heardHey?: boolean;
    heardJarvis?: boolean;
    retry?: string;
  };
};
export class WakeController extends EventEmitter {
  enabled = false;
  voiceActive = false;
  systemPaused = false;
  quitting = false;
  cooldownUntil = 0;
  child?: ChildProcessWithoutNullStreams;
  timer?: ReturnType<typeof setTimeout>;
  status: WakeStatus = {
    state: "disabled",
    detail: "Local wake listening is off.",
    lastWakeAt: null,
  };
  constructor(public helperPath: string) {
    super();
  }
  publish(state: WakeStatus["state"], detail: string) {
    this.status = { ...this.status, state, detail };
    this.emit("status", this.status);
  }
  configure(enabled: boolean) {
    this.enabled = enabled;
    this.reconcile();
  }
  setVoiceActive(active: boolean) {
    this.voiceActive = active;
    if (!active) this.cooldownUntil = Date.now() + 2000;
    this.reconcile();
  }
  setSystemPaused(paused: boolean) {
    this.systemPaused = paused;
    this.reconcile();
  }
  stopChild() {
    const child = this.child;
    this.child = undefined;
    child?.kill("SIGTERM");
    clearTimeout(this.timer);
  }
  reconcile() {
    this.stopChild();
    if (this.quitting) return;
    if (!this.enabled) {
      this.publish("disabled", "Local wake listening is off.");
      return;
    }
    if (this.voiceActive || this.systemPaused) {
      this.publish(
        "paused",
        this.systemPaused
          ? "Paused while the Mac is locked or asleep."
          : "Paused during the active voice session.",
      );
      return;
    }
    const delay = this.cooldownUntil - Date.now();
    if (delay > 0) {
      this.publish("starting", "Rearming local wake listening…");
      this.timer = setTimeout(() => this.start(), delay);
      return;
    }
    this.start();
  }
  start() {
    if (
      !this.enabled ||
      this.voiceActive ||
      this.systemPaused ||
      this.quitting ||
      this.child
    )
      return;
    if (!existsSync(this.helperPath)) {
      this.publish(
        "error",
        "The native wake helper is missing. Build the packaged JARVIS app.",
      );
      return;
    }
    this.publish("starting", "Starting strictly on-device recognition…");
    const child = spawn(this.helperPath, [], { stdio: "pipe" });
    this.child = child;
    child.on("error", (error) => {
      if (this.child === child) {
        this.child = undefined;
        this.publish("error", error.message);
      }
    });
    createInterface({ input: child.stdout }).on("line", (line) => {
      if (this.child !== child) return;
      try {
        this.receive(JSON.parse(line));
      } catch {}
    });
    child.stderr.resume();
    child.on("exit", (code) => {
      if (this.child !== child) return;
      this.child = undefined;
      if (this.status.state !== "error") {
        this.publish(
          "error",
          `Wake listener exited (${code}). Toggle wake listening to retry.`,
        );
      }
    });
  }
  receive(event: any) {
    if (["audio", "candidate", "retry"].includes(event.type)) {
      this.status.diagnostics = {
        ...this.status.diagnostics,
        ...(event.type === "audio"
          ? { rms: Number(event.rms) }
          : event.type === "candidate"
            ? {
                updates:
                  typeof event.updates === "number"
                    ? event.updates
                    : (this.status.diagnostics?.updates || 0) + 1,
                heardHey: !!event.heardHey,
                heardJarvis: !!event.heardJarvis,
              }
            : { retry: String(event.message) }),
      };
      this.emit("status", this.status);
      return;
    }
    if (event.type === "ready" && event.onDevice === true)
      this.publish(
        "listening",
        "Listening locally for “Hey JARVIS”. No API voice session is open.",
      );
    else if (event.type === "error") {
      this.publish("error", String(event.message));
      this.stopChild();
    } else if (event.type === "wake" && event.onDevice === true) {
      if (
        !this.enabled ||
        this.voiceActive ||
        this.systemPaused ||
        Date.now() < this.cooldownUntil
      )
        return;
      this.status.lastWakeAt = new Date().toISOString();
      this.voiceActive = true;
      this.cooldownUntil = Date.now() + 10000;
      this.stopChild();
      this.publish("paused", "Wake phrase detected. Connecting voice…");
      this.emit("wake");
    }
  }
  close() {
    this.quitting = true;
    this.stopChild();
  }
}
