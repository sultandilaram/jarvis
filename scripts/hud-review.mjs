import { _electron as electron } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
await mkdir(".jarvis/verification/hud", { recursive: true });
const app = await electron.launch({
  args: [".", "--windowed"],
  env: {
    ...process.env,
    JARVIS_DATA_DIR: resolve(".jarvis/verification/hud-profile-" + process.pid),
  },
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("tabpanel", { name: "Voice", exact: true }).waitFor();
  await page.screenshot({ path: ".jarvis/verification/hud/welcome.png" });
  const images = await page.locator("img").evaluateAll((imgs) =>
    imgs.map((i) => ({
      src: i.getAttribute("src"),
      loaded: i.complete && i.naturalWidth > 0,
    })),
  );
  if (images.some((i) => !i.loaded)) throw Error("Logo failed to load");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("dialog", { name: "Workspace settings" }).waitFor();
  if ((await page.getByLabel("Voice character").inputValue()) !== "vesper")
    throw Error("British voice is not default");
  await page.getByLabel("Voice character").selectOption("marin");
  if (
    (await page.evaluate(() => window.jarvis.snapshot())).settings.voiceName !==
    "marin"
  )
    throw Error("Voice selection did not persist");
  await page.getByLabel("Voice character").selectOption("vesper");
  await page.screenshot({ path: ".jarvis/verification/hud/settings.png" });
  await page.getByRole("button", { name: "Close settings" }).click();
  // Render synthetic states without initiating microphone, network requests or actions.
  await page.evaluate(() => {
    const core = document.querySelector(".hud-core");
    core.className = "hud-core mode-approval";
    core.querySelector(".core-status").textContent = "AWAITING AUTHORIZATION";
  });
  await page.screenshot({
    path: ".jarvis/verification/hud/approval-state.png",
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(960, 650),
  );
  await page.screenshot({ path: ".jarvis/verification/hud/compact.png" });
  const layout = await page.evaluate(() => {
    const box = (s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        bottom: r.bottom,
      };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      voiceCall: box(".voice-call"),
      stop: box(".global-stop"),
      core: box(".hud-core"),
    };
  });
  await writeFile(
    ".jarvis/verification/hud/layout.json",
    JSON.stringify({ images, layout, errors }, null, 2),
  );
  if (
    layout.voiceCall.bottom > layout.viewport.height ||
    layout.stop.bottom > layout.viewport.height ||
    layout.core.height < 160
  )
    throw Error("Compact layout clips controls");
  if (errors.length) throw Error(errors.join("\n"));
  await writeFile(
    ".jarvis/verification/hud/layout.json",
    JSON.stringify({ images, layout, errors }, null, 2),
  );
  console.log(JSON.stringify({ images, layout, errors }));
} finally {
  await app.close();
}
