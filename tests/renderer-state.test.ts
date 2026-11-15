import test from "node:test";
import assert from "node:assert/strict";
import {
  rendererWire,
  rendererSnapshot,
  rendererWireLimit,
  rendererApprovalAllowed,
  RendererPublisher,
} from "../src/main/renderer-state.ts";
import { RendererRecovery } from "../src/main/renderer-recovery.ts";
import { Orchestrator } from "../src/main/orchestrator.ts";
const state = () =>
  ({
    status: "ready",
    settings: { wakeWordEnabled: false },
    tasks: [],
    entries: [],
    approvals: [],
    memories: [],
    jobs: [],
  }) as any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
test("large maintenance history stays bounded on the wire without mutating local records or previews", () => {
  const s = state();
  s.entries = Array.from({ length: 1000 }, (_, i) => ({
    id: String(i),
    role: "activity",
    taskId: "t",
    createdAt: "now",
    text: "\u0000".repeat(100000),
  }));
  s.jobs = Array.from({ length: 100 }, () => ({
    goal: "x".repeat(100000),
    state: "running",
  }));
  s.maintenance = {
    proposals: Array.from({ length: 100 }, () => ({
      review: "r".repeat(100000),
      goal: "g".repeat(100000),
    })),
  };
  s.approvals = [
    {
      id: 1,
      method: "jarvis/desktop/requestApproval",
      params: { voiceId: 1, preview: { path: "exact.txt", text: "Blue" } },
    },
  ];
  const raw = rendererWire(s),
    projected = JSON.parse(raw);
  assert(Buffer.byteLength(raw) < rendererWireLimit);
  assert.equal(projected.status, "ready");
  assert.deepEqual(projected.settings, s.settings);
  assert(projected.entries.length < 1000);
  assert.match(projected.entries.at(-1).text, /Shortened for display/);
  assert.equal(s.entries.length, 1000);
  assert.equal(s.entries[0].text.length, 100000);
  assert.deepEqual(projected.approvals, s.approvals);
  assert(rendererApprovalAllowed(s.approvals, 1));
});
test("deep, cyclic and oversized approvals cannot be shortened into approvable actions", () => {
  let deep: any = { text: "value" };
  for (let i = 0; i < 30; i++) deep = { child: deep };
  const cyclic: any = {};
  cyclic.self = cyclic;
  for (const preview of [deep, cyclic, { text: "x".repeat(2 * 1024 * 1024) }]) {
    const s = state();
    s.approvals = [
      {
        id: "a",
        method: "jarvis/desktop/requestApproval",
        params: { preview },
      },
    ];
    assert.equal(
      rendererSnapshot(s).approvals[0].params.reviewUnavailable,
      true,
    );
    assert.equal(rendererApprovalAllowed(s.approvals, "a"), false);
    let dispatched = 0;
    const actor: any = {
      approvals: new Map([["a", s.approvals[0]]]),
      stopping: false,
      approvalReviewAllowed: (id: string) =>
        rendererApprovalAllowed(s.approvals, id),
      desktop: { decide: () => dispatched++ },
    };
    assert.throws(
      () => Orchestrator.prototype.approve.call(actor, "a", true),
      /too large to review/,
    );
    assert.equal(dispatched, 0);
    assert(actor.approvals.has("a"));
  }
});
test("combined approval budget fails closed and ordinary previews remain exact", () => {
  const s = state();
  s.approvals = Array.from({ length: 3 }, (_, i) => ({
    id: i,
    method: "test/requestApproval",
    params: { preview: { text: "x".repeat(1000000) } },
  }));
  const p = rendererSnapshot(s);
  assert.deepEqual(p.approvals[0], s.approvals[0]);
  assert.deepEqual(p.approvals[1], s.approvals[1]);
  assert.equal(p.approvals[2].params.reviewUnavailable, true);
  assert(rendererApprovalAllowed(s.approvals, 0));
  assert(!rendererApprovalAllowed(s.approvals, 2));
  assert(Buffer.byteLength(rendererWire(s)) < rendererWireLimit);
});
test("streaming changes coalesce to latest state and a dead renderer receives no queued payload", async () => {
  let revision = 0;
  const sent: string[] = [],
    errors: unknown[] = [];
  const p = new RendererPublisher(
    () => String(revision),
    (s) => sent.push(s),
    (e) => errors.push(e),
    5,
  );
  p.resume();
  for (let i = 0; i < 10000; i++) {
    revision = i;
    p.queue();
  }
  await sleep(15);
  assert.deepEqual(sent, ["9999"]);
  p.queue();
  p.pause();
  await sleep(15);
  assert.equal(sent.length, 1);
  revision = 10000;
  p.resume();
  await sleep(15);
  assert.deepEqual(sent, ["9999", "10000"]);
  p.pause();
  assert.deepEqual(errors, []);
});
test("renderer recovery reloads only the interface with a bounded crash-loop policy", async () => {
  let reloads = 0,
    blocked = 0,
    clock = 1000;
  const recovery = new RendererRecovery(
    () => reloads++,
    () => blocked++,
    () => clock,
    2,
  );
  recovery.gone("crashed");
  recovery.gone("crashed");
  await sleep(12);
  assert.equal(reloads, 1);
  recovery.gone("oom");
  await sleep(12);
  recovery.gone("crashed");
  await sleep(12);
  recovery.gone("crashed");
  assert.equal(reloads, 3);
  assert.equal(blocked, 1);
  clock += 300001;
  recovery.gone("crashed");
  await sleep(12);
  assert.equal(reloads, 4);
  recovery.gone("crashed");
  recovery.close();
  await sleep(12);
  assert.equal(reloads, 4);
});

