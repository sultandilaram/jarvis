import { test } from "node:test";
import assert from "node:assert/strict";
import { Voice, spokenActionId } from "../src/renderer/voice.ts";
import type { Api, Snapshot, VoiceEvent } from "../src/shared/types.ts";
function setup() {
  const calls: { type: string; args: unknown[] }[] = [];
  const events: VoiceEvent[] = [];
  const api = {
    send: async (...args: unknown[]) => {
      calls.push({ type: "send", args });
    },
    stop: async () => {
      calls.push({ type: "stop", args: [] });
    },
    approve: async (...args: unknown[]) => {
      calls.push({ type: "approve", args });
    },
  } as unknown as Api;
  Object.assign(globalThis, { window: { jarvis: api } });
  const snapshot: Snapshot = {
    status: "ready",
    error: null,
    model: "test",
    workspace: "/tmp",
    tasks: [],
    entries: [],
    approvals: [],
    memories: [],
    settings: {
      routineChecks: false,
      speakReplies: false,
      voiceProvider: "live",
      voiceModel: "gpt-live-1",
      voiceName: "vesper",
      wakeWordEnabled: false,
      startAtLogin: false,
      voiceIdleSeconds: 20,
    },
    hasApiKey: true,
    activeTaskId: null,
  };
  const voice = new Voice(
    () => {},
    () => {},
    (e) => events.push(e),
  );
  voice.closed = false;
  voice.ready = true;
  voice.latest = snapshot;
  voice.sessionId = "test-session";
  return { voice, calls, events, snapshot };
}
const flush = () => new Promise((r) => queueMicrotask(() => r(null)));
test("mute changes actual microphone tracks and a closed release cannot release a new voice lease", async () => {
  const { voice } = setup();
  const track = { enabled: true, stop() {} };
  voice.stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  voice.setMuted(true);
  assert.equal(track.enabled, false);
  voice.setMuted(false);
  assert.equal(track.enabled, true);
  let released = 0;
  voice.bridge = {
    voiceActivity: async () => {
      released++;
    },
  } as any;
  voice.release();
  voice.release();
  await flush();
  assert.equal(released, 1);
});
test("mobile silence window is two minutes while desktop remains twenty seconds", () => {
  const { voice } = setup();
  voice.idleSecondsOverride = 120;
  voice.lastSpeechAt = 1000;
  voice.checkIdle(120999);
  assert.equal(voice.closed, false);
  voice.checkIdle(121000);
  assert.equal(voice.closed, true);
});
test("spoken approval cannot execute on a partial identifier or without its explicit terminator", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { voice, calls, snapshot } = setup();
  snapshot.approvals = [
    { id: 1, method: "item/commandExecution/requestApproval", params: {} },
  ];
  voice.event({
    type: "session.input_transcript.delta",
    delta: "Approve action one",
    start_ms: 0,
    end_ms: 300,
  });
  t.mock.timers.tick(1300);
  await flush();
  assert.equal(calls.length, 0);
  voice.event({
    type: "session.input_transcript.delta",
    delta: " zero confirm",
    start_ms: 300,
    end_ms: 700,
  });
  t.mock.timers.tick(1300);
  await flush();
  assert.equal(calls.length, 0);
  voice.disconnect();
});
test("spoken zero approval is accepted once after quiet; duplicate delegation cannot repeat it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { voice, calls, snapshot } = setup();
  snapshot.approvals = [
    { id: 0, method: "item/commandExecution/requestApproval", params: {} },
  ];
  voice.event({
    type: "session.input_transcript.delta",
    delta: "Approve action zero confirm.",
    start_ms: 0,
    end_ms: 600,
  });
  voice.event({
    type: "session.delegation.created",
    delegation: { id: "d", target: "client" },
  });
  t.mock.timers.tick(1300);
  await flush();
  voice.event({
    type: "session.delegation.created",
    delegation: { id: "d", target: "client" },
  });
  t.mock.timers.tick(1300);
  await flush();
  assert.deepEqual(calls, [{ type: "approve", args: [0, true] }]);
  voice.disconnect();
});
test("expired approval cannot authorize an action when the quiet timer fires", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { voice, calls, snapshot } = setup();
  snapshot.approvals = [
    { id: 3, method: "item/commandExecution/requestApproval", params: {} },
  ];
  voice.event({
    type: "session.input_transcript.delta",
    delta: "approve action three confirm",
    start_ms: 0,
    end_ms: 300,
  });
  voice.observe({ ...snapshot, approvals: [] });
  t.mock.timers.tick(1300);
  await flush();
  assert.equal(calls.length, 0);
  voice.disconnect();
});
test("standalone stop after earlier conversation cancels pending work and late delegation is ignored", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { voice, calls } = setup();
  voice.event({
    type: "session.input_transcript.delta",
    delta: "Hello there.",
    start_ms: 0,
    end_ms: 200,
  });
  voice.event({
    type: "session.input_transcript.delta",
    delta: "Stop.",
    start_ms: 2000,
    end_ms: 2400,
  });
  voice.event({
    type: "session.delegation.created",
    delegation: { id: "late", target: "client" },
  });
  t.mock.timers.tick(5000);
  await flush();
  assert.deepEqual(calls, [{ type: "stop", args: [] }]);
  assert.equal(voice.closed, true);
});
test("delegation arriving before the transcript waits for text and dispatches only once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { voice, calls } = setup();
  voice.event({
    type: "session.delegation.created",
    delegation: { id: "d", target: "client" },
  });
  t.mock.timers.tick(1300);
  assert.equal(calls.length, 0);
  voice.event({
    type: "session.input_transcript.delta",
    delta: "Read package.json.",
    start_ms: 0,
    end_ms: 400,
  });
  t.mock.timers.tick(1300);
  await flush();
  voice.event({
    type: "session.delegation.created",
    delegation: { id: "d", target: "client" },
  });
  t.mock.timers.tick(1300);
  assert.deepEqual(calls, [{ type: "send", args: ["Read package.json."] }]);
  voice.disconnect();
});
test("new speech steers an active task without creating a duplicate dispatch from late delegation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { voice, calls, events, snapshot } = setup();
  snapshot.activeTaskId = "task";
  voice.event({
    type: "session.input_transcript.delta",
    delta: "Instead read README.md.",
    start_ms: 0,
    end_ms: 400,
  });
  t.mock.timers.tick(1300);
  await flush();
  voice.event({
    type: "session.delegation.created",
    delegation: { id: "late", target: "client" },
  });
  t.mock.timers.tick(1300);
  assert.equal(calls.length, 1);
  assert.ok(events.some((e) => e.kind === "steer"));
  voice.disconnect();
});
test("closing voice stops tracks immediately while retaining the old transport for final usage", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { voice, events } = setup();
  const sent: any[] = [];
  let stopped = 0,
    closed = 0;
  const channel = {
    readyState: "open",
    send: (x: string) => sent.push(JSON.parse(x)),
    close: () => {
      closed++;
    },
    onclose: null,
    onmessage: null,
  } as unknown as RTCDataChannel;
  voice.channel = channel;
  voice.pc = {
    close: () => {
      closed++;
    },
  } as unknown as RTCPeerConnection;
  voice.stream = {
    getTracks: () => [
      {
        stop: () => {
          stopped++;
        },
      },
    ],
  } as unknown as MediaStream;
  voice.disconnect();
  assert.equal(stopped, 1);
  assert.equal(closed, 0);
  assert.equal(sent[0].type, "session.close");
  assert.equal(voice.closed, true);
  channel.onmessage!({
    data: JSON.stringify({
      type: "session.closed",
      usage: { seconds: 15 },
      reason: "close_requested",
    }),
  } as MessageEvent);
  assert.equal(closed, 2);
  assert.ok(
    events.some(
      (e) => e.kind === "usage" && e.detail.includes('"finalized":true'),
    ),
  );
});

