import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { ExtensionManager } from "../src/main/extensions/manager.ts";
import { rendererWire } from "../src/main/renderer-state.ts";
const code = buildSync({
  stdin: {
    contents:
      "export {SkillSettings} from './src/renderer/extension-settings.tsx'",
    resolveDir: process.cwd(),
    loader: "js",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  loader: { ".css": "empty" },
  write: false,
}).outputFiles[0].text;
const require = createRequire(import.meta.url);
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function find(tree: any, predicate: (node: any) => boolean): any {
  if (!tree) return undefined;
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return;
  }
  if (typeof tree === "object") {
    if (predicate(tree)) return tree;
    return find(tree.props?.children, predicate);
  }
}
test("actual skill toggle, edit and save retain complete authoritative instructions", async () => {
  const records = new Map();
  const manager = new ExtensionManager(
    {
      get: (key: string, fallback: any) => records.get(key) ?? fallback,
      set: (key: string, value: any) => records.set(key, value),
    } as any,
    { load: async () => [], save: async () => {} },
  );
  const text =
    "Preserve every step of this procedure.\n".repeat(160) +
    "FINAL REQUIRED INSTRUCTION";
  const id = manager.saveSkill({
    name: "Synthetic procedure",
    text,
    scope: "all",
    enabled: false,
  });
  assert.equal("text" in manager.snapshot().skills[0], false);
  const state: any = {
    status: "ready",
    settings: {},
    tasks: [],
    entries: [],
    approvals: [],
    memories: [],
    jobs: [],
    extensions: manager.snapshot(),
  };
  const projected = JSON.parse(rendererWire(state));
  // Even a future display summary carrying shortened text is never written back.
  projected.extensions.skills[0].text = "[Shortened display summary]";
  let cursor = 0;
  const values: any[] = [];
  const real = require("react");
  const fake = {
    ...real,
    useState: (initial: any) => {
      const index = cursor++;
      if (!(index in values))
        values[index] = typeof initial === "function" ? initial() : initial;
      return [
        values[index],
        (next: any) => {
          values[index] =
            typeof next === "function" ? next(values[index]) : next;
        },
      ];
    },
    useRef: (value: any) => ({ current: value }),
    useEffect: () => {},
    createElement: (type: any, props: any, ...children: any[]) => ({
      type,
      props: { ...props, children },
    }),
  };
  const module = { exports: {} as any };
  new Function("require", "module", "exports", code)(
    (name: string) => (name === "react" ? fake : require(name)),
    module,
    module.exports,
  );
  const render = () => {
    cursor = 0;
    return module.exports.SkillSettings({ state: projected });
  };
  const calls: any[] = [];
  const prior = (globalThis as any).window;
  (globalThis as any).window = {
    jarvis: {
      skillEnable: async (skillId: string, enabled: boolean) => {
        calls.push(["enable", skillId, enabled]);
        return manager.enableSkill(skillId, enabled);
      },
      skillRead: async (skillId: string) => {
        calls.push(["read", skillId]);
        return manager.readSkill(skillId);
      },
      skillSave: async (value: any) => {
        calls.push(["save", value]);
        return manager.saveSkill(value);
      },
    },
  };
  try {
    const checkbox = find(
      render(),
      (node) => node.props?.["aria-label"] === "Enable Synthetic procedure",
    );
    assert(checkbox);
    checkbox.props.onChange({ target: { checked: true } });
    await flush();
    assert.deepEqual(calls[0], ["enable", id, true]);
    assert.equal(manager.readSkill(id).text, text);
    assert.equal(manager.readSkill(id).enabled, true);
    assert.equal(calls.filter((c) => c[0] === "save").length, 0);
    const edit = find(
      render(),
      (node) => node.props?.className === "extension-name",
    );
    assert(edit);
    edit.props.onClick();
    await flush();
    const tree = render(),
      textarea = find(tree, (node) => node.type === "textarea");
    assert(textarea);
    assert.equal(textarea.props.value, text);
    assert.deepEqual(
      calls.find((c) => c[0] === "read"),
      ["read", id],
    );
    const form = find(tree, (node) => node.type === "form");
    form.props.onSubmit({ preventDefault() {} });
    await flush();
    assert.equal(calls.find((c) => c[0] === "save")[1].text, text);
    assert.equal(manager.readSkill(id).text, text);
    assert(
      manager.instructions("desktop").includes("FINAL REQUIRED INSTRUCTION"),
    );
    assert.equal(manager.snapshot().skills.length, 1);
  } finally {
    (globalThis as any).window = prior;
  }
});

test("skill enable changes only its authoritative boolean and rejects invalid input", () => {
  const records = new Map();
  const manager = new ExtensionManager(
    {
      get: (key: string, fallback: any) => records.get(key) ?? fallback,
      set: (key: string, value: any) => records.set(key, value),
    } as any,
    { load: async () => [], save: async () => {} },
  );
  const id = manager.saveSkill({
    name: "Long procedure",
    text: "x".repeat(19000),
    scope: "all",
    enabled: false,
  });
  const before = manager.readSkill(id);
  manager.enableSkill(id, true);
  assert.deepEqual(manager.readSkill(id), { ...before, enabled: true });
  assert.throws(() => manager.enableSkill(id, "true"));
  assert.throws(() => manager.enableSkill("unknown", false));
  assert.throws(() => manager.readSkill("unknown"));
  const copy = manager.readSkill(id);
  copy.text = "mutated caller copy";
  assert.equal(manager.readSkill(id).text, before.text);
});
