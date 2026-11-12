import test from "node:test";
import assert from "node:assert/strict";
import {
  realpath,
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  symlink,
  rename,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectService } from "../src/main/project.ts";
import { FileAccess } from "../src/main/desktop/files.ts";
const native = { skip: process.platform !== "darwin" };
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "jarvis-project-")));
  const root = join(base, "job");
  await mkdir(root);
  const service = new ProjectService(
    () =>
      ({
        id: "fixture",
        profile: "project",
        workspace: root,
        state: "running",
      }) as any,
    new FileAccess(
      () => [base],
      async () => {},
      async () => "",
      base,
    ),
  );
  return {
    base,
    root,
    service,
    close: () => rm(base, { recursive: true, force: true }),
  };
}
test("project profile is required and path escapes are rejected", async () => {
  const s = new ProjectService(() => undefined);
  await assert.rejects(
    () => s.plan("project.exec", { command: ["node", "-v"] }),
    /Project job/,
  );
  const f = await fixture();
  try {
    await assert.rejects(() =>
      f.service.plan("project.write", { path: "../escape.txt", text: "bad" }),
    );
  } finally {
    await f.close();
  }
});
test(
  "kernel-confined file operations preserve content and deny a swapped parent symlink",
  native,
  async () => {
    const f = await fixture();
    try {
      let plan = await f.service.plan("project.write", {
        path: "a.txt",
        text: "Hello",
      });
      assert.equal(plan.approval, false);
      await plan.run(new AbortController().signal);
      const read = await f.service.plan("project.read", { path: "a.txt" });
      assert.equal(
        ((await read.run(new AbortController().signal)) as any).text,
        "Hello",
      );
      await mkdir(join(f.root, "dir"));
      await mkdir(join(f.base, "outside"));
      plan = await f.service.plan("project.write", {
        path: "dir/escape.txt",
        text: "forbidden",
      });
      await rename(join(f.root, "dir"), join(f.root, "original"));
      await symlink(join(f.base, "outside"), join(f.root, "dir"));
      await assert.rejects(() => plan.run(new AbortController().signal));
      await assert.rejects(() => access(join(f.base, "outside/escape.txt")));
    } finally {
      await f.close();
    }
  },
);
test(
  "approved commands can write project files but cannot read or write outside",
  native,
  async () => {
    const f = await fixture();
    try {
      const secret = join(f.base, "sentinel");
      await writeFile(secret, "synthetic");
      const p = await f.service.plan("project.exec", {
        command: [
          "node",
          "-e",
          `const fs=require('fs');fs.writeFileSync('ok.txt','ok');let blocked=0;try{fs.readFileSync(${JSON.stringify(secret)})}catch{blocked++}try{fs.writeFileSync(${JSON.stringify(secret + ".out")},'bad')}catch{blocked++}console.log(blocked)`,
        ],
      });
      assert(p.approval);
      const r: any = await p.run(new AbortController().signal);
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout.trim(), "2");
      assert.equal(await readFile(join(f.root, "ok.txt"), "utf8"), "ok");
    } finally {
      await f.close();
    }
  },
);
test(
  "import leaves source untouched and export requires the exact host write preview",
  native,
  async () => {
    const f = await fixture();
    try {
      const source = join(f.base, "source");
      await mkdir(source);
      await writeFile(join(source, "module.js"), "original");
      await writeFile(join(source, ".env"), "synthetic-private");
      const p = await f.service.plan("project.import", {
        path: source,
        destination: "copy",
      });
      assert(p.approval);
      assert.deepEqual(p.preview.files, ["module.js"]);
      await p.verify?.();
      await p.run(new AbortController().signal);
      const w = await f.service.plan("project.write", {
        path: "copy/module.js",
        text: "changed",
      });
      await w.run(new AbortController().signal);
      assert.equal(
        await readFile(join(source, "module.js"), "utf8"),
        "original",
      );
      const x = await f.service.plan("project.export", {
        path: "copy/module.js",
        destination: join(source, "module.js"),
      });
      assert(x.approval);
      assert.equal(x.preview.before, "original");
      assert.equal(x.preview.after, "changed");
      await x.verify?.();
      await x.run(new AbortController().signal);
      assert.equal(
        await readFile(join(source, "module.js"), "utf8"),
        "changed",
      );
    } finally {
      await f.close();
    }
  },
);
test(
  "Stop terminates a command before a delayed mutation",
  native,
  async () => {
    const f = await fixture();
    try {
      const p = await f.service.plan("project.exec", {
        command: [
          "node",
          "-e",
          "setTimeout(()=>require('fs').writeFileSync('late.txt','bad'),1000);setInterval(()=>{},1000)",
        ],
      });
      const c = new AbortController();
      const running = p.run(c.signal);
      setTimeout(() => c.abort(), 150);
      await assert.rejects(() => running, /stopped|cancelled/i);
      await assert.rejects(() => access(join(f.root, "late.txt")));
    } finally {
      await f.close();
    }
  },
);

test(
  "approved network mode cannot bypass the proxy to reach private local services",
  native,
  async () => {
    const { createServer } = await import("node:net");
    let accepted = 0;
    const server = createServer((s) => {
      accepted++;
      s.destroy();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as any).port;
    const f = await fixture();
    try {
      const p = await f.service.plan("project.exec", {
        network: true,
        command: [
          "node",
          "-e",
          `const net=require('net');let blocked=0;const direct=new Promise(r=>{const s=net.connect({host:'127.0.0.1',port:${port}});s.on('error',()=>{blocked++;r()});s.on('connect',()=>{s.destroy();r()})});const proxy=new Promise(r=>{const u=new URL(process.env.HTTPS_PROXY);const s=net.connect({host:u.hostname,port:Number(u.port)},()=>s.write('CONNECT 127.0.0.1:443 HTTP/1.1\\r\\n\\r\\n'));s.on('data',d=>{if(d.toString().includes('403'))blocked++;s.destroy();r()});s.on('error',()=>r())});Promise.all([direct,proxy]).then(()=>console.log(blocked));`,
        ],
      });
      assert(p.approval);
      const result: any = await p.run(new AbortController().signal);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.trim(), "2");
      assert.equal(accepted, 0);
    } finally {
      server.close();
      await f.close();
    }
  },
);