test("a delegated expired spoken approval is discarded rather than becoming a new task", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { voice, calls } = setup();
  voice.event({
    type: "session.input_transcript.delta",
    delta: "approve action three confirm",
    start_ms: 0,
    end_ms: 500,
  });
  voice.event({
    type: "session.delegation.created",
    delegation: { id: "d", target: "client" },
  });
  t.mock.timers.tick(1300);
  await flush();
  assert.equal(calls.length, 0);
  voice.disconnect();
});

test("silence closes the paid voice connection without cancelling independent backend work", async () => {
  const { voice, calls, events, snapshot } = setup();
  snapshot.settings.voiceIdleSeconds = 20;
  snapshot.activeTaskId = "still-working";
  voice.lastSpeechAt = 1000;
  voice.checkIdle(20999);
  assert.equal(voice.closed, false);
  voice.checkIdle(21000);
  assert.equal(voice.closed, true);
  assert.equal(calls.length, 0);
  assert.ok(events.some((e) => e.detail.includes("backend work continues")));
});
test("new speech refreshes the inactivity deadline", () => {
  const { voice } = setup();
  voice.event({
    type: "session.input_transcript.delta",
    delta: "Hello",
    start_ms: 0,
    end_ms: 100,
  });
  const activity = voice.lastSpeechAt;
  voice.checkIdle(activity + 19000);
  assert.equal(voice.closed, false);
  voice.disconnect();
});

