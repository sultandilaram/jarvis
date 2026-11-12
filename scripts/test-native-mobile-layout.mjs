import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
const adb = resolve(".jarvis/android-tools/sdk/platform-tools/adb");
const device = "emulator-5580";
const command = (...args) =>
  execFileSync(adb, ["-s", device, ...args], { encoding: "utf8" }).trim();
const output = resolve(".jarvis/verification/mobile-redesign");
await mkdir(output, { recursive: true });
const original = {
  font: command("shell", "settings", "get", "system", "font_scale"),
  night: command("shell", "cmd", "uimode", "night"),
  size: command("shell", "wm", "size"),
  density: command("shell", "wm", "density"),
  rotation: command("shell", "settings", "get", "system", "user_rotation"),
  accelerometer: command(
    "shell",
    "settings",
    "get",
    "system",
    "accelerometer_rotation",
  ),
  keyboard: command(
    "shell",
    "settings",
    "get",
    "secure",
    "show_ime_with_hard_keyboard",
  ),
};
let browser, page;
const connections = [];
const attach = async () => {
  try {
    command("shell", "uiautomator", "dump", "/sdcard/jarvis-layout-ready.xml");
  } catch (error) {
    if (!String(error.stdout).includes("dumped to:")) throw error;
  }
  const pid = command("shell", "pidof", "com.sultan.jarvis.mobile").split(
    " ",
  )[0];
  command(
    "forward",
    "tcp:9223",
    "localabstract:webview_devtools_remote_" + pid,
  );
  browser = await chromium.connectOverCDP("http://127.0.0.1:9223", {
    noDefaults: true,
  });
  connections.push(browser);
  page = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().includes("appassets.androidplatform.net"));
  if (!page)
    page = await browser.contexts()[0].waitForEvent("page", { timeout: 15000 });
  await page.getByRole("tab", { name: "Voice", exact: true }).waitFor();
  await page.evaluate(() => window.__mobilePreview.apply("ready"));
  await page.getByRole("tab", { name: "Voice", exact: true }).click();
  await page
    .getByRole("button", { name: "Talk to JARVIS", exact: true })
    .waitFor();
};
const capture = async (name) => {
  await page.waitForFunction(() =>
    [...document.images].every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await writeFile(
    resolve(output, name + ".png"),
    execFileSync(adb, ["-s", device, "exec-out", "screencap", "-p"]),
  );
};
const reports = [];
const geometry = async (name) => {
  const g = await page.evaluate(() => {
    const box = (s) => {
      const r = document.querySelector(s)?.getBoundingClientRect();
      return r
        ? {
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
            width: r.width,
            height: r.height,
          }
        : null;
    };
    return {
      scrollY,
      viewport: { width: innerWidth, height: innerHeight },
      core: box(".voice-core"),
      main: box("main"),
      nav: box(".main-nav"),
      stop: box(".stop"),
      greeting: box(".voice-greeting"),
      note: box(".voice-note"),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  reports.push({ name, ...g });
  await capture(name);
  assert.equal(g.scrollY, 0, name + " document scrolled outside the app shell");
  assert(!g.overflow, name + " horizontal overflow");
  if (g.nav)
    assert(g.nav.bottom <= g.viewport.height + 1, name + " navigation clipped");
  assert(
    g.stop.top >= 0 && g.stop.bottom <= g.viewport.height,
    name + " Stop clipped",
  );
  if (g.core) {
    assert(
      g.core.top >= g.main.top - 1,
      name + " core clipped above its panel",
    );
    assert(
      g.core.bottom <= g.main.bottom + 1,
      name + " core clipped below its panel",
    );
    if (g.viewport.width < 600)
      assert(
        Math.abs((g.core.left + g.core.right) / 2 - g.viewport.width / 2) < 2,
        name + " core not centered",
      );
  }
  return g;
};
try {
  if (process.argv.includes("--jobs-only")) {
    command("shell", "settings", "put", "system", "font_scale", "1.3");
    command("shell", "wm", "size", "960x1920");
    command("shell", "wm", "density", "480");
    command("shell", "am", "force-stop", "com.sultan.jarvis.mobile");
    command(
      "shell",
      "am",
      "start",
      "-W",
      "-n",
      "com.sultan.jarvis.mobile/.MainActivity",
    );
    await attach();
    await page.evaluate(() => window.__mobilePreview.apply("jobs"));
    await page.getByRole("tab", { name: "Tasks", exact: true }).click();
    await page
      .getByRole("button", { name: "Resume safely", exact: true })
      .scrollIntoViewIfNeeded();
    await geometry("phone-jobs-font130");
    await page
      .getByRole("button", { name: "Resume safely", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Resume this job", exact: true })
      .scrollIntoViewIfNeeded();
    await geometry("phone-resume-font130");
    await page.getByText("New job", { exact: true }).click();
    await page
      .getByRole("textbox", { name: "Goal", exact: true })
      .scrollIntoViewIfNeeded();
    await geometry("phone-new-job-font130");
    await writeFile(
      resolve(output, "jobs-result.json"),
      JSON.stringify(
        { passed: true, native: true, offline: true, reports },
        null,
        2,
      ),
    );
    console.log("Native jobs / resume / form passed at compact 130% text.");
  } else if (process.argv.includes("--call-only")) {
    command(
      "shell",
      "pm",
      "grant",
      "com.sultan.jarvis.mobile",
      "android.permission.RECORD_AUDIO",
    );
    command("shell", "settings", "put", "system", "font_scale", "1.3");
    command("shell", "wm", "size", "960x1920");
    command("shell", "wm", "density", "480");
    command("shell", "am", "force-stop", "com.sultan.jarvis.mobile");
    command(
      "shell",
      "am",
      "start",
      "-W",
      "-n",
      "com.sultan.jarvis.mobile/.MainActivity",
    );
    await attach();
    await page
      .getByRole("button", { name: "Talk to JARVIS", exact: true })
      .click();
    await page
      .getByRole("button", { name: "End voice", exact: true })
      .waitFor();
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("jarvis-native", {
          detail: JSON.stringify({
            type: "callState",
            value: JSON.stringify({ route: "bluetooth", muted: false }),
          }),
        }),
      ),
    );
    const g = await page.evaluate(() => {
      const end = document
        .querySelector(".hud-voice-controls .end-voice")
        .getBoundingClientRect();
      const controls = document.querySelector(".hud-voice-controls");
      return {
        width: innerWidth,
        height: innerHeight,
        end: { left: end.left, right: end.right, bottom: end.bottom },
        overflow: controls.scrollWidth > controls.clientWidth,
      };
    });
    assert.equal(
      await page.getByRole("dialog").count(),
      0,
      "Outgoing must remain on HUD",
    );
    assert.equal(
      await page.evaluate(
        () => JSON.parse(window.JarvisNative.getCallState()).incoming,
      ),
      false,
    );
    await capture("phone-hud-listening-font130");
    await page.evaluate(() =>
      window.__previewVoice.update("speaking", "Of course, sir."),
    );
    await capture("phone-hud-speaking-font130");
    await page.getByRole("tab", { name: "Tasks", exact: true }).click();
    command(
      "shell",
      "am",
      "start",
      "-W",
      "-n",
      "com.sultan.jarvis.mobile/.MainActivity",
      "-a",
      "voice-hud",
    );
    await page.getByRole("tabpanel", { name: "Voice", exact: true }).waitFor();
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.getByRole("button", { name: "End voice", exact: true }).click();
    assert(!g.overflow, "Call controls overflow at large text");
    assert(
      g.end.left >= 0 && g.end.right <= g.width && g.end.bottom <= g.height,
      "End call clipped",
    );
    await writeFile(
      resolve(output, "call-layout-result.json"),
      JSON.stringify({ passed: true, offlineVoice: true, ...g }, null, 2),
    );
    console.log("Native compact large-text call controls passed.");
  } else if (process.argv.includes("--landscape-only")) {
    command(
      "shell",
      "settings",
      "put",
      "system",
      "accelerometer_rotation",
      "0",
    );
    command("shell", "settings", "put", "system", "user_rotation", "1");
    command("shell", "am", "force-stop", "com.sultan.jarvis.mobile");
    command(
      "shell",
      "am",
      "start",
      "-W",
      "-n",
      "com.sultan.jarvis.mobile/.MainActivity",
    );
    await attach();
    const g = await geometry("phone-landscape");
    assert(
      g.viewport.width > g.viewport.height,
      "Native display did not rotate",
    );
    await writeFile(
      resolve(output, "landscape-result.json"),
      JSON.stringify({ passed: true, viewport: g.viewport }, null, 2),
    );
    console.log("Native landscape layout passed.");
  } else if (process.argv.includes("--recovery-only")) {
    command("shell", "settings", "put", "system", "font_scale", "1.3");
    command("shell", "wm", "size", "960x1920");
    command("shell", "wm", "density", "480");
    command("shell", "am", "force-stop", "com.sultan.jarvis.mobile");
    command(
      "shell",
      "am",
      "start",
      "-W",
      "-n",
      "com.sultan.jarvis.mobile/.MainActivity",
    );
    await attach();
    await page.evaluate(() => window.__mobilePreview.apply("offline"));
    const button = page.getByRole("button", {
      name: "Reconnect paired desktop",
      exact: true,
    });
    await button.waitFor();
    const g = await geometry("phone-offline-compact");
    const bounds = await button.boundingBox();
    assert(
      bounds.y + bounds.height <= g.main.bottom,
      "Saved-pairing reconnect must be visible before scrolling",
    );
    await writeFile(
      resolve(output, "recovery-result.json"),
      JSON.stringify(
        { passed: true, viewport: g.viewport, reconnectVisible: true },
        null,
        2,
      ),
    );
    console.log(
      "Native saved-pairing recovery passed at 320-wide / font 130%.",
    );
  } else {
    command("shell", "am", "force-stop", "com.sultan.jarvis.mobile");
    command(
      "shell",
      "am",
      "start",
      "-W",
      "-n",
      "com.sultan.jarvis.mobile/.MainActivity",
    );
    await attach();
    await page.evaluate(() => window.__mobilePreview.apply("ready"));
    const ready = await geometry("phone-voice");
    assert.equal(
      await page.locator(".messages").count(),
      0,
      "History must be absent from Voice",
    );
    await page.getByRole("tab", { name: "Chats", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Message JARVIS" })
      .fill("Keep this draft when I change tabs.");
    await page.getByRole("tab", { name: "Voice", exact: true }).click();
    await page.waitForFunction(
      (height) => innerHeight >= height,
      ready.viewport.height,
    );
    const history = await geometry("phone-voice-with-history");
    assert.equal(ready.core.width, history.core.width);
    await page.getByRole("tab", { name: "Chats", exact: true }).click();
    assert.equal(
      await page.getByRole("textbox", { name: "Message JARVIS" }).inputValue(),
      "Keep this draft when I change tabs.",
    );
    await geometry("phone-chats");
    command(
      "shell",
      "settings",
      "put",
      "secure",
      "show_ime_with_hard_keyboard",
      "1",
    );
    const beforeKeyboard = await page.evaluate(() => innerHeight);
    const target = await page
      .getByRole("textbox", { name: "Message JARVIS" })
      .boundingBox();
    const meta = await (await fetch("http://127.0.0.1:9223/json/list")).json();
    const native = JSON.parse(
      meta.find((x) => x.url.includes("appassets.androidplatform.net"))
        .description,
    );
    const dpr = await page.evaluate(() => devicePixelRatio);
    command(
      "shell",
      "input",
      "tap",
      String(Math.round((target.x + target.width / 2) * dpr + native.screenX)),
      String(Math.round((target.y + target.height / 2) * dpr + native.screenY)),
    );
    await page.waitForFunction(
      (height) => innerHeight < height,
      beforeKeyboard,
      {
        timeout: 10000,
      },
    );
    await geometry("phone-chat-keyboard");
    command("shell", "input", "keyevent", "4");
    await page.waitForFunction(
      (height) => innerHeight >= height,
      beforeKeyboard,
    );
    command("shell", "input", "keyevent", "4");
    await page.getByRole("tabpanel", { name: "Voice", exact: true }).waitFor();
    await page.evaluate(() => window.__mobilePreview.apply("approval"));
    await page
      .getByRole("button", { name: "Review action", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Approve once", exact: true })
      .scrollIntoViewIfNeeded();
    await geometry("phone-approval");
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await geometry("phone-settings");
    await page.evaluate(() => window.__mobilePreview.apply("ready"));
    await page.getByRole("tab", { name: "Voice", exact: true }).click();
    command("shell", "settings", "put", "system", "font_scale", "1.3");
    command("shell", "cmd", "uimode", "night", "yes");
    // Activity recreation may replace the native WebView. Connect to the current target.
    command(
      "shell",
      "am",
      "start",
      "-n",
      "com.sultan.jarvis.mobile/.MainActivity",
    );
    await attach();
    await geometry("phone-font130");
    command("shell", "wm", "size", "960x1920");
    command("shell", "wm", "density", "480");
    command(
      "shell",
      "am",
      "start",
      "-n",
      "com.sultan.jarvis.mobile/.MainActivity",
    );
    await attach();
    await geometry("phone-compact-font130");
    await page.evaluate(() => window.__mobilePreview.apply("error"));
    await geometry("phone-error-compact");
    await page.evaluate(() => window.__mobilePreview.apply("offline"));
    await page
      .getByRole("button", { name: "Reconnect paired desktop", exact: true })
      .waitFor();
    await geometry("phone-offline-compact");
    await writeFile(
      resolve(output, "layout-results.json"),
      JSON.stringify(
        {
          passed: true,
          nativeWebView: true,
          offlineFixture: true,
          noApiVoice: true,
          original,
          reports,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        passed: true,
        nativeCaptures: reports.length,
        viewports: reports.map((r) => ({ name: r.name, ...r.viewport })),
      }),
    );
  }
} finally {
  command(
    "shell",
    "settings",
    "put",
    "system",
    "user_rotation",
    original.rotation,
  );
  command(
    "shell",
    "settings",
    "put",
    "system",
    "accelerometer_rotation",
    original.accelerometer,
  );
  command(
    "shell",
    "settings",
    "put",
    "secure",
    "show_ime_with_hard_keyboard",
    original.keyboard,
  );
  command("shell", "settings", "put", "system", "font_scale", original.font);
  command(
    "shell",
    "cmd",
    "uimode",
    "night",
    original.night.includes("yes")
      ? "yes"
      : original.night.includes("auto")
        ? "auto"
        : "no",
  );
  const size = original.size.match(/Override size: (\d+x\d+)/)?.[1];
  command("shell", "wm", "size", size || "reset");
  const density = original.density.match(/Override density: (\d+)/)?.[1];
  command("shell", "wm", "density", density || "reset");
  await Promise.all(
    connections.map((connection) => connection.close().catch(() => {})),
  );
}
