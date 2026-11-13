import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  validateProfile,
  requestBody,
  parseCompletion,
  resultMessages,
  complete,
  type ProviderKind,
  type ProviderProfile,
} from "../src/main/providers/protocol.ts";
import { ProviderEngine } from "../src/main/providers/engine.ts";
import { ProviderManager } from "../src/main/providers/manager.ts";
const profile = (kind: ProviderKind): ProviderProfile => ({
  kind,
  endpoint: "https://provider.example/v1",
  model: "test-model",
  key: "test-credential",
  toolsVerified: true,
});
test("provider stream failures and error-body cancellation never expose credentials", async () => {
  for (const kind of [
    "openai-compatible",
    "ollama",
    "anthropic",
    "gemini",
  ] as ProviderKind[]) {
    for (const status of [200, 403]) {
      const p = profile(kind);
      const fetcher = (async () =>
        new Response(
          new ReadableStream({
            start(c) {
              if (status === 200) c.error(Error("stream echoed " + p.key));
            },
            cancel() {
              throw Error("cancel echoed " + p.key);
            },
          }),
          { status, headers: { "content-type": "application/json" } },
        )) as typeof fetch;
      await assert.rejects(
        complete(p, [], "", [], new AbortController().signal, fetcher),
        (e) => {
          assert(!String(e).includes(p.key!));
          assert.match(
            String(e),
            status === 200 ? /response could not be read/ : /HTTP 403/,
          );
          return true;
        },
      );
    }
  }
});
const spec = {
  name: "jarvis_desktop",
  description: "Test",
  parameters: {
    type: "object",
    properties: { action: { type: "string" } },
    required: ["action"],
  },
};
function response(kind: ProviderKind, name?: string) {
  const args = { action: "files.roots" };
  if (kind === "anthropic")
    return {
      content: name
        ? [{ type: "tool_use", id: "call-1", name, input: args }]
        : [{ type: "text", text: "Done" }],
      stop_reason: name ? "tool_use" : "end_turn",
      usage: { input_tokens: 4, output_tokens: 3 },
    };
  if (kind === "gemini")
    return {
      candidates: [
        {
          finishReason: "STOP",
          content: {
            role: "model",
            parts: name
              ? [
                  {
                    functionCall: { name, args },
                    thoughtSignature: "preserve-this",
                  },
                ]
              : [{ text: "Done" }],
          },
        },
      ],
      usageMetadata: { totalTokenCount: 7 },
    };
  const message = {
    role: "assistant",
    content: name ? "" : "Done",
    ...(name
      ? {
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name,
                arguments: kind === "ollama" ? args : JSON.stringify(args),
              },
            },
          ],
        }
      : {}),
  };
  return kind === "ollama"
    ? { message, done: true, prompt_eval_count: 4, eval_count: 3 }
    : {
        choices: [{ message, finish_reason: name ? "tool_calls" : "stop" }],
        usage: { total_tokens: 7 },
      };
}
test("provider configuration forbids credential URLs, redirects and unencrypted remote endpoints", async () => {
  for (const endpoint of [
    "http://remote.example",
    "https://u:p@provider.example",
    "https://provider.example?key=x",
    "https://provider.example/#x",
    "file:///tmp/model",
  ])
    assert.throws(() =>
      validateProfile({ ...profile("openai-compatible"), endpoint }),
    );
  assert.equal(
    validateProfile({
      ...profile("ollama"),
      endpoint: "http://127.0.0.1:11434",
    }).endpoint,
    "http://127.0.0.1:11434",
  );
  let options: RequestInit | undefined;
  await complete(
    profile("openai-compatible"),
    [],
    "system",
    [],
    new AbortController().signal,
    (async (_url, opts) => {
      options = opts;
      return Response.json(response("openai-compatible"));
    }) as typeof fetch,
  );
  assert.equal(options?.redirect, "error");
  await assert.rejects(
    complete(
      profile("openai-compatible"),
      [],
      "",
      [],
      new AbortController().signal,
      (async () =>
        new Response("secret-credential echoed", {
          status: 401,
        })) as typeof fetch,
    ),
    (e) => !String(e).includes("secret-credential"),
  );
  await assert.rejects(
    complete(
      profile("openai-compatible"),
      [],
      "",
      [],
      new AbortController().signal,
      (async () => new Response("secret-credential malformed")) as typeof fetch,
    ),
    (e) => !String(e).includes("secret-credential"),
  );
});
for (const kind of [
  "openai-compatible",
  "ollama",
  "anthropic",
  "gemini",
] as const) {
  test(
    kind +
      " preserves structured tool calls and result continuation through the actual broker contract",
    async () => {
      const parsed = parseCompletion(kind, response(kind, "jarvis_desktop"));
      assert.equal(parsed.calls[0].args.action, "files.roots");
      assert.equal(parsed.usage, 7);
      const result = resultMessages(kind, [
        { call: parsed.calls[0], text: "fixture-result", failed: false },
      ]);
      assert(JSON.stringify(result).includes("fixture-result"));
      if (kind === "gemini") {
        assert.equal(
          parsed.assistant.parts[0].thoughtSignature,
          "preserve-this",
        );
        assert.equal(
          Object.hasOwn(parsed.assistant.parts[0].functionCall, "id"),
          false,
        );
      }
      const requests: any[] = [];
      let calls = 0;
      const store = new Map<string, any>();
      const engine = new ProviderEngine(
        profile(kind),
        {
          get: (k, f) => store.get(k) ?? f,
          set: (k, v) => store.set(k, structuredClone(v)),
        },
        (async (_url, options) => {
          requests.push(JSON.parse(String(options?.body)));
          return Response.json(
            response(kind, ++calls === 1 ? "jarvis_desktop" : undefined),
          );
        }) as typeof fetch,
      );
      let toolCalls = 0;
      engine.on("request", (m) => {
        toolCalls++;
        assert.equal(m.params.namespace, "jarvis");
        assert.equal(m.params.tool, "desktop");
        engine.reply(m.id, {
          success: true,
          contentItems: [{ type: "inputText", text: "fixture-result" }],
        });
      });
      const thread = await engine.request("thread/start", {
        developerInstructions: "Trusted policy",
      });
      const finished = new Promise<any>((resolve) =>
        engine.on("notification", (m) => {
          if (m.method === "turn/completed") resolve(m.params.turn);
        }),
      );
      await engine.request("turn/start", {
        threadId: thread.thread.id,
        input: [{ type: "text", text: "Read roots" }],
      });
      assert.equal((await finished).status, "completed");
      assert.equal(toolCalls, 1);
      assert.equal(requests.length, 2);
      assert(JSON.stringify(requests[1]).includes("fixture-result"));
      engine.close();
    },
  );
}
test("unknown tool names never dispatch; unverified models have no tool capability", async () => {
  for (const verified of [true, false]) {
    const engine = new ProviderEngine(
      { ...profile("openai-compatible"), toolsVerified: verified },
      { get: (_k, f) => f, set: () => {} },
      (async () =>
        Response.json(response("openai-compatible", "shell"))) as typeof fetch,
    );
    let calls = 0;
    engine.on("request", () => calls++);
    const thread = await engine.request("thread/start", {});
    const ended = new Promise<any>((resolve) =>
      engine.on("notification", (m) => {
        if (m.method === "turn/completed") resolve(m.params.turn);
      }),
    );
    await engine.request("turn/start", {
      threadId: thread.thread.id,
      input: [{ type: "text", text: "test" }],
    });
    assert.equal((await ended).status, "failed");
    assert.equal(calls, 0);
    engine.close();
  }
});
test("Stop cancels a pending provider tool wait and interrupted history cannot replay", async () => {
  const values = new Map<string, any>(),
    store = {
      get: <T>(k: string, f: T): T => values.get(k) ?? f,
      set: (k: string, v: any) => values.set(k, structuredClone(v)),
    };
  const engine = new ProviderEngine(
    profile("openai-compatible"),
    store,
    (async () =>
      Response.json(
        response("openai-compatible", "jarvis_desktop"),
      )) as typeof fetch,
  );
  const thread = await engine.request("thread/start", {}),
    requested = once(engine, "request");
  const ended = new Promise<any>((resolve) =>
    engine.on("notification", (m) => {
      if (m.method === "turn/completed") resolve(m.params.turn);
    }),
  );
  const turn = await engine.request("turn/start", {
    threadId: thread.thread.id,
    input: [{ type: "text", text: "test" }],
  });
  await requested;
  await engine.request("turn/interrupt", {
    threadId: thread.thread.id,
    turnId: turn.turn.id,
  });
  assert.equal((await ended).status, "interrupted");
  const restarted = new ProviderEngine(profile("openai-compatible"), store);
  await assert.rejects(
    restarted.request("thread/resume", { threadId: thread.thread.id }),
    /interrupted/i,
  );
  engine.close();
  restarted.close();
});
test("saving a profile cannot forge tool verification; keys stay out of state and do not follow new servers", async () => {
  let saved: any;
  const manager = new ProviderManager({
    load: async () => null,
    save: async (c) => {
      saved = structuredClone(c);
    },
  });
  await manager.save({ ...profile("anthropic"), toolsVerified: true });
  assert.equal(
    manager.snapshot().profiles.find((p) => p.kind === "anthropic")
      ?.toolsVerified,
    false,
  );
  assert(!JSON.stringify(manager.snapshot()).includes("test-credential"));
  await manager.save({ ...profile("anthropic"), key: "" });
  assert.equal(saved.profiles.anthropic.key, "test-credential");
  await assert.rejects(
    manager.save({
      ...profile("anthropic"),
      endpoint: "https://other.example/v1",
      key: "",
    }),
    /key/,
  );
});

