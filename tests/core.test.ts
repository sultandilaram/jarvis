import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/main/store.ts";
import { Codex } from "../src/main/codex.ts";
import { DesktopBroker } from "../src/main/desktop/broker.ts";
import { Orchestrator } from "../src/main/orchestrator.ts";
import { readSelectedFile } from "../src/main/local-file.ts";
const deferred = () => {
  let resolve!: (v: any) => void;
  const promise = new Promise<any>((r) => (resolve = r));
  return { promise, resolve };
};
class FakeCodex extends Codex {
  calls: { method: string; params: any }[] = [];
  replies: any[] = [];
  closed = false;
  gate?: ReturnType<typeof deferred>;
  override async request(method: string, params: any = {}) {
    this.calls.push({ method, params });
    if (method === "thread/start")
      return this.gate ? this.gate.promise : { thread: { id: "thread" } };
    if (method === "turn/start") return { turn: { id: "turn" } };
    if (method === "turn/interrupt") {
      queueMicrotask(() =>
        this.emit("notification", {
          method: "turn/completed",
          params: {
            threadId: "thread",
            turn: { id: "turn", status: "interrupted" },
          },
        }),
      );
      return {};
    }
    return {};
  }
  override reply(id: any, result: any) {
    this.replies.push({ id, result });
  }
  override reject(id: any, message: string) {
    this.replies.push({ id, error: message });
  }
  override close() {
    this.closed = true;
  }
}
function setup() {
  const store = new Store(":memory:");
  const codex = new FakeCodex();
  const agent = new Orchestrator(store, codex, "/tmp", () => false);
  agent.model = "test";
  agent.status = "ready";
  return { store, codex, agent };
}
test("public research requires a separate owner opt-in", () => {
  const store = new Store(":memory:");
  assert.equal(store.settings().publicResearchEnabled, false);
  store.set("settings", { approvalMode: "critical" });
  assert.equal(store.settings().publicResearchEnabled, false);
  store.set("settings", { approvalMode: "critical", publicResearchEnabled: true });
  assert.equal(store.settings().publicResearchEnabled, true);
  store.close();
});
test("history and confirmed/inferred memories survive reopening; interrupted work is recovered", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-"));
  const path = join(dir, "state.sqlite");
  let store = new Store(path);
  const task = store.task("read file", "thread");
  store.entry("user", "hello", task.id);
  store.remember("fact", "confirmed");
  store.remember("hypothesis", "inferred");
  store.set("threadId", "thread");
  store.close();
  store = new Store(path);
  store.recover();
  assert.equal(store.tasks()[0].status, "interrupted");
  assert.equal(store.entries()[0].text, "hello");
  assert.equal(store.get("threadId", null), "thread");
  assert.deepEqual(
    store.memories().map((m) => m.kind),
    ["confirmed", "inferred"],
  );
  store.close();
  await rm(dir, { recursive: true });
});
test("stop during thread startup prevents turn execution and releases the task slot", async () => {
  const { store, codex, agent } = setup();
  codex.gate = deferred();
  const sending = agent.send("work");
  await agent.stop();
  codex.gate.resolve({ thread: { id: "thread" } });
  await sending;
  assert.equal(codex.calls.filter((c) => c.method === "turn/start").length, 0);
  assert.equal(agent.active, null);
  assert.equal(agent.status, "ready");
  assert.equal(store.tasks()[0].status, "interrupted");
  store.close();
});
test("active corrections steer the exact turn; stop cancels pending approvals and rejects stale approvals", async () => {
  const { store, codex, agent } = setup();
  await agent.send("work");
  await agent.send("change direction");
  assert.equal(codex.calls.at(-1)?.method, "turn/steer");
  assert.equal(codex.calls.at(-1)?.params.expectedTurnId, "turn");
  codex.emit("request", {
    id: 44,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "thread", command: "danger" },
  });
  assert.equal(agent.status, "approval");
  await agent.stop();
  assert.deepEqual(codex.replies[0], {
    id: 44,
    result: { decision: "cancel" },
  });
  assert.throws(() => agent.approve(44, true), /expired/);
  assert.equal(agent.active, null);
  assert.equal(store.tasks()[0].status, "interrupted");
  store.close();
});
test("second task cannot race startup; unsupported requests fail closed", async () => {
  const { store, codex, agent } = setup();
  codex.gate = deferred();
  const sending = agent.send("work");
  await assert.rejects(() => agent.send("race"), /starting/);
  codex.gate.resolve({ thread: { id: "thread" } });
  await sending;
  codex.emit("request", {
    id: 55,
    method: "unknown/action",
    params: { threadId: "thread" },
  });
  assert.match(codex.replies[0].error, /Unsupported/);
  store.close();
});
test("selected text file reads verify bytes and hash; binary and oversized files are rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-file-"));
  const path = join(dir, "hello.txt");
  await writeFile(path, "hello");
  const result = await readSelectedFile(path);
  assert.equal(result.bytes, 5);
  assert.equal(
    result.sha256,
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
  await writeFile(path, Buffer.from([0, 1]));
  await assert.rejects(() => readSelectedFile(path), /binary/);
  await writeFile(path, Buffer.alloc(1024 * 1024 + 1));
  await assert.rejects(() => readSelectedFile(path), /1 MiB/);
  await rm(dir, { recursive: true });
});
test("RPC correlates out-of-order responses and propagates errors", async () => {
  const codex = new Codex();
  const sent: any[] = [];
  codex.write = (m) => {
    sent.push(m);
  };
  const a = codex.request("first");
  const b = codex.request("second");
  codex.receive({ id: sent[1].id, result: { ok: true } });
  codex.receive({ id: sent[0].id, error: { message: "denied" } });
  assert.deepEqual(await b, { ok: true });
  await assert.rejects(a, /denied/);
  assert.equal(codex.pending.size, 0);
});
test("stop while turn/start is pending interrupts the late-started turn", async () => {
  const { store, codex, agent } = setup();
  const gate = deferred();
  const request = codex.request.bind(codex);
  codex.request = async (method, params = {}) =>
    method === "turn/start" ? gate.promise : request(method, params);
  const sending = agent.send("work");
  await new Promise((r) => setImmediate(r));
  await agent.stop();
  gate.resolve({ turn: { id: "turn" } });
  await sending;
  assert.equal(codex.calls.at(-1)?.method, "turn/interrupt");
  assert.equal(agent.active, null);
  assert.equal(agent.status, "ready");
  assert.equal(store.tasks()[0].status, "interrupted");
  store.close();
});
test("a delayed completion or approval from an older turn cannot affect the current task", async () => {
  const { store, codex, agent } = setup();
  await agent.send("work");
  codex.emit("notification", {
    method: "turn/completed",
    params: {
      threadId: "thread",
      turn: { id: "old-turn", status: "completed" },
    },
  });
  codex.emit("request", {
    id: 65,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "thread", turnId: "old-turn", command: "stale" },
  });
  assert.ok(agent.active);
  assert.equal(agent.approvals.size, 0);
  assert.match(codex.replies[0].error, /No active authorized/);
  store.close();
});

