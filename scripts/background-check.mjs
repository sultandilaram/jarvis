import { chromium } from "playwright-core";
import { readFile, writeFile } from "node:fs/promises";
const [port] = (
  await readFile(
    process.env.HOME + "/Library/Application Support/JARVIS/DevToolsActivePort",
    "utf8",
  )
).split("\n");
const browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
const page = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url().endsWith("/dist/index.html"));
const initial = await page.evaluate(async () => ({
  state: await window.jarvis.snapshot(),
  events: await window.jarvis.voiceDiagnostics(),
}));
const began = new Date().toISOString();
if (initial.state.background?.wake.state !== "listening")
  throw new Error("Local listener is not ready.");
if (!process.argv.includes("--wake-now"))
  await new Promise((r) => setTimeout(r, 35000));
const idle = await page.evaluate(async () => ({
  state: await window.jarvis.snapshot(),
  events: await window.jarvis.voiceDiagnostics(),
}));
const idleNewSessions = idle.events.filter(
  (e) =>
    e.createdAt > began &&
    e.kind === "session" &&
    e.detail.startsWith("Connecting"),
);
if (idleNewSessions.length)
  throw new Error("Standby unexpectedly started an API voice session.");
console.log(
  JSON.stringify({
    idleSeconds: process.argv.includes("--wake-now") ? 0 : 35,
    newApiVoiceSessions: 0,
    wake: idle.state.background.wake,
    login: idle.state.background.login,
  }),
);
await writeFile(
  ".jarvis/verification/standby-idle.json",
  JSON.stringify(
    {
      began,
      checkedAt: new Date().toISOString(),
      seconds: process.argv.includes("--wake-now") ? 0 : 35,
      newApiVoiceSessions: 0,
      background: idle.state.background,
    },
    null,
    2,
  ),
);
let woke = false,
  connected = false,
  returned = false;
const deadline = Date.now() + 300000;
const baselineWake = idle.state.background.wake.lastWakeAt;
let activeSession;
while (Date.now() < deadline) {
  const s = await page.evaluate(async () => ({
    state: await window.jarvis.snapshot(),
    events: await window.jarvis.voiceDiagnostics(),
  }));
  if (!woke && s.state.background.wake.lastWakeAt !== baselineWake) {
    woke = true;
    console.log("Native local wake phrase detected.");
  }
  const recent = s.events.filter((e) => e.createdAt > began);
  const start = recent.find(
    (e) => e.kind === "session" && e.detail.startsWith("session.started"),
  );
  if (start && !connected) {
    connected = true;
    activeSession = start.sessionId;
    console.log("GPT-Live connected after local wake.");
  }
  if (
    connected &&
    s.state.background.wake.state === "listening" &&
    recent.some(
      (e) =>
        e.sessionId === activeSession &&
        e.kind === "session" &&
        e.detail.includes("without speech"),
    )
  ) {
    returned = true;
    await writeFile(
      ".jarvis/verification/wake-workflow.json",
      JSON.stringify({ ...s, woke, connected, returned }, null, 2),
    );
    console.log(
      "API call closed on silence; native local wake listening resumed.",
    );
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
if (!woke || !connected || !returned) {
  throw new Error("Wake/voice/idle return not fully observed.");
}
const idleBegan = new Date().toISOString();
await new Promise((r) => setTimeout(r, 35000));
const final = await page.evaluate(async () => ({
  state: await window.jarvis.snapshot(),
  events: await window.jarvis.voiceDiagnostics(),
}));
const newSessions = final.events.filter(
  (e) =>
    e.createdAt > idleBegan &&
    e.kind === "session" &&
    e.detail.startsWith("Connecting"),
);
if (newSessions.length)
  throw new Error("An API session started during final standby.");
await writeFile(
  ".jarvis/verification/standby-idle.json",
  JSON.stringify(
    {
      seconds: 35,
      newApiVoiceSessions: 0,
      background: final.state.background,
      observedAfterWake: true,
    },
    null,
    2,
  ),
);
console.log("Final 35-second standby: zero new API voice sessions.");
process.exit(0);
