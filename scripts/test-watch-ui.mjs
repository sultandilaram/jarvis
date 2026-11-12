import "./prepare-ui-fixtures.mjs";
import { _electron as electron } from "playwright-core";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
await mkdir(".jarvis/verification/watches", { recursive: true });
const app = await electron.launch({
  args: [resolve(".jarvis/ui-test/desktop-main.cjs")],
});
try {
  const p = await app.firstWindow();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.getByRole("button", { name: "Settings", exact: true }).click();
  await p.getByText("No price watches configured.", { exact: true }).waitFor();
  assert(
    await p
      .getByRole("button", {
        name: "Enable task alerts and phone escalation",
        exact: true,
      })
      .isDisabled(),
  );
  await p.keyboard.press("Escape");
  await p.evaluate(() => window.__critiqueSeed("watch"));
  await p.getByRole("button", { name: "Updates", exact: true }).click();
  await p
    .getByText("Synthetic SOL price alert: threshold reached.", { exact: true })
    .waitFor();
  await p
    .getByRole("button", { name: "Acknowledge update", exact: true })
    .click();
  await p.getByText("Acknowledged", { exact: true }).waitFor();
  await p
    .getByRole("combobox", { name: "Phone for task updates", exact: true })
    .selectOption("p");
  await p
    .getByRole("button", {
      name: "Enable task alerts and phone escalation",
      exact: true,
    })
    .click();
  await p
    .getByRole("button", { name: "Disable task phone escalation", exact: true })
    .waitFor();
  await p
    .getByRole("button", { name: "Remove SOL watch", exact: true })
    .click();
  await p.getByText("No price watches configured.", { exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(960, 650),
  );
  assert(
    !(await p.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    )),
  );
  await p.screenshot({ path: ".jarvis/verification/watches/settings.png" });
  assert.deepEqual(errors, []);
  console.log(
    "Watches UI: empty state, acknowledgment, exact phone subscription, removal and compact layout passed. Offline fixtures only.",
  );
} finally {
  await app.close();
}
