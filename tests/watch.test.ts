import test from "node:test";
import assert from "node:assert/strict";
import { WatchManager } from "../src/main/watch.ts";
function fixture() {
  let saved: any;
  let now = 1800000000000;
  let price = 100;
  let fail = false;
  let phones = [{ id: "p", name: "Owner phone", alertsEnabled: true }];
  const pings: any[] = [],
    calls: any[] = [];
  const store = {
    get<T>(_k: string, f: T): T {
      return saved ? structuredClone(saved) : f;
    },
    set(_k: string, v: unknown) {
      saved = structuredClone(v);
    },
  };
  const ports = {
    now: () => now,
    phones: () => phones,
    ready: () => true,
    changed: () => {},
    quote: async () => {
      if (fail) throw Error("offline");
      return price;
    },
    notify: (u: any) => pings.push(structuredClone(u)),
    call: async (text: string, id: string) => {
      calls.push({ text, id });
      return { id: "call", push: [{ accepted: true }] };
    },
  };
  const manager = new WatchManager(store, ports);
  return {
    manager,
    store,
    ports,
    pings,
    calls,
    setTime: (v: number) => (now = v),
    advance: (v: number) => (now += v),
    price: (v: number) => (price = v),
    fail: (v: boolean) => (fail = v),
    revoke: () => (phones = []),
    now: () => now,
  };
}
async function create(f: ReturnType<typeof fixture>) {
  const plan = await f.manager.plan("watch.price", {
    symbol: "SOL",
    dropPercent: 5,
    windowMinutes: 15,
    phoneId: "p",
  });
  assert(plan.approval);
  await plan.verify?.();
  return plan.run(new AbortController().signal);
}
test("a watch plan is inert until approved and validates exact threshold and target", async () => {
  const f = fixture();
  await f.manager.plan("watch.price", {
    symbol: "SOL",
    dropPercent: 5,
    windowMinutes: 15,
    phoneId: "p",
  });
  assert.equal(f.manager.data.watches.length, 0);
  for (const args of [
    { symbol: "SOL", phoneId: "p" },
    { symbol: "https://evil", dropPercent: 5, windowMinutes: 15, phoneId: "p" },
    { symbol: "SOL", dropPercent: NaN, windowMinutes: 15, phoneId: "p" },
  ])
    await assert.rejects(() => f.manager.plan("watch.price", args));
});
test("price drop pings Mac once, pauses watch and waits an hour before a single phone request", async () => {
  const f = fixture();
  await create(f);
  f.advance(60000);
  f.price(94);
  await f.manager.tick();
  assert.equal(f.pings.length, 1);
  assert.equal(f.manager.data.watches[0].enabled, false);
  assert.equal(f.calls.length, 0);
  f.advance(3599999);
  await f.manager.tick();
  assert.equal(f.calls.length, 0);
  f.advance(1);
  await f.manager.tick();
  assert.equal(f.calls.length, 1);
  await f.manager.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].id, "p");
});
test("explicit acknowledgment and pause cancel pending escalation", async () => {
  for (const pause of [false, true]) {
    const f = fixture();
    await create(f);
    f.advance(60000);
    f.price(90);
    await f.manager.tick();
    if (pause) f.manager.pauseAll();
    else f.manager.ack(f.manager.data.updates[0].id);
    f.advance(3600000);
    await f.manager.tick();
    assert.equal(f.calls.length, 0);
  }
});
test("deadline and acknowledgment persist across restart, uncertain dispatch is never replayed", async () => {
  const f = fixture();
  await create(f);
  f.advance(60000);
  f.price(90);
  await f.manager.tick();
  let m = new WatchManager(f.store, f.ports);
  f.advance(3600000);
  await m.tick();
  assert.equal(f.calls.length, 1);
  m.data.updates[0].state = "calling";
  m.save();
  m = new WatchManager(f.store, f.ports);
  await m.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(m.data.updates[0].state, "failed");
});
test("a revoked phone cannot be replaced by another target or called", async () => {
  const f = fixture();
  await create(f);
  f.advance(60000);
  f.price(90);
  await f.manager.tick();
  f.revoke();
  f.advance(3600000);
  await f.manager.tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.manager.data.updates[0].state, "failed");
});
test("sleep and failed quotes reset observations rather than implying continuous monitoring", async () => {
  const f = fixture();
  await create(f);
  f.advance(240000);
  f.price(80);
  await f.manager.tick();
  assert.equal(f.pings.length, 0);
  assert.equal(f.manager.data.watches[0].samples.length, 1);
  f.advance(60000);
  f.fail(true);
  await f.manager.tick();
  assert.equal(f.manager.data.watches[0].samples.length, 0);
  assert.match(f.manager.data.watches[0].error!, /offline/);
  f.advance(60000);
  f.fail(false);
  f.price(50);
  await f.manager.tick();
  assert.equal(f.pings.length, 0);
});
test("task updates are Mac-only until exact future escalation subscription is enabled", async () => {
  const f = fixture();
  f.manager.report("Task finished");
  assert.equal(f.manager.data.updates[0].state, "local");
  const p = await f.manager.plan("watch.tasks", { phoneId: "p" });
  assert(p.approval);
  await p.run(new AbortController().signal);
  f.manager.report("Second task finished");
  f.advance(3600000);
  await f.manager.tick();
  assert.equal(f.calls.length, 1);
  f.manager.remove("tasks");
  assert.equal(f.manager.data.taskPhone, undefined);
});
test("failed call requests are visible and not automatically retried", async () => {
  const f = fixture();
  f.ports.call = async () => {
    throw Error("network failed");
  };
  await create(f);
  f.advance(60000);
  f.price(90);
  await f.manager.tick();
  f.advance(3600000);
  await f.manager.tick();
  assert.equal(f.manager.data.updates[0].state, "failed");
  assert.match(f.manager.data.updates[0].error!, /network failed/);
});

test("resolved information and approval requests cancel escalation while the same task continues", async () => {
  for (const kind of ["question", "approval"] as const) {
    const f = fixture();
    const p = await f.manager.plan("watch.tasks", { phoneId: "p" });
    await p.run(new AbortController().signal);
    const ref = { taskId: "task", requestId: 7, kind };
    f.manager.report("Waiting for operator", ref);
    const current: any = {
      activeTaskId: "task",
      approvals: [
        {
          id: 7,
          method:
            kind === "question"
              ? "item/tool/requestUserInput"
              : "jarvis/desktop/requestApproval",
          params: {},
        },
      ],
    };
    f.manager.resolveAttention(current);
    assert.equal(f.manager.data.updates[0].state, "waiting");
    f.manager.resolveAttention({ ...current, approvals: [] });
    assert.equal(f.manager.data.updates[0].state, "cancelled");
    assert(f.manager.data.updates[0].resolvedAt);
    f.advance(3600000);
    await f.manager.tick();
    assert.equal(f.calls.length, 0);
  }
});
test("interrupted tasks cannot leave old information requests queued for a later call", async () => {
  const f = fixture();
  const p = await f.manager.plan("watch.tasks", { phoneId: "p" });
  await p.run(new AbortController().signal);
  f.manager.report("Need details", {
    taskId: "old-task",
    requestId: 1,
    kind: "question",
  });
  const restarted = new WatchManager(f.store, f.ports);
  restarted.resolveAttention({
    activeTaskId: "new-task",
    approvals: [{ id: 1, method: "item/tool/requestUserInput", params: {} }],
  } as any);
  f.advance(3600000);
  await restarted.tick();
  assert.equal(f.calls.length, 0);
});
