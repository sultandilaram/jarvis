import "./prepare-ui-fixtures.mjs";
import { _electron as electron } from "playwright-core";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
await mkdir(".jarvis/verification/information", { recursive: true });
const desktop = await electron.launch({
  args: [resolve(".jarvis/ui-test/desktop-main.cjs")],
});
const mobile = await electron.launch({
  args: [resolve(".jarvis/ui-test/mobile-main.cjs")],
});
try {
  const d = await desktop.firstWindow(),
    m = await mobile.firstWindow();
  await d.getByRole("tabpanel", { name: "Voice", exact: true }).waitFor();
  await d.evaluate(() => window.__critiqueSeed("question"));
  await d.getByText("A detail is needed", { exact: true }).waitFor();
  const send = d.getByRole("button", { name: "Send answer", exact: true });
  await send.waitFor();
  assert(await send.isDisabled());
  await d
    .getByRole("textbox", { name: "Which folder should I use?", exact: true })
    .fill("Client reports");
  await send.click();
  assert.deepEqual(await d.evaluate(() => window.__answerRecords), {
    id: "question1",
    answers: { folder: "Client reports" },
  });
  await mobile.evaluate(() => {
    const s = globalThis.fixtureState;
    s.status = "approval";
    s.activeTaskId = "task1";
    s.approvals = [
      {
        id: "question1",
        method: "item/tool/requestUserInput",
        params: {
          questions: [{ id: "folder", question: "Which folder should I use?" }],
        },
      },
    ];
    return globalThis.fixtureGateway.push({ type: "state" });
  });
  await m.getByRole("button", { name: "Answer question", exact: true }).click();
  await m
    .getByRole("textbox", { name: "Which folder should I use?", exact: true })
    .fill("Client reports");
  await m.screenshot({
    path: ".jarvis/verification/information/mobile-question.png",
  });
  await m.getByRole("button", { name: "Send answer", exact: true }).click();
  await m
    .getByRole("button", { name: "Send answer", exact: true })
    .waitFor({ state: "detached" });
  const records = await mobile.evaluate(() => globalThis.fixtureRecords);
  assert(
    records.some(
      (r) =>
        r.method === "answer" && r.params.answers.folder === "Client reports",
    ),
  );
  assert(!records.some((r) => r.method === "approve" || r.method === "send"));
  console.log(
    "Desktop and encrypted mobile question flow passed: real question, exact answer RPC, no approval or new-task dispatch. Offline fixtures only.",
  );
} finally {
  await desktop.close();
  await mobile.close();
}
