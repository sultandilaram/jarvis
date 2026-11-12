import { _electron as electron } from "playwright-core";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
await mkdir(".jarvis/verification", { recursive: true });
const fixture = await mkdtemp("/private/tmp/jarvis-smoke-fixture-");
await mkdir(resolve(fixture, "Workspace"), { recursive: true });
await writeFile(
  resolve(fixture, "Workspace", "fixture.txt"),
  "JARVIS synthetic test fixture\n",
);
const electronApp = await electron.launch({
  args: [".", "--windowed"],
  cwd: process.cwd(),
  env: {
    ...process.env,
    JARVIS_WORKSPACE: fixture,
    JARVIS_DATA_DIR: resolve(".jarvis/verification/state-" + process.pid),
  },
  timeout: 30000,
});
electronApp.on("console", (m) => {
  if (m.type() === "error") console.log("MAIN:", m.text());
});
let result;
try {
  const page = await electronApp.firstWindow();
  page.on("pageerror", (e) => console.log("RENDERER:", e.message));
  await page.getByRole("tabpanel", { name: "Voice", exact: true }).waitFor();
  await page.getByRole("tab", { name: "Chats", exact: true }).click();
  await page.screenshot({ path: ".jarvis/verification/welcome.png" });
  console.log("Window rendered; screenshot saved.");
  for (let i = 0; i < 60; i++) {
    const s = await page.evaluate(() => window.jarvis.snapshot());
    if (s.status !== "connecting") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const initial = await page.evaluate(() => window.jarvis.snapshot());
  console.log(
    JSON.stringify({
      status: initial.status,
      model: initial.model,
      error: initial.error,
    }),
  );
  if (initial.status === "error") throw new Error(initial.error);
  await page
    .getByRole("textbox", { name: "Message JARVIS" })
    .fill(
      "Use jarvis.desktop to list granted file roots, then read fixture.txt inside the granted Workspace folder. Report its exact text. This is a generated integration-test fixture. Do not modify files or open apps.",
    );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  for (let i = 0; i < 120; i++) {
    const s = await page.evaluate(() => window.jarvis.snapshot());
    if (s.approvals.length)
      throw new Error("Unexpected approval for fixture reading.");
    if (s.tasks.some((t) => ["completed", "failed"].includes(t.status))) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  result = await page.evaluate(() => window.jarvis.snapshot());
  console.log(
    JSON.stringify(
      {
        tasks: result.tasks,
        approvals: result.approvals,
        entries: result.entries,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: ".jarvis/verification/task.png" });
  await writeFile(
    ".jarvis/verification/result.json",
    JSON.stringify(result, null, 2),
  );
  if (
    !result.entries.some(
      (e) =>
        e.role === "assistant" &&
        e.text.includes("JARVIS synthetic test fixture"),
    )
  )
    throw new Error("Fixture text not verified by the task model.");
  if (result.approvals.length)
    throw new Error(
      "Real task needs approval; inspect details before authorizing.",
    );
  if (result.tasks[0]?.status !== "completed")
    throw new Error(result.error || "Task did not complete.");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("dialog", { name: "Workspace settings" }).waitFor();
  await page.screenshot({ path: ".jarvis/verification/settings.png" });
  await page.getByRole("button", { name: "Close settings" }).click();
} finally {
  await electronApp.close();
}
const restarted = await electron.launch({
  args: [".", "--windowed"],
  cwd: process.cwd(),
  env: {
    ...process.env,
    JARVIS_WORKSPACE: fixture,
    JARVIS_DATA_DIR: resolve(".jarvis/verification/state-" + process.pid),
  },
  timeout: 30000,
});
try {
  const next = await restarted.firstWindow();
  await next.getByRole("tabpanel", { name: "Voice", exact: true }).waitFor();
  const persisted = await next.evaluate(() => window.jarvis.snapshot());
  if (
    !persisted.tasks.some(
      (t) => t.id === result.tasks[0].id && t.status === "completed",
    )
  )
    throw new Error("History did not survive restart.");
  console.log("Verified task history after application restart.");
} finally {
  await restarted.close();
}
