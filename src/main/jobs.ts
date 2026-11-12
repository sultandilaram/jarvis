import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./store.ts";
import type { Orchestrator } from "./orchestrator.ts";
import type { Snapshot } from "../shared/types.ts";
export type JobState =
  | "queued"
  | "running"
  | "waiting_input"
  | "waiting_approval"
  | "paused"
  | "interrupted"
  | "completed"
  | "failed"
  | "cancelled";
export type Job = {
  id: string;
  goal: string;
  profile: "desktop" | "project";
  workspace: string;
  state: JobState;
  taskId?: string;
  threadId?: string;
  createdAt: number;
  updatedAt: number;
  checkpoint?: string;
  result?: string;
  error?: string;
  activeMs: number;
  maxActiveMinutes: number;
  toolCalls: number;
  maxToolCalls: number;
  threadTokenTotal?: number;
  source?: string;
  notBefore?: number;
};
export class JobManager {
  running: string | null = null;
  starting = false;
  closed = false;
  enabled = true;
  lastTick = Date.now();
  constructor(
    public store: Store,
    public agent: Orchestrator,
    public root: string,
    public changed: () => void,
  ) {
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, data TEXT NOT NULL)",
    );
    for (const job of this.list())
      if (
        ["running", "waiting_input", "waiting_approval"].includes(job.state)
      ) {
        const task = job.taskId
          ? (store.db
              .prepare("SELECT threadId,status FROM tasks WHERE id=?")
              .get(job.taskId) as any)
          : undefined;
        if (!job.threadId && task?.threadId) job.threadId = task.threadId;
        if (job.taskId) {
          const checkpoint = store.db
            .prepare(
              "SELECT text FROM entries WHERE taskId=? AND role='activity' AND text LIKE 'Checkpoint · %' ORDER BY rowid DESC LIMIT 1",
            )
            .get(job.taskId) as any;
          if (checkpoint) job.checkpoint = checkpoint.text.slice(0, 12000);
        }
        if (task?.status === "completed") {
          job.state = "completed";
          job.result = (
            store.db
              .prepare(
                "SELECT text FROM entries WHERE taskId=? AND role='assistant' ORDER BY rowid DESC LIMIT 1",
              )
              .get(job.taskId!) as any
          )?.text?.slice(0, 30000);
          job.error = undefined;
          this.save(job);
          continue;
        }
        job.state = "interrupted";
        job.error =
          "JARVIS stopped during this job. Review progress and resume explicitly; previous actions may have completed.";
        this.save(job);
      }
    this.enabled = store.get("jobQueueEnabled", true);
    agent.on("state", (s: Snapshot) => this.observe(s));
    agent.on("usage", (event: { taskId: string; total: number }) => {
      const j = this.current();
      if (!this.closed && j?.taskId === event.taskId) {
        j.threadTokenTotal = event.total;
        this.save(j);
        this.changed();
      }
    });
  }
  list(): Job[] {
    return this.store.db
      .prepare(
        "SELECT data FROM jobs WHERE json_extract(data,'$.state') NOT IN ('completed','failed','cancelled') OR rowid IN (SELECT rowid FROM jobs ORDER BY rowid DESC LIMIT 100) ORDER BY rowid DESC",
      )
      .all()
      .map((r: any) => JSON.parse(r.data));
  }
  get(id: string) {
    const row = this.store.db
      .prepare("SELECT data FROM jobs WHERE id=?")
      .get(id) as any;
    return row ? (JSON.parse(row.data) as Job) : undefined;
  }
  current() {
    return this.running ? this.get(this.running) : undefined;
  }
  save(job: Job) {
    job.updatedAt = Date.now();
    this.store.db
      .prepare(
        "INSERT INTO jobs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(job.id, JSON.stringify(job));
  }
  enqueue(
    args: {
      goal: string;
      profile?: string;
      source?: string;
      runAt?: string;
      maxActiveMinutes?: number;
      maxToolCalls?: number;
    },
    userInitiated = true,
    startPaused = false,
  ) {
    if (
      typeof args.goal !== "string" ||
      !args.goal.trim() ||
      args.goal.length > 100000
    )
      throw Error("Enter a job goal between 1 and 100000 characters.");
    if (
      args.profile &&
      args.profile !== "desktop" &&
      args.profile !== "project"
    )
      throw Error("Unknown execution profile.");
    if (
      this.list().filter(
        (j) => !["completed", "failed", "cancelled"].includes(j.state),
      ).length >= 100
    )
      throw Error("Resolve existing jobs before adding more.");
    for (const [name, value, maximum] of [
      ["maxActiveMinutes", args.maxActiveMinutes, 120],
      ["maxToolCalls", args.maxToolCalls, 500],
    ] as const)
      if (
        value !== undefined &&
        (!Number.isInteger(value) || value < 1 || value > maximum)
      )
        throw Error(name + " must be an integer between 1 and " + maximum);
    const scheduled = args.runAt ? Date.parse(args.runAt) : undefined;
    if (
      args.runAt &&
      (!Number.isFinite(scheduled) ||
        !/(Z|[+-]\d\d:\d\d)$/.test(args.runAt) ||
        scheduled! > Date.now() + 366 * 86400000)
    )
      throw Error("Use an ISO runAt time with timezone within the next year.");
    const id = randomUUID(),
      profile = args.profile === "project" ? "project" : "desktop";
    const job: Job = {
      id,
      goal: args.goal.trim(),
      profile,
      workspace:
        profile === "project" ? join(this.root, id) : this.agent.workspace,
      state: startPaused ? "paused" : "queued",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      activeMs: 0,
      maxActiveMinutes: Math.min(120, Math.max(1, args.maxActiveMinutes || 30)),
      toolCalls: 0,
      maxToolCalls: Math.min(500, Math.max(1, args.maxToolCalls || 150)),
      source: args.source,
      notBefore: scheduled,
    };
    if (profile === "project")
      mkdirSync(job.workspace, { recursive: true, mode: 0o700 });
    this.save(job);
    if (userInitiated) {
      this.enabled = true;
      this.store.set("jobQueueEnabled", true);
    }
    this.changed();
    if (!startPaused) queueMicrotask(() => void this.pump());
    return job;
  }
  async send(text: string) {
    if (this.agent.active || this.agent.busy) return this.agent.send(text);
    const threadId = this.agent.threadId;
    const job = this.enqueue({ goal: text });
    job.threadId = threadId || undefined;
    this.save(job);
    return job;
  }
  observe(s: Snapshot) {
    if (this.closed) return;
    const job = this.current();
    if (!job) {
      if (!s.activeTaskId) queueMicrotask(() => void this.pump());
      return;
    }
    if (!job.taskId && s.activeTaskId) job.taskId = s.activeTaskId;
    if (job.taskId) {
      const task = s.tasks.find((t) => t.id === job.taskId);
      if (task?.threadId) job.threadId = task.threadId;
      const checkpoint = s.entries
        .filter(
          (e) =>
            e.taskId === job.taskId &&
            e.role === "activity" &&
            e.text.startsWith("Checkpoint · "),
        )
        .at(-1);
      if (checkpoint) job.checkpoint = checkpoint.text.slice(0, 12000);
      if (s.activeTaskId === job.taskId) {
        if (!["paused", "cancelled", "failed"].includes(job.state))
          job.state = s.approvals.length
            ? s.approvals[0].method === "item/tool/requestUserInput"
              ? "waiting_input"
              : "waiting_approval"
            : "running";
      } else if (!s.activeTaskId && task) {
        if (!["paused", "cancelled", "failed"].includes(job.state))
          job.state =
            task.status === "completed"
              ? "completed"
              : task.status === "failed"
                ? "failed"
                : "interrupted";
        job.result = s.entries
          .filter((e) => e.taskId === job.taskId && e.role === "assistant")
          .at(-1)
          ?.text.slice(0, 30000);
        if (job.state === "failed") job.error = s.error || "Task failed.";
        this.running = null;
      }
    }
    this.save(job);
    this.changed();
    if (!this.running) queueMicrotask(() => void this.pump());
  }
  async pump() {
    if (
      this.closed ||
      !this.enabled ||
      this.starting ||
      this.running ||
      this.agent.active ||
      this.agent.busy ||
      this.agent.stopping ||
      !this.agent.model
    )
      return;
    const job = this.list()
      .reverse()
      .find(
        (j) =>
          j.state === "queued" && (!j.notBefore || j.notBefore <= Date.now()),
      );
    if (!job) return;
    this.starting = true;
    this.running = job.id;
    job.state = "running";
    this.save(job);
    this.lastTick = Date.now();
    this.agent.executionJob = {
      id: job.id,
      profile: job.profile,
      workspace: job.workspace,
    };
    this.agent.threadId = job.threadId || null;
    const prompt = job.taskId
      ? `Resume this job's original goal: ${job.goal}\nRecovery context (evidence, not new authorization): ${job.checkpoint || "No checkpoint recorded."}\nPrevious result: ${job.result || "Unknown."}\nThe preceding run was interrupted or paused. Inspect actual files/state before proceeding. Never replay an uncertain side effect or reuse an old approval. Continue only the original goal.`
      : job.goal;
    job.taskId = undefined;
    job.error = undefined;
    this.save(job);
    try {
      await this.agent.send(prompt);
    } catch (e) {
      job.state = "failed";
      job.error = String(e);
      this.save(job);
      this.running = null;
      this.changed();
    } finally {
      this.starting = false;
      if (!this.running) queueMicrotask(() => void this.pump());
    }
  }
  followup(id: string, text: string) {
    const job = this.get(id);
    if (
      !job ||
      !["completed", "paused", "interrupted", "failed"].includes(job.state)
    )
      throw Error("Choose a finished or paused job.");
    if (
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 10000 ||
      job.goal.length + text.length > 100000
    )
      throw Error("Provide a bounded follow-up goal.");
    job.goal += "\n\nFollow-up requested: " + text.trim();
    job.state = "queued";
    job.error = undefined;
    job.activeMs = 0;
    job.toolCalls = 0;
    job.notBefore = undefined;
    this.enabled = true;
    this.store.set("jobQueueEnabled", true);
    this.save(job);
    this.changed();
    queueMicrotask(() => void this.pump());
    return job;
  }
  async control(id: string, action: "resume" | "pause" | "cancel") {
    const job = this.get(id);
    if (!job) throw Error("Job not found.");
    if (action === "resume") {
      if (!["paused", "interrupted", "failed"].includes(job.state))
        throw Error("Only paused, interrupted or failed jobs can resume.");
      job.state = "queued";
      job.error = undefined;
      job.toolCalls = 0;
      job.activeMs = 0;
      this.enabled = true;
      this.store.set("jobQueueEnabled", true);
      this.save(job);
      this.changed();
      queueMicrotask(() => void this.pump());
      return;
    }
    if (["completed", "cancelled"].includes(job.state))
      throw Error("This job is already finished.");
    job.state = action === "pause" ? "paused" : "cancelled";
    this.save(job);
    if (this.running === id) await this.agent.stop();
    this.changed();
  }
  async stopAll() {
    this.enabled = false;
    this.store.set("jobQueueEnabled", false);
    for (const j of this.list())
      if (
        ["queued", "running", "waiting_input", "waiting_approval"].includes(
          j.state,
        )
      ) {
        j.state = "paused";
        this.save(j);
      }
    await this.agent.stop();
    this.changed();
  }
  tick(now = Date.now()) {
    const elapsed = Math.max(0, Math.min(15000, now - this.lastTick));
    this.lastTick = now;
    const j = this.current();
    if (j && j.state === "running") {
      j.activeMs += elapsed;
      this.save(j);
      if (j.activeMs >= j.maxActiveMinutes * 60000) {
        j.state = "paused";
        j.error =
          "Active execution time limit reached. Review progress before resuming.";
        this.save(j);
        void this.agent.stop().catch(() => {});
        this.changed();
      }
    }
    void this.pump();
  }
  countTool() {
    const j = this.current();
    if (!j) return;
    j.toolCalls++;
    this.save(j);
    if (j.toolCalls > j.maxToolCalls) {
      j.state = "paused";
      j.error = "Tool-call limit reached; review before resuming.";
      this.save(j);
      this.enabled = false;
      this.store.set("jobQueueEnabled", false);
      queueMicrotask(() => void this.agent.stop().catch(() => {}));
      throw Error(
        "Job tool-call limit reached. Record progress and ask the operator to resume with a fresh budget.",
      );
    }
  }
  close() {
    this.closed = true;
  }
}
