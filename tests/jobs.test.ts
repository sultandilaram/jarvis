import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/main/store.ts";
import { Codex } from "../src/main/codex.ts";
import { Orchestrator } from "../src/main/orchestrator.ts";
import { JobManager } from "../src/main/jobs.ts";
class Fake extends Codex {
  calls: any[] = [];
  override async request(method: string, p: any = {}) {
    this.calls.push({ method, p });
    if (method === "thread/start")
      return { thread: { id: "t" + this.calls.length } };
    if (method === "turn/start")
      return { turn: { id: "r" + this.calls.length } };
    if (method === "turn/interrupt")
      queueMicrotask(() =>
        this.emit("notification", {
          method: "turn/completed",
          params: {
            threadId: p.threadId,
            turn: { id: p.turnId, status: "interrupted" },
          },
        }),
      );
    return {};
  }
  override reply(_id?: any, _value?: any) {}
  override reject() {}
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "jarvis-jobs-"));
  const store = new Store(":memory:"),
    codex = new Fake(),
    agent = new Orchestrator(store, codex, root, () => false);
  agent.model = "fixture";
  agent.status = "ready";
  const jobs = new JobManager(store, agent, join(root, "projects"), () => {});
  return {
    root,
    store,
    codex,
    agent,
    jobs,
    close: async () => {
      jobs.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
const tick = () => new Promise((r) => setImmediate(r));
test("jobs queue independently, keep their goals, and complete in order", async () => {
  const f = await setup();
  try {
    const a = f.jobs.enqueue({ goal: "First goal" }),
      b = f.jobs.enqueue({ goal: "Second goal", profile: "project" });
    await tick();
    assert.equal(f.jobs.current()?.id, a.id);
    assert.equal(f.jobs.get(b.id)?.state, "queued");
    const task = f.agent.active!;
    f.agent.notification({
      method: "turn/completed",
      params: {
        threadId: task.threadId,
        turn: { id: task.turnId, status: "completed" },
      },
    });
    await tick();
    assert.equal(f.jobs.get(a.id)?.state, "completed");
    assert.equal(f.jobs.current()?.id, b.id);
    assert.equal(f.agent.executionJob?.profile, "project");
    assert.notEqual(f.jobs.get(a.id)?.threadId, f.jobs.get(b.id)?.threadId);
  } finally {
    await f.close();
  }
});
test("recovery preserves checkpoints and interrupts active jobs without replay", async () => {
  const f = await setup();
  try {
    const j = f.jobs.enqueue({ goal: "Build a tool" });
    await tick();
    const saved = f.jobs.get(j.id)!;
    saved.checkpoint = "Built the module; tests pending";
    f.jobs.save(saved);
    f.jobs.close();
    const replacement = new JobManager(
      f.store,
      f.agent,
      join(f.root, "projects"),
      () => {},
    );
    replacement.closed = true;
    assert.equal(replacement.get(j.id)?.state, "interrupted");
    assert.match(replacement.get(j.id)?.checkpoint || "", /tests pending/);
    assert.equal(replacement.running, null);
  } finally {
    await f.close();
  }
});
test("Stop pauses the queue; old goals cannot start after cancellation", async () => {
  const f = await setup();
  try {
    const a = f.jobs.enqueue({ goal: "First" }),
      b = f.jobs.enqueue({ goal: "Second" });
    await tick();
    await f.jobs.stopAll();
    await tick();
    assert.equal(f.jobs.get(a.id)?.state, "paused");
    assert.equal(f.jobs.get(b.id)?.state, "paused");
    assert.equal(f.jobs.running, null);
    assert.equal(f.jobs.enabled, false);
    await f.jobs.pump();
    assert.equal(f.agent.active, null);
  } finally {
    await f.close();
  }
});
test("explicit resume retains the job and adds recovery instructions", async () => {
  const f = await setup();
  try {
    const j = f.jobs.enqueue({ goal: "Build a report" });
    await tick();
    await f.jobs.control(j.id, "pause");
    await tick();
    await f.jobs.control(j.id, "resume");
    await tick();
    assert.equal(f.jobs.current()?.id, j.id);
    const start = f.codex.calls.filter((x) => x.method === "turn/start").at(-1);
    assert.match(
      start.p.input[0].text,
      /Never replay an uncertain side effect/,
    );
    assert.match(start.p.input[0].text, /Build a report/);
  } finally {
    await f.close();
  }
});

test("scheduled jobs wait until their due time without blocking ready jobs", async () => {
  const f = await setup();
  try {
    const later = f.jobs.enqueue({
      goal: "Later",
      runAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const now = f.jobs.enqueue({ goal: "Now" });
    await tick();
    assert.equal(f.jobs.get(later.id)?.state, "queued");
    assert.equal(f.jobs.current()?.id, now.id);
  } finally {
    await f.close();
  }
});
test("memory retrieval is bounded and respects global/project scope", async () => {
  const f = await setup();
  try {
    for (let i = 0; i < 20; i++)
      f.store.remember("Preference " + i, "confirmed");
    f.store.remember(
      "Website project uses a cyan interface",
      "confirmed",
      "website",
    );
    assert.equal(
      f.store.recall("website", "global").some((m) => m.scope === "website"),
      false,
    );
    assert(
      f.store.recall("website", "website").some((m) => m.scope === "website"),
    );
    assert(f.store.recall("preferences", "all").length <= 12);
  } finally {
    await f.close();
  }
});

test("follow-up work preserves a completed project workspace and thread", async () => {
  const f = await setup();
  const registrations: string[] = [];
  f.jobs.onCreated = job => { registrations.push(job.id); };
  try {
    const job = f.jobs.enqueue({
      goal: "Build a calculator",
      profile: "project",
    });
    await tick();
    const task = f.agent.active!;
    f.agent.notification({
      method: "turn/completed",
      params: {
        threadId: task.threadId,
        turn: { id: task.turnId, status: "completed" },
      },
    });
    await tick();
    const old = f.jobs.get(job.id)!;
    f.jobs.followup(job.id, "Add multiplication");
    await tick();
    const next = f.jobs.get(job.id)!;
    assert.equal(next.workspace, old.workspace);
    assert.equal(next.threadId, old.threadId);
    assert.match(next.goal, /Add multiplication/);
    assert.equal(f.jobs.current()?.id, job.id);
    assert.deepEqual(registrations, [job.id], "Follow-ups must not register a fresh admission budget");
  } finally {
    await f.close();
  }
});

test("reported usage belongs to the active turn and is never inferred as a bill", async () => {
  const f = await setup();
  try {
    const j = f.jobs.enqueue({ goal: "Inspect a report" });
    await tick();
    const t = f.agent.active!;
    f.agent.notification({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: t.threadId,
        turnId: "stale",
        tokenUsage: { total: { totalTokens: 999 } },
      },
    });
    assert.equal(f.jobs.get(j.id)?.threadTokenTotal, undefined);
    f.agent.notification({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: t.threadId,
        turnId: t.turnId,
        tokenUsage: { total: { totalTokens: 1234 } },
      },
    });
    assert.equal(f.jobs.get(j.id)?.threadTokenTotal, 1234);
  } finally {
    await f.close();
  }
});

test("recovery reconciles a completed task before considering a job interrupted", async () => {
  const f = await setup();
  try {
    const j = f.jobs.enqueue({ goal: "Complete a report" });
    await tick();
    const saved = f.jobs.get(j.id)!;
    f.jobs.close();
    f.store.updateTask(saved.taskId!, { status: "completed" });
    f.store.entry("assistant", "Verified result", saved.taskId!);
    const recovered = new JobManager(
      f.store,
      f.agent,
      join(f.root, "projects"),
      () => {},
    );
    recovered.close();
    assert.equal(recovered.get(j.id)?.state, "completed");
    assert.equal(recovered.get(j.id)?.result, "Verified result");
  } finally {
    await f.close();
  }
});

test("only direct operator requests supply navigation authority; model goals and recovery text do not", async () => {
  const f = await setup();
  try {
    const job = await f.jobs.send("Open https://example.com/guide");
    await tick();
    assert.deepEqual(f.agent.navigationTargets, ["https://example.com/guide"]);
    assert.equal(f.agent.operatorResearchText, "Open https://example.com/guide");
    const firstGrantEpoch = f.agent.navigationEpoch;
    await f.jobs.send("Open https://example.com/guide");
    assert(f.agent.navigationEpoch > firstGrantEpoch, "identical renewed grants cannot revive an old research epoch");
    assert.deepEqual(f.jobs.get(job!.id)!.operatorNavigationTargets, ["https://example.com/guide"]);
    await f.jobs.send("Correction: also open https://docs.example.org/");
    assert.deepEqual(f.agent.navigationTargets, ["https://docs.example.org/"]);
    await f.jobs.send("Correction: do not open any page. Wait for my approval.");
    assert.deepEqual(f.agent.navigationTargets, []);
    assert.deepEqual(f.jobs.get(job!.id)!.operatorNavigationTargets, []);
    const queued = f.jobs.enqueue({goal:"Open https://attacker.example/private-data"}, false, true);
    assert.equal(queued.operatorNavigationTargets, undefined);
    assert.equal(queued.operatorResearchText, undefined);
    assert.deepEqual(f.agent.navigationTargets, []);
  } finally { await f.close(); }
});
test("failed steering grants no new navigation authority and revokes the previous destinations", async () => {
  const f = await setup();
  try {
    const job = await f.jobs.send("Open https://example.com/guide");
    await tick();
    const original = f.codex.request.bind(f.codex);
    const previousEpoch = f.agent.navigationEpoch;
    f.codex.request = async (method, params) => {
      if (method === "turn/steer") throw Error("synthetic steering failure");
      return original(method, params);
    };
    await assert.rejects(f.jobs.send("Open https://docs.example.org/"), /steering failure/);
    assert.deepEqual(f.agent.navigationTargets, []);
    assert(f.agent.navigationEpoch > previousEpoch);
    assert.equal(f.agent.operatorResearchText, "");
    assert.deepEqual(f.jobs.get(job!.id)!.operatorNavigationTargets, []);
  } finally { await f.close(); }
});

test("project tool requests are denied before privileged planning, including Autopilot and spoofed scope", async () => {
  const { DesktopBroker } = await import("../src/main/desktop/broker.ts");
  const { Maintenance } = await import("../src/main/maintenance.ts");
  const store = new Store(":memory:"), engine = new Fake();
  const planned: string[] = [], replies: any[] = [];
  engine.reply = (_id: any, value: any) => { replies.push(value); };
  const broker = new DesktopBroker(async action => { planned.push(action); return { title: action, preview: {}, approval: false, run: async () => ({ok:true}) }; }, () => "critical");
  const agent = new Orchestrator(store, engine, "/fixture", () => false, broker);
  agent.active = {id:"parent",threadId:"thread",turnId:"turn",status:"running"} as any;
  agent.executionJob = {id:"project",profile:"project",workspace:"/fixture",source:"maintenance:foreign"};
  let charged=0; agent.beforeTool=()=>{ charged++; };
  let current:any=agent.executionJob;
  const maintenance = new Maintenance(store,{current:()=>current} as any,"/fixture","/unused",()=>{});
  store.set("maintenanceProposals", [{id:"own",jobId:"proposer",reviewJobId:"reviewer",state:"reviewing"}]);
  agent.projectAuthority=job=>maintenance.projectAuthority(job);
  const send=async(action:string,args:any={})=>{
    const n=replies.length;
    agent.serverRequest({id:charged+1,method:"item/tool/call",params:{threadId:"thread",turnId:"turn",namespace:"jarvis",tool:"desktop",arguments:{action,...args}}});
    for(let i=0;i<20&&replies.length===n;i++)await tick();
    assert.equal(replies.length,n+1,action); return replies.at(-1);
  };
  try {
    for(const action of ["apps.list","apps.open","desktop.observe","desktop.type","desktop.capture","browser.open_external","browser.tabs","files.roots","files.read","files.write","accounts.status","email.read","calendar.list","plugin.call","phone.call","watch.tasks","memory.search","job.list","job.enqueue","job.resume","repo.status","repo.start","repo.publish","repo.merge","repo.release","repo.build_release","future.tool"]){
      assert.equal((await send(action,{profile:"desktop",source:"maintenance:own",proposalId:"own",jobId:"proposer",requestTaskId:"parent"})).success,false,action);
    }
    assert.deepEqual(planned,[]);
    assert.equal((await send("job.read",{jobId:"proposer"})).success,false);
    for(const action of ["project.status","project.read","task.status","agent.status"])
      assert.equal((await send(action)).success,true,action);
    assert.equal((await send("job.read",{jobId:"project"})).success,true);
    agent.executionJob=current={id:"reviewer",profile:"project" as const,workspace:"/fixture",source:"maintenance-review:own"};
    for(const [action,args] of [["repo.status",{}],["repo.diff",{proposalId:"own"}],["repo.review",{proposalId:"own"}],["job.files",{jobId:"proposer"}]] as const)
      assert.equal((await send(action,args)).success,true,action);
    for(const [action,args] of [["repo.submit",{proposalId:"own"}],["repo.diff",{proposalId:"foreign"}],["job.read",{jobId:"foreign"}],["repo.publish",{proposalId:"own"}]] as const)
      assert.equal((await send(action,args)).success,false,action);
    current={...current,id:"other"};assert.equal((await send("repo.status")).success,false);
    agent.executionJob={id:"desktop",profile:"desktop",workspace:"/fixture"};
    assert.equal((await send("apps.open")).success,true);
    assert.ok(charged>30);
    agent.executionJob={id:"unknown",profile:"unexpected",workspace:"/fixture"} as any;
    assert.equal((await send("apps.list")).success,false);
  } finally { store.close(); }
});

test("task activity and pending approvals retain trusted request ownership", async () => {
  const { DesktopBroker } = await import("../src/main/desktop/broker.ts");
  const store=new Store(":memory:"), engine=new Fake();
  const broker=new DesktopBroker(async action=>({title:action,preview:{value:action},approval:action.endsWith("approval"),run:async()=>({value:action})}));
  const agent=new Orchestrator(store,engine,"/fixture",()=>false,broker);
  agent.active={id:"project-task",threadId:"thread",status:"running"} as any;
  agent.executionJob={id:"project",profile:"project",workspace:"/fixture"};
  try {
    await broker.execute("owner-private",{});
    await broker.execute("project-own",{}, {taskId:"project-task",authorize:()=>{}});
    let pending=broker.execute("owner-approval",{requestTaskId:"project-task"});await tick();
    let status:any=await agent.taskPlan("task.status",{}).run(new AbortController().signal);
    assert.equal(status.pendingRequests.length,0);
    assert.ok(status.recentActivity.length>0);
    assert.ok(status.recentActivity.every((e:any)=>!e.text.includes("owner-private")));
    agent.approve([...agent.approvals.keys()][0],false);await pending;
    status=await agent.taskPlan("task.status",{}).run(new AbortController().signal);
    assert.ok(status.recentActivity.every((e:any)=>!e.text.includes("owner-approval")));
    pending=broker.execute("owner-approval",{});await tick();
    agent.approve([...agent.approvals.keys()][0],true);await pending;
    status=await agent.taskPlan("task.status",{}).run(new AbortController().signal);
    assert.ok(status.recentActivity.every((e:any)=>!e.text.includes("owner-approval")));
    pending=broker.execute("project-approval",{}, {taskId:"project-task",authorize:()=>{}});await tick();
    status=await agent.taskPlan("task.status",{}).run(new AbortController().signal);
    assert.equal(status.pendingRequests.length,1);
    assert.equal(status.pendingRequests[0].params.requestTaskId,"project-task");
    agent.approve([...agent.approvals.keys()][0],true);await pending;
    status=await agent.taskPlan("task.status",{}).run(new AbortController().signal);
    assert.ok(status.recentActivity.some((e:any)=>e.text.includes("Approved once: project-approval")));
    let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
    broker.planner=async action=>({title:action,preview:{},approval:false,run:async()=>{if(action==="block")await gate;return {};}});
    const first=broker.execute("block",{});await tick();let authority=true;
    const stale=broker.execute("stale",{}, {taskId:"project-task",authorize:()=>{if(!authority)throw Error("expired");}});
    authority=false;release();await first;assert.equal((await stale).success,false);
  } finally {broker.cancel();store.close();}
});

test("maintenance grants bind the active role and expose no global builder or foreign proposal status", async()=>{
  const { Maintenance }=await import("../src/main/maintenance.ts");
  const store=new Store(":memory:");let current:any={id:"reviewer",profile:"project",source:"maintenance-review:own"};
  const m=new Maintenance(store,{current:()=>current} as any,"/fixture","/unused",()=>{});
  m.builderState=()=>({directory:"private-build-path"});m.githubReady=()=>true;
  store.set("maintenanceProposals",[{id:"own",jobId:"proposer",reviewJobId:"reviewer",state:"reviewing"},{id:"foreign",jobId:"other",state:"draft",goal:"private-goal"}]);
  try{
    assert.deepEqual(m.projectAuthority(current),{proposalId:"own",role:"reviewer",evidenceJobIds:["proposer"]});
    assert.equal(m.projectAuthority({...current,source:"maintenance:own"}),undefined);
    assert.equal(m.projectAuthority({...current,id:"other"}),undefined);
    const result:any=await (await m.plan("repo.status",{})).run(new AbortController().signal);
    assert.equal(result.proposals.length,1);assert.equal(result.proposals[0].id,"own");
    assert.ok(!JSON.stringify(result).includes("private"));assert.equal(result.releaseBuilder,undefined);
    current={id:"proposer",profile:"project",source:"maintenance:own"};
    assert.equal(m.projectAuthority(current),undefined);
    store.set("maintenanceProposals",[{id:"own",jobId:"proposer",state:"draft"}]);
    assert.equal(m.projectAuthority(current)?.role,"proposer");
  }finally{store.close();}
});

test("actual desktop service receives zero native calls from project scope while desktop requests still work", async()=>{
  const cp=await import("node:child_process"), modules=await import("node:module");
  const stub='data:text/javascript,'+encodeURIComponent('export const dialog={};export const shell={};export class BrowserWindow{};export class WebContentsView{};export const session={};');
  const hook=modules.registerHooks({resolve(s,c,next){return s==='electron'?{url:stub,shortCircuit:true}:next(s,c);}});
  const mutable=cp.default,original=mutable.execFile,calls:any[]=[];
  mutable.execFile=((_file:any,_args:any,_options:any,callback:any)=>({stdin:{end(raw:string){const args=JSON.parse(raw);calls.push(args);queueMicrotask(()=>callback(null,JSON.stringify(args.action==='apps.list'?{apps:[{bundleId:'fixture.application'}]}:args.action==='desktop.observe'?{bundleId:'fixture.application',elements:[],pageContentAvailable:true,truncated:false}:{launchAccepted:true,verified:false})));}}})) as any;
  modules.syncBuiltinESMExports();
  const store=new Store(":memory:");
  try{
    const {DesktopService}=await import("../src/main/desktop/service.ts");
    const service=new DesktopService('inert-helper',()=>[],()=>{},()=>{throw Error('No owner UI');});
    const engine=new Fake(),replies:any[]=[];engine.reply=(_id:any,result:any)=>{replies.push(result);};
    const agent=new Orchestrator(store,engine,'.',()=>false,service.broker);
    agent.executionJob={id:'project',profile:'project',workspace:'.'};
    agent.active={id:'task',threadId:'thread',turnId:'turn',status:'running'} as any;
    service.browser.accessAllowed=()=>agent.executionJob?.profile!=='project';
    let approvals=0;service.broker.on('approval',a=>{approvals++;service.broker.decide(a.id,true);});
    const actions=[{action:'apps.list'},{action:'desktop.observe',bundleId:'fixture.application'},{action:'apps.open',bundleId:'com.apple.TextEdit'},{action:'browser.open_external',bundleId:'company.thebrowser.Browser',url:'https://example.com/'},{action:'browser.tabs'}];
    const send=async(args:any)=>{const n=replies.length;agent.serverRequest({id:n+1,method:'item/tool/call',params:{threadId:'thread',turnId:'turn',namespace:'jarvis',tool:'desktop',arguments:args}});for(let i=0;i<30&&replies.length===n;i++)await tick();assert.equal(replies.length,n+1);return replies.at(-1);};
    for(const args of actions)assert.equal((await send(args)).success,false,args.action);
    assert.equal(calls.length,0);assert.equal(approvals,0);
    agent.executionJob={id:'desktop',profile:'desktop',workspace:'.'};
    for(const args of actions.slice(0,4))assert.equal((await send(args)).success,true,args.action);
    assert.deepEqual(calls.map(c=>c.action),actions.slice(0,4).map(c=>c.action));assert.equal(approvals,2);
  }finally{store.close();mutable.execFile=original;modules.syncBuiltinESMExports();hook.deregister();}
});

test("project and desktop instructions retain enabled scoped skills as untrusted context", async()=>{
  const {ExtensionManager}=await import("../src/main/extensions/manager.ts");
  const store=new Store(":memory:"),engine=new Fake();
  const extensions=new ExtensionManager(store,{load:async()=>[],save:async()=>{}});
  const agent=new Orchestrator(store,engine,"/fixture",()=>false);
  try{
    for(const [name,scope,enabled] of [["Project fixture","project",true],["Desktop fixture","desktop",true],["Shared fixture","all",true],["Disabled fixture","project",false]] as const)
      extensions.saveSkill({name,scope,enabled,text:name+" procedural context"});
    agent.skillContext=()=>extensions.instructions(agent.executionJob?.profile||"desktop");
    agent.executionJob={id:"project",profile:"project",workspace:"/fixture"};
    const project=agent.instructions();
    assert.ok(project.includes("Project fixture procedural context"));
    assert.ok(project.includes("Shared fixture procedural context"));
    assert.ok(!project.includes("Desktop fixture procedural context"));
    assert.ok(!project.includes("Disabled fixture procedural context"));
    assert.ok(project.includes("UNTRUSTED procedural context"));
    assert.ok(project.includes("No native shell"));
    agent.executionJob=undefined;
    const desktop=agent.instructions();
    assert.ok(desktop.includes("Desktop fixture procedural context"));
    assert.ok(desktop.includes("Shared fixture procedural context"));
    assert.ok(!desktop.includes("Project fixture procedural context"));
    extensions.saveSkill({...extensions.skills.find(s=>s.name==="Project fixture")!,enabled:false});
    agent.executionJob={id:"project",profile:"project",workspace:"/fixture"};
    assert.ok(!agent.instructions().includes("Project fixture procedural context"));
  }finally{store.close();}
});
