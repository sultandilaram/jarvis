import { _electron as electron } from "playwright-core";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const data = resolve(".jarvis/verification/quit-" + process.pid);
await mkdir(data, { recursive: true });
await writeFile(
  resolve(data, "openai-key.enc"),
  "synthetic unavailable credential fixture",
  { mode: 0o600 },
);
const instance = await electron.launch({
  ...(process.env.JARVIS_TEST_EXECUTABLE
    ? { executablePath: process.env.JARVIS_TEST_EXECUTABLE }
    : {}),
  args: process.env.JARVIS_TEST_EXECUTABLE
    ? ["--windowed"]
    : [".", "--windowed"],
  env: { ...process.env, JARVIS_DATA_DIR: data },
  timeout: 30000,
});
let exited = false;
try {
  const page = await instance.firstWindow();
  await page.getByRole("tabpanel", { name: "Voice", exact: true }).waitFor();
  await page.waitForFunction(
    async () => {
      const s = await window.jarvis.snapshot();
      return s.status !== "connecting";
    },
    { timeout: 20000 },
  );
  const ready = await page.evaluate(() => window.jarvis.snapshot());
  assert(
    ready.hasApiKey,
    "Saved credential presence should be reported without unlocking it",
  );
  const errors = [];
  instance.process().stderr.on("data", (b) => errors.push(String(b)));
  const closed = new Promise((r) =>
    instance.process().once("exit", (code) => {
      exited = true;
      r(code);
    }),
  );
  await page.evaluate(() => window.jarvis.quit());
  let timer;
  const code = await Promise.race([
    closed,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(Error("Quit did not finish within 5 seconds")),
        5000,
      );
    }),
  ]);
  clearTimeout(timer);
  assert.equal(code, 0);
  assert(!errors.join("").includes("database is not open"));
  console.log(
    JSON.stringify({
      startupWithSavedKeyDoesNotBlock: true,
      quitExitedCleanly: true,
      closedDatabaseError: false,
    }),
  );
} finally {
  if (!exited) await instance.close();
}
