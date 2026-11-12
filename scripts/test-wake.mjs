import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
await mkdir(".jarvis/wake-assets", { recursive: true });
const cases = [
  ["positive", "Hey Jarvis", true],
  ["unrelated", "Hello there, this is a speaker check.", false],
  ["near-name", "Hey Travis", false],
  ["command", "Please read package JSON.", false],
];
const results = [];
for (const [id, text, expected] of cases) {
  const aiff = `.jarvis/wake-assets/${id}.aiff`,
    wav = `.jarvis/wake-assets/${id}.wav`;
  execFileSync("say", ["-r", "165", "-o", aiff, text]);
  execFileSync("afconvert", [
    "-f",
    "WAVE",
    "-d",
    "LEI16@16000",
    "-c",
    "1",
    aiff,
    wav,
  ]);
  const run = spawnSync("dist/native/jarvis-wake", ["--file", wav], {
    encoding: "utf8",
  });
  const result = JSON.parse(run.stdout.trim());
  results.push({ phrase: text, expected, detected: result.fileDetected });
  assert.equal(
    result.fileDetected,
    expected,
    `Incorrect detection for ${text}`,
  );
  console.log(`${id}: ${result.fileDetected ? "detected" : "rejected"}`);
}
await writeFile(
  ".jarvis/verification/offline-wake-fixtures.json",
  JSON.stringify(results, null, 2),
);
