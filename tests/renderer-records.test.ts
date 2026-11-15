import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { rendererWire } from "../src/main/renderer-state.ts";
const source = `import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import{JobsPanel}from'./src/renderer/jobs.tsx';import{MaintenanceSettings}from'./src/renderer/maintenance-settings.tsx';export function render(state){const noop=async()=>{};return renderToStaticMarkup(React.createElement(React.Fragment,null,React.createElement(JobsPanel,{jobs:state.jobs,enqueue:noop,control:noop,run:noop}),React.createElement(MaintenanceSettings,{state,run:noop})));}`;
const output = buildSync({
  stdin: { contents: source, resolveDir: process.cwd(), loader: "js" },
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  loader: { ".css": "empty" },
  write: false,
}).outputFiles[0].text;
const module = { exports: {} as any };
new Function("require", "module", "exports", output)(
  createRequire(import.meta.url),
  module,
  module.exports,
);
test("actual Jobs and maintenance views render retained records after a large-history projection", () => {
  const state: any = {
    status: "ready",
    settings: {},
    tasks: [],
    memories: [],
    entries: [],
    approvals: [],
    jobs: Array.from({ length: 100 }, (_, i) => ({
      id: "j" + i,
      goal: ("Goal " + i + "\n").repeat(2000),
      state: "completed",
      profile: "project",
      checkpoint: "c".repeat(10000),
      result: "r".repeat(10000),
      activeMs: 100,
      maxActiveMinutes: 30,
      toolCalls: 1,
      maxToolCalls: 20,
    })),
    maintenance: {
      githubConfigured: true,
      mode: "github",
      pulls: [{ number: 1, state: "waiting_owner" }],
      proposals: Array.from({ length: 100 }, (_, i) => ({
        id: "p" + i,
        goal: "g".repeat(10000),
        state: "reviewing",
        review: "r".repeat(10000),
        changes: [],
        checks: [],
      })),
    },
  };
  const projected = JSON.parse(rendererWire(state));
  assert(projected.jobs.length > 0);
  assert(projected.maintenance.proposals.length > 0);
  const html = module.exports.render(projected);
  assert.match(html, /Goal 0/);
  assert.match(html, /Independent review/);
  assert.match(html, /GitHub maintenance identities configured/);
  assert(html.length < 500000);
});
