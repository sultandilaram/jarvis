import { contextBridge, ipcRenderer } from "electron";
const invoke = (name: string, ...args: unknown[]) =>
  ipcRenderer.invoke(`jarvis:${name}`, ...args);
contextBridge.exposeInMainWorld("jarvis", {
  googleConfigure: () => invoke("googleConfigure"),
  googleSetup: () => invoke("googleSetup"),
  googleManageAccess: () => invoke("googleManageAccess"),
  googleConnect: (service:string,write:boolean) => invoke("googleConnect",service,write),
  googleCancel: () => invoke("googleCancel"),
  googleDisconnect: (service:string) => invoke("googleDisconnect",service),
  configureReleaseBuildState: () => invoke("configureReleaseBuildState"),
  buildRelease: () => invoke("buildRelease"),
  openReleaseLog: () => invoke("openReleaseLog"),
  configureGitHubMaintenance: () => invoke("configureGitHubMaintenance"),
  removeGitHubMaintenance: () => invoke("removeGitHubMaintenance"),
  rendererReady: () => invoke("rendererReady"),
  maintenanceReview: (id:string) => invoke("maintenanceReview",id),
  maintenanceMerge: (id:string,digest:string) => invoke("maintenanceMerge",id,digest),
  checkForUpdates: () => invoke("checkForUpdates"),
  installUpdate: () => invoke("installUpdate"),
  monitorControl: (id: string, action: string) =>
    invoke("monitorControl", id, action),
  jobEnqueue: (goal: string, profile: string, runAt?: string) =>
    invoke("jobEnqueue", goal, profile, runAt),
  jobControl: (id: string, action: string) => invoke("jobControl", id, action),
  jobOpen: (id: string) => invoke("jobOpen", id),
  watchEnableTasks: (phoneId: string) => invoke("watchEnableTasks", phoneId),
  watchAcknowledge: (id: string) => invoke("watchAcknowledge", id),
  watchRemove: (id: string) => invoke("watchRemove", id),
  watchPauseAll: () => invoke("watchPauseAll"),
  remoteStart: () => invoke("remoteStart"),
  remoteConfigurePermanent: (value: unknown) =>
    invoke("remoteConfigurePermanent", value),
  remoteQR: () => invoke("remoteQR"),
  remoteDisable: () => invoke("remoteDisable"),
  remotePair: (id: string, accept: boolean) => invoke("remotePair", id, accept),
  remoteRevoke: (id: string) => invoke("remoteRevoke", id),
  remoteConfigurePush: () => invoke("remoteConfigurePush"),
  remoteNotify: () => invoke("remoteNotify"),
  desktopPermissions: () => invoke("desktopPermissions"),
  revokeFolder: (root: string) => invoke("revokeFolder", root),
  quit: () => invoke("quit"),
  voiceActivity: (active: boolean) => invoke("voiceActivity", active),
  onWake: (callback: Function) => {
    const listener = () => callback();
    ipcRenderer.on("jarvis:wake", listener);
    return () => ipcRenderer.removeListener("jarvis:wake", listener);
  },
  voiceEvent: (event: unknown) => invoke("voiceEvent", event),
  voiceDiagnostics: () => invoke("voiceDiagnostics"),
  snapshot: () => invoke("snapshot"),
  send: (text: string) => invoke("send", text),
  stop: () => invoke("stop"),
  stopCurrent: () => invoke("stopCurrent"),
  newConversation: () => invoke("newConversation"),
  approve: (id: string | number, accept: boolean) =>
    invoke("approve", id, accept),
  answer: (id: string | number, answers: unknown) =>
    invoke("answer", id, answers),
  readFile: () => invoke("readFile"),
  settings: (patch: unknown) => invoke("settings", patch),
  saveKey: (key: string) => invoke("saveKey", key),
  checkVoice: () => invoke("checkVoice"),
  voiceConnect: (sdp: string) => invoke("voiceConnect", sdp),
  remember: (text: string, kind: string) => invoke("remember", text, kind),
  forget: (id: string) => invoke("forget", id),
  fullscreen: () => invoke("fullscreen"),
  onState: (callback: Function) => {
    const listener = (_: unknown, state: unknown) => callback(state);
    ipcRenderer.on("jarvis:state", listener);
    return () => ipcRenderer.removeListener("jarvis:state", listener);
  },
  onStop: (callback: Function) => {
    const listener = () => callback();
    ipcRenderer.on("jarvis:stop", listener);
    return () => ipcRenderer.removeListener("jarvis:stop", listener);
  },
});
