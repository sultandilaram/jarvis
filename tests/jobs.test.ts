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
  override reply() {}
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
