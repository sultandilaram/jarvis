import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import {
  DelegationManager,
  subagentLimits,
  subagentTool,
  type DelegationParent,
} from "../src/main/delegation.ts";
import {
  ProviderEngine,
  type TaskEngine,
} from "../src/main/providers/engine.ts";
const tick = () => new Promise<void>((r) => setImmediate(r));
class FakeEngine extends EventEmitter implements TaskEngine {
  desktopMode = false;
  desktopConfig = { "agents.enabled": false };
  closed = false;
  threadId = randomUUID();
  turnId = randomUUID();
  calls: any[] = [];
  replies: any[] = [];
  rejections: any[] = [];
  gate?: Promise<void>;
  cwd = "";
  async connect(cwd: string) {
    this.cwd = cwd;
    if (this.gate) await this.gate;
  }
  async request(method: string, params: any = {}) {
    this.calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: this.threadId } };
    if (method === "turn/start") {
      this.emit("notification", {
        method: "turn/started",
        params: { threadId: this.threadId, turn: { id: this.turnId } },
      });
      return { turn: { id: this.turnId } };
    }
    return {};
  }
  reply(id: any, result: any) {
    this.replies.push({ id, result });
  }
  reject(id: any, message: string) {
    this.rejections.push({ id, message });
  }
  close() {
    this.closed = true;
  }
  tool(action: string, extra: any = {}) {
    const id = randomUUID();
    this.emit("request", {
      id,
      method: "item/tool/call",
      params: {
        threadId: this.threadId,
        turnId: this.turnId,
        namespace: "jarvis",
        tool: "desktop",
        arguments: { action, ...extra },
      },
    });
    return id;
  }
  done(text = "Findings") {
    this.emit("notification", {
      method: "item/completed",
      params: {
        threadId: this.threadId,
        turnId: this.turnId,
        item: { type: "agentMessage", text },
      },
    });
    this.emit("notification", {
      method: "turn/completed",
      params: {
        threadId: this.threadId,
        turn: { id: this.turnId, status: "completed" },
      },
    });
  }
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "jarvis-delegation-")),
    values = new Map<string, any>(),
    engines: FakeEngine[] = [];
  let parent: DelegationParent | null = {
      jobId: "parent-job",
      taskId: "parent-task",
      project: true,
    },
    enabled = true,
    charges = 0,
    captures = 0;
  let connectGate: Promise<void> | undefined;
  let capture: (
    path: string,
  ) => Promise<{ path: string; text: string; sha256: string }> = async (
    path,
  ) => ({
    path,
    text: "const value = 'Blue';",
    sha256: createHash("sha256").update("const value = 'Blue';").digest("hex"),
  });
  const store = {
    get: <T>(k: string, f: T) =>
      values.has(k) ? structuredClone(values.get(k)) : f,
    set: (k: string, v: unknown) => {
      values.set(k, structuredClone(v));
    },
  };
  const manager = new DelegationManager(
    store,
    root,
    () => parent,
    () => enabled,
    () => {
      const e = new FakeEngine();
      e.gate = connectGate;
      engines.push(e);
      return { engine: e, model: "fixture" };
    },
    async (_p, path) => {
      captures++;
      return capture(path);
    },
    () => {
      charges++;
    },
    () => {},
  );
  manager.registerNewParent(parent!.jobId);
  const run = async (action: string, args: any = {}) => {
    const p = await manager.plan(action, args);
    return p.run(new AbortController().signal) as Promise<any>;
  };
  const spawn = (name = "Worker", extra: any = {}) =>
    run("agent.spawn", {
      title: name,
      role: "review",
      text: "Review the supplied code",
      ...extra,
    });
  const ready = async () => {
    const deadline = Date.now() + 5000;
    while (
      manager.summary().some((r) => r.state === "starting") &&
      Date.now() < deadline
    ) {
      if (
        connectGate &&
        engines.length >=
          Math.min(
            2,
            manager
              .summary()
              .filter((r) => ["starting", "running"].includes(r.state)).length,
          )
      )
        break;
      await tick();
    }
    for (let i = 0; i < 4; i++) await tick();
  };
  return {
    manager,
    engines,
    values,
    store,
    root,
    run,
    spawn,
    ready,
    get charges() {
      return charges;
    },
    get captures() {
      return captures;
    },
    setParent: (v: DelegationParent | null) => {
      parent = v;
    },
    disable: () => {
      enabled = false;
      manager.cancelAll();
    },
    enable: () => {
      enabled = true;
    },
    setConnectGate: (gate: Promise<void>) => {
      connectGate = gate;
    },
    setCapture: (f: typeof capture) => {
      capture = f;
    },
    close: async () => {
      manager.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
test("subagents really overlap up to the concurrency cap and queued work starts after completion", async () => {
  const f = await fixture();
  try {
    const a = await f.spawn("A"),
      b = await f.spawn("B"),
      c = await f.spawn("C");
    await f.ready();
    assert.equal(f.engines.length, 2);
    assert.equal(f.manager.ownerResult(c.agentId).state, "queued");
    assert.equal(f.manager.ownerResult(a.agentId).state, "running");
    assert.equal(f.manager.ownerResult(b.agentId).state, "running");
    const workerA = f.engines.find((e) => e.cwd.endsWith("/" + a.agentId))!;
    const start = workerA.calls.find((c) => c.method === "thread/start").params;
    assert.equal(start.ephemeral, true);
    assert.equal(start.sandbox, "read-only");
    assert.equal(start.approvalPolicy, "never");
    assert.equal(start.config.project_doc_max_bytes, 0);
    assert.equal(start.config["skills.include_instructions"], false);
    assert.equal(start.config["memories.use_memories"], false);
    assert.equal(start.config["memories.generate_memories"], false);
    assert.deepEqual(start.dynamicTools, [subagentTool]);
    workerA.done("A findings");
    await f.ready();
    assert.equal(f.engines.length, 3);
    assert.equal(f.manager.ownerResult(c.agentId).state, "running");
    const result = await f.run("agent.result", { agentId: a.agentId });
    assert.equal(result.result, "A findings");
    assert.match(result.notice, /untrusted/);
  } finally {
    await f.close();
  }
});
test("workers read only captured selected files; mutations, accounts and recursive agents never execute", async () => {
  const f = await fixture();
  try {
    const r = await f.spawn("Reviewer", { paths: ["src/app.ts"] });
    await f.ready();
    const e = f.engines[0];
    f.setCapture(async () => {
      throw Error("Live files should not be read again");
    });
    e.tool("project.read", { path: "src/app.ts" });
    await tick();
    const read = JSON.parse(e.replies.at(-1).result.contentItems[0].text);
    assert.equal(read.text, "const value = 'Blue';");
    assert.equal(read.snapshot, true);
    assert.equal(f.captures, 1);
    for (const action of [
      "project.write",
      "project.exec",
      "files.read",
      "browser.read",
      "email.read",
      "agent.spawn",
      "repo.review",
    ]) {
      e.tool(action, { path: "src/app.ts" });
      await tick();
      assert.equal(e.replies.at(-1).result.success, false);
    }
    e.tool("project.read", { path: "other.ts" });
    await tick();
    assert.equal(e.replies.at(-1).result.success, false);
    assert.equal(f.charges, 9);
    assert.equal(f.manager.ownerResult(r.agentId).toolCalls, 9);
  } finally {
    await f.close();
  }
});
test("parent cancellation cancels queued workers without starting them and late results are ignored", async () => {
  const f = await fixture();
  try {
    const a = await f.spawn(),
      b = await f.spawn(),
      c = await f.spawn();
    await f.ready();
    f.manager.cancelAll("Correction");
    await f.ready();
    assert.equal(f.engines.length, 2);
    for (const id of [a.agentId, b.agentId, c.agentId])
      assert.equal(f.manager.ownerResult(id).state, "cancelled");
    f.engines[0].done("Late misleading success");
    assert.equal(f.manager.ownerResult(a.agentId).result, undefined);
    assert(f.engines.every((e) => e.closed));
  } finally {
    await f.close();
  }
});
test("a worker cannot read another parent job's findings or grant repository approval", async () => {
  const f = await fixture();
  try {
    const r = await f.spawn();
    await f.ready();
    f.engines[0].done("Review notes");
    await f.run("agent.review", {
      agentId: r.agentId,
      assessment: "use",
      text: "Checked the proposed findings against the source.",
    });
    assert.equal(f.manager.ownerResult(r.agentId).assessment?.decision, "use");
    f.setParent({ jobId: "other-job", taskId: "other-task", project: true });
    await assert.rejects(
      f.run("agent.result", { agentId: r.agentId }),
      /does not belong/,
    );
    await assert.rejects(
      f.run("agent.cancel", { agentId: r.agentId }),
      /does not belong/,
    );
  } finally {
    await f.close();
  }
});
test("disabled delegation, invalid snapshots and cancellation during capture start no inference", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.spawn("Bad", { paths: ["../private.txt"] }),
      /relative project/,
    );
    f.setParent({ jobId: "parent-job", taskId: "parent-task", project: false });
    await assert.rejects(f.spawn("Bad", { paths: ["a.ts"] }), /Only project/);
    f.setParent({ jobId: "parent-job", taskId: "parent-task", project: true });
    let release!: (v: any) => void;
    f.setCapture(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    const plan = await f.manager.plan("agent.spawn", {
        title: "Pending",
        role: "analysis",
        text: "Analyze",
        paths: ["a.ts"],
      }),
      controller = new AbortController();
    const pending = plan.run(controller.signal),
      rejected = assert.rejects(pending, /abort/i);
    await tick();
    controller.abort();
    release({ path: "a.ts", text: "a", sha256: "0".repeat(64) });
    await rejected;
    assert.equal(f.engines.length, 0);
    f.disable();
    await assert.rejects(f.spawn(), /Enable read-only/);
  } finally {
    await f.close();
  }
});
test("per-worker and per-job limits stop further work; completion alone is not a parent assessment", async () => {
  const f = await fixture();
  try {
    const r = await f.spawn();
    await f.ready();
    const e = f.engines[0];
    await assert.rejects(
      f.run("agent.review", {
        agentId: r.agentId,
        assessment: "use",
        text: "Accepted",
      }),
      /finish/,
    );
    for (let i = 0; i <= subagentLimits.toolCalls; i++) {
      e.tool("task.status");
      await tick();
    }
    assert.equal(f.manager.ownerResult(r.agentId).state, "failed");
    assert(e.closed);
    await assert.rejects(
      f.run("agent.review", {
        agentId: r.agentId,
        assessment: "use",
        text: "Accepted",
      }),
      /Incomplete/,
    );
    for (let i = 1; i < subagentLimits.perJob; i++) await f.spawn();
    await assert.rejects(f.spawn(), /six-worker/);
    f.manager.reconcile(null);
    assert(
      f.manager
        .summary()
        .every((r) => !["queued", "starting", "running"].includes(r.state)),
    );
  } finally {
    await f.close();
  }
});
test("restart preserves interrupted findings without recreating a worker or replaying its tools", async () => {
  const f = await fixture();
  try {
    const r = await f.spawn();
    await f.ready();
    const restored = new DelegationManager(
      f.store,
      f.root,
      () => null,
      () => true,
      () => {
        throw Error("Must not restart inference");
      },
      async () => {
        throw Error("Must not read");
      },
      () => {},
      () => {},
    );
    assert.equal(restored.ownerResult(r.agentId).state, "interrupted");
    restored.close();
  } finally {
    await f.close();
  }
});
test("time and reported-token budgets terminate workers and preserve partial findings", async (t) => {
  const f = await fixture();
  try {
    const first = await f.spawn();
    await f.ready();
    f.engines[0].emit("notification", {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: f.engines[0].threadId,
        tokenUsage: { total: { totalTokens: subagentLimits.reportedTokens } },
      },
    });
    assert.equal(f.manager.ownerResult(first.agentId).state, "failed");
    assert.match(f.manager.ownerResult(first.agentId).error!, /token budget/);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const second = await f.spawn();
    await f.ready();
    t.mock.timers.tick(subagentLimits.milliseconds + 1);
    assert.equal(f.manager.ownerResult(second.agentId).state, "failed");
    assert.match(f.manager.ownerResult(second.agentId).error!, /time budget/);
  } finally {
    t.mock.timers.reset();
    await f.close();
  }
});
test("disabling during connection startup prevents late turn creation", async () => {
  const f = await fixture();
  try {
    let release!: () => void;
    f.setConnectGate(
      new Promise<void>((r) => {
        release = r;
      }),
    );
    const r = await f.spawn();
    await f.ready();
    assert.equal(f.engines[0].calls.length, 0);
    f.disable();
    release();
    await f.ready();
    assert.equal(f.manager.ownerResult(r.agentId).state, "cancelled");
    assert.equal(f.engines[0].calls.length, 0);
    assert(f.engines[0].closed);
  } finally {
    await f.close();
  }
});
test("actual provider workers receive restricted tools and return findings across all four adapters", async () => {
  for (const kind of [
    "openai-compatible",
    "ollama",
    "anthropic",
    "gemini",
  ] as const) {
    const root = await mkdtemp(join(tmpdir(), "jarvis-delegation-provider-")),
      data = new Map(),
      requests: any[] = [];
    const store = {
      get: <T>(k: string, f: T) => (data.has(k) ? data.get(k) : f),
      set: (k: string, v: any) => {
        data.set(k, v);
      },
    };
    const fetcher = (async (_url: any, options: any) => {
      const q = JSON.parse(options.body);
      requests.push(q);
      const schema =
        kind === "anthropic"
          ? q.tools[0].input_schema
          : kind === "gemini"
            ? q.tools[0].functionDeclarations[0].parametersJsonSchema
            : q.tools[0].function.parameters;
      assert.deepEqual(schema.properties.action.enum, [
        "project.read",
        "task.status",
        "task.checkpoint",
      ]);
      const first = requests.length === 1,
        args = { action: "project.read", path: "a.ts" },
        name = "jarvis_desktop",
        finding = "Verified snapshot says Blue";
      if (kind === "anthropic")
        return Response.json({
          content: first
            ? [{ type: "tool_use", id: "read", name, input: args }]
            : [{ type: "text", text: finding }],
          stop_reason: first ? "tool_use" : "end_turn",
        });
      if (kind === "gemini")
        return Response.json({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                role: "model",
                parts: first
                  ? [{ functionCall: { name, args } }]
                  : [{ text: finding }],
              },
            },
          ],
        });
      const message = {
        role: "assistant",
        content: first ? "" : finding,
        ...(first
          ? {
              tool_calls: [
                {
                  id: "read",
                  type: "function",
                  function: {
                    name,
                    arguments: kind === "ollama" ? args : JSON.stringify(args),
                  },
                },
              ],
            }
          : {}),
      };
      return Response.json(
        kind === "ollama"
          ? { message, done: true }
          : {
              choices: [
                { message, finish_reason: first ? "tool_calls" : "stop" },
              ],
            },
      );
    }) as typeof fetch;
    const manager = new DelegationManager(
      store,
      root,
      () => ({ jobId: "j", taskId: "t", project: true }),
      () => true,
      (history) => ({
        engine: new ProviderEngine(
          {
            kind,
            endpoint: "https://provider.example",
            model: "fixture",
            key: "fixture",
            toolsVerified: true,
          },
          history,
          fetcher,
          [
            {
              name: "jarvis_desktop",
              description: subagentTool.description,
              parameters: subagentTool.inputSchema,
            },
          ],
        ),
        model: "fixture",
      }),
      async (_parent, path) => ({
        path,
        text: "Blue",
        sha256: createHash("sha256").update("Blue").digest("hex"),
      }),
      () => {},
      () => {},
    );
    manager.registerNewParent("j");
    try {
      const plan = await manager.plan("agent.spawn", {
        title: "Reader",
        role: "review",
        text: "Read a.ts",
        paths: ["a.ts"],
      });
      const result: any = await plan.run(new AbortController().signal);
      const deadline = Date.now() + 5000;
      while (
        !["completed", "failed"].includes(
          manager.ownerResult(result.agentId).state,
        ) &&
        Date.now() < deadline
      )
        await tick();
      assert.equal(
        manager.ownerResult(result.agentId).state,
        "completed",
        kind,
      );
      assert.equal(
        manager.ownerResult(result.agentId).result,
        "Verified snapshot says Blue",
      );
      assert.equal(requests.length, 2);
      assert.match(JSON.stringify(requests[1]), /Blue/);
      assert.equal(
        [...data.keys()].filter((k) => k.startsWith("providerThread:")).length,
        0,
      );
    } finally {
      manager.close();
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("disable and re-enable cannot revive a pending snapshot capture or a prepared spawn", async () => {
  const f = await fixture();
  let release!: (v: any) => void, entered!: () => void;
  const capturing = new Promise<void>((r) => (entered = r)),
    gate = new Promise<any>((r) => (release = r));
  try {
    f.setCapture(async () => {
      entered();
      return gate;
    });
    const pending = f.spawn("Capturing", { paths: ["fixture.txt"] });
    await capturing;
    f.disable();
    f.enable();
    release({
      path: "fixture.txt",
      text: "Blue",
      sha256: createHash("sha256").update("Blue").digest("hex"),
    });
    await assert.rejects(pending, /cancelled|disabled|changed/i);
    await f.ready();
    assert.equal(f.engines.length, 0);
    assert.equal(f.manager.summary().length, 0);
    const prepared = await f.manager.plan("agent.spawn", {
      title: "Prepared",
      role: "analysis",
      text: "Analyse explicit context",
    });
    f.disable();
    f.enable();
    await assert.rejects(
      () => prepared.run(new AbortController().signal),
      /cancelled|disabled|changed/i,
    );
    assert.equal(f.engines.length, 0);
  } finally {
    await f.close();
  }
});

test("six admissions survive complete result eviction, follow-up tasks and restart", async()=>{
  const f=await fixture();let restored:DelegationManager|undefined;
  try{
    const original={jobId:"original",taskId:"original-task",project:true};
    f.setParent(original);
    f.manager.registerNewParent(original.jobId);
    const finish=async()=>{const r=await f.spawn();f.manager.cancel(r.agentId);await f.ready();};
    for(let i=0;i<6;i++)await finish();
    await assert.rejects(f.spawn(),/six-worker/);
    for(let j=0;j<17;j++){
      f.setParent({jobId:"other-"+j,taskId:"task-"+j,project:true});
      f.manager.registerNewParent("other-"+j);
      for(let i=0;i<6;i++)await finish();
    }
    assert.equal(f.values.get("subagentRuns").filter((r:any)=>r.parentJobId==="original").length,0);
    f.setParent({...original,taskId:"follow-up"});
    await assert.rejects(f.spawn(),/six-worker/);
    const status=await f.run("agent.status");assert.equal(status.admissionsUsed,6);assert.equal(status.admissionsRemaining,0);
    f.manager.close();
    restored=new DelegationManager(f.store,f.root,()=>({...original,taskId:"resumed"}),()=>true,()=>{throw Error("Must not launch provider");},async()=>{throw Error("No capture");},()=>{},()=>{});
    const plan=await restored.plan("agent.spawn",{title:"Seventh",role:"analysis",text:"Denied after restart"});
    await assert.rejects(plan.run(new AbortController().signal),/six-worker/);
    assert.equal(f.values.get("subagentAdmissions").counts.original,6);
  }finally{restored?.close();await f.close();}
});

test("missing or corrupt admission history fails closed for old jobs and permits genuinely new jobs",async()=>{
  for(const corrupt of [false,true]){
    const f=await fixture();let restored:DelegationManager|undefined;
    try{
      f.manager.close();
      f.values.set("subagentRuns",[{id:"retained",parentJobId:"legacy",parentTaskId:"old-task",label:"Legacy",role:"analysis",goal:"Legacy",state:"completed",createdAt:1,files:[],toolCalls:0,reportedTokens:0}]);
      if(corrupt)f.values.set("subagentAdmissions",{schema:1,counts:{legacy:"invalid"}});else f.values.delete("subagentAdmissions");
      let parent:DelegationParent={jobId:"fully-evicted-legacy",taskId:"old",project:true};
      restored=new DelegationManager(f.store,f.root,()=>parent,()=>true,()=>({engine:new FakeEngine(),model:"fixture"}),async()=>{throw Error("No files");},()=>{},()=>{});
      const spawn=async()=>{const plan=await restored!.plan("agent.spawn",{title:"Budget",role:"review",text:"Synthetic admission"});return plan.run(new AbortController().signal);};
      await assert.rejects(spawn(),/six-worker|verified worker budget/);
      parent={jobId:"legacy",taskId:"resumed",project:true};await assert.rejects(spawn(),/six-worker|verified worker budget/);
      parent={jobId:"missing-time",taskId:"resumed",project:true};await assert.rejects(spawn(),/six-worker|verified worker budget/);
      const saved=f.values.get("subagentAdmissions");assert.equal(saved.counts.legacy,6);
      parent={jobId:"fresh",taskId:"fresh-task",project:true};
      await assert.rejects(spawn(),/six-worker|verified worker budget/);
      restored.registerNewParent(parent.jobId);
      const result:any=await spawn();assert.ok(result.agentId);assert.equal(f.values.get("subagentAdmissions").counts.fresh,1);
      restored.cancel(result.agentId);await tick();
      restored.registerNewParent(parent.jobId);
      assert.equal(f.values.get("subagentAdmissions").counts.fresh,1);
    }finally{restored?.close();await f.close();}
  }
});

test("unknown parent budgets stay closed with absent, empty or malformed history until trusted registration",async()=>{
  for(const mode of ["absent","empty","valid-empty","malformed"]){
    const values=new Map<string,any>();
    if(mode!=="absent")values.set("subagentRuns",[]);
    if(mode==="valid-empty")values.set("subagentAdmissions",{schema:1,counts:{}});
    if(mode==="malformed")values.set("subagentAdmissions",{schema:1,counts:{old:"bad"}});
    const store={get:<T>(k:string,f:T):T=>values.has(k)?structuredClone(values.get(k)):f,set:(k:string,v:unknown)=>{values.set(k,structuredClone(v));}};
    let factories=0;
    const root=await mkdtemp(join(tmpdir(),"jarvis-budget-"));
    let parent:DelegationParent={jobId:"old",taskId:"resumed",project:true};
    const manager=new DelegationManager(store,root,()=>parent,()=>true,()=>{factories++;return {engine:new FakeEngine(),model:"fixture"};},async()=>{throw Error("No capture");},()=>{},()=>{});
    const spawn=async()=>{const plan=await manager.plan("agent.spawn",{title:"Budget",role:"review",text:"Inert fixture",jobId:"new",registerNewParent:true});return plan.run(new AbortController().signal);};
    try{
      await assert.rejects(spawn(),/six-worker|verified worker budget/,mode);assert.equal(factories,0);
      const status:any=await (await manager.plan("agent.status",{})).run(new AbortController().signal);
      assert.equal(status.admissionBudgetKnown,false);assert.equal(status.admissionsUsed,null);assert.equal(status.admissionsRemaining,0);
      manager.registerNewParent("new");await assert.rejects(spawn(),/six-worker|verified worker budget/);
      parent={jobId:"new",taskId:"fresh",project:true};
      const result:any=await spawn();assert.ok(result.agentId);assert.equal(values.get("subagentAdmissions").counts.new,1);
      manager.cancel(result.agentId);manager.registerNewParent("new");
      assert.equal(values.get("subagentAdmissions").counts.new,1);
      parent={jobId:"old",taskId:"resumed-again",project:true};await assert.rejects(spawn(),/six-worker|verified worker budget/);
    }finally{manager.close();await rm(root,{recursive:true,force:true});}
  }
});
