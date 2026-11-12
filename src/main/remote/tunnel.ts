import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { PermanentTunnel } from "./permanent.ts";
export class PublicTunnel {
  child?: ChildProcess;
  async open(
    binary: string,
    port: number,
    permanent?: PermanentTunnel,
  ): Promise<string> {
    if (!existsSync(binary))
      throw Error(
        "Cloudflare tunnel helper is missing. Run npm run setup:remote before packaging.",
      );
    this.close();
    return new Promise((resolve, reject) => {
      const child = (this.child = spawn(
        binary,
        permanent
          ? ["tunnel", "--no-autoupdate", "--protocol", "http2", "run"]
          : [
              "tunnel",
              "--url",
              `http://127.0.0.1:${port}`,
              "--no-autoupdate",
              "--protocol",
              "http2",
            ],
        {
          stdio: ["ignore", "ignore", "pipe"],
          env: {
            PATH: process.env.PATH || "/usr/bin:/bin",
            HOME: process.env.HOME,
            TMPDIR: process.env.TMPDIR,
            ...(permanent ? { TUNNEL_TOKEN: permanent.token } : {}),
          },
        },
      ));
      let settled = false;
      let publicURL = permanent?.url || "",
        registered = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.close();
          reject(
            Error(
              "The public link did not become ready. Check internet access.",
            ),
          );
        }
      }, 45000);
      child.stderr?.on("data", (buffer) => {
        const match = String(buffer).match(
          /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
        );
        if (match && !permanent) publicURL = match[0];
        if (String(buffer).includes("Registered tunnel connection"))
          registered = true;
        if (publicURL && registered && !settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(publicURL);
        }
      });
      child.on("error", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(Error("Could not start the public link helper."));
        }
      });
      child.on("exit", () => {
        if (this.child === child) {
          this.child = undefined;
          this.onDisconnect?.();
        }
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(Error("The public link helper exited before connecting."));
        }
      });
    });
  }
  onDisconnect?: () => void;
  close() {
    const child = this.child;
    this.child = undefined;
    child?.kill("SIGTERM");
  }
}