test("tool compatibility probe requires both tool call and result continuation; cancellation stays disabled", async () => {
  let nonce = "",
    rounds = 0;
  const manager = new ProviderManager(
    { load: async () => null, save: async () => {} },
    (async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      const text = JSON.stringify(body);
      if (++rounds === 1) {
        nonce = text.match(/nonce ([a-f0-9-]{36})/)![1];
        const value = response("openai-compatible", "jarvis_probe");
        value.choices![0].message.tool_calls![0].function.arguments =
          JSON.stringify({ nonce });
        return Response.json(value);
      }
      if (rounds === 2) assert(text.includes(nonce));
      return Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: rounds === 2 ? nonce : "incorrect-image-result",
            },
            finish_reason: "stop",
          },
        ],
      });
    }) as typeof fetch,
  );
  await manager.save(profile("openai-compatible"));
  assert.equal((await manager.test("openai-compatible")).toolsVerified, true);
  assert.equal(rounds, 2);
  assert.equal(manager.testing, false);
  await assert.rejects(manager.testVision("openai-compatible"), /Vision probe/);
  assert.equal(
    manager.snapshot().profiles.find((p) => p.kind === "openai-compatible")!
      .visionVerified,
    false,
  );
  assert.equal(manager.testing, false);
  const waiting = new ProviderManager(
    { load: async () => null, save: async () => {} },
    (async (_url, options) =>
      new Promise((_resolve, reject) => {
        options!.signal!.addEventListener(
          "abort",
          () => reject(Error("Aborted")),
          { once: true },
        );
      })) as typeof fetch,
  );
  await waiting.save(profile("openai-compatible"));
  const probe = waiting.test("openai-compatible");
  await new Promise((r) => setImmediate(r));
  await assert.rejects(waiting.select("codex"), /Cancel/);
  waiting.cancelTest();
  await assert.rejects(probe);
  assert.equal(waiting.testing, false);
  assert.equal(
    waiting.snapshot().profiles.find((p) => p.kind === "openai-compatible")!
      .toolsVerified,
    false,
  );
});

