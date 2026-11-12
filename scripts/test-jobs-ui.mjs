import "./prepare-ui-fixtures.mjs";
import { _electron as electron } from "playwright-core";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
await mkdir(".jarvis/verification/agent", { recursive: true });
const desktop = await electron.launch({
  args: [resolve(".jarvis/ui-test/desktop-main.cjs")],
});
const mobile = await electron.launch({
  args: [resolve(".jarvis/ui-test/mobile-main.cjs")],
});
try {
  const d = await desktop.firstWindow(),
    m = await mobile.firstWindow();
  const errors = [];
  d.on("pageerror", (e) => errors.push(e.message));
  m.on("pageerror", (e) => errors.push(e.message));
  await d.getByRole("button", { name: "Jobs", exact: true }).waitFor();
  await d.evaluate(() => window.__critiqueSeed("jobs"));
  await d.getByRole("button", { name: "Jobs", exact: true }).click();
  await d.getByRole("button", { name: "Resume safely", exact: true }).click();
  assert.equal(await d.evaluate(() => window.__jobControl), undefined);
  await d.getByRole("button", { name: "Resume this job", exact: true }).click();
  assert.deepEqual(await d.evaluate(() => window.__jobControl), {
    id: "j1",
    action: "resume",
  });
  await d.getByText("New job", { exact: true }).click();
  await d
    .getByRole("textbox", { name: "Goal", exact: true })
    .fill("Build a small report tool");
  await d
    .getByRole("combobox", { name: "Execution profile", exact: true })
    .selectOption("project");
  await d.getByRole("button", { name: "Queue job", exact: true }).click();
  await d
    .getByRole("heading", { name: "Build a small report tool", exact: true })
    .waitFor();
  assert.equal(
    (await d.evaluate(() => window.__jobRecords))[0].profile,
    "project",
  );
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(960, 650),
  );
  assert(
    !(await d.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    )),
  );
  await d.screenshot({ path: ".jarvis/verification/agent/desktop-jobs.png" });
  await d.getByRole("button", { name: "Settings", exact: true }).click();
  await d.getByRole("button", { name: "Pause monitor", exact: true }).click();
  assert.equal(
    await d.getByRole("button", { name: "Pause monitor", exact: true }).count(),
    0,
  );
  await d.getByRole("button", { name: "Remove monitor", exact: true }).click();
  await d
    .getByText("No source monitors configured.", { exact: true })
    .waitFor();
  await mobile.evaluate(() => {
    globalThis.fixtureState.approvals = [];
    return globalThis.fixtureGateway.push({ type: "state" });
  });
  await m.getByRole("tab", { name: "Tasks", exact: true }).click();
  await m.getByText("New job", { exact: true }).click();
  await m
    .getByRole("textbox", { name: "Goal", exact: true })
    .fill("Prepare the weekly report");
  await m.getByRole("button", { name: "Queue job", exact: true }).click();
  await m
    .getByRole("heading", { name: "Prepare the weekly report", exact: true })
    .waitFor();
  await mobile.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(320, 672),
  );
  assert(
    !(await m.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    )),
  );
  await m.screenshot({ path: ".jarvis/verification/agent/mobile-jobs.png" });
  await m.getByRole("button", { name: "Pause job", exact: true }).click();
  await m.getByRole("button", { name: "Resume safely", exact: true }).click();
  await m.getByRole("button", { name: "Resume this job", exact: true }).click();
  const records = await mobile.evaluate(() => globalThis.fixtureRecords);
  assert(records.some((r) => r.method === "job.enqueue"));
  assert(
    records.some(
      (r) => r.method === "job.control" && r.params.action === "resume",
    ),
  );
  assert(!records.some((r) => r.method === "approve"));
  assert.deepEqual(errors, []);
  console.log(
    "Jobs UI passed: explicit resume review, profile/goal queueing, monitor pause/remove, compact desktop/phone, encrypted mobile controls; no action approval side effects.",
  );
} finally {
  await desktop.close();
  await mobile.close();
}
