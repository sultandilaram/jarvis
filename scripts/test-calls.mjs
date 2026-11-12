import assert from "node:assert/strict";
import { resolve } from "node:path";
import { _electron as electron } from "playwright-core";
process.env.JARVIS_CALL_FIXTURE = "1";
await import("./prepare-ui-fixtures.mjs");
const app = await electron.launch({
  args: [resolve(".jarvis/ui-test/mobile-main.cjs")],
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("button", { name: "Talk to JARVIS", exact: true })
    .click();
  await page.getByRole("button", { name: "End voice", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("dialog").count(),
    0,
    "Outgoing voice must stay on the HUD",
  );
  assert(await page.locator(".voice-core.listening").count());
  await page.getByRole("button", { name: "Mute", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__voice.muted), true);
  await page.evaluate(() =>
    window.__voice.update("speaking", "Of course, sir."),
  );
  assert.equal(
    await page
      .locator(".voice-core.speaking .ring-inner")
      .evaluate((e) => getComputedStyle(e).animationName),
    "core-orbit",
  );
  await page
    .getByRole("button", { name: "Review action", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Approve once", exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.__voice.closed),
    false,
    "Action review must preserve voice",
  );
  assert.equal(
    await app.evaluate(
      () =>
        globalThis.fixtureRecords.filter((x) => x.method === "approve").length,
    ),
    0,
  );
  await page.getByRole("button", { name: /JARVIS voice/ }).click();
  assert.equal(
    await page.getByRole("dialog").count(),
    0,
    "Returning to outgoing voice must show HUD",
  );
  await page.screenshot({
    path: ".jarvis/verification/calls/mobile-hud-speaking.png",
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(320, 600),
  );
  const end = await page
    .getByRole("button", { name: "End voice", exact: true })
    .boundingBox();
  assert(end && end.y + end.height <= 600, "End voice must remain visible");
  await page.getByRole("button", { name: "End voice", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__voice.closed), true);
  const attempts = await app.evaluate(
    () =>
      globalThis.fixtureRecords.filter(
        (x) => x.method === "voice.activity" && x.params.active,
      ).length,
  );
  await page.evaluate(() => {
    window.__delayMicrophone = true;
  });
  await page
    .getByRole("button", { name: "Talk to JARVIS", exact: true })
    .click();
  await page.getByRole("button", { name: "End voice", exact: true }).click();
  await page.evaluate(() => {
    window.__delayMicrophone = false;
    window.dispatchEvent(
      new CustomEvent("jarvis-native", {
        detail: JSON.stringify({ type: "microphone", value: true }),
      }),
    );
  });
  assert.equal(await page.evaluate(() => window.__voice.closed), true);
  assert.equal(
    await app.evaluate(
      () =>
        globalThis.fixtureRecords.filter(
          (x) => x.method === "voice.activity" && x.params.active,
        ).length,
    ),
    attempts,
  );
  await app.evaluate(() =>
    globalThis.fixtureGateway.push({
      type: "incoming",
      call: {
        id: "fixture-incoming",
        reason: "Synthetic update",
        expires: Date.now() + 90000,
      },
    }),
  );
  const incoming = page.getByRole("dialog", { name: "Incoming JARVIS call" });
  await incoming.waitFor();
  await incoming.getByRole("button", { name: "Answer", exact: true }).click();
  await page.getByRole("dialog", { name: "JARVIS voice call" }).waitFor();
  await page
    .getByRole("dialog", { name: "JARVIS voice call" })
    .getByRole("button", { name: "End call", exact: true })
    .click();
  await app.evaluate(() =>
    globalThis.fixtureGateway.push({
      type: "incoming",
      call: {
        id: "fixture-decline",
        reason: "Synthetic update",
        expires: Date.now() + 90000,
      },
    }),
  );
  await incoming.waitFor();
  await incoming.getByRole("button", { name: "Decline", exact: true }).click();
  await incoming.waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  console.log(
    "Passed: outgoing HUD, listening/speaking animation, mute, action review, return to HUD, End voice, late-permission cancellation; incoming-only Answer/End/Decline dialog. No API connection.",
  );
} finally {
  await app.close();
}