test("window images use each provider's wire format, reach only verified vision models and never persist", async () => {
  const { visionProbeImage, imageSource } =
    await import("../src/main/providers/images.ts");
  const url = visionProbeImage("12345678"),
    data = imageSource(url).data;
  for (const kind of [
    "openai-compatible",
    "ollama",
    "anthropic",
    "gemini",
  ] as const) {
    const values = new Map<string, any>(),
      requests: any[] = [];
    const engine = new ProviderEngine(
      { ...profile(kind), visionVerified: true },
      {
        get: (k, f) => values.get(k) ?? f,
        set: (k, v) => values.set(k, structuredClone(v)),
      },
      (async (_url, options) => {
        requests.push(JSON.parse(String(options?.body)));
        return Response.json(
          response(kind, requests.length === 1 ? "jarvis_desktop" : undefined),
        );
      }) as typeof fetch,
    );
    engine.on("request", (m) =>
      engine.reply(m.id, {
        success: true,
        contentItems: [
          { type: "inputText", text: "Window fixture" },
          { type: "inputImage", imageUrl: url },
        ],
      }),
    );
    const thread = await engine.request("thread/start", {}),
      done = new Promise<any>((r) =>
        engine.on("notification", (m) => {
          if (m.method === "turn/completed") r(m.params.turn);
        }),
      );
    await engine.request("turn/start", {
      threadId: thread.thread.id,
      input: [{ type: "text", text: "Inspect fixture" }],
    });
    assert.equal((await done).status, "completed");
    assert.equal(requests.length, 2);
    assert(JSON.stringify(requests[1]).includes(data), kind);
    assert(!JSON.stringify([...values.values()]).includes(data), kind);
    const changed = new ProviderEngine(
      { ...profile(kind), key: "another-key" },
      { get: (k, f) => values.get(k) ?? f, set: () => {} },
    );
    await assert.rejects(
      changed.request("thread/resume", { threadId: thread.thread.id }),
      /another provider/,
    );
    engine.close();
    changed.close();
  }
});

