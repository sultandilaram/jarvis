import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
export const bundledCodex =
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
export class Codex extends EventEmitter {
  constructor(public version = "development") {
    super();
  }
  process?: ChildProcessWithoutNullStreams;
  pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  sequence = 0;
  desktopMode = false;
  desktopConfig: Record<string, unknown> = {};
  async connect(cwd: string) {
    const binary =
      process.env.JARVIS_CODEX_PATH ||
      (existsSync(bundledCodex) ? bundledCodex : "codex");
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    const overrides = this.desktopMode
      ? [
          "shell_tool",
          "unified_exec",
          "computer_use",
          "browser_use",
          "browser_use_external",
          "browser_use_full_cdp_access",
          "apps",
          "code_mode_host",
          "skill_mcp_dependency_install",
          "hooks",
          "multi_agent",
          "image_generation",
          "remote_plugin",
        ]
          .flatMap((f) => ["-c", `features.${f}=false`])
          .concat([
            "-c",
            "agents.enabled=false",
            "-c",
            "features.code_mode.enabled=false",
            "-c",
            'features.code_mode.direct_only_tool_namespaces=["jarvis"]',
            "-c",
            'web_search="disabled"',
          ])
      : [];
    const child = spawn(binary, [...overrides, "app-server", "--stdio"], {
      cwd,
      env,
      stdio: "pipe",
    });
    this.process = child;
    child.on("error", (e) => this.fail(e));
    child.on("exit", (code, signal) => {
      if (this.process === child) {
        this.process = undefined;
        this.fail(
          new Error(
            `Codex disconnected (${signal || code}). Restart JARVIS to reconnect.`,
          ),
        );
      }
    });
    child.stderr.on("data", (chunk) =>
      this.emit("diagnostic", String(chunk).slice(-2000)),
    );
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        this.receive(JSON.parse(line));
      } catch {
        this.emit("diagnostic", "Ignored a non-JSON server line.");
      }
    });
    await this.request("initialize", {
      clientInfo: {
        name: "jarvis_desktop",
        title: "JARVIS",
        version: this.version,
      },
      capabilities: { experimentalApi: true },
    });
    this.write({ method: "initialized", params: {} });
    if (this.desktopMode) {
      const { config } = await this.request("config/read", { cwd });
      for (const name of Object.keys(config.mcp_servers || {}))
        this.desktopConfig[`mcp_servers.${name}.enabled`] = false;
      for (const name of Object.keys(config.plugins || {}))
        this.desktopConfig[`plugins.${name}.enabled`] = false;
      this.desktopConfig["agents.enabled"] = false;
    }
  }
  receive(message: any) {
    if (message.method) {
      this.emit(message.id !== undefined ? "request" : "notification", message);
      return;
    }
    const p = this.pending.get(message.id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(message.id);
    if (message.error)
      p.reject(
        new Error(message.error.message || JSON.stringify(message.error)),
      );
    else p.resolve(message.result);
  }
  write(message: unknown) {
    if (!this.process?.stdin.writable)
      throw new Error("Codex is not connected.");
    this.process.stdin.write(JSON.stringify(message) + "\n");
  }
  request(method: string, params: unknown = {}, timeout = 45000): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out; its outcome is uncertain.`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  reply(id: string | number, result: unknown) {
    this.write({ id, result });
  }
  reject(id: string | number, message: string) {
    this.write({ id, error: { code: -32601, message } });
  }
  fail(error: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.emit("disconnected", error);
  }
  close() {
    const child = this.process;
    this.process = undefined;
    child?.kill("SIGTERM");
    this.fail(new Error("Codex stopped."));
  }
}