test("blocked questions cannot receive answers through another channel", () => {
  const a = {
    id: "q",
    method: "item/tool/requestUserInput",
    params: { questions: [{ id: "hidden", question: "x".repeat(2000000) }] },
  };
  const actor: any = {
    approvals: new Map([["q", a]]),
    active: { id: "t" },
    stopping: false,
    approvalReviewAllowed: (id: string) => rendererApprovalAllowed([a], id),
  };
  assert.throws(
    () => Orchestrator.prototype.answer.call(actor, "q", { hidden: "yes" }),
    /too large to display/,
  );
  assert(actor.approvals.has("q"));
});

test("unrepresentable request IDs stay unapprovable and cannot inflate live state", () => {
  const s = state();
  s.approvals = [
    {
      id: "x".repeat(5000000),
      method: "test/requestApproval",
      params: { text: "Blue" },
    },
  ];
  assert.equal(rendererApprovalAllowed(s.approvals, s.approvals[0].id), false);
  assert.equal(JSON.parse(rendererWire(s)).approvals.length, 0);
});

test("long job lists keep atomic renderable records and exact action identities", () => {
  const s = state();
  s.jobs = Array.from({ length: 100 }, (_, i) => ({
    id: "job-" + i,
    goal: "x".repeat(7689),
    state: "completed",
    profile: "project",
    checkpoint: "c".repeat(10000),
    result: "r".repeat(10000),
  }));
  const p = rendererSnapshot(s);
  assert(p.jobs && p.jobs.length > 0);
  assert(p.jobs.length <= 30);
  for (const j of p.jobs) {
    assert.equal(typeof j, "object");
    assert.equal(typeof j.state.replaceAll("_", " "), "string");
    assert.equal(typeof j.goal.split("\n")[0], "string");
    assert.equal(j.state, "completed");
    assert.equal(j.profile, "project");
    assert.equal(s.jobs.find((old: any) => old.id === j.id)?.id, j.id);
  }
  assert(s.jobs.length === 100);
  assert(Buffer.byteLength(rendererWire(s)) < rendererWireLimit);
});

test("metadata projection preserves required siblings after large arrays", () => {
  const s = state();
  s.providers = {
    profiles: Array.from({ length: 100 }, (_, i) => ({
      kind: "provider-" + i,
      name: "Provider",
      capabilities: { tools: true, vision: false },
      description: "z".repeat(10000),
    })),
    selected: "provider-0",
    testing: false,
  };
  s.maintenance = {
    proposals: Array.from({ length: 100 }, (_, i) => ({
      id: "p" + i,
      goal: "g".repeat(10000),
      state: "reviewing",
      review: "r".repeat(10000),
      changes: [],
    })),
    pulls: [],
    githubConfigured: true,
    mode: "github",
  };
  const p: any = JSON.parse(rendererWire(s));
  assert.equal(p.providers.selected, "provider-0");
  assert.equal(p.providers.testing, false);
  for (const profile of p.providers.profiles)
    assert.deepEqual(profile.capabilities, { tools: true, vision: false });
  assert.equal(p.maintenance.githubConfigured, true);
  assert.equal(p.maintenance.mode, "github");
  assert(Array.isArray(p.maintenance.proposals));
  for (const proposal of p.maintenance.proposals)
    assert.equal(proposal.state, "reviewing");
});
