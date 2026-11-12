import test from "node:test";
import assert from "node:assert/strict";
import {
  realpath,
  mkdtemp,
  writeFile,
  readFile,
  symlink,
  mkdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopBroker } from "../src/main/desktop/broker.ts";
import { FileAccess } from "../src/main/desktop/files.ts";
const tick = () => new Promise<void>((r) => setImmediate(r));
test("packaged internal workspace allows only its own Library subtree and still excludes credentials", async()=>{
  const dir=await realpath(await mkdtemp(join(tmpdir(),"jarvis-portable-")));
  try {
    const workspace=join(dir,"Library","Application Support","JARVIS","Workspace","Workspace");
    await mkdir(workspace,{recursive:true});
    const files=new FileAccess(()=>[dir],async()=>{},async()=>"",workspace);
    const note=join(workspace,"note.txt");
    await writeFile(note,"portable");
    assert.equal(await files.path(note),note);
    await assert.rejects(()=>files.path(join(workspace,".env"),true),/Credential/);
    await assert.rejects(()=>files.path(join(dir,"Library","other.txt"),true),/Credential/);
    await assert.rejects(()=>files.path(join(workspace,"..","outside.txt"),true),/Credential/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test("desktop actions cannot run before approval, approvals are single-use, and stale verification fails closed", async () => {
  let executed = 0,
    stale = false;
  const broker = new DesktopBroker(async () => ({
    title: "Test",
    preview: { text: "exact" },
    approval: true,
    verify: async () => {
      if (stale) throw Error("stale target");
    },
    run: async () => {
      executed++;
      return { verified: true };
    },
  }));
  const call = broker.execute("test", {});
  await tick();
  assert.equal(executed, 0);
  const id = [...broker.pending.keys()][0];
  broker.decide(id, true);
  assert.equal((await call).success, true);
  assert.equal(executed, 1);
  assert.throws(() => broker.decide(id, true), /expired/);
  const changed = broker.execute("test", {});
  await tick();
  stale = true;
  broker.decide([...broker.pending.keys()][0], true);
  assert.equal((await changed).success, false);
  assert.equal(executed, 1);
});
test("decline, Stop and queued calls never execute mutations", async () => {
  let executions = 0;
  const broker = new DesktopBroker(async () => ({
    title: "Test",
    preview: {},
    approval: true,
    run: async () => {
      executions++;
      return {};
    },
  }));
  const declined = broker.execute("test", {});
  await tick();
  broker.decide([...broker.pending.keys()][0], false);
  assert.equal((await declined).success, false);
  const first = broker.execute("test", {}),
    queued = broker.execute("test", {});
  await tick();
  broker.cancel();
  assert.equal((await first).success, false);
  assert.equal((await queued).success, false);
  assert.equal(executions, 0);
  assert.equal(broker.pending.size, 0);
});
test("granted file scope rejects escape, symlink and credential paths; changed previews cannot overwrite", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "jarvis-scope-")));
  try {
    const files = new FileAccess(
        () => [dir],
        async () => {},
        async () => "",
      ),
      path = join(dir, "note.txt");
    await writeFile(path, "before");
    await assert.rejects(
      () => files.path(join(dir, "..", "outside.txt"), true),
      /outside/,
    );
    await symlink(path, join(dir, "link"));
    await assert.rejects(() => files.path(join(dir, "link")), /Symlink/);
    await assert.rejects(
      () => files.path(join(dir, ".env.local"), true),
      /Credential/,
    );
    const plan = await files.plan("files.write", { path, text: "after" });
    assert.equal(plan.approval, true);
    assert.deepEqual(plan.preview.after, "after");
    await writeFile(path, "changed");
    await assert.rejects(() => plan.verify!(), /changed/);
    await assert.rejects(
      () => plan.run(new AbortController().signal),
      /changed/,
    );
    assert.equal(await readFile(path, "utf8"), "changed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("approved file create verifies exact content; move is exclusive and Trash is reversible", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "jarvis-files-")));
  try {
    const trash: string[] = [];
    const files = new FileAccess(
        () => [dir],
        async (path) => {
          trash.push(path);
          await rm(path);
        },
        async () => "",
      ),
      path = join(dir, "note.txt");
    const broker = new DesktopBroker((action, args) =>
      files.plan(action, args),
    );
    broker.on("approval", (a) => broker.decide(a.id, true));
    assert.equal(
      (await broker.execute("files.write", { path, text: "hello" })).success,
      true,
    );
    assert.equal(await readFile(path, "utf8"), "hello");
    const destination = join(dir, "moved.txt");
    assert.equal(
      (await broker.execute("files.move", { path, destination })).success,
      true,
    );
    assert.equal(await readFile(destination, "utf8"), "hello");
    assert.equal(
      (await broker.execute("files.trash", { path: destination })).success,
      true,
    );
    assert.deepEqual(trash, [destination]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
