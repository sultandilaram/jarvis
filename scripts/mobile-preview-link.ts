// Offline native rendering fixture. Included only by --debug --preview builds.
const state: any = {
  jobs: [],
  monitors: [],
  status: "ready",
  error: null,
  model: "Offline preview",
  workspace: "/Synthetic/Workspace",
  tasks: [
    { id: "fixture", title: "Review the project notes", status: "completed" },
  ],
  entries: Array.from({ length: 24 }, (_, i) => ({
    id: String(i),
    role: i % 2 ? "assistant" : "user",
    text:
      i % 2
        ? "The project notes are ready for your review."
        : "Review the notes and tell me what needs attention.",
  })),
  approvals: [],
  memories: [],
  activeTaskId: null,
  hasApiKey: true,
  settings: { voiceProvider: "live", voiceIdleSeconds: 20 },
};
export class MobileLink {
  pair: any;
  connected = false;
  connecting = false;
  code = "";
  pairingName = "";
  onState = () => {};
  onEvent = (e: any) => {};
  onPaired = (p: any) => {};
  onError = (e: string) => {};
  constructor() {
    (window as any).__mobilePreview = {
      state,
      apply: (mode: string) => {
        state.jobs =
          mode === "jobs"
            ? [
                {
                  id: "preview-job",
                  goal: "Build the report generator",
                  profile: "project",
                  workspace: "/Synthetic/Jobs/preview",
                  state: "interrupted",
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  checkpoint: "Imported source; tests pending.",
                  activeMs: 60000,
                  maxActiveMinutes: 30,
                  toolCalls: 10,
                  maxToolCalls: 150,
                },
              ]
            : [];
        state.error = null;
        state.approvals = [];
        state.activeTaskId = null;
        state.status = "ready";
        if (mode === "approval") {
          state.status = "approval";
          state.activeTaskId = "fixture";
          state.approvals = [
            {
              id: "desktop:77",
              method: "jarvis/desktop/requestApproval",
              params: {
                title: "Create meeting-notes.txt",
                voiceId: 77,
                preview: {
                  path: "/Synthetic/Workspace/meeting-notes.txt",
                  after: "Agenda: review the prototype.",
                },
              },
            },
          ];
        }
        if (mode === "empty") state.entries = [];
        if (mode === "error")
          state.error =
            "The desktop execution link needs attention. Reopen JARVIS on your Mac.";
        this.connected = mode !== "offline";
        this.onState();
        this.onEvent({ type: "state" });
      },
    };
  }
  async connect(pair: any) {
    this.pair = pair;
    this.connected = true;
    this.onState();
  }
  disconnect() {
    this.connected = false;
    this.onState();
  }
  async scan() {
    this.code = "123456";
    this.onState();
  }
  async rpc(method: string, p?: any) {
    if (method === "snapshot") return structuredClone(state);
    if (method === "config") return { firebase: null, registered: false };
    if (method === "approve") {
      state.approvals = [];
      state.status = "ready";
      this.onEvent({ type: "state" });
      return {};
    }
    if (method === "stop") {
      state.activeTaskId = null;
      state.approvals = [];
      state.status = "ready";
      this.onEvent({ type: "state" });
      return {};
    }
    if (method === "send") {
      state.entries.push({
        id: crypto.randomUUID(),
        role: "user",
        text: p.text,
      });
      this.onEvent({ type: "state" });
      return {};
    }
    return {};
  }
}
