import "./prepare-ui-fixtures.mjs";
import { _electron as electron } from "playwright-core";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
await mkdir(".jarvis/verification/ui-fixes", { recursive: true });
const desktop = await electron.launch({
  args: [resolve(".jarvis/ui-test/desktop-main.cjs")],
});
const mobile = await electron.launch({
  args: [resolve(".jarvis/ui-test/mobile-main.cjs")],
});
const errors = [];
try {
  const d = await desktop.firstWindow(),
    m = await mobile.firstWindow();
  for (const p of [d, m]) p.on("pageerror", (e) => errors.push(e.message));
  await d.getByRole("tabpanel", { name: "Voice", exact: true }).waitFor();
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 940),
  );
  await d.screenshot({
    path: ".jarvis/verification/ui-fixes/desktop-idle.png",
  });
  await d.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = d.getByRole("dialog", { name: "Workspace settings" });
  await dialog.waitFor();
  assert(
    await d.evaluate(() =>
      document.querySelector("dialog").contains(document.activeElement),
    ),
    "Focus must enter settings",
  );
  for (let i = 0; i < 22; i++) {
    await d.keyboard.press("Tab");
    assert(
      await d.evaluate(() =>
        document.querySelector("dialog").contains(document.activeElement),
      ),
      "Focus escaped modal",
    );
  }
  await d.screenshot({ path: ".jarvis/verification/ui-fixes/settings.png" });
  await d.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(
    await d.evaluate(() => document.activeElement.getAttribute("aria-label")),
    "Settings",
  );
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(960, 650),
  );
  await d.getByRole("tab", { name: "Chats", exact: true }).click();
  await d.evaluate(() => window.__critiqueSeed("approval"));
  await d.getByText("New content", { exact: true }).waitFor();
  assert.equal(
    await d.locator(".technical-preview").getAttribute("open"),
    null,
  );
  const geometry = await d.evaluate(() => {
    const b = (s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    };
    return {
      viewport: innerHeight,
      conversation: b(".conversation"),
      approve: b(".approve"),
      decline: b(".approval-buttons button"),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  assert(!geometry.overflow, "Desktop overflow");
  assert(geometry.conversation.height > 100, "Transcript remains cramped");
  assert(
    geometry.approve.bottom <= geometry.viewport,
    "Approve below viewport",
  );
  assert(
    geometry.decline.bottom <= geometry.viewport,
    "Decline below viewport",
  );
  await d.screenshot({
    path: ".jarvis/verification/ui-fixes/desktop-approval-compact.png",
  });
  await d.evaluate(() => window.__critiqueSeed("error"));
  if (
    (await d
      .getByRole("button", { name: "Activity", exact: true })
      .getAttribute("aria-expanded")) !== "true"
  )
    await d.getByRole("button", { name: "Activity", exact: true }).click();
  await d
    .getByRole("heading", { name: "Needs attention", exact: true })
    .waitFor();
  assert.equal(
    await d.locator(".transcript-heading").innerText(),
    "COMMUNICATIONS LOG\nNEEDS ATTENTION",
  );
  assert.equal(
    await d.getByRole("button", { name: "Dismiss error" }).count(),
    0,
  );
  assert(!(await d.getByText("All clear", { exact: true }).count()));
  await d.screenshot({
    path: ".jarvis/verification/ui-fixes/desktop-error.png",
  });
  await m.getByRole("tab", { name: "Voice", exact: true }).waitFor();
  await m.getByRole("button", { name: "Review action", exact: true }).waitFor();
  await m.screenshot({
    path: ".jarvis/verification/ui-fixes/mobile-review-notice.png",
  });
  await m.getByRole("button", { name: "Review action", exact: true }).click();
  await m.getByText("File path", { exact: true }).waitFor();
  await m.getByText("New content", { exact: true }).waitFor();
  await m.screenshot({
    path: ".jarvis/verification/ui-fixes/mobile-approval.png",
  });
  await mobile.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(320, 672),
  );
  const small = await m.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  assert(!small.overflow, "Narrow phone overflow");
  await m
    .getByRole("button", { name: "Approve once", exact: true })
    .scrollIntoViewIfNeeded();
  const controls = await m.evaluate(() => {
    const a = document
        .querySelector(".approval-buttons")
        .getBoundingClientRect(),
      s = document.querySelector(".stop").getBoundingClientRect();
    return {
      approvalTop: a.top,
      approvalBottom: a.bottom,
      stopBottom: s.bottom,
    };
  });
  assert(
    controls.approvalTop >= controls.stopBottom,
    "Stop overlaps phone approval controls",
  );
  await m.screenshot({ path: ".jarvis/verification/ui-fixes/mobile-320.png" });
  await m.getByRole("tab", { name: "Settings", exact: true }).click();
  assert(
    await m
      .getByRole("button", { name: "Enable alerts on this phone" })
      .isDisabled(),
  );
  assert(
    await m
      .getByRole("button", { name: "Disable alerts", exact: true })
      .isDisabled(),
  );
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    modalFocusEntryContainmentRestore: true,
    persistentPhoneReview: true,
    structuredExactPreviews: true,
    errorConsistency: true,
    geometry,
    small,
    controls,
    errors,
  };
  await writeFile(
    ".jarvis/verification/ui-fixes/result.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await desktop.close();
  await mobile.close();
}
