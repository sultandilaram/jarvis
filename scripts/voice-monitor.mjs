import { chromium } from "playwright-core";
import { readFile, writeFile } from "node:fs/promises";
const [port] = (
  await readFile(
    process.env.HOME + "/Library/Application Support/JARVIS/DevToolsActivePort",
    "utf8",
  )
)
  .trim()
  .split("\n");
const browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
const page = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url().endsWith("/Jarvis/dist/index.html"));
const baseline = await page.evaluate(() => window.jarvis.voiceDiagnostics());
const oldSessions = new Set(baseline.map((e) => e.sessionId));
if (await page.getByRole("dialog", { name: "Workspace settings" }).count())
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
const alreadyActive = await page
  .locator("button.mic")
  .evaluate((button) => button.classList.contains("enabled"));
if (!alreadyActive)
  await page.getByRole("button", { name: "Toggle voice", exact: true }).click();
const seen = new Set(baseline.map((e) => JSON.stringify(e)));
let sessionId = alreadyActive ? baseline.at(-1)?.sessionId : undefined,
  deadline = Date.now() + (alreadyActive ? 300000 : 45000);
while (Date.now() < deadline) {
  const events = await page.evaluate(() => window.jarvis.voiceDiagnostics());
  const fresh = events.filter((e) => !seen.has(JSON.stringify(e)));
  for (const e of fresh) {
    seen.add(JSON.stringify(e));
    console.log(JSON.stringify(e));
    if (!oldSessions.has(e.sessionId)) {
      sessionId = e.sessionId;
      if (e.kind === "session" && e.detail.startsWith("session.started"))
        deadline = Date.now() + 300000;
    }
  }
  await writeFile(
    ".jarvis/verification/voice-live-session.json",
    JSON.stringify(events, null, 2),
  );
  if (
    fresh.some(
      (e) =>
        e.sessionId === sessionId &&
        e.kind === "stop" &&
        e.detail.includes("Backend stop acknowledged"),
    )
  )
    break;
  if (fresh.some((e) => e.sessionId === sessionId && e.kind === "error")) break;
  await new Promise((r) => setTimeout(r, 1000));
}
await page.evaluate(() => window.jarvis.stop());
await new Promise((r) => setTimeout(r, 3000));
const result = await page.evaluate(async () => ({
  events: await window.jarvis.voiceDiagnostics(),
  snapshot: await window.jarvis.snapshot(),
}));
await writeFile(
  ".jarvis/verification/voice-workflow.json",
  JSON.stringify(result, null, 2),
);
console.log("Voice test closed; final diagnostics saved.");
process.exit(0);
