import { projectNetwork } from "./project-network.ts";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { realpath, mkdir, readdir, lstat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { FileAccess } from "./desktop/files.ts";
import type { ActionPlan } from "./desktop/broker.ts";
import type { Job } from "./jobs.ts";
const quote = (s: string) => JSON.stringify(s);
export function projectSandbox(
  root: string,
  tools: string[] = [],
  proxyPort?: number,
) {
  const readable = [
    root,
    "/System",
    "/usr/bin",
    "/usr/lib",
    "/usr/libexec",
    "/usr/share",
    "/usr/sbin",
    "/usr/local/bin",
    "/usr/local/lib",
    "/usr/local/share",
    "/bin",
    "/sbin",
    "/Library/Developer",
    "/Library/Apple",
    "/Library/Frameworks",
    "/private/etc",
    "/private/var/select/sh",
    "/private/var/db/dyld",
    "/opt/homebrew/bin",
    "/opt/homebrew/lib",
    "/opt/homebrew/Cellar",
    "/opt/homebrew/opt",
    "/opt/homebrew/share",
    ...tools,
  ];
  const ancestors = new Set<string>();
  for (const p of readable) {
    let parent = dirname(p);
    while (parent !== "/") {
      ancestors.add(parent);
      parent = dirname(parent);
    }
  }
  return `(version 1)(deny default)${proxyPort ? `(allow network-outbound (remote ip "localhost:${proxyPort}"))` : ""}${ancestors.size ? `(allow file-read-metadata ${[...ancestors].map((p) => `(literal ${quote(p)})`).join(" ")})` : ""}(allow process-exec process-fork)(allow signal (target same-sandbox))(allow sysctl-read)(allow mach-lookup (global-name "com.apple.system.logger"))(allow file-read* ${readable.map((p) => `(subpath ${quote(p)})`).join(" ")} (literal "/") (literal "/dev/null") (literal "/dev/random") (literal "/dev/urandom") (literal "/dev/zero") (subpath "/dev/fd") (literal "/private/var/db/xcode_select_link"))(allow file-write* (subpath ${quote(root)}) (literal "/dev/null") (subpath "/dev/fd"))`;
}
async function nodeToolchain() {
  for (const path of ["/opt/homebrew/bin/node", "/usr/local/bin/node"])
    if (existsSync(path)) return realpath(path);
  const base = join(homedir(), ".nvm/versions/node");
  try {
    for (const v of (await readdir(base)).sort().reverse()) {
      const path = join(base, v, "bin/node");
      if (existsSync(path)) return realpath(path);
    }
  } catch {}
  return process.execPath;
}
export class ProjectService {
  constructor(
    public current: () => Job | undefined,
    public hostFiles?: FileAccess,
  ) {}
  async fileOp(
    root: string,
    operation: string,
    path: string,
    text: unknown,
    signal: AbortSignal,
  ): Promise<any> {
    const node = await nodeToolchain(),
      tools = [
        dirname(node),
        join(dirname(dirname(node)), "lib"),
        process.execPath.includes(".app/")
          ? process.execPath.split(".app/")[0] + ".app"
          : dirname(process.execPath),
      ];
    const script = String.raw`const fs=require('fs'),p=require('path'),crypto=require('crypto');let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>{input+=s;if(input.length>20000000)process.exit(4)});process.stdin.on('end',()=>{try{const a=JSON.parse(input);const root=fs.realpathSync(a.root),path=p.resolve(a.path);if(path!==root&&!path.startsWith(root+p.sep))throw Error('Path outside project');let result;const hash=b=>crypto.createHash('sha256').update(b).digest('hex');if(a.operation==='read'){const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>1048576)throw Error('Choose a regular text file up to 1 MiB');const data=fs.readFileSync(fd);if(data.length>1048576||data.includes(0))throw Error('File exceeds text limit');result={path,text:new TextDecoder('utf-8',{fatal:true}).decode(data),sha256:hash(data),bytes:data.length};}finally{fs.closeSync(fd)}}else if(a.operation==='list'){result={path,entries:fs.readdirSync(path,{withFileTypes:true}).slice(0,200).map(e=>({name:e.name,kind:e.isSymbolicLink()?'symlink':e.isDirectory()?'directory':'file'}))}}else if(a.operation==='mkdir'){fs.mkdirSync(path,{mode:448});result={created:path}}else if(a.operation==='write'){const data=Buffer.from(a.text);if(data.length>100000)throw Error('Write exceeds 100 KB');const temp=p.join(p.dirname(path),'.jarvis-write-'+crypto.randomUUID());try{fs.writeFileSync(temp,data,{flag:'wx',mode:384});fs.renameSync(temp,path)}finally{try{fs.unlinkSync(temp)}catch{}}result={path,bytes:data.length,sha256:hash(data),verified:fs.readFileSync(path).equals(data)}}else if(a.operation==='import'){fs.mkdirSync(path,{mode:448});for(const item of a.text){const dest=p.resolve(path,item.relative);if(!dest.startsWith(path+p.sep))throw Error('Import escaped target');fs.mkdirSync(p.dirname(dest),{recursive:true,mode:448});fs.writeFileSync(dest,item.text,{flag:'wx',mode:384});}result={path,imported:a.text.length,verified:true}}else throw Error('Unknown file operation');process.stdout.write(JSON.stringify(result));}catch(e){process.stderr.write(String(e.message));process.exitCode=1}});`;
    return new Promise((done, reject) => {
      const child = execFile(
        "/usr/bin/sandbox-exec",
        ["-p", projectSandbox(root, tools), node, "-e", script],
        {
          cwd: root,
          env: {
            PATH: "/usr/bin:/bin",
            HOME: root,
            LANG: "en_US.UTF-8",
            ELECTRON_RUN_AS_NODE: "1",
            OPENSSL_CONF: "/dev/null",
          },
          signal,
          timeout: 10000,
          maxBuffer: 3 * 1024 * 1024,
        },
        (error, out, err) => {
          if (error) {
            reject(Error(err || error.message));
            return;
          }
          try {
            done(JSON.parse(out));
          } catch (e) {
            reject(e);
          }
        },
      );
      child.stdin?.end(JSON.stringify({ root, operation, path, text }));
    });
  }
  async artifact(job: Job, operation: "read" | "list", value: unknown) {
    if (job.profile !== "project") throw Error("Choose a project job.");
    const root = await realpath(job.workspace);
    const scope = new FileAccess(
      () => [root],
      async () => {},
      async () => "",
      root,
    );
    const path = await scope.path(resolve(root, String(value || ".")));
    return this.fileOp(
      root,
      operation,
      path,
      undefined,
      new AbortController().signal,
    );
  }
  async plan(
    action: string,
    args: Record<string, unknown>,
  ): Promise<ActionPlan> {
    const job = this.current();
    if (
      !job ||
      job.profile !== "project" ||
      !["running", "waiting_approval", "waiting_input"].includes(job.state)
    )
      throw Error(
        "Start a Project job first. Project tools never operate on the whole Mac.",
      );
    const root = await realpath(job.workspace);
    const files = new FileAccess(
      () => [root],
      async () => {},
      async () => "",
      root,
    );
    const verify = async () => {
      if (
        this.current()?.id !== job.id ||
        (await realpath(job.workspace)) !== root
      )
        throw Error("The project job changed; request a new action.");
    };
    if (action === "project.export") {
      if (!this.hostFiles) throw Error("Granted file access unavailable.");
      const source = await files.path(resolve(root, String(args.path || "")));
      const data = await this.fileOp(
        root,
        "read",
        source,
        undefined,
        new AbortController().signal,
      );
      const plan = await this.hostFiles.plan("files.write", {
        path: args.destination,
        text: data.text,
      });
      return {
        ...plan,
        title: "Export project file",
        approval: true,
        preview: { ...plan.preview, source },
        verify: async () => {
          await verify();
          await plan.verify?.();
          const now = await this.fileOp(
            root,
            "read",
            source,
            undefined,
            new AbortController().signal,
          );
          if (now.sha256 !== data.sha256)
            throw Error("Project file changed. Review a fresh export.");
        },
      };
    }
    if (action === "project.import") {
      if (!this.hostFiles)
        throw Error(
          "Grant the source folder through files.request_folder first.",
        );
      const source = await this.hostFiles.path(args.path),
        targetName = String(args.destination || "imported");
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(targetName))
        throw Error("Choose a simple new directory name in destination.");
      const destination = await files.path(resolve(root, targetName), true);
      if (existsSync(destination))
        throw Error("Import destination must be a new directory.");
      const items: {
        relative: string;
        path: string;
        text: string;
        sha256: string;
      }[] = [];
      let bytes = 0;
      const excluded = (name: string) =>
        /^(?:\.git|node_modules|\.jarvis|\.codex|\.aws|\.ssh|\.gnupg|\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx)|.*(?:credentials|secrets|service-account).*\.json)$/i.test(
          name,
        );
      const walk = async (path: string, relative: string, depth: number) => {
        if (depth > 12) throw Error("Choose a shallower source folder.");
        const canonical = await this.hostFiles!.path(path),
          stat = await lstat(canonical);
        if (stat.isDirectory()) {
          for (const entry of await readdir(canonical, {
            withFileTypes: true,
          })) {
            if (entry.isSymbolicLink() || excluded(entry.name)) continue;
            await walk(
              join(canonical, entry.name),
              relative ? relative + "/" + entry.name : entry.name,
              depth + 1,
            );
          }
        } else if (stat.isFile()) {
          const data = await this.hostFiles!.read(canonical);
          bytes += data.bytes;
          if (items.length >= 500 || bytes > 5 * 1024 * 1024)
            throw Error(
              "Import supports up to 500 text files / 5 MiB. Choose a smaller source folder.",
            );
          items.push({
            relative: relative || canonical.split("/").at(-1)!,
            path: canonical,
            text: data.text,
            sha256: data.sha256,
          });
        }
      };
      await walk(source, "", 0);
      return {
        title: "Import project source snapshot",
        approval: true,
        preview: {
          source,
          destination,
          files: items.map((i) => i.relative),
          bytes,
          effect:
            "Copy this bounded text snapshot into the isolated project. Source files stay unchanged. Symlinks, dependencies and common credential filenames are excluded.",
        },
        verify: async () => {
          await verify();
          if (existsSync(destination))
            throw Error("Import destination changed.");
          for (const i of items)
            if (
              (await this.hostFiles!.read(await this.hostFiles!.path(i.path)))
                .sha256 !== i.sha256
            )
              throw Error("Source changed; review a fresh import.");
        },
        run: async (signal) => {
          signal.throwIfAborted();
          return this.fileOp(
            root,
            "import",
            destination,
            items.map((i) => ({ relative: i.relative, text: i.text })),
            signal,
          );
        },
      };
    }
    if (action === "project.status")
      return {
        title: "Inspect project execution scope",
        approval: false,
        preview: {},
        run: async () => ({
          jobId: job.id,
          workspace: root,
          network: false,
          node: await nodeToolchain(),
          limits:
            "Commands require approval, 120 second timeout, 64 KiB output per stream. Reads/writes restricted to the isolated project. External account connections are not inherited.",
        }),
      };
    if (
      [
        "project.list",
        "project.read",
        "project.write",
        "project.mkdir",
      ].includes(action)
    ) {
      const path = await files.path(
        resolve(root, String(args.path || ".")),
        action === "project.write" || action === "project.mkdir",
      );
      if (
        action === "project.write" &&
        (typeof args.text !== "string" || Buffer.byteLength(args.text) > 100000)
      )
        throw Error("Provide exact UTF-8 text up to 100 KB.");
      return {
        title: action + " " + path,
        approval: false,
        preview: { path },
        verify,
        run: async (signal) => {
          signal.throwIfAborted();
          await verify();
          return this.fileOp(
            root,
            action.split(".")[1],
            path,
            args.text,
            signal,
          );
        },
      };
    }
    if (action !== "project.exec") throw Error("Unsupported project action.");
    if (args.network !== undefined && typeof args.network !== "boolean")
      throw Error("network must be a boolean.");
    const network = args.network === true;
    const command = args.command;
    if (
      !Array.isArray(command) ||
      !command.length ||
      command.length > 100 ||
      command.some(
        (v) =>
          typeof v !== "string" || !v || v.includes("\0") || v.length > 20000,
      )
    )
      throw Error("Provide command as a non-empty argv array.");
    const cwd = await files.path(resolve(root, String(args.path || ".")));
    const node = await nodeToolchain();
    const executable = command[0] === "node" ? node : command[0];
    const argv = command.slice(1);
    const tools = [
      dirname(node),
      join(dirname(dirname(node)), "lib"),
      process.execPath.includes(".app/")
        ? process.execPath.split(".app/")[0] + ".app"
        : dirname(process.execPath),
    ];
    return {
      title: network
        ? "Run project command with public HTTPS"
        : "Run project command",
      approval: true,
      preview: {
        jobId: job.id,
        command,
        workingDirectory: cwd,
        scope:
          "Only this isolated project and system/toolchain files are readable. Writes stay in this project. Desktop automation and personal folders are denied by the OS sandbox. Network access is scoped separately below.",
        network: network
          ? "Public HTTPS through a temporary filtered proxy, up to 50 MiB. This command may send project data to public endpoints. Private/local networks and personal files remain blocked."
          : "Disabled",
        timeoutSeconds: 120,
      },
      verify,
      run: async (signal) => {
        signal.throwIfAborted();
        await verify();
        await mkdir(join(root, ".home"), { recursive: true, mode: 0o700 });
        await mkdir(join(root, ".tmp"), { recursive: true, mode: 0o700 });
        const env: NodeJS.ProcessEnv = {
          PATH: [
            dirname(node),
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
          ].join(":"),
          HOME: join(root, ".home"),
          TMPDIR: join(root, ".tmp") + "/",
          LANG: "en_US.UTF-8",
          CI: "1",
          ELECTRON_RUN_AS_NODE: "1",
            OPENSSL_CONF: "/dev/null",
        };
        const proxy = network ? await projectNetwork() : undefined;
        if (signal.aborted) {
          proxy?.close();
          throw Error("Command cancelled.");
        }
        if (proxy) {
          env.HTTPS_PROXY = proxy.url;
          env.HTTP_PROXY = proxy.url;
          env.ALL_PROXY = proxy.url;
          env.NODE_USE_ENV_PROXY = "1";
        }
        return new Promise((resolveResult, reject) => {
          const child = spawn(
            "/usr/bin/sandbox-exec",
            [
              "-p",
              projectSandbox(root, tools, proxy?.port),
              executable,
              ...argv,
            ],
            { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true },
          );
          let stdout = "",
            stderr = "",
            truncated = false,
            finished = false,
            timedOut = false;
          const stop = () => {
            try {
              process.kill(-child.pid!, "SIGKILL");
            } catch {
              child.kill("SIGKILL");
            }
          };
          signal.addEventListener("abort", stop, { once: true });
          const timer = setTimeout(() => {
            timedOut = true;
            stop();
          }, 120000);
          const collect = (kind: "out" | "err", chunk: Buffer) => {
            const old = kind === "out" ? stdout : stderr;
            const next = (old + chunk.toString()).slice(0, 65536);
            if (old.length + chunk.length > 65536) truncated = true;
            if (kind === "out") stdout = next;
            else stderr = next;
          };
          child.stdout.on("data", (c) => collect("out", c));
          child.stderr.on("data", (c) => collect("err", c));
          const cleanup = () => {
            clearTimeout(timer);
            proxy?.close();
            signal.removeEventListener("abort", stop);
          };
          child.on("error", (e) => {
            if (!finished) {
              finished = true;
              cleanup();
              reject(e);
            }
          });
          child.on("close", (code, termination) => {
            if (finished) return;
            finished = true;
            cleanup();
            stop();
            if (signal.aborted) {
              reject(
                Error(
                  "Project command stopped. Partial file changes may remain.",
                ),
              );
              return;
            }
            resolveResult({
              exitCode: code,
              signal: termination,
              stdout,
              stderr,
              truncated,
              timedOut,
              verified: code === 0 && !timedOut,
            });
          });
        });
      },
    };
  }
}