test("desktop calls route through namespaced approvals and cannot fall back to server execution", async () => {
  const store = new Store(":memory:"),
    codex = new FakeCodex();
  let executed = 0;
  const desktop = new DesktopBroker(async () => ({
    title: "Fixture",
    approval: true,
    preview: { text: "exact" },
    run: async () => {
      executed++;
      return { verified: true };
    },
  }));
  const agent = new Orchestrator(store, codex, "/tmp", () => false, desktop);
  agent.model = "test";
  await agent.send("Test");
  assert.equal(
    codex.calls.find((c) => c.method === "thread/start")?.params.dynamicTools[0]
      .name,
    "jarvis",
  );
  codex.emit("request", {
    id: 90,
    method: "item/tool/call",
    params: {
      threadId: "thread",
      turnId: "turn",
      namespace: "jarvis",
      tool: "desktop",
      arguments: { action: "fixture" },
    },
  });
  await new Promise((r) => setImmediate(r));
  const a = agent.snapshot().approvals[0];
  assert.equal(a.id, "desktop:901");
  assert.equal(executed, 0);
  agent.approve(a.id, true);
  await new Promise((r) => setImmediate(r));
  assert.equal(executed, 1);
  assert.equal(codex.replies.find((r) => r.id === 90)?.result.success, true);
  codex.emit("request", {
    id: 91,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "thread", turnId: "turn", command: "unexpected" },
  });
  assert.match(
    codex.replies.find((r) => r.id === 91)?.error,
    /Only approval-enforced/,
  );
  await agent.stop();
  store.close();
});

