import type { Snapshot, VoiceEvent, Api } from "../shared/types";
export type VoiceBridge = Pick<
  Api,
  "voiceActivity" | "voiceConnect" | "stop" | "approve" | "send"
> &
  Partial<Pick<Api, "answer" | "stopCurrent">>;
export type VoiceState =
  "off" | "connecting" | "listening" | "speaking" | "error";
const quietMs = 1200;
const digitWords: Record<string, string> = {
  zero: "0",
  oh: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
};
export function normalizeSpeech(text: string) {
  return text
    .toLowerCase()
    .replace(/[.,!?]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function spokenActionId(text: string) {
  const normalized = normalizeSpeech(text);
  const words = normalized
    .replace(/-/g, " ")
    .split(" ")
    .filter((w) => w !== "and");
  const tens: Record<string, number> = {
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
  };
  if (
    words.includes("hundred") ||
    words.some((w) => tens[w] && w !== "twenty")
  ) {
    let value = 0;
    for (const w of words) {
      if (w === "hundred") {
        value *= 100;
      } else if (tens[w]) value += tens[w];
      else if (digitWords[w]) value += Number(digitWords[w]);
      else return normalized;
    }
    return String(value);
  }
  if (words.length === 2 && tens[words[0]] && Number(digitWords[words[1]]) < 10)
    return String(tens[words[0]] + Number(digitWords[words[1]]));
  return words.map((w) => digitWords[w] ?? w).join("");
}
export class Voice {
  pc?: RTCPeerConnection;
  channel?: RTCDataChannel;
  stream?: MediaStream;
  audio?: HTMLAudioElement;
  state: VoiceState = "off";
  provider: "live" | "realtime" = "live";
  latest?: Snapshot;
  closed = true;
  ready = false;
  transcript = "";
  utterance = "";
  utteranceQuestionKey: string | null = null;
  speechQuestionKey: string | null | undefined = undefined;
  lastEndMs = 0;
  delegationId: string | null = null;
  pendingDelegation = false;
  seenDelegations = new Set<string>();
  questionDraft: {
    id: string | number;
    taskId: string | null;
    answers: Record<string, string>;
  } | null = null;
  answering: string | null = null;
  generation = 0;
  sessionId = "";
  timer?: ReturnType<typeof setTimeout>;
  startupTimer?: ReturnType<typeof setTimeout>;
  speakingTimer?: ReturnType<typeof setTimeout>;
  deadlineTimer?: ReturnType<typeof setTimeout>;
  seenResult = "";
  statsTimer?: ReturnType<typeof setInterval>;
  idleTimer?: ReturnType<typeof setInterval>;
  lastSpeechAt = 0;
  wakeActivated = false;
  idleSecondsOverride?: number;
  muted = false;
  queuedContext: { text: string; speak: boolean }[] = [];
  constructor(
    public update: (state: VoiceState, caption?: string) => void,
    public fail: (message: string) => void,
    public diagnostic: (event: VoiceEvent) => void = () => {},
    public bridge?: VoiceBridge,
  ) {}
  get api(): VoiceBridge {
    return this.bridge || window.jarvis;
  }
  report(kind: VoiceEvent["kind"], detail: string) {
    this.diagnostic({
      sessionId: this.sessionId,
      kind,
      detail: detail.slice(0, 4000),
      createdAt: new Date().toISOString(),
    });
  }
  set(state: VoiceState, caption?: string) {
    this.state = state;
    this.update(state, caption);
  }
  send(event: Record<string, unknown>) {
    if (this.ready && this.channel?.readyState === "open")
      this.channel.send(
        JSON.stringify({ event_id: crypto.randomUUID(), ...event }),
      );
  }
  async connect(snapshot: Snapshot, wakeActivated = false) {
    this.disconnect();
    this.closed = false;
    this.ready = false;
    this.wakeActivated = wakeActivated;
    this.lastSpeechAt = Date.now();
    this.sessionId = crypto.randomUUID();
    this.provider = snapshot.settings.voiceProvider;
    this.latest = snapshot;
    this.set("connecting");
    const generation = this.generation;
    this.report(
      "session",
      `Connecting ${snapshot.settings.voiceProvider} / ${snapshot.settings.voiceModel}`,
    );
    try {
      await this.api.voiceActivity?.(true);
      if (this.closed || generation !== this.generation) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (this.closed || generation !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.setMuted(this.muted);
      this.report(
        "microphone",
        "Microphone permission granted; real audio track acquired.",
      );
      const pc = (this.pc = new RTCPeerConnection());
      const audio = (this.audio = new Audio());
      audio.autoplay = true;
      audio.controls = true;
      audio.muted = false;
      audio.volume = 1;
      audio.setAttribute("aria-label", "JARVIS voice playback");
      document.getElementById("voice-playback")?.append(audio);
      this.statsTimer = setInterval(() => {
        void pc
          .getStats()
          .then((stats) => {
            if (this.closed || generation !== this.generation) return;
            const inbound = [...stats.values()].find(
              (s: any) => s.type === "inbound-rtp" && s.kind === "audio",
            );
            const source = [...stats.values()].find(
              (s: any) => s.type === "media-source" && s.kind === "audio",
            );
            this.report(
              "transport",
              JSON.stringify({
                audio: {
                  paused: audio.paused,
                  muted: audio.muted,
                  volume: audio.volume,
                  readyState: audio.readyState,
                  currentTime: Math.round(audio.currentTime),
                },
                incoming: inbound
                  ? {
                      bytes: inbound.bytesReceived,
                      energy: inbound.totalAudioEnergy,
                      samples: inbound.totalSamplesReceived,
                    }
                  : null,
                microphone: source
                  ? {
                      level: source.audioLevel,
                      energy: source.totalAudioEnergy,
                    }
                  : null,
              }),
            );
          })
          .catch(() => {});
      }, 5000);
      pc.ontrack = (e) => {
        if (generation !== this.generation) return;
        audio.srcObject = e.streams[0] || new MediaStream([e.track]);
        void audio
          .play()
          .then(() =>
            this.report("transport", "Remote audio playback started."),
          )
          .catch(() =>
            this.fail(
              "Audio playback was blocked. Reconnect voice from its button.",
            ),
          );
      };
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      const channel = (this.channel = pc.createDataChannel("oai-events"));
      channel.onmessage = ({ data }) => {
        try {
          const event = JSON.parse(data);
          if (generation === this.generation && !this.closed) this.event(event);
        } catch (e) {
          this.fail(String(e));
        }
      };
      channel.onclose = () => {
        if (generation === this.generation && !this.closed) {
          this.report(
            "transport",
            "Data channel closed before confirmed session finalization.",
          );
          this.disconnect();
        }
      };
      pc.onconnectionstatechange = () => {
        if (generation !== this.generation || this.closed) return;
        if (pc.connectionState === "connected")
          this.report("transport", "WebRTC connected.");
        if (["failed", "disconnected"].includes(pc.connectionState)) {
          this.report("error", `WebRTC ${pc.connectionState}`);
          this.fail("Voice connection lost. Reconnect voice.");
          this.disconnect();
        }
      };
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise<void>((resolve, reject) => {
        const check = () => {
          if (pc.iceGatheringState === "complete") {
            clearTimeout(timer);
            pc.removeEventListener("icegatheringstatechange", check);
            resolve();
          }
        };
        const timer = setTimeout(() => {
          pc.removeEventListener("icegatheringstatechange", check);
          reject(new Error("Audio connection setup timed out."));
        }, 10000);
        pc.addEventListener("icegatheringstatechange", check);
        check();
      });
      if (this.closed || generation !== this.generation) return;
      const answer = await this.api.voiceConnect(pc.localDescription!.sdp);
      if (this.closed || generation !== this.generation) return;
      await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      if (!this.ready)
        this.startupTimer = setTimeout(() => {
          if (!this.ready && generation === this.generation) {
            this.fail(
              "The voice session did not become ready. Reconnect to try again.",
            );
            this.report("error", "No session.started event within 15 seconds.");
            this.disconnect();
            this.set("error");
          }
        }, 15000);
      // A bounded development session prevents unattended voice usage while testing.
      this.deadlineTimer = setTimeout(
        () => {
          if (generation === this.generation) {
            this.report(
              "session",
              "Ten-minute session limit reached. Reconnect to continue.",
            );
            this.disconnect();
          }
        },
        10 * 60 * 1000,
      );
    } catch (e) {
      if (generation !== this.generation) return;
      const message = e instanceof Error ? e.message : String(e);
      this.report("error", message);
      this.disconnect();
      this.set("error");
      this.fail(message);
    }
  }
  currentQuestionKey() {
    const a = this.latest?.approvals[0];
    return a?.method === "item/tool/requestUserInput"
      ? JSON.stringify([this.latest?.activeTaskId, a.id])
      : null;
  }
  event(e: any) {
    if (this.closed) return;
    if (e.type === "error") {
      const message = e.error?.message || "Voice service reported an error.";
      this.report("error", message);
      this.fail(message);
      return;
    }
    if (e.type === "session.closed") {
      this.report(
        "usage",
        JSON.stringify({ finalized: true, usage: e.usage, reason: e.reason }),
      );
      this.release();
      return;
    }
    if (e.type === "session.usage.updated") {
      this.report(
        "usage",
        JSON.stringify({ finalized: false, usage: e.usage }),
      );
      return;
    }
    if (
      e.type === "session.started" ||
      (this.provider === "realtime" && e.type === "session.created")
    ) {
      this.ready = true;
      this.lastSpeechAt = Date.now();
      this.idleTimer = setInterval(() => this.checkIdle(), 1000);
      clearTimeout(this.startupTimer);
      this.set("listening");
      this.report("session", `session.started ${e.session?.id || ""}`);
      for (const pending of this.queuedContext.splice(0))
        this.context(pending.text, pending.speak);
      if (this.wakeActivated)
        this.context(
          "The user activated you by saying Hey JARVIS locally. Briefly say: At your service, sir. Then listen for the request. Do not start backend work until the user supplies a request.",
          true,
        );
      if (this.latest?.activeTaskId) {
        const task = this.latest.tasks.find(
          (t) => t.id === this.latest?.activeTaskId,
        );
        this.context(
          `Existing backend task is already active: ${task?.title}. Do not restart it; new instructions should steer it.`,
          false,
        );
      }
      if (this.latest?.approvals.length) this.announceApproval(this.latest);
      return;
    }
    if (
      [
        "session.input_transcript.delta",
        "session.output_transcript.delta",
        "conversation.item.input_audio_transcription.completed",
        "response.output_audio_transcript.delta",
        "input_audio_buffer.speech_started",
      ].includes(e.type)
    )
      this.lastSpeechAt = Date.now();
    if (e.type === "input_audio_buffer.speech_started") {
      this.speechQuestionKey = this.currentQuestionKey();
      this.set("listening");
    }
    if (
      e.type === "session.output_transcript.delta" ||
      e.type === "response.output_audio_transcript.delta"
    ) {
      this.report("output", e.delta || "");
      this.set("speaking", e.delta);
      clearTimeout(this.speakingTimer);
      this.speakingTimer = setTimeout(() => {
        if (!this.closed) this.set("listening");
      }, 1800);
    }
    if (["response.done", "response.output_audio.done"].includes(e.type))
      this.set("listening");
    if (e.type === "session.input_transcript.delta") {
      const delta = e.delta || "";
      // A timeline gap groups captions; the full unsent transcript is retained for delegation.
      if (typeof e.start_ms === "number" && e.start_ms - this.lastEndMs > 700)
        this.utterance = "";
      if (!this.utterance)
        this.utteranceQuestionKey = this.currentQuestionKey();
      this.lastEndMs = e.end_ms ?? this.lastEndMs;
      this.transcript += delta;
      this.utterance += delta;
      this.report("input", delta);
      this.set("listening", this.utterance);
      if (this.stopControl(this.utterance)) return;
      this.schedule();
    }
    if (e.type === "session.delegation.created") {
      const id = e.delegation?.id;
      if (
        !id ||
        e.delegation.target !== "client" ||
        this.seenDelegations.has(id)
      )
        return;
      this.seenDelegations.add(id);
      this.delegationId = id;
      this.report("delegation", id);
      this.send({
        type: "session.thinking.append",
        delegation_id: id,
        content: "",
      });
      this.pendingDelegation = true;
      this.schedule();
    }
    if (e.type === "conversation.item.input_audio_transcription.completed") {
      const text = (e.transcript || "").trim();
      this.report("input", text);
      this.set("listening", text);
      if (!text || this.stopControl(text)) return;
      const speechQuestion = this.speechQuestionKey;
      this.speechQuestionKey = undefined;
      if (
        speechQuestion !== undefined &&
        speechQuestion !== this.currentQuestionKey()
      ) {
        this.fail(
          "The pending question changed. Please answer the current question.",
        );
        return;
      }
      if (this.approvalControl(text)) return;
      if (/^(approve|decline) action\b/.test(normalizeSpeech(text))) {
        this.fail(
          "No matching current approval. Use the complete phrase on the pending card.",
        );
        return;
      }
      if (this.questionControl(text)) return;
      if (this.latest?.approvals.length) {
        this.context(
          "Review the pending action and use its exact approval phrase, ending with confirm.",
          true,
        );
        return;
      }
      void this.dispatch(text);
    }
  }
  schedule() {
    clearTimeout(this.timer);
    const generation = this.generation;
    this.timer = setTimeout(() => {
      if (this.closed || generation !== this.generation) return;
      const text = this.transcript.trim();
      const utterance = this.utterance.trim();
      if (!text) return; // Delegations can precede transcript delivery; a later delta retries.
      if (this.utteranceQuestionKey !== this.currentQuestionKey()) {
        this.transcript = "";
        this.utterance = "";
        this.pendingDelegation = false;
        this.fail(
          "The pending question changed. Please answer the current question.",
        );
        return;
      }
      if (this.approvalControl(utterance)) {
        this.transcript = "";
        this.utterance = "";
        this.pendingDelegation = false;
        return;
      }
      if (/^(approve|decline) action\b/.test(normalizeSpeech(utterance))) {
        this.fail(
          "No matching current approval. Use the complete phrase on the pending card.",
        );
        this.transcript = "";
        this.utterance = "";
        this.pendingDelegation = false;
        return;
      }
      if (this.questionControl(utterance)) {
        this.transcript = "";
        this.utterance = "";
        this.pendingDelegation = false;
        return;
      }
      if (this.latest?.approvals.length) {
        this.context(
          "Approval is still pending. Use the exact approval phrase shown in the activity panel, ending with confirm.",
          true,
        );
        this.transcript = "";
        this.utterance = "";
        this.pendingDelegation = false;
        return;
      }
      if (this.pendingDelegation || this.latest?.activeTaskId) {
        this.transcript = "";
        this.utterance = "";
        this.pendingDelegation = false;
        void this.dispatch(text);
      }
    }, quietMs);
  }
  stopControl(text: string) {
    const command = normalizeSpeech(text)
      .replace(/^(?:okay|ok|please|hey jarvis|jarvis) /, "")
      .replace(/ please$/, "");
    if (
      ![
        "stop",
        "stop jarvis",
        "cancel task",
        "stop all work",
        "cancel all tasks",
      ].includes(command)
    )
      return false;
    this.report(
      "stop",
      "Spoken stop recognized; closing audio and interrupting the active task.",
    );
    this.disconnect();
    const action = ["stop all work", "cancel all tasks"].includes(command)
      ? () => this.api.stop()
      : () => (this.api.stopCurrent ? this.api.stopCurrent() : this.api.stop());
    void action()
      .then(() => this.report("stop", "Backend stop acknowledged."))
      .catch((e) => this.fail(String(e)));
    return true;
  }
  approvalControl(text: string) {
    const a = this.latest?.approvals[0];
    if (!a || !/requestApproval$/.test(a.method)) return false;
    const match = normalizeSpeech(text).match(
      /^(approve|decline) action (.+) confirm$/,
    );
    if (!match || spokenActionId(match[2]) !== String(a.params.voiceId || a.id))
      return false;
    const generation = this.generation;
    const accept = match[1] === "approve";
    void this.api
      .approve(a.id, accept)
      .then(() => {
        if (generation === this.generation)
          this.report(
            "approval",
            `${accept ? "Approved" : "Declined"} action ${a.id} by voice; backend accepted.`,
          );
      })
      .catch((e) => this.fail(String(e)));
    return true;
  }
  questionControl(text: string) {
    const request = this.latest?.approvals[0];
    if (
      !request ||
      request.method !== "item/tool/requestUserInput" ||
      !text.trim()
    )
      return false;
    const answerKey = JSON.stringify([
      this.generation,
      this.latest?.activeTaskId,
      request.id,
    ]);
    if (this.answering === answerKey) return true;
    const questions = request.params.questions;
    if (!this.api.answer || !Array.isArray(questions) || !questions.length) {
      this.fail("Answer this question in JARVIS's task panel.");
      return true;
    }
    if (
      !this.questionDraft ||
      this.questionDraft.id !== request.id ||
      this.questionDraft.taskId !== this.latest?.activeTaskId
    )
      this.questionDraft = {
        id: request.id,
        taskId: this.latest?.activeTaskId || null,
        answers: {},
      };
    const next = questions.find(
      (q: any) => !Object.hasOwn(this.questionDraft!.answers, q.id),
    );
    if (!next) return true;
    this.questionDraft.answers[next.id] = text
      .trim()
      .replace(/^(?:my answer is|the answer is|answer:)\s*/i, "");
    if (!this.questionDraft.answers[next.id]) {
      delete this.questionDraft.answers[next.id];
      return true;
    }
    const remaining = questions.find(
      (q: any) => !Object.hasOwn(this.questionDraft!.answers, q.id),
    );
    if (remaining) {
      this.context(
        `Information received for the previous question. Next question: ${remaining.question}${remaining.options?.length ? " Options: " + remaining.options.map((o: any) => o.label).join("; ") : ""}. Wait for the operator's reply. This is information, not action approval.`,
        true,
      );
      return true;
    }
    const generation = this.generation;
    this.answering = answerKey;
    void this.api
      .answer(request.id, { ...this.questionDraft.answers })
      .then(() => {
        this.report(
          "input",
          "Backend accepted the answer to its information request.",
        );
        if (!this.closed && generation === this.generation)
          this.context(
            "The backend accepted the requested information and can continue the existing task. This did not approve any action.",
            false,
          );
      })
      .catch((e) => {
        this.fail(String(e));
        this.questionDraft = null;
      })
      .finally(() => {
        if (this.answering === answerKey) this.answering = null;
      });
    return true;
  }
  async dispatch(text: string) {
    const steering = !!this.latest?.activeTaskId;
    try {
      await this.api.send(text);
      this.report(
        steering ? "steer" : "dispatch",
        `${steering ? "Correction" : "Request"} accepted: ${text}`,
      );
    } catch (e) {
      this.report("error", String(e));
      this.fail(String(e));
      this.context(`Backend could not accept the request: ${String(e)}`, true);
    }
  }
  context(text: string, speak = false) {
    if (this.closed) return;
    if (!this.ready) {
      this.queuedContext.push({ text, speak });
      return;
    }
    if (this.provider === "live")
      this.send({
        type: speak ? "session.commentary.append" : "session.thinking.append",
        delegation_id: this.delegationId,
        content: text.slice(0, 1000),
      });
    else {
      this.send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: `Local backend evidence: ${text.slice(0, 4000)}`,
            },
          ],
        },
      });
      if (speak) this.send({ type: "response.create" });
    }
  }
  announceApproval(snapshot: Snapshot) {
    const a = snapshot.approvals[0];
    if (!a) return;
    if (a.method === "item/tool/requestUserInput") {
      const question = a.params.questions?.[0];
      if (question)
        this.context(
          `The backend needs information to continue its existing task: ${question.question}${question.options?.length ? " Options: " + question.options.map((o: any) => o.label).join("; ") : ""}. Ask this question and listen. The operator may answer naturally; the local app will submit the answer. Do not ask for an approval phrase or claim any action is approved.`,
          true,
        );
      return;
    }
    this.context(
      `Approval required. Exact action details are visible in the activity panel. ${a.params.title || a.params.command || a.method}. To approve this action say: approve action ${a.params.voiceId || a.id} confirm. To decline say: decline action ${a.params.voiceId || a.id} confirm.`,
      true,
    );
  }
  observe(snapshot: Snapshot) {
    const prior = this.latest;
    this.latest = snapshot;
    if (
      this.questionDraft &&
      (snapshot.activeTaskId !== this.questionDraft.taskId ||
        !snapshot.approvals.some((a) => a.id === this.questionDraft!.id))
    )
      this.questionDraft = null;
    if (!prior) return;
    if (prior.activeTaskId && !snapshot.activeTaskId) {
      const task = snapshot.tasks.find((t) => t.id === prior.activeTaskId);
      const last = snapshot.entries
        .filter((e) => e.taskId === task?.id && e.role === "assistant")
        .at(-1);
      const key = `${task?.id}:${task?.status}`;
      if (this.seenResult !== key) {
        this.seenResult = key;
        this.context(
          `Task status: ${task?.status}. ${last?.text || snapshot.error || "No result was verified."}`,
          true,
        );
      }
    }
    if (
      snapshot.approvals.length &&
      !prior.approvals.some((a) => a.id === snapshot.approvals[0].id)
    )
      this.announceApproval(snapshot);
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    for (const track of this.stream?.getAudioTracks() || [])
      track.enabled = !muted;
  }
  checkIdle(now = Date.now()) {
    if (this.closed || !this.ready) return;
    const seconds =
      this.idleSecondsOverride ?? this.latest?.settings.voiceIdleSeconds ?? 20;
    if (now - this.lastSpeechAt < seconds * 1000) return;
    this.report(
      "session",
      `Voice closed after ${seconds}s without speech; backend work continues independently and local wake listening can resume.`,
    );
    this.disconnect();
  }
  release() {
    const wasOpen = !this.closed;
    this.closed = true;
    this.ready = false;
    ++this.generation;
    clearTimeout(this.timer);
    clearTimeout(this.startupTimer);
    clearTimeout(this.speakingTimer);
    clearTimeout(this.deadlineTimer);
    clearInterval(this.statsTimer);
    clearInterval(this.idleTimer);
    this.channel?.close();
    this.pc?.close();
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.audio) {
      this.audio.pause();
      this.audio.srcObject = null;
      this.audio.remove();
    }
    this.audio = undefined;
    this.pc = undefined;
    this.channel = undefined;
    this.stream = undefined;
    this.transcript = "";
    this.utterance = "";
    this.pendingDelegation = false;
    this.questionDraft = null;
    this.delegationId = null;
    this.lastEndMs = 0;
    this.seenDelegations.clear();
    this.queuedContext = [];
    this.set("off");
    if (wasOpen) void this.api.voiceActivity?.(false).catch(() => {});
  }
  disconnect() {
    const channel = this.channel,
      pc = this.pc,
      sessionId = this.sessionId;
    // Silence output and stop microphone capture immediately. Keep only the transport briefly
    // to receive confirmed final usage, independently from any next connection.
    if (
      this.provider === "live" &&
      this.ready &&
      channel?.readyState === "open"
    ) {
      let finalized = false;
      const finalize = () => {
        if (finalized) return;
        finalized = true;
        clearTimeout(timeout);
        channel.close();
        pc?.close();
      };
      const timeout = setTimeout(() => {
        this.diagnostic({
          sessionId,
          kind: "usage",
          detail: "Final session usage unconfirmed: graceful close timed out.",
          createdAt: new Date().toISOString(),
        });
        finalize();
      }, 2500);
      channel.onclose = () => finalize();
      channel.onmessage = ({ data }) => {
        try {
          const e = JSON.parse(data);
          if (e.type === "session.closed") {
            this.diagnostic({
              sessionId,
              kind: "usage",
              detail: JSON.stringify({
                finalized: true,
                usage: e.usage,
                reason: e.reason,
              }),
              createdAt: new Date().toISOString(),
            });
            finalize();
          }
        } catch {}
      };
      channel.send(
        JSON.stringify({
          type: "session.close",
          event_id: crypto.randomUUID(),
        }),
      );
      this.channel = undefined;
      this.pc = undefined;
    }
    this.release();
  }
}
