// Explicit isolated development acceptance test. Uses Codex sign-in; no voice API, phone, or owner workspace.
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { Store } from "../src/main/store.ts";
import { Codex } from "../src/main/codex.ts";
import { Orchestrator } from "../src/main/orchestrator.ts";
import { DesktopBroker } from "../src/main/desktop/broker.ts";
import { JobManager } from "../src/main/jobs.ts";
import { ProjectService } from "../src/main/project.ts";
const root = await mkdtemp(join(tmpdir(), "jarvis-real-project-"));
const store = new Store(join(root, "fixture.sqlite"));
const codex = new Codex();
let agent, jobs;
const projects = new ProjectService(() => jobs?.current());
const broker = new DesktopBroker(async (action, args) => {
  if (action.startsWith("task.")) return agent.taskPlan(action, args);
  if (action.startsWith("project.")) return projects.plan(action, args);
  throw Error("Only isolated project/task tools are enabled in this test.");
});
agent = new Orchestrator(store, codex, root, () => false, broker);
jobs = new JobManager(store, agent, join(root, "projects"), () => {});
agent.beforeTool = () => jobs.countTool();
let questions = 0,
  approvals = 0;
const executionResults = [];
const answered = new Set();
broker.on("activity", (event) => {
  if (event.phase === "result" && event.action === "project.exec")
    executionResults.push(event.result);
});
broker.on("approval", (a) => {
  const command = a.params.preview?.command;
  const allowed =
    a.params.action === "project.exec" &&
    JSON.stringify(command) ===
      JSON.stringify(["node", "--test", "calculator.test.cjs"]);
  if (allowed) approvals++;
  broker.decide(a.id, allowed);
});
agent.on("state", (s) => {
  for (const a of s.approvals) {
    if (a.method !== "item/tool/requestUserInput" || answered.has(a.id))
      continue;
    const q = a.params.questions?.[0];
    if (q && /multiplier|factor/i.test(q.question)) {
      answered.add(a.id);
      questions++;
      agent.answer(a.id, { [q.id]: "7" });
    }
  }
});
let timeout;
try {
  await agent.connect();
  if (!agent.model) throw Error(agent.error || "Codex unavailable");
  const job = jobs.enqueue({
    profile: "project",
    goal: 'Build a tiny Node CommonJS calculator in this isolated project. First use task.ask to ask me which fixed multiplier to use and wait for the answer. Create calculator.cjs exporting n => n * the answered multiplier, and calculator.test.cjs using node:test and node:assert/strict to verify 3 maps to 21 and 0 maps to 0. Use project.write for files, task.checkpoint to record progress, and run exactly command ["node","--test","calculator.test.cjs"] using project.exec. Inspect the test result and report it. Do not use any other command or tool namespace. This is a disposable acceptance fixture.',
  });
  await new Promise((done, reject) => {
    const check = () => {
      const j = jobs.get(job.id);
      if (["completed", "failed", "interrupted"].includes(j?.state)) {
        agent.off("state", check);
        j.state === "completed" ? done() : reject(Error(j.error || j.state));
      }
    };
    agent.on("state", check);
    timeout = setTimeout(() => {
      agent.off("state", check);
      reject(Error("Real project acceptance timed out"));
    }, 200000);
    check();
  });
  const final = jobs.get(job.id);
  assert(questions > 0);
  assert(approvals > 0);
  assert(executionResults.some((r) => r.exitCode === 0 && r.verified));
  const source = await readFile(
    join(final.workspace, "calculator.cjs"),
    "utf8",
  );
  assert(source.includes("7"));
  assert(final.checkpoint);
  assert(final.result);
  const report = {
    passed: true,
    realCodex: true,
    informationRequestsAnswered: questions,
    exactTestCommandsApproved: approvals,
    state: final.state,
    checkpointRecorded: !!final.checkpoint,
    resultReported: !!final.result,
    model: agent.model,
    noVoiceAPI: true,
    ownerWorkspaceTouched: false,
    verifiedTestExitCode: executionResults.at(-1)?.exitCode,
  };
  await mkdir(".jarvis/verification/agent", { recursive: true });
  await writeFile(
    ".jarvis/verification/agent/real-project.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} catch (e) {
  console.log(
    JSON.stringify({
      passed: false,
      error: String(e),
      status: agent.status,
      backendError: agent.error,
      activity: store
        .entries()
        .filter((e) => e.role === "activity")
        .slice(-5)
        .map((e) => e.text.slice(0, 800)),
    }),
  );
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  jobs.close();
  agent.removeAllListeners();
  codex.removeAllListeners();
  codex.close();
  store.close();
  await rm(root, { recursive: true, force: true });
}
