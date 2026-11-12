import { _electron as electron, chromium } from "playwright-core";
import { readFile, writeFile } from "node:fs/promises";
const path =
  process.env.HOME + "/Library/Application Support/JARVIS/DevToolsActivePort";
try {
  const [port] = (await readFile(path, "utf8")).trim().split("\n");
  const browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
  const old = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().endsWith("/Jarvis/dist/index.html"));
  if (old) {
    const state = await old.evaluate(() => window.jarvis.snapshot());
    if (state.activeTaskId)
      throw new Error("An active task must be stopped before restarting.");
    await old.close();
  }
} catch (e) {
  if (e.message.includes("active task")) throw e;
}
const app = await electron.launch({
  args: ["."],
  cwd: process.cwd(),
  env: { ...process.env },
  timeout: 30000,
});
const page = await app.firstWindow();
await page.getByRole("tabpanel", { name: "Voice", exact: true }).waitFor();
for (let i = 0; i < 45; i++) {
  const s = await page.evaluate(() => window.jarvis.snapshot());
  if (s.status === "ready") break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log("Updated JARVIS ready. Requesting real microphone access.");
await page.getByRole("button", { name: "Talk to JARVIS", exact: true }).click();
let seen = new Set();
const deadline = Date.now() + 180000;
while (Date.now() < deadline) {
  const events = await page.evaluate(() => window.jarvis.voiceDiagnostics());
  const fresh = events.filter((e) => !seen.has(JSON.stringify(e)));
  for (const e of fresh) {
    seen.add(JSON.stringify(e));
    console.log(JSON.stringify(e));
  }
  await writeFile(
    ".jarvis/verification/voice-live-session.json",
    JSON.stringify(events, null, 2),
  );
  if (
    events.some(
      (e) =>
        e.kind === "stop" && e.detail.includes("Backend stop acknowledged"),
    )
  )
    break;
  if (events.some((e) => e.kind === "error")) {
    console.log("Voice reported an error; inspect diagnostics.");
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
await page.evaluate(() => window.jarvis.stop());
await new Promise((r) => setTimeout(r, 3000));
const final = await page.evaluate(() => window.jarvis.voiceDiagnostics());
await writeFile(
  ".jarvis/verification/voice-live-session.json",
  JSON.stringify(final, null, 2),
);
console.log("Test call ended; JARVIS remains open.");
await app.waitForEvent("close", { timeout: 0 });