test("question replies require all exact fields, preserve the task, and reject stale replies", async () => {
  const { store, codex, agent } = setup();
  await agent.send("Prepare the report");
  agent.serverRequest({
    id: "q1",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread",
      questions: [
        { id: "format", question: "Which format?" },
        { id: "folder", question: "Which folder?" },
      ],
    },
  });
  assert.throws(() => agent.answer("q1", { format: "PDF" }), /every pending/);
  assert.throws(
    () =>
      agent.answer("q1", {
        format: "PDF",
        folder: "Workspace",
        extra: "ignore",
      }),
    /every pending/,
  );
  agent.answer("q1", { format: "PDF", folder: "Workspace" });
  assert.deepEqual(codex.replies.at(-1), {
    id: "q1",
    result: {
      answers: {
        format: { answers: ["PDF"] },
        folder: { answers: ["Workspace"] },
      },
    },
  });
  assert.equal(agent.status, "working");
  assert.equal(agent.active?.id, store.tasks()[0].id);
  assert.equal(store.tasks()[0].status, "working");
  assert.throws(
    () => agent.answer("q1", { format: "PDF", folder: "Workspace" }),
    /expired/,
  );
  store.close();
});

test("Codex task.ask waits for operator information and resumes the original tool call", async () => {
  const store = new Store(":memory:"),
    codex = new FakeCodex();
  let agent: Orchestrator;
  const broker = new DesktopBroker(async (action, args) =>
    agent.taskPlan(action, args),
  );
  agent = new Orchestrator(store, codex, "/tmp", () => false, broker);
  agent.model = "test";
  agent.status = "ready";
  await agent.send("Prepare the client report");
  const task = agent.active!.id;
  agent.serverRequest({
    id: 100,
    method: "item/tool/call",
    params: {
      threadId: "thread",
      tool: "desktop",
      namespace: "jarvis",
      arguments: { action: "task.ask", text: "Which client should I use?" },
    },
  });
  await new Promise((r) => setImmediate(r));
  const question = [...agent.approvals.values()][0];
  assert.equal(question.method, "item/tool/requestUserInput");
  assert.equal(codex.replies.length, 0);
  agent.answer(question.id, { reply: "Acme" });
  await new Promise((r) => setImmediate(r));
  assert.equal(agent.active!.id, task);
  assert.equal(agent.status, "working");
  assert.equal(agent.approvals.size, 0);
  assert.equal(codex.replies[0].id, 100);
  assert.equal(codex.replies[0].result.success, true);
  const result = JSON.parse(codex.replies[0].result.contentItems[0].text);
  assert.equal(result.answer, "Acme");
  assert.match(result.note, /No action was approved/);
  store.close();
});
test("Stop cancels a local task question and rejects late spoken replies", async () => {
  const store = new Store(":memory:"),
    codex = new FakeCodex();
  let agent: Orchestrator;
  const broker = new DesktopBroker(async (action, args) =>
    agent.taskPlan(action, args),
  );
  agent = new Orchestrator(store, codex, "/tmp", () => false, broker);
  agent.model = "test";
  await agent.send("Prepare a report");
  agent.serverRequest({
    id: 101,
    method: "item/tool/call",
    params: {
      threadId: "thread",
      tool: "desktop",
      namespace: "jarvis",
      arguments: { action: "task.ask", text: "Which report?" },
    },
  });
  await new Promise((r) => setImmediate(r));
  const q = [...agent.approvals.values()][0];
  await agent.stop();
  await new Promise((r) => setImmediate(r));
  assert.equal(agent.localQuestions.size, 0);
  assert.equal(agent.approvals.size, 0);
  assert.throws(() => agent.answer(q.id, { reply: "Late answer" }), /expired/);
  assert.equal(codex.replies.find((r) => r.id === 101)?.result.success, false);
  store.close();
});
test("task checkpoints record progress without authorizing work or replacing the active goal", async () => {
  const { store, agent } = setup();
  await agent.send("Prepare a report");
  const id = agent.active!.id;
  const plan = agent.taskPlan("task.checkpoint", {
    text: "Read the approved source files; drafting remains.",
  });
  assert.equal(plan.approval, false);
  await plan.run(new AbortController().signal);
  assert.equal(agent.active!.id, id);
  assert.match(store.entries().at(-1)!.text, /Checkpoint/);
  assert.equal(agent.approvals.size, 0);
  store.close();
});
