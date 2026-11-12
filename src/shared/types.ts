export type Status =
  "connecting" | "ready" | "working" | "approval" | "stopping" | "error";
export type Entry = {
  id: string;
  taskId: string | null;
  role: "user" | "assistant" | "activity" | "system";
  text: string;
  createdAt: string;
};
export type Task = {
  id: string;
  title: string;
  status: string;
  threadId: string | null;
  turnId: string | null;
  createdAt: string;
};
export type Approval = {
  id: string | number;
  method: string;
  params: Record<string, any>;
};
export type Memory = {
  id: string;
  text: string;
  kind: "confirmed" | "inferred";
  scope?: string;
};
export type Settings = {
  keepAvailable?: boolean;
  routineChecks: boolean;
  speakReplies: boolean;
  voiceProvider: "live" | "realtime";
  voiceModel: string;
  voiceName: "vesper" | "marin";
  wakeWordEnabled: boolean;
  startAtLogin: boolean;
  voiceIdleSeconds: number;
};
export type BackgroundState = {
  availability?: { enabled: boolean; active: boolean; onBattery: boolean };
  wake: {
    state: "disabled" | "starting" | "listening" | "paused" | "error";
    detail: string;
    lastWakeAt: string | null;
    diagnostics?: {
      rms?: number;
      updates?: number;
      heardHey?: boolean;
      heardJarvis?: boolean;
      retry?: string;
    };
  };
  login: { enabled: boolean; status: string };
};
export type RemoteState = {
  connected?: boolean;
  permanent?: { url: string; autoStart: boolean };
  running: boolean;
  starting: boolean;
  url: string;
  error: string | null;
  qrDataURL: string;
  qrExpires: number;
  pushConfigured: boolean;
  voiceActive: boolean;
  phones: {
    id: string;
    name: string;
    createdAt: string;
    online: boolean;
    alertsEnabled?: boolean;
  }[];
  pending: { id: string; name: string; code: string; expires: number } | null;
};
export type Snapshot = {
  google?: import("../main/integrations/google.ts").GoogleState;
  releases?: Omit<import("../main/local-releases.ts").LocalReleaseState,"log"> & {configured:boolean};
  maintenance?: ReturnType<import("../main/maintenance.ts").Maintenance["summary"]>;
  updates?: import("../main/updater.ts").UpdateState;
  monitors?: import("../main/monitors.ts").Monitor[];
  jobs?: import("../main/jobs.ts").Job[];
  watches?: import("../main/watch.ts").WatchState;
  remote?: RemoteState;
  desktop?: { roots: string[]; capabilities: string[]; accessibility: boolean };
  background?: BackgroundState;
  status: Status;
  error: string | null;
  model: string;
  workspace: string;
  tasks: Task[];
  entries: Entry[];
  approvals: Approval[];
  memories: Memory[];
  settings: Settings;
  hasApiKey: boolean;
  activeTaskId: string | null;
};
export type VoiceEvent = {
  sessionId: string;
  kind:
    | "session"
    | "microphone"
    | "input"
    | "output"
    | "delegation"
    | "dispatch"
    | "steer"
    | "approval"
    | "stop"
    | "usage"
    | "error"
    | "transport";
  detail: string;
  createdAt: string;
};
export type Api = {
  googleConfigure(): Promise<void>;
  googleSetup(): Promise<void>;
  googleManageAccess(): Promise<void>;
  googleConnect(service:"gmail"|"calendar",write:boolean): Promise<void>;
  googleCancel(): Promise<void>;
  googleDisconnect(service:"gmail"|"calendar"): Promise<void>;
  configureReleaseBuildState():Promise<unknown>;
  buildRelease():Promise<unknown>;
  openReleaseLog():Promise<unknown>;
  configureGitHubMaintenance(): Promise<unknown>;
  removeGitHubMaintenance(): Promise<unknown>;
  rendererReady?(): Promise<unknown>;
  maintenanceReview(id:string): Promise<any>;
  maintenanceMerge(id:string,digest:string): Promise<unknown>;
  checkForUpdates(): Promise<unknown>;
  installUpdate(): Promise<unknown>;
  monitorControl(id: string, action: "pause" | "remove"): Promise<unknown>;
  jobEnqueue(
    goal: string,
    profile: "desktop" | "project",
    runAt?: string,
  ): Promise<unknown>;
  jobControl(id: string, action: "resume" | "pause" | "cancel"): Promise<void>;
  jobOpen(id: string): Promise<void>;
  watchEnableTasks(phoneId: string): Promise<unknown>;
  watchAcknowledge(id: string): Promise<unknown>;
  watchRemove(id: string): Promise<unknown>;
  watchPauseAll(): Promise<void>;
  remoteStart(): Promise<void>;
  remoteQR(): Promise<void>;
  remoteDisable(): Promise<void>;
  remotePair(id: string, accept: boolean): Promise<void>;
  remoteRevoke(id: string): Promise<void>;
  remoteConfigurePush(): Promise<void>;
  remoteConfigurePermanent(value: {
    url: string;
    token: string;
    autoStart: boolean;
  }): Promise<void>;
  remoteNotify(): Promise<unknown>;
  desktopPermissions(): Promise<string>;
  revokeFolder(root: string): Promise<void>;
  quit(): Promise<void>;
  voiceActivity(active: boolean): Promise<void>;
  onWake(callback: () => void): () => void;
  voiceEvent(event: VoiceEvent): Promise<void>;
  voiceDiagnostics(): Promise<VoiceEvent[]>;
  snapshot(): Promise<Snapshot>;
  send(text: string): Promise<void>;
  stop(): Promise<void>;
  stopCurrent(): Promise<void>;
  newConversation(): Promise<void>;
  approve(id: string | number, accept: boolean): Promise<void>;
  answer(id: string | number, answers: Record<string, string>): Promise<void>;
  readFile(): Promise<void>;
  settings(patch: Partial<Settings>): Promise<void>;
  saveKey(key: string): Promise<void>;
  checkVoice(): Promise<string[]>;
  voiceConnect(sdp: string): Promise<{ sdp: string }>;
  remember(text: string, kind: Memory["kind"]): Promise<void>;
  forget(id: string): Promise<void>;
  fullscreen(): Promise<void>;
  onState(callback: (snapshot: Snapshot) => void): () => void;
  onStop(callback: () => void): () => void;
};
declare global {
  interface Window {
    jarvis: Api;
  }
}
