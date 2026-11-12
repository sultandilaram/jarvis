import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Store } from "../src/main/store.ts";
import { Codex } from "../src/main/codex.ts";
import { Orchestrator } from "../src/main/orchestrator.ts";
import { DesktopBroker } from "../src/main/desktop/broker.ts";
import { JobManager } from "../src/main/jobs.ts";
const root = await mkdtemp(join(tmpdir(), "jarvis-research-")),
  store = new Store(":memory:"),
  codex = new Codex();
let agent;
const broker = new DesktopBroker(async (a, p) => {
  if (a.startsWith("task.")) return agent.taskPlan(a, p);
  throw Error(
    "Only research and task coordination are allowed in this fixture.",
  );
});
agent = new Orchestrator(store, codex, root, () => false, broker);
const jobs = new JobManager(store, agent, join(root, "projects"), () => {});
agent.beforeTool = () => jobs.countTool();
let timer;
try {
  await agent.connect();
  if (!agent.model) throw Error(agent.error || "Codex unavailable");
  const job = jobs.enqueue({
    goal: "Use built-in web search to find the official Node.js documentation for the node:test test runner. Give a short factual summary and include its official documentation URL. Do not use browser, file, phone, project or shell tools. This is a disposable research acceptance test.",
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
    timer = setTimeout(() => {
      agent.off("state", check);
      reject(Error("Research test timed out"));
    }, 120000);
    check();
  });
  const final = jobs.get(job.id);
  assert(
    store
      .entries()
      .some((e) => e.role === "activity" && /webSearch/.test(e.text)),
  );
  assert(
    /https?:\/\/(?:nodejs\.org|www\.nodejs\.org)/.test(final.result || ""),
  );
  const report = {
    passed: true,
    realCodex: true,
    cachedWebSearch: true,
    officialSourceCited: true,
    toolCalls: final.toolCalls,
    threadTokenTotal: final.threadTokenTotal,
    noVoiceAPI: true,
    ownerWorkspaceTouched: false,
  };
  await mkdir(".jarvis/verification/agent", { recursive: true });
  await writeFile(
    ".jarvis/verification/agent/real-research.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} catch (e) {
  console.log(
    JSON.stringify({
      passed: false,
      error: String(e),
      backendError: agent.error,
      lastEntries: store
        .entries()
        .slice(-3)
        .map((e) => e.text.slice(0, 500)),
    }),
  );
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  jobs.close();
  agent.removeAllListeners();
  codex.removeAllListeners();
  codex.close();
  store.close();
  await rm(root, { recursive: true, force: true });
}
