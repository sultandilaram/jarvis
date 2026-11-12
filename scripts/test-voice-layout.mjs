import { _electron as electron } from "playwright-core";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
process.env.JARVIS_VOICE_FIXTURE = "1";
await import("./prepare-ui-fixtures.mjs");
const directory = resolve(".jarvis/verification/voice-layout");
await mkdir(directory, { recursive: true });
const app = await electron.launch({
  args: [resolve(".jarvis/ui-test/desktop-main.cjs")],
});
const errors = [];
const geometry = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("tabpanel", { name: "Voice", exact: true }).waitFor();
  const size = async (w, h) =>
    app.evaluate(
      ({ BrowserWindow }, [w, h]) =>
        BrowserWindow.getAllWindows()[0].setSize(w, h),
      [w, h],
    );
  const measure = async (label) => {
    const metrics = await page.evaluate(() => {
      const b = (s) => {
        const r = document.querySelector(s)?.getBoundingClientRect();
        return r
          ? {
              left: r.left,
              right: r.right,
              top: r.top,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            }
          : null;
      };
      return {
        width: innerWidth,
        height: innerHeight,
        core: b(".core-control"),
        stage: b(".voice-stage"),
        workspace: b(".workspace"),
        stop: b(".global-stop"),
        call: b(".voice-call"),
        approve: b(".approve"),
        decline: b(".approval-buttons button"),
        overflow:
          document.documentElement.scrollWidth > innerWidth ||
          document.documentElement.scrollHeight > innerHeight,
      };
    });
    assert(!metrics.overflow, label + " document overflow");
    for (const key of ["core", "stop", "call", "approve", "decline"])
      if (metrics[key]) {
        assert(
          metrics[key].top >= 0 && metrics[key].bottom <= metrics.height,
          label + " " + key + " clipped",
        );
        assert(
          metrics[key].left >= 0 && metrics[key].right <= metrics.width,
          label + " " + key + " outside width",
        );
      }
    if (metrics.core)
      assert(
        metrics.core.top >= metrics.stage.top - 1 &&
          metrics.core.bottom <= metrics.stage.bottom + 1,
        label + " core escapes its available stage",
      );
    if (metrics.core)
      assert(
        Math.abs(
          (metrics.core.left + metrics.core.right) / 2 -
            (metrics.workspace.left + metrics.workspace.right) / 2,
        ) < 2,
        label + " core not centered",
      );
    geometry.push({ label, ...metrics });
    await page.screenshot({ path: resolve(directory, label + ".png") });
    return metrics;
  };
  await size(1440, 940);
  assert.equal(await page.locator(".conversation").count(), 0);
  assert.equal(await page.locator(".panel").count(), 0);
  const idle = await measure("voice-idle");
  assert(idle.core.width >= 400);
  await page.evaluate(() => window.__critiqueSeed("conversation"));
  const history = await measure("voice-with-history");
  assert.equal(history.core.width, idle.core.width);
  await page
    .getByRole("button", { name: "Talk to JARVIS", exact: true })
    .click();
  await page
    .getByRole("button", { name: "End conversation", exact: true })
    .waitFor();
  await page.evaluate(() => {
    const audio = document.createElement("audio");
    audio.id = "fixture-playback";
    document.getElementById("voice-playback").append(audio);
    window.__playbackRef = audio;
  });
  await page.getByRole("tab", { name: "Chats", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message JARVIS" })
    .fill("Keep this draft");
  await page.screenshot({ path: resolve(directory, "chats.png") });
  await page.getByRole("tab", { name: "Voice", exact: true }).click();
  assert(
    await page.evaluate(
      () =>
        document.getElementById("fixture-playback") === window.__playbackRef,
    ),
    "Tab switch removed audio playback",
  );
  assert.deepEqual(await page.evaluate(() => window.__voiceCounters), {
    connects: 1,
    disconnects: 0,
  });
  await page.evaluate(() => window.__voiceFixture("connecting", ""));
  await page
    .getByText("Connecting voice conversation…", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByText("Voice conversation connected", { exact: true })
      .count(),
    0,
  );
  await page.evaluate(() =>
    window.__voiceFixture("speaking", "A concise reply from JARVIS."),
  );
  await measure("voice-speaking");
  await page.getByRole("tab", { name: "Chats", exact: true }).click();
  assert.equal(
    await page.getByRole("textbox", { name: "Message JARVIS" }).inputValue(),
    "Keep this draft",
  );
  await page.getByRole("tab", { name: "Voice", exact: true }).click();
  await size(960, 650);
  await page.evaluate(() => window.__critiqueSeed("approval"));
  await page.getByText("New content", { exact: true }).waitFor();
  await measure("voice-approval-compact");
  await page.getByRole("tab", { name: "Chats", exact: true }).click();
  assert(
    await page
      .getByRole("button", { name: "Approve once", exact: true })
      .isVisible(),
  );
  await measure("chats-approval-compact");
  await page.getByRole("tab", { name: "Voice", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop all work", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Talk to JARVIS", exact: true })
    .waitFor();
  assert.equal(await page.locator(".approval-card").count(), 0);
  if (await page.getByRole("button", { name: "Close details" }).count())
    await page.getByRole("button", { name: "Close details" }).click();
  await page.evaluate(() => {
    window.__critiqueSeed("error");
    window.__voiceFixture("listening", "Long live caption. ".repeat(100));
  });
  const fault = await measure("voice-error-long-caption-compact");
  assert(fault.core.width >= 176, "Recovery copy crowds out the core");
  await page.getByText("Recovery steps", { exact: true }).click();
  await measure("voice-error-recovery-expanded");
  await page.evaluate(() => {
    window.__critiqueSeed("working");
    window.__voiceFixture("listening", "I am listening.");
  });
  await size(800, 650);
  await measure("voice-narrow");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await measure("voice-narrow-details");
  await page.getByRole("button", { name: "Close details" }).click();
  await page.getByRole("tab", { name: "Voice", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page
      .getByRole("tab", { name: "Chats", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.keyboard.press("ArrowLeft");
  assert.equal(
    await page
      .getByRole("tab", { name: "Voice", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.deepEqual(errors, []);
  const report = {
    passed: true,
    offlineVoiceOnly: true,
    defaultVoiceView: true,
    historyDoesNotShrinkCore: true,
    playbackAndSessionPreservedAcrossTabs: true,
    draftPreserved: true,
    approvalsVisibleAcrossViews: true,
    stopRemainsAvailable: true,
    keyboardTabs: true,
    geometry,
    errors,
  };
  await writeFile(
    resolve(directory, "result.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await app.close();
}