test("desktop approval codes accept natural hundreds and keep their namespaced backend identity", async () => {
  const { voice, calls, snapshot } = setup();
  snapshot.approvals = [
    {
      id: "desktop:901",
      method: "jarvis/desktop/requestApproval",
      params: { voiceId: 901 },
    },
  ];
  assert.equal(spokenActionId("nine hundred and one"), "901");
  assert.equal(
    voice.approvalControl("approve action nine hundred one confirm"),
    true,
  );
  await flush();
  assert.deepEqual(calls[0], { type: "approve", args: ["desktop:901", true] });
  voice.disconnect();
});

test("polite stop is immediate while non-command mentions of stop are not cancellation", () => {
  const { voice, calls } = setup();
  assert.equal(voice.stopControl("do not stop"), false);
  assert.equal(voice.stopControl("Okay, stop"), true);
  assert.equal(calls[0].type, "stop");
});

test("natural spoken information answers resume the pending question without authorizing an action", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { voice, calls, snapshot } = setup();
  (window.jarvis as any).answer = async (...args: unknown[]) =>
    calls.push({ type: "answer", args });
  snapshot.activeTaskId = "task";
  snapshot.approvals = [
    {
      id: "question1",
      method: "item/tool/requestUserInput",
      params: {
        questions: [
          { id: "destination", question: "Which folder should I use?" },
        ],
      },
    },
  ];
  voice.event({
    type: "session.input_transcript.delta",
    delta: "Use the client reports folder",
    start_ms: 0,
    end_ms: 500,
  });
  t.mock.timers.tick(1300);
  await flush();
  assert.deepEqual(calls, [
    {
      type: "answer",
      args: ["question1", { destination: "Use the client reports folder" }],
    },
  ]);
  voice.questionControl("Use the client reports folder");
  await flush();
  assert.equal(calls.length, 1);
});
test("multiple spoken questions collect separate answers before one submission", async () => {
  const { voice, calls, snapshot } = setup();
  (window.jarvis as any).answer = async (...args: unknown[]) =>
    calls.push({ type: "answer", args });
  snapshot.activeTaskId = "task";
  snapshot.approvals = [
    {
      id: 7,
      method: "item/tool/requestUserInput",
      params: {
        questions: [
          { id: "date", question: "Which date?" },
          { id: "format", question: "Which format?" },
        ],
      },
    },
  ];
  assert(voice.questionControl("Friday"));
  assert.equal(calls.length, 0);
  assert(voice.questionControl("A PDF"));
  await flush();
  assert.deepEqual(calls, [
    { type: "answer", args: [7, { date: "Friday", format: "A PDF" }] },
  ]);
});
test("an expired question is not answered when the quiet timer fires", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { voice, calls, snapshot } = setup();
  (window.jarvis as any).answer = async (...args: unknown[]) =>
    calls.push({ type: "answer", args });
  snapshot.activeTaskId = "task";
  snapshot.approvals = [
    {
      id: 2,
      method: "item/tool/requestUserInput",
      params: { questions: [{ id: "q", question: "Which one?" }] },
    },
  ];
  voice.event({
    type: "session.input_transcript.delta",
    delta: "The second option",
    start_ms: 0,
    end_ms: 500,
  });
  snapshot.approvals = [];
  snapshot.activeTaskId = null;
  t.mock.timers.tick(1300);
  await flush();
  assert.equal(calls.length, 0);
});

