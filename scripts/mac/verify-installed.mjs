import { chromium } from "playwright-core";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
// LaunchServices is essential: a directly spawned test app inherits the test
// runner's TCC responsibility and cannot prove JARVIS's own privacy consent.
const app = "/Applications/JARVIS.app";
if (process.argv.includes("--launch"))
  execFileSync("/usr/bin/open", [
    "-a",
    app,
    "--args",
    "--remote-debugging-port=0",
    "--windowed",
  ]);
const data = join(process.env.HOME, "Library/Application Support/JARVIS");
let browser;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const [port] = (
      await readFile(join(data, "DevToolsActivePort"), "utf8")
    ).split("\n");
    browser = await chromium.connectOverCDP("http://127.0.0.1:" + port, {
      timeout: 1000,
    });
    break;
  } catch (e) {
    if (attempt === 29) throw e;
    await new Promise((r) => setTimeout(r, 250));
  }
}
try {
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().endsWith("/dist/index.html"));
  if (!page) throw Error("Installed JARVIS renderer not found");
  const deadline = Date.now() + 30000;
  let s;
  while (Date.now() < deadline) {
    s = await page.evaluate(() => window.jarvis.snapshot());
    if (
      s.status === "ready" &&
      s.model &&
      (!s.settings.wakeWordEnabled || s.background?.wake.state === "listening")
    )
      break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (
    s?.status !== "ready" ||
    !s.model ||
    (s.settings.wakeWordEnabled && s.background?.wake.state !== "listening")
  )
    throw Error("Installed app did not reach ready/local-listening state");
  if (process.argv.includes("--restore-login"))
    await page.evaluate(() => window.jarvis.settings({ startAtLogin: true }));
  s = await page.evaluate(() => window.jarvis.snapshot());
  const version = execFileSync(
    "/usr/bin/plutil",
    [
      "-extract",
      "CFBundleShortVersionString",
      "raw",
      "-o",
      "-",
      join(app, "Contents/Info.plist"),
    ],
    { encoding: "utf8" },
  ).trim();
  const report = {
    version,
    application: app,
    launchedThroughMacOS: true,
    status: s.status,
    accessibility: s.desktop?.accessibility,
    wake: s.background?.wake.state,
    login: s.background?.login,
    hasSavedKey: s.hasApiKey,
    activeTask: !!s.activeTaskId,
    checkedAt: new Date().toISOString(),
  };
  if (process.argv.includes("--check-key")) {
    await page.evaluate(() => window.jarvis.checkVoice());
    report.keyUnlockAndModelsRequestSucceeded = true;
  }
  const dir = resolve(".jarvis/verification/local-install");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, version + ".json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes("--quit")) {
    if (s.activeTaskId || s.remote?.voiceActive)
      throw Error("Cannot quit during active work or call");
    await page.evaluate(() => window.jarvis.quit());
  }
} finally {
  await browser.close();
}
