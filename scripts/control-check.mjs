import { _electron as electron } from "playwright-core";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
await mkdir(".jarvis/verification", { recursive: true });
const instance = await electron.launch({
  args: [".", "--windowed"],
  cwd: process.cwd(),
  env: {
    ...process.env,
    JARVIS_DATA_DIR: resolve(".jarvis/verification/control-" + process.pid),
  },
  timeout: 30000,
});
try {
  const page = await instance.firstWindow();
  await page.getByRole("tabpanel", { name: "Voice", exact: true }).waitFor();
  await page.getByRole("tab", { name: "Chats", exact: true }).click();
  const snapshot = () => page.evaluate(() => window.jarvis.snapshot());
  const wait = async (check, seconds = 60) => {
    for (let i = 0; i < seconds; i++) {
      const s = await snapshot();
      if (check(s)) return s;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Condition timed out.");
  };
  await wait((s) => s.status !== "connecting");
  const path = resolve(
    "/private/tmp/jarvis-picker-fixture-" + process.pid + ".txt",
  );
  await writeFile(path, "JARVIS picker fixture\n");
  const bytes = await readFile(path);
  const hash = createHash("sha256").update(bytes).digest("hex");
  // Stub only the OS picker response; exercise the real IPC and bounded file-read path.
  await instance.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, path);
  await page
    .getByRole("button", { name: "Read a selected file", exact: true })
    .click();
  const read = await wait((s) =>
    s.tasks.some((t) => t.title === `Read ${path}`),
  );
  if (
    !read.entries.some(
      (e) => e.text.includes(hash) && e.text.includes(`${bytes.length} bytes`),
    )
  )
    throw new Error("File verification evidence missing.");
  console.log(
    "Real selected-file handler verified against independently computed SHA-256. OS picker response was stubbed.",
  );
  await page.screenshot({ path: ".jarvis/verification/file-read.png" });
  await page.evaluate(() =>
    window.jarvis.send(
      "For an interruption test, ask jarvis.desktop to open TextEdit (com.apple.TextEdit) and wait for its launch approval. Do not change files or invoke other actions.",
    ),
  );
  let s = await wait(
    (s) =>
      s.activeTaskId && s.tasks.find((t) => t.id === s.activeTaskId)?.turnId,
  );
  const taskId = s.activeTaskId;
  await page.evaluate(() =>
    window.jarvis.send(
      "Correction: after this action, include CONTROL_MARKER in your reply.",
    ),
  );
  s = await wait((s) => s.approvals.length);
  const approval = s.approvals[0];
  if (
    approval.method !== "jarvis/desktop/requestApproval" ||
    approval.params.action !== "apps.open" ||
    approval.params.preview.bundleId !== "com.apple.TextEdit"
  )
    throw new Error("Unexpected desktop preview");
  // Cancel while pending: this test never launches TextEdit or approves an action.
  await page
    .getByRole("button", { name: "Stop all work", exact: true })
    .click();
  s = await wait((s) => !s.activeTaskId && s.status !== "stopping", 30);
  const task = s.tasks.find((t) => t.id === taskId);
  if (task?.status !== "interrupted")
    throw new Error(
      "Expected interrupted task, got " + task?.status + " " + s.error,
    );
  if (
    !s.entries.some(
      (e) =>
        e.role === "user" &&
        e.taskId === taskId &&
        e.text.includes("CONTROL_MARKER"),
    )
  )
    throw new Error("Live steering message not recorded.");
  console.log(
    "Real active-turn steering and visible Stop button verified; final status interrupted.",
  );
  await writeFile(
    ".jarvis/verification/controls.json",
    JSON.stringify(s, null, 2),
  );
  await page.screenshot({ path: ".jarvis/verification/stopped.png" });
  await page.getByRole("button", { name: "Toggle voice", exact: true }).click();
  await page.getByRole("dialog", { name: "Workspace settings" }).waitFor();
  await page.screenshot({ path: ".jarvis/verification/voice-setup.png" });
  console.log(
    "Missing-credential voice setup remains accessible without blocking text.",
  );
} finally {
  await instance.close();
}
