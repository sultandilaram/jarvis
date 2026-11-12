import { constants } from "node:fs";
import {
  realpath,
  lstat,
  readdir,
  open,
  rename,
  unlink,
  copyFile,
} from "node:fs/promises";
import {
  resolve,
  relative,
  join,
  dirname,
  basename,
  extname,
  sep,
} from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { ActionPlan } from "./broker.ts";
export class FileAccess {
  constructor(
    public roots: () => string[],
    public trash: (path: string) => Promise<void>,
    public openDocument: (path: string) => Promise<string>,
    public internalWorkspace?: string,
  ) {}
  async path(value: unknown, allowMissing = false) {
    if (typeof value !== "string" || !value || value.includes("\0"))
      throw new Error("An explicit file path is required.");
    const path = resolve(value);
    const protectedPart = path
      .split(sep)
      .some((p) =>
        [
          ".ssh",
          ".aws",
          ".codex",
          ".git",
          ".jarvis",
          ".gnupg",
          "Keychains",
        ].includes(p),
      );
    if (
      protectedPart ||
      (/\/(Library|System|Applications)(\/|$)/.test(path) &&
        !(
          this.internalWorkspace &&
          (path === this.internalWorkspace ||
            path.startsWith(this.internalWorkspace + sep))
        )) ||
      /^(\.env(?:\..*)?|.*\.(pem|key|p12|pfx))$/i.test(basename(path))
    )
      throw new Error(
        "Credential, application, and system paths are excluded from desktop file tools.",
      );
    let canonical: string;
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink())
        throw new Error("Symlink targets are not allowed.");
      canonical = await realpath(path);
    } catch (e: any) {
      if (e.code !== "ENOENT" || !allowMissing) throw e;
      canonical = join(await realpath(dirname(path)), basename(path));
    }
    let allowed = false;
    for (const root of this.roots()) {
      const base = await realpath(root);
      const part = relative(base, canonical);
      if (
        part !== "" &&
        !part.startsWith(".." + sep) &&
        part !== ".." &&
        !part.startsWith(sep)
      )
        allowed = true;
      if (part === "" && canonical === base) allowed = true;
    }
    if (!allowed)
      throw new Error(
        "This path is outside the granted folders. Use files.roots or request a folder from the user.",
      );
    if (canonical !== path)
      throw new Error(
        "Paths containing symlinks are excluded. Use the real granted path.",
      );
    return canonical;
  }
  async read(path: string) {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 1024 * 1024)
        throw new Error("Choose a regular UTF-8 file up to 1 MiB.");
      const data = await file.readFile();
      if (data.length > 1024 * 1024)
        throw new Error("File grew beyond the read limit.");
      if (data.includes(0))
        throw new Error("Binary files are not supported for text reading.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
      return {
        path,
        bytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
        text,
        identity: `${stat.dev}:${stat.ino}`,
      };
    } finally {
      await file.close();
    }
  }
  async fingerprint(path: string) {
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error("Only regular files can be changed.");
      return await this.read(path);
    } catch (e: any) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  async plan(
    action: string,
    args: Record<string, unknown>,
  ): Promise<ActionPlan> {
    const path = await this.path(args.path, action === "files.write");
    if (action === "files.list") {
      return {
        title: `List ${path}`,
        preview: { path },
        approval: false,
        run: async () => ({
          path,
          entries: (
            await readdir(await this.path(path), { withFileTypes: true })
          )
            .slice(0, 200)
            .map((e) => ({
              name: e.name,
              kind: e.isSymbolicLink()
                ? "symlink"
                : e.isDirectory()
                  ? "directory"
                  : "file",
            })),
        }),
      };
    }
    if (action === "files.read")
      return {
        title: `Read ${path}`,
        preview: { path },
        approval: false,
        run: async () => this.read(await this.path(path)),
      };
    const before = await this.fingerprint(path);
    if (action !== "files.write" && !before)
      throw new Error("The source file does not exist.");
    const verify = async () => {
      await this.path(path, action === "files.write");
      const now = await this.fingerprint(path);
      if (now?.sha256 !== before?.sha256 || now?.identity !== before?.identity)
        throw new Error(
          "The file changed after preview. The approval is invalid; inspect it again.",
        );
    };
    if (action === "files.write") {
      if (
        typeof args.text !== "string" ||
        Buffer.byteLength(args.text) > 100000
      )
        throw new Error("Writes require exact UTF-8 content up to 100 KB.");
      const text = args.text;
      return {
        title: `${before ? "Replace" : "Create"} ${path}`,
        approval: true,
        preview: {
          path,
          beforeSha256: before?.sha256 || null,
          before: before?.text || null,
          after: text,
        },
        verify,
        run: async (signal) => {
          signal.throwIfAborted();
          const temporary = join(
            dirname(path),
            ".jarvis-write-" + randomUUID(),
          );
          try {
            const file = await open(temporary, "wx", 0o600);
            try {
              await file.writeFile(text);
              await file.sync();
            } finally {
              await file.close();
            }
            signal.throwIfAborted();
            await verify();
            if (!before) {
              await copyFile(temporary, path, constants.COPYFILE_EXCL);
              await unlink(temporary);
            } else await rename(temporary, path);
            const result = await this.read(path);
            if (result.text !== text)
              throw new Error("Write outcome could not be verified.");
            return { ...result, verified: true };
          } finally {
            await unlink(temporary).catch(() => {});
          }
        },
      };
    }
    if (action === "files.move") {
      const destination = await this.path(args.destination, true);
      if (await this.fingerprint(destination))
        throw new Error("The destination already exists.");
      return {
        title: `Move ${basename(path)}`,
        approval: true,
        preview: { source: path, destination, sha256: before!.sha256 },
        verify: async () => {
          await verify();
          await this.path(destination, true);
          if (await this.fingerprint(destination))
            throw new Error("The destination changed after preview.");
        },
        run: async (signal) => {
          signal.throwIfAborted();
          try {
            await copyFile(path, destination, constants.COPYFILE_EXCL);
            const copied = await this.read(destination);
            if (copied.sha256 !== before!.sha256)
              throw new Error("Copied file differs; source was retained.");
            await verify();
            signal.throwIfAborted();
            await unlink(path);
            return {
              source: path,
              destination,
              sha256: copied.sha256,
              verified: true,
            };
          } catch (error) {
            throw new Error(
              `Move outcome requires inspection: ${path} → ${destination}. A destination copy may remain; no rollback was attempted. ${String(error)}`,
            );
          }
        },
      };
    }
    if (action === "files.trash")
      return {
        title: `Move ${basename(path)} to Trash`,
        approval: true,
        preview: { path, sha256: before!.sha256, content: before!.text },
        verify,
        run: async () => {
          await this.trash(path);
          if (await this.fingerprint(path))
            throw new Error("Trash operation could not be verified.");
          return { path, trashed: true, verified: true };
        },
      };
    if (action === "files.open") {
      if (![".txt", ".md", ".csv"].includes(extname(path).toLowerCase()))
        throw new Error(
          "Opening executable or unsupported file types is disabled.",
        );
      return {
        title: `Open ${basename(path)}`,
        approval: true,
        preview: { path, sha256: before!.sha256 },
        verify,
        run: async () => {
          const error = await this.openDocument(path);
          if (error) throw new Error(error);
          return {
            path,
            launchAccepted: true,
            verified: false,
            note: "The OS accepted the open request; inspect the application to verify its result.",
          };
        },
      };
    }
    throw new Error("Unsupported file action.");
  }
}