test("malformed credentials and transport failures cannot expose API keys", async () => {
  for (const key of [
    "fixture-secret\0",
    "fixture-secret\t",
    "fixture-secret\x7f",
    "fixture-secret€",
  ])
    assert.throws(
      () => validateProfile({ ...profile("openai-compatible"), key }),
      (e) => !String(e).includes("fixture-secret"),
    );
  await assert.rejects(
    complete(
      profile("openai-compatible"),
      [],
      "",
      [],
      new AbortController().signal,
      (async () => {
        throw Error("transport echoed test-credential");
      }) as typeof fetch,
    ),
    (e) => !String(e).includes("test-credential"),
  );
});

test("cancelling during final capability persistence never publishes the grant and restores disabled storage", async () => {
  let saves = 0,
    release!: () => void,
    entered!: () => void,
    persisted: any,
    nonce = "";
  const waiting = new Promise<void>((r) => (entered = r));
  const manager = new ProviderManager(
    {
      load: async () => null,
      save: async (c) => {
        if (++saves === 3) {
          entered();
          await new Promise<void>((r) => (release = r));
        }
        persisted = structuredClone(c);
      },
    },
    (async (_url, options) => {
      const b = JSON.parse(String(options?.body));
      if (!nonce) {
        nonce = JSON.stringify(b).match(/nonce ([a-f0-9-]{36})/)![1];
        return Response.json({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "probe",
                    function: {
                      name: "jarvis_probe",
                      arguments: JSON.stringify({ nonce }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        });
      }
      return Response.json({
        choices: [{ message: { content: nonce }, finish_reason: "stop" }],
      });
    }) as typeof fetch,
  );
  await manager.save(profile("openai-compatible"));
  const probe = manager.test("openai-compatible"),
    rejected = assert.rejects(probe, /cancelled/);
  await waiting;
  manager.cancelTest();
  release();
  await rejected;
  assert.equal(manager.testing, false);
  assert.equal(
    manager.snapshot().profiles.find((p) => p.kind === "openai-compatible")!
      .toolsVerified,
    false,
  );
  assert.equal(persisted.profiles["openai-compatible"].toolsVerified, false);
  assert.equal(saves, 4);
});
