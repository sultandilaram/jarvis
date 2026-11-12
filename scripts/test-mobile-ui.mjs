import { build } from "esbuild";
import { _electron as electron } from "playwright-core";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir(".jarvis/verification/mobile", { recursive: true });
await build({
  entryPoints: ["scripts/mobile-fixture.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: ".jarvis/mobile-fixture.cjs",
  external: ["electron"],
  target: "node24",
});
const instance = await electron.launch({
  args: [resolve(".jarvis/mobile-fixture.cjs")],
});
try {
  const page = await instance.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("tab", { name: "Chats", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message JARVIS", exact: true })
    .fill("Synthetic mobile task");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page
    .getByText("Synthetic fixture request received.", { exact: true })
    .waitFor();
  await page.screenshot({
    path: ".jarvis/verification/mobile/conversation.png",
  });
  await page.getByRole("tab", { name: "Tasks", exact: true }).click();
  await page
    .getByRole("heading", { name: "Create fixture.txt", exact: true })
    .waitFor();
  await page.screenshot({ path: ".jarvis/verification/mobile/approval.png" });
  await page.getByRole("button", { name: "Approve once", exact: true }).click();
  await page.getByText("No pending approvals.", { exact: true }).waitFor();
  await page.getByRole("button", { name: /Stop all work/i }).click();
  const records = await instance.evaluate(() => globalThis.fixtureRecords);
  if (
    !records.some(
      (r) => r.method === "send" && r.params.text === "Synthetic mobile task",
    ) ||
    !records.some(
      (r) =>
        r.method === "approve" &&
        r.params.id === "desktop:77" &&
        r.params.accept === true,
    ) ||
    !records.some((r) => r.method === "stop")
  )
    throw Error("Mobile actions did not reach the real encrypted transport");
  if (errors.length) throw Error(errors.join("\n"));
  const result = {
    passed: true,
    records,
    errors,
    scope:
      "Actual mobile web bundle, real encrypted gateway, synthetic desktop replies. No microphone or user files accessed.",
  };
  await writeFile(
    ".jarvis/verification/mobile/ui-result.json",
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: true,
      send: true,
      approval: true,
      stop: true,
      errors,
    }),
  );
} finally {
  await instance.close();
}
