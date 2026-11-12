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
  .find((p) => p.url().endsWith("/Jarvis/dist/index.html"));
const baseline = await page.evaluate(() => window.jarvis.voiceDiagnostics());
const old = new Set(baseline.map((e) => e.sessionId));
if (
  !(await page
    .locator("button.mic")
    .evaluate((b) => b.classList.contains("enabled")))
)
  await page.getByRole("button", { name: "Toggle voice", exact: true }).click();
let sessionId;
try {
  for (let i = 0; i < 20; i++) {
    const events = await page.evaluate(() => window.jarvis.voiceDiagnostics());
    const start = events.find(
      (e) =>
        !old.has(e.sessionId) &&
        e.kind === "session" &&
        e.detail.startsWith("session.started"),
    );
    if (start) {
      sessionId = start.sessionId;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!sessionId) throw new Error("No ready voice session.");
  await new Promise((r) => setTimeout(r, 3000));
  await page.evaluate(() =>
    window.jarvis.send(
      "Using only the package.json you already verified in this conversation, report the package name in one sentence. Do not run any commands or modify files.",
    ),
  );
  for (let i = 0; i < 40; i++) {
    const s = await page.evaluate(() => window.jarvis.snapshot());
    if (!s.activeTaskId) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 7000));
  const data = await page.evaluate(async () => ({
    state: await window.jarvis.snapshot(),
    events: await window.jarvis.voiceDiagnostics(),
  }));
  const events = data.events.filter((e) => e.sessionId === sessionId);
  const speech = events
    .filter((e) => e.kind === "output")
    .map((e) => e.detail)
    .join("");
  console.log(
    JSON.stringify({
      status: data.state.status,
      lastTask: data.state.tasks[0],
      speech,
    }),
  );
  if (data.state.approvals.length) throw new Error("Unexpected approval.");
  if (!/jarvis[\s-]?desktop/i.test(speech))
    throw new Error(
      "Verified result was not found in the spoken output transcript.",
    );
  await writeFile(
    ".jarvis/verification/voice-result.json",
    JSON.stringify({ ...data, sessionId, spokenResult: speech }, null, 2),
  );
} finally {
  await page.evaluate(() => window.jarvis.stop());
  await new Promise((r) => setTimeout(r, 3000));
  const events = await page.evaluate(() => window.jarvis.voiceDiagnostics());
  await writeFile(
    ".jarvis/verification/voice-result-final-events.json",
    JSON.stringify(events, null, 2),
  );
}
process.exit(0);
