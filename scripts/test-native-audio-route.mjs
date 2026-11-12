import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
const adb = resolve(".jarvis/android-tools/sdk/platform-tools/adb");
const run = (...a) =>
  execFileSync(adb, ["-s", "emulator-5580", ...a], { encoding: "utf8" }).trim();
run(
  "shell",
  "pm",
  "grant",
  "com.sultan.jarvis.mobile",
  "android.permission.RECORD_AUDIO",
);
run("shell", "am", "force-stop", "com.sultan.jarvis.mobile");
run(
  "shell",
  "am",
  "start",
  "-W",
  "-n",
  "com.sultan.jarvis.mobile/.MainActivity",
);
try {
  run("shell", "uiautomator", "dump", "/sdcard/jarvis-audio-ready.xml");
} catch (e) {
  if (!String(e.stdout).includes("dumped to:")) throw e;
}
const pid = run("shell", "pidof", "com.sultan.jarvis.mobile").split(" ")[0];
run("forward", "tcp:9223", "localabstract:webview_devtools_remote_" + pid);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", {
  noDefaults: true,
});
try {
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().includes("appassets"));
  await page
    .getByRole("button", { name: "Talk to JARVIS", exact: true })
    .click();
  await page.waitForFunction(
    () => JSON.parse(window.JarvisNative.getCallState()).phase === "active",
  );
  await page.waitForFunction(
    () => JSON.parse(window.JarvisNative.getCallState()).route === "speaker",
  );
  assert.equal(await page.getByRole("dialog").count(), 0);
  console.log("Outgoing native Telecom route: speaker");
  await page.getByRole("button", { name: "End voice", exact: true }).click();
  await page.waitForFunction(
    () => JSON.parse(window.JarvisNative.getCallState()).phase === "off",
  );
  // Real incoming Telecom connection on this isolated emulator; no API session.
  run(
    "shell",
    "am",
    "start",
    "-W",
    "-n",
    "com.sultan.jarvis.mobile/.CallPreviewActivity",
    "--es",
    "mode",
    "incoming-telecom",
  );
  await page.waitForFunction(
    () => JSON.parse(window.JarvisNative.getCallState()).phase === "ringing",
  );
  await page.evaluate(() =>
    window.JarvisNative.prepareCall("incoming", "emulator-incoming"),
  );
  await page.waitForFunction(
    () => JSON.parse(window.JarvisNative.getCallState()).phase === "connecting",
  );
  await page.evaluate(() => window.JarvisNative.updateCallState("listening"));
  console.log(await page.evaluate(() => window.JarvisNative.getCallState()));
  const diagnostics =
    run("logcat", "-d", "-s", "JarvisAudio:I", "*:S")
      .split("\n")
      .filter((l) => l.includes("incoming=true"))
      .at(-1) || "";
  if (diagnostics.includes("EARPIECE")) {
    await page.waitForFunction(() => {
      const s = JSON.parse(window.JarvisNative.getCallState());
      return s.incoming && s.phase === "active" && s.route === "earpiece";
    });
    console.log("Answered incoming native Telecom route: earpiece");
  } else {
    assert(diagnostics.includes("Type: SPEAKER"), "No endpoint diagnostics");
    assert.equal(
      await page.evaluate(
        () => JSON.parse(window.JarvisNative.getCallState()).incoming,
      ),
      true,
    );
    console.log(
      "Incoming direction verified; emulator exposes Speaker only, so physical earpiece acceptance remains pending.",
    );
  }
  await page.evaluate(() => window.JarvisNative.endCall());
} finally {
  await browser.close();
  run("forward", "--remove", "tcp:9223");
}