test("Realtime information answers use the answer channel and never steer the waiting task", async () => {
  const { voice, calls, snapshot } = setup();
  (window.jarvis as any).answer = async (...args: unknown[]) =>
    calls.push({ type: "answer", args });
  snapshot.activeTaskId = "task";
  snapshot.approvals = [
    {
      id: 3,
      method: "item/tool/requestUserInput",
      params: { questions: [{ id: "client", question: "Which client?" }] },
    },
  ];
  voice.event({
    type: "conversation.item.input_audio_transcription.completed",
    transcript: "Acme",
  });
  await flush();
  assert.deepEqual(calls, [{ type: "answer", args: [3, { client: "Acme" }] }]);
});
test("partial question drafts cannot leak between tasks with reused request identifiers", async () => {
  const { voice, calls, snapshot } = setup();
  (window.jarvis as any).answer = async (...args: unknown[]) =>
    calls.push({ type: "answer", args });
  snapshot.activeTaskId = "first";
  snapshot.approvals = [
    {
      id: 4,
      method: "item/tool/requestUserInput",
      params: {
        questions: [
          { id: "a", question: "First?" },
          { id: "b", question: "Second?" },
        ],
      },
    },
  ];
  voice.questionControl("Old answer");
  voice.observe({ ...snapshot, activeTaskId: "second" });
  voice.questionControl("New first answer");
  assert.equal(calls.length, 0);
  voice.questionControl("New second answer");
  await flush();
  assert.deepEqual(calls[0].args, [
    4,
    { a: "New first answer", b: "New second answer" },
  ]);
});

test("speech for a replaced question cannot answer the new request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { voice, calls, snapshot } = setup();
  (window.jarvis as any).answer = async (...args: unknown[]) =>
    calls.push({ type: "answer", args });
  snapshot.activeTaskId = "task";
  snapshot.approvals = [
    {
      id: 1,
      method: "item/tool/requestUserInput",
      params: { questions: [{ id: "q", question: "First question?" }] },
    },
  ];
  voice.event({
    type: "session.input_transcript.delta",
    delta: "First answer",
    start_ms: 0,
    end_ms: 500,
  });
  snapshot.approvals = [
    {
      id: 2,
      method: "item/tool/requestUserInput",
      params: { questions: [{ id: "q", question: "A different question?" }] },
    },
  ];
  t.mock.timers.tick(1300);
  await flush();
  assert.equal(calls.length, 0);
});

test("spoken Stop targets current work while explicit Stop all work uses the global cancellation path", async () => {
  for (const global of [false, true]) {
    const { voice, calls } = setup();
    (window.jarvis as any).stopCurrent = async () =>
      calls.push({ type: "stopCurrent", args: [] });
    assert(voice.stopControl(global ? "Stop all work" : "Okay, stop"));
    await flush();
    assert.equal(calls[0].type, global ? "stop" : "stopCurrent");
  }
});
