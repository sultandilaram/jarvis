import { GoogleAccounts, type GoogleState } from "./integrations/google.ts";
import { parseGoogleClient } from "./integrations/google-oauth.ts";
import { LocalReleases, validateBuildState } from "./local-releases.ts";
import { GitHubMaintenance, type GitHubMaintenanceCredentials, type PendingPull } from "./github-maintenance.ts";
import { Maintenance, readTree, treeDigest, sensitivePath as importSensitivePath } from "./maintenance.ts";
import { assetURL } from "./releases.ts";
import { ReleaseUpdater } from "./updater.ts";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import { Availability } from "./availability.ts";
import {
  app,
  Notification,
  BrowserWindow,
  ipcMain,
  dialog,
  globalShortcut,
  session,
  systemPreferences,
  Tray,
  Menu,
  nativeImage,
  powerMonitor,
  powerSaveBlocker,
  shell,
} from "electron";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import {
  encryptSecret,
  decryptSecret,
  writeEncrypted,
  usesFixedVault,
  isVaultCipher,
} from "./credential-storage.ts";
import { WakeController } from "./wake.ts";
import { JobManager } from "./jobs.ts";
import { MonitorManager } from "./monitors.ts";
import { ProjectService } from "./project.ts";
import { WatchManager } from "./watch.ts";
import { Store } from "./store.ts";
import { ProviderManager, ProviderRouter } from "./providers/manager.ts";
import { DelegationManager, subagentTool } from "./delegation.ts";
import { ProviderEngine } from "./providers/engine.ts";
import { Codex } from "./codex.ts";
import { ExtensionManager } from "./extensions/manager.ts";
import { PluginCatalog, isBuiltinPlugin } from "./extensions/catalog.ts";
import { voiceInstructions, liveVoices } from "../shared/persona.ts";
import { RemoteLink } from "./remote/link.ts";
import { DesktopService, nativeCall } from "./desktop/service.ts";
import { Orchestrator } from "./orchestrator.ts";
import { readSelectedFile } from "./local-file.ts";
import type { Settings, VoiceEvent } from "../shared/types.ts";
app.setName("JARVIS");
if (process.env.JARVIS_DATA_DIR)
  app.setPath("userData", resolve(process.env.JARVIS_DATA_DIR));
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) process.exit(0);
let window: BrowserWindow;
let updater: ReleaseUpdater;
let maintenance: Maintenance;
let githubMaintenance: GitHubMaintenance;
let githubTimer: ReturnType<typeof setInterval>;
let githubTickBusy=false;
let localReleases: LocalReleases;
let google: GoogleAccounts;
let providers: ProviderManager;
let extensions: ExtensionManager;
let pluginCatalog:PluginCatalog;
let delegations:DelegationManager;
let updateTimer: ReturnType<typeof setInterval>;
let updateInstalling = false;
let agent: Orchestrator;
let desktop: DesktopService;
let desktopAccess: {accessibility:boolean;eventPosting:boolean;screenCapture:boolean}|undefined;
let store: Store;
let keyPath: string;
let wake: WakeController;
let tray: Tray;
let remote: RemoteLink;
let monitors: MonitorManager;
let availability: Availability;
let jobs: JobManager;
let jobsTimer: ReturnType<typeof setInterval>;
let watches: WatchManager;
const updateNotifications = new Map<string, Notification>();
let watchTimer: ReturnType<typeof setInterval>;
let localVoiceActive = false;
let isQuitting = false;
function loginState() {
  if (process.platform !== "darwin")
    return { enabled: false, status: "unsupported" };
  const item = app.getLoginItemSettings();
  return { enabled: item.openAtLogin, status: item.status || "unknown" };
}
function sourcePreview(base64:string) {
 const bytes=Buffer.from(base64,"base64");
 return bytes.includes(0)?`Binary asset · ${bytes.length} bytes · SHA-256 ${createHash("sha256").update(bytes).digest("hex")}`:bytes.toString("utf8");
}
function snapshot() {
  return {
    ...agent.snapshot(),
    google: google?.snapshot(),
    providers: providers?.snapshot(),
    extensions: extensions?.snapshot(),
    pluginCatalog:pluginCatalog?.entries(),
    browser:desktop?.browser.state(),
    updates: updater?.state,
    maintenance: maintenance?.summary(),
    releases: localReleases?{...localReleases.state,log:undefined,configured:!!store.get("releaseBuildStateDirectory",null)}:undefined,
    watches: watches?.snapshot(),
    remote: remote?.state(),
    desktop: {
      roots: desktop?.roots() || [],
      accessibility: systemPreferences.isTrustedAccessibilityClient(false),
      eventPosting: desktopAccess?.eventPosting,
      screenCapture: desktopAccess?.screenCapture,
      capabilities: [
        "App launch",
        "Accessibility inspect / press / text",
        "Dedicated browser",
        "Granted UTF-8 files",
      ],
    },
    background: {
      wake: wake.status,
      login: loginState(),
      availability: {
        enabled: !!store.settings().keepAvailable,
        active: availability?.id !== null && availability?.id !== undefined,
        onBattery: powerMonitor.isOnBatteryPower(),
      },
    },
  };
}
function showWindow() {
  window.show();
  window.focus();
  app.dock?.show();
}
function publishBackground() {
  if (isQuitting) return;
  if (window && !window.isDestroyed())
    window.webContents.send("jarvis:state", snapshot());
  if (tray) refreshTray();
}
function setLogin(enabled: boolean) {
  if (!app.isPackaged && enabled)
    throw new Error(
      "Login startup requires the packaged JARVIS.app. Use npm run package.",
    );
  app.setLoginItemSettings({ openAtLogin: enabled });
}
function refreshTray() {
  tray.setToolTip(`JARVIS · ${wake.status.detail}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show JARVIS", click: showWindow },
      { label: wake.status.detail, enabled: false },
      { type: "separator" },
      {
        label: "Listen for Hey JARVIS locally",
        type: "checkbox",
        checked: store.settings().wakeWordEnabled,
        click: (item) => {
          store.set("settings", {
            ...store.settings(),
            wakeWordEnabled: item.checked,
          });
          wake.configure(item.checked);
          publishBackground();
        },
      },
      {
        label: "Start at login",
        type: "checkbox",
        checked: loginState().enabled,
        click: (item) => {
          try {
            setLogin(item.checked);
            store.set("settings", {
              ...store.settings(),
              startAtLogin: item.checked,
            });
            publishBackground();
          } catch (error) {
            dialog.showErrorBox("Login startup", String(error));
          }
        },
      },
      {
        label: "Stop all work",
        click: () => {
          void stop();
        },
      },
      { type: "separator" },
      { label: "Quit JARVIS", click: () => app.quit() },
    ]),
  );
}
let cachedApiKey = "";
function apiKey() {
  return process.env.OPENAI_API_KEY || cachedApiKey;
}
let keyLoading: Promise<void> | undefined;
async function unlockedApiKey() {
  if (!apiKey() && existsSync(keyPath)) {
    keyLoading ??= loadStoredKey(
      store.get<string>("workspace", app.getAppPath()),
    ).finally(() => {
      keyLoading = undefined;
      if (!isQuitting) agent?.publish();
    });
    await keyLoading;
  }
  return apiKey();
}
async function loadStoredKey(workspace: string) {
  if (
    process.env.OPENAI_API_KEY ||
    !existsSync(keyPath) ||
    app.commandLine.hasSwitch("use-mock-keychain")
  )
    return;
  try {
    const original = readFileSync(keyPath);
    const decrypted = await decryptSecret(original);
    if (
      !apiKey() &&
      existsSync(keyPath) &&
      readFileSync(keyPath).equals(original)
    ) {
      if (usesFixedVault() && !isVaultCipher(original)) {
        const encrypted = await encryptSecret(decrypted);
        if (
          apiKey() ||
          !existsSync(keyPath) ||
          !readFileSync(keyPath).equals(original)
        )
          return;
        writeEncrypted(keyPath, encrypted);
        store.set("credentialStorage", "macos-local-vault");
      }
      cachedApiKey = decrypted;
      if (usesFixedVault()) await remote?.migrateSecrets();
    }
    return;
  } catch (error) {
    if (existsSync(keyPath) && isVaultCipher(readFileSync(keyPath)))
      throw error;
  }
  const legacy = join(
    workspace,
    "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
  );
  const helper = join(__dirname, "native/migrate-key.cjs");
  if (!existsSync(legacy) || !existsSync(helper)) return;
  const result = await new Promise<string>((resolve) => {
    const child = spawn(legacy, [helper, keyPath], {
      stdio: ["ignore", "ignore", "ignore", "pipe"],
    });
    let data = "";
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(value);
    };
    const timer = setTimeout(() => finish(""), 15000);
    (child.stdio[3] as Readable).on("data", (chunk) => {
      data += String(chunk);
      if (data.length > 10000) finish("");
    });
    child.on("error", () => finish(""));
    child.on("exit", () => {
      try {
        const value = JSON.parse(data);
        finish(typeof value.key === "string" ? value.key : "");
      } catch {
        finish("");
      }
    });
  });
  if (result && !apiKey() && existsSync(keyPath)) {
    const encrypted = await encryptSecret(result);
    if (apiKey() || !existsSync(keyPath)) return;
    writeEncrypted(keyPath, encrypted);
    cachedApiKey = result;
    store.set(
      "credentialStorage",
      usesFixedVault() ? "macos-local-vault" : "macos-keychain",
    );
  }
}
async function createVoiceConnection(sdp: unknown) {
  if (typeof sdp !== "string" || sdp.length > 100000 || !sdp.startsWith("v=0"))
    throw new Error("Invalid audio offer.");
  const key = await unlockedApiKey();
  if (!key) throw new Error("An OpenAI project API key is required for voice.");
  const cfg = store.settings();
  const instructions = voiceInstructions;
  let r: Response;
  if (cfg.voiceProvider === "live") {
    r = await fetch("https://api.openai.com/v1/live/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          model: cfg.voiceModel,
          instructions,
          audio: { output: { voice: cfg.voiceName } },
          delegation: { type: "client" },
        },
        transport: { type: "webrtc", sdp },
      }),
      signal: AbortSignal.timeout(30000),
    });
  } else {
    const form = new FormData();
    form.set("sdp", sdp);
    form.set(
      "session",
      JSON.stringify({
        type: "realtime",
        model: cfg.voiceModel,
        instructions,
        audio: {
          input: {
            transcription: { model: "gpt-4o-mini-transcribe" },
            turn_detection: {
              type: "server_vad",
              interrupt_response: true,
              create_response: true,
            },
          },
          output: { voice: cfg.voiceName === "vesper" ? "cedar" : "marin" },
        },
      }),
    );
    r = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(30000),
    });
  }
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as any;
    throw new Error(
      `Voice session failed (${r.status}): ${body.error?.message || "Check model access and API billing."}`,
    );
  }
  if (cfg.voiceProvider === "live") {
    const result = (await r.json()) as any;
    if (!result.transport?.sdp)
      throw new Error("Live returned no audio answer.");
    return { sdp: result.transport.sdp };
  }
  return { sdp: await r.text() };
}
function handle(name: string, fn: (...args: any[]) => any) {
  ipcMain.handle(`jarvis:${name}`, (event, ...args) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("Unauthorized IPC sender.");
    return fn(...args);
  });
}
async function stopCurrent() {
  void remote?.gateway.push({ type: "endVoice" });
  if (remote?.voiceOwner) remote.releaseVoice();
  window?.webContents.send("jarvis:stop");
  const current = jobs?.current();
  if (current) await jobs.control(current.id, "pause");
  else await agent.stop();
}
async function stop() {
  providers?.cancelTest();
  google?.cancel();
  localReleases?.stop();
  monitors?.pauseAll();
  watches?.pauseAll();
  void remote?.gateway.push({ type: "endVoice" });
  if (remote?.voiceOwner) remote.releaseVoice();
  window?.webContents.send("jarvis:stop");
  if (jobs) await jobs.stopAll();
  else await agent.stop();
}
app.on("second-instance", (_event, argv) => {
  if (!argv.includes("--background")) showWindow();
});
app.on("activate", () => {
  if (window) showWindow();
});
app.whenReady().then(async () => {
  const data = app.getPath("userData");
  mkdirSync(data, { recursive: true, mode: 0o700 });
  keyPath = join(data, "openai-key.enc");
  updater = new ReleaseUpdater(app.getVersion(), join(data,"Updates"));
  updater.on("change", publishBackground);
  store = new Store(join(data, "jarvis.sqlite"));
  const providerPath=join(data,"task-providers.enc");
  providers=new ProviderManager({
    load:async()=>existsSync(providerPath)?JSON.parse(await decryptSecret(readFileSync(providerPath))):null,
    save:async value=>writeEncrypted(providerPath,await encryptSecret(JSON.stringify(value))),
  });
  await providers.load();
  const pluginPath=join(data,"plugins.enc");
  extensions=new ExtensionManager(store,{
    load:async()=>existsSync(pluginPath)?JSON.parse(await decryptSecret(readFileSync(pluginPath))):[],
    save:async value=>writeEncrypted(pluginPath,await encryptSecret(JSON.stringify(value))),
  });
  await extensions.load();
  const googlePath=join(data,"google-accounts.enc");
  google=new GoogleAccounts({
    load:async()=>existsSync(googlePath)?JSON.parse(await decryptSecret(readFileSync(googlePath))):{},
    save:async value=>writeEncrypted(googlePath,await encryptSecret(JSON.stringify(value))),
  },store.get<GoogleState>("googleAccounts",{configured:existsSync(googlePath)}),state=>{
    store.set("googleAccounts",{...state,connecting:undefined,error:undefined});
    if(agent&&wake)publishBackground();
  },url=>shell.openExternal(url));
  pluginCatalog=new PluginCatalog(store,()=>google.state,publishBackground);
  google.enabled=service=>pluginCatalog.enabled(service);
  if (!store.get("seeded", false)) {
    store.set("seeded", true);
  }
  const workspaceConfig = join(__dirname, "workspace.json");
  const hint = existsSync(workspaceConfig)
    ? JSON.parse(readFileSync(workspaceConfig, "utf8")).workspace
    : null;
  const workspace = resolve(
    process.env.JARVIS_WORKSPACE ||
      store.get<string | null>("workspace", null) ||
      (hint && existsSync(hint)
        ? hint
        : app.isPackaged
          ? join(data, "Workspace")
          : app.getAppPath()),
  );
  store.set("workspace", workspace);
  const background =
    process.argv.includes("--background") ||
    app.getLoginItemSettings().wasOpenedAtLogin;
  wake = new WakeController(join(__dirname, "native", "jarvis-wake"));
  const fileWorkspace = join(workspace, "Workspace");
  mkdirSync(fileWorkspace, { recursive: true, mode: 0o700 });
  desktop = new DesktopService(
    join(__dirname, "native", "jarvis-desktop-control"),
    () => store.get<string[]>("desktopRoots", [fileWorkspace]),
    (roots) => {
      store.set("desktopRoots", roots);
      agent.publish();
    },
    () => window,
    fileWorkspace,
  );
  google.allowed=()=>jobs?.current()?.profile!=="project";
  desktop.broker.approvalMode = () => store.settings().approvalMode === "critical" ? "critical" : "always";
  desktop.visionAllowed=()=>providers.config.selected==="codex"||providers.profile()?.visionVerified===true;
  desktop.integrationPlanner=(action,args)=>google.plan(action,args);
  desktop.extensionPlanner=(action,args)=>{
    if(jobs?.current()?.profile === "project")throw Error("Plugins are unavailable to isolated project jobs.");
    if(action==="plugin.list")return Promise.resolve({title:"List JARVIS plugins",approval:false,preview:{},run:async()=>({plugins:[...pluginCatalog.entries(),...extensions.snapshot().plugins.map(p=>({...p,kind:"external",required:false}))]})});
    if(action==="plugin.tools"&&isBuiltinPlugin(args.pluginId)){const p=pluginCatalog.entries().find(p=>p.id===args.pluginId)!;return Promise.resolve({title:"Inspect built-in plugin",approval:false,preview:{plugin:p.name},run:async()=>({...p,notice:"Use these native actions directly through jarvis.desktop; their account, tab, isolation and approval guards remain in force."})});}
    if(jobs?.current()?.profile === "project")throw Error("Custom plugins are unavailable to isolated project jobs.");return extensions.plan(action,args);
  };
  agent = new Orchestrator(
    store,
    new ProviderRouter(app.getVersion(),providers,store),
    workspace,
    () => !!apiKey() || existsSync(keyPath),
    desktop.broker,
  );
  desktop.navigationTargets = () => agent.active ? agent.navigationTargets : [];
  desktop.browser.taskKey=()=>agent.active?.id||"idle";
  let researchPermissionEpoch=0;
  desktop.browser.researchEpoch=()=>agent.navigationEpoch+researchPermissionEpoch;
  desktop.browser.researchText=()=>agent.operatorResearchText;
  desktop.browser.publicResearchAllowed=()=>store.settings().approvalMode==="critical" && store.settings().publicResearchEnabled===true;
  desktop.browser.accessAllowed=()=>jobs?.current()?.profile!=="project";
  desktop.browser.owner=()=>window;
  desktop.browser.canEmbed=()=>!!window&&!window.isDestroyed()&&agent.approvals.size===0&&!updateInstalling;
  desktop.browser.on("change",publishBackground);
  desktop.browser.on("reveal",()=>{showWindow();window.webContents.send("jarvis:browser-reveal");});
  jobs = new JobManager(store, agent, join(data, "Jobs"), () => {
    if (window && !window.isDestroyed()) publishBackground();
  });
  monitors = new MonitorManager(store, desktop.files, jobs, () => {
    if (window && !window.isDestroyed()) publishBackground();
  });
  agent.monitorSnapshot = () => monitors.list();
  agent.jobSnapshot = () => jobs.list();
  agent.beforeTool = () => jobs.countTool();
  const projects = new ProjectService(() => jobs.current(), desktop.files);
  delegations=new DelegationManager(store,join(data,"Subagents"),()=>{
    const j=jobs.current();
    return j&&agent.active&&!agent.stopping&&j.taskId===agent.active.id?{jobId:j.id,taskId:agent.active.id,project:j.profile==="project"}:null;
  },()=>store.settings().subagentsEnabled===true,history=>{
    const p=providers.profile();
    if(p&&!p.toolsVerified)throw Error("The selected provider must pass its tool test before delegation.");
    const engine=p?new ProviderEngine({...p},history,fetch,[{name:"jarvis_desktop",description:subagentTool.description,parameters:subagentTool.inputSchema}]):new Codex(app.getVersion());
    return {engine,model:p?.model||agent.model};
  },async(parent,path)=>{
    const j=jobs.current();
    if(!j||j.id!==parent.jobId||j.taskId!==parent.taskId||j.profile!=="project")throw Error("The shared project task changed.");
    const f=await projects.artifact(j,"read",path);
    if(jobs.current()?.id!==j.id||agent.active?.id!==parent.taskId)throw Error("The parent task changed during snapshot capture.");
    return {path,text:f.text,sha256:f.sha256};
  },parent=>{
    const j=jobs.current();if(!j||j.id!==parent.jobId||j.taskId!==parent.taskId||agent.active?.id!==parent.taskId||agent.stopping)throw Error("The parent budget is no longer active.");
    jobs.countTool();
  },publishBackground);
  jobs.onCreated=job=>delegations.registerNewParent(job.id);
  desktop.agentPlanner=(action,args)=>delegations.plan(action,args);
  agent.subagentSnapshot=()=>delegations.summary();
  agent.on("state",s=>delegations.reconcile(s.activeTaskId));
  agent.on("correction",()=>delegations.cancelAll("The operator corrected the parent task. Delegate fresh work explicitly."));
  maintenance=new Maintenance(store,jobs,join(data,"Source",app.getVersion()),join(__dirname,"maintenance-source.json"),publishBackground);
  agent.projectAuthority=job=>maintenance.projectAuthority(job);
  const githubKeyPath=join(data,"github-maintenance.enc");
  githubMaintenance=new GitHubMaintenance(async()=>{
    if(!existsSync(githubKeyPath))throw Error("JARVIS GitHub maintenance identities are not configured.");
    return JSON.parse(await decryptSecret(readFileSync(githubKeyPath))) as GitHubMaintenanceCredentials;
  });
  localReleases=new LocalReleases(join(data,"ReleaseBuilds"),()=>store.get<string|undefined>("releaseBuildStateDirectory",undefined),githubMaintenance,(result)=>{store.set("localReleaseState",result);publishBackground();},store.get("localReleaseState",undefined));
  maintenance.builderState=()=>({...localReleases.state,log:undefined,configured:!!store.get("releaseBuildStateDirectory",null)});
  maintenance.buildRelease=(version,commit,signal)=>localReleases.build(version,commit,signal);
  maintenance.githubReady=()=>existsSync(githubKeyPath);
  maintenance.prepareRelease=version=>githubMaintenance.releasePreview(version);
  maintenance.requestRelease=async(version,commit)=>{
    const result=await githubMaintenance.release(version,commit);
    store.set("localReleaseRequests",[{version,commit}]);publishBackground();return {...result,localBuildApprovalPending:true};
  };
  maintenance.githubPulls=()=>store.get<PendingPull[]>("githubPendingPulls",[]);
  maintenance.publishGitHub=async(p)=>{
    if(maintenance.githubPulls!().some(pr=>pr.proposalId===p.id))throw Error("This proposal already has a pull request. Check repo.status.");
    if(maintenance.githubPulls!().filter(p=>!["merged","failed"].includes(p.state)).length>=10)throw Error("Resolve existing pull requests before publishing more.");
    const pull=await githubMaintenance.publish({proposalId:p.id,goal:p.goal,changes:p.changes!,review:p.review!,sensitive:p.changes!.some(c=>importSensitivePath(c.path))});
    store.set("githubPendingPulls",[pull,...maintenance.githubPulls!()].slice(0,100));publishBackground();return pull;
  };
  let githubCursor=0;
  githubTimer=setInterval(()=>{
    if(githubTickBusy || !existsSync(githubKeyPath))return;
    const pending=maintenance.githubPulls!().filter(p=>!["merged","failed"].includes(p.state));if(!pending.length)return;
    const p=pending[githubCursor++%pending.length];githubTickBusy=true;
    void githubMaintenance.advance(p).then(next=>{
      if(isQuitting)return;
      store.set("githubPendingPulls",maintenance.githubPulls!().map(old=>old.number===p.number?next:old));publishBackground();
    }).catch(error=>{
      if(isQuitting)return;
      store.set("githubPendingPulls",maintenance.githubPulls!().map(old=>old.number===p.number?{...old,error:(error as Error).message}:old));publishBackground();
    }).finally(()=>{githubTickBusy=false;});
  },60000);
  desktop.maintenancePlanner=async(action,args)=>maintenance.plan(action,args);
  desktop.projectPlanner = async (action,args) => {
    const plan=await projects.plan(action,args);
    if(action!=="project.exec")return plan;
    const run=plan.run;
    plan.run=async(signal)=>{
      const job=jobs.current();
      const reviewing=job?.source?.startsWith("maintenance-review:");
      const before=reviewing?treeDigest(readTree(job!.workspace)):"";
      const result=await run(signal);
      if(reviewing)maintenance.receipt(job!,args.command as string[],args.path,before,result);
      return result;
    };
    return plan;
  };
  desktop.jobPlanner = async (action, args) => {
    if (action === "job.list")
      return {
        title: "Inspect durable jobs",
        approval: false,
        preview: {},
        run: async () => jobs.list(),
      };
    if (action === "job.enqueue") {
      const goal = args.text,
        profile = args.profile || "desktop";
      if (
        typeof goal !== "string" ||
        !goal.trim() ||
        !["desktop", "project"].includes(String(profile))
      )
        throw Error("Provide a goal in text and profile desktop or project.");
      return {
        title: "Queue a " + profile + " job",
        approval: true,
        preview: {
          goal,
          profile,
          runAt: args.runAt || "When the worker is ready",
          effect:
            profile === "project"
              ? "Create and modify files in a fresh isolated project folder. Commands require individual approval and cannot access the rest of your home folder. Public HTTPS requires its own exact-command approval; private networks remain blocked."
              : "Use existing approval-gated desktop, browser and granted-file tools.",
          limits:
            "30 active minutes and 150 tool calls; explicit resume after interruption.",
        },
        run: async () =>
          jobs.enqueue({
            goal,
            profile: String(profile),
            runAt: typeof args.runAt === "string" ? args.runAt : undefined,
          }),
      };
    }
    const id = args.jobId;
    if (typeof id !== "string" || !jobs.get(id))
      throw Error("Choose jobId from job.list.");
    if (action === "job.read" || action === "job.files")
      return {
        title: "Inspect job artifact",
        approval: false,
        preview: { jobId: id, path: args.path },
        run: async () =>
          projects.artifact(
            jobs.get(id)!,
            action === "job.read" ? "read" : "list",
            args.path,
          ),
      };
    if (action === "job.continue") {
      if (typeof args.text !== "string" || !args.text.trim())
        throw Error("Provide the follow-up goal in text.");
      return {
        title: "Continue this job with a follow-up",
        approval: true,
        preview: {
          job: jobs.get(id),
          followUp: args.text,
          effect:
            "Reuse this job workspace and context with a fresh execution budget. Inspect previous effects; new consequential actions need fresh approval.",
        },
        run: async () => jobs.followup(id, String(args.text)),
      };
    }
    const control = action.split(".")[1];
    if (!["resume", "pause", "cancel"].includes(control))
      throw Error("Unsupported job action.");
    return {
      title: control + " job",
      approval: control === "resume",
      preview: {
        job: jobs.get(id),
        effect:
          control === "resume"
            ? "Continue the same goal. Inspect prior effects; old approvals cannot be reused."
            : control,
      },
      run: async () => {
        await jobs.control(id, control as any);
        return { accepted: true };
      },
    };
  };
  availability = new Availability(powerSaveBlocker);
  powerMonitor.on("on-ac", () => {
    availability.update(!!store.settings().keepAvailable, false);
    publishBackground();
  });
  powerMonitor.on("on-battery", () => {
    availability.update(!!store.settings().keepAvailable, true);
    publishBackground();
  });
  availability.update(
    !!store.settings().keepAvailable,
    powerMonitor.isOnBatteryPower(),
  );
  jobsTimer = setInterval(() => {
    jobs.tick();
    void monitors.tick().catch(() => {});
  }, 5000);
  app.dock?.setIcon(join(__dirname, "brand", "jarvis-icon.png"));
  remote = new RemoteLink(
    data,
    join(__dirname, "native", "cloudflared"),
    () => window,
    () => agent.snapshot(),
    async (method, p) => {
      if (method === "send") return jobs.send(p);
      if (method === "job.enqueue") return jobs.enqueue(p);
      if (method === "monitor.control") return monitors.control(p.id, p.action);
      if (method === "job.control") return jobs.control(p.id, p.action);
      if (method === "stop") return stop();
      if (method === "stop.current") return stopCurrent();
      if (method === "approve") return agent.approve(p.id, p.accept);
      if (method === "answer") return agent.answer(p.id, p.answers);
      if (method === "voice.connect") return createVoiceConnection(p);
      throw Error("Unsupported remote operation");
    },
    (active) => wake.setVoiceActive(localVoiceActive || active),
    () => localVoiceActive,
    join(__dirname, "mobile", "JARVIS.apk"),
  );
  remote.on("state", () => {
    if (isQuitting) return;
    if (window && !window.isDestroyed()) agent.publish();
  });
  watches = new WatchManager(store, {
    phones: () => remote.state().phones,
    ready: () =>
      !!remote.state().connected && !remote.voiceOwner && !localVoiceActive,
    notify: (update) => {
      store.entry("system", update.text);
      agent.publish();
      if (!Notification.isSupported())
        throw Error("Native notifications unavailable");
      const n = new Notification({
        title: "JARVIS · Update",
        body: update.text,
        actions: [{ type: "button", text: "Acknowledge" }],
        timeoutType: "never",
      });
      updateNotifications.set(update.id, n);
      n.on("close", () => updateNotifications.delete(update.id));
      n.on("click", showWindow);
      n.on("failed", (_event, error) => {
        update.error = "Mac notification failed: " + String(error);
        watches.save();
      });
      n.on("action", (_event, index) => {
        if (index === 0) {
          watches.ack(update.id);
          n.close();
        }
      });
      n.show();
    },
    call: (text, id, attention) => remote.notify(text, id, attention),
    changed: () => {
      if (window && !window.isDestroyed()) publishBackground();
    },
  });
  remote.onBackgroundUpdate = (update) =>
    watches.report(update.text, update.attention);
  desktop.memoryPlanner = async (action, args) => {
    const text = typeof args.text === "string" ? args.text.trim() : "";
    const scope = typeof args.scope === "string" ? args.scope : "global";
    if (action === "memory.search")
      return {
        title: "Recall saved context",
        approval: false,
        preview: {},
        run: async () => store.recall(text, scope),
      };
    if (
      action !== "memory.save" ||
      !text ||
      text.length > 4000 ||
      scope.length > 100
    )
      throw Error("Provide an explicit memory in text and an optional scope.");
    return {
      title: "Remember personal context",
      approval: true,
      preview: {
        text,
        scope,
        kind: "confirmed",
        effect:
          "Save this context locally for future relevant tasks. It can be removed in Memory.",
      },
      run: async () => {
        store.remember(text, "confirmed", scope);
        agent.publish();
        return { saved: true };
      },
    };
  };
  desktop.taskPlanner = async (action, args) => agent.taskPlan(action, args);
  desktop.watchPlanner = async (action, args) =>
    ["watch.source", "watch.sources"].includes(action)
      ? monitors.plan(action, args)
      : watches.plan(action, args);
  watchTimer = setInterval(() => {
    void watches
      .tick()
      .catch((error) => console.error("Watch check failed:", String(error)));
  }, 60000);
  powerMonitor.on("resume", () => {
    void watches.tick().catch(() => {});
  });
  remote.checkUpdates=()=>updater.check();
  remote.androidUpdate=()=>{
    const m=updater.manifest;
    if(!m)throw Error("Check for a verified public release first.");
    return {version:m.version,url:assetURL(m.version,m.assets.android.name),...m.assets.android};
  };
  desktop.phonePlanner = async (action, args) => remote.phonePlan(action, args);
  remote.handoffLocalVoice = async () => {
    if (!localVoiceActive) return;
    window.webContents.send("jarvis:stop");
    const deadline = Date.now() + 3000;
    while (localVoiceActive && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (localVoiceActive)
      throw Error("End the Mac voice session before calling the phone.");
  };
  window = new BrowserWindow({
    icon: join(__dirname, "brand", "jarvis-icon.png"),
    show: !background,
    width: 1440,
    height: 950,
    minWidth: 960,
    minHeight: 650,
    backgroundColor: "#030b12",
    title: "JARVIS",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  window.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
      app.dock?.hide();
    }
  });
  wake.on("status", publishBackground);
  wake.on("wake", () => {
    showWindow();
    window.webContents.send("jarvis:wake");
  });
  const trayIcon = nativeImage.createFromPath(
    join(__dirname, "brand", "jarvisTrayTemplate.png"),
  );
  trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  refreshTray();
  let suspended = false,
    screenLocked = false;
  powerMonitor.on("suspend", () => {
    suspended = true;
    wake.setSystemPaused(true);
    window.webContents.send("jarvis:stop");
  });
  powerMonitor.on("lock-screen", () => {
    screenLocked = true;
    wake.setSystemPaused(true);
    window.webContents.send("jarvis:stop");
  });
  powerMonitor.on("resume", () => {
    suspended = false;
    wake.setSystemPaused(screenLocked);
  });
  powerMonitor.on("unlock-screen", () => {
    screenLocked = false;
    wake.setSystemPaused(suspended);
  });
  window.on("resize",()=>desktop.browser.waitForLayout());
  window.webContents.on("render-process-gone",()=>desktop.browser.surface(false));
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  session.defaultSession.setPermissionRequestHandler(
    async (wc, permission, callback, details) => {
      if (
        wc !== window.webContents ||
        permission !== "media" ||
        !("mediaTypes" in details) ||
        !details.mediaTypes?.includes("audio") ||
        details.mediaTypes?.includes("video")
      ) {
        callback(false);
        return;
      }
      callback(
        process.platform !== "darwin" ||
          (await systemPreferences.askForMediaAccess("microphone")),
      );
    },
  );
  session.defaultSession.setPermissionCheckHandler(
    (wc, permission, _origin, details) =>
      wc === window.webContents &&
      permission === "media" &&
      details.mediaType === "audio",
  );
  agent.on("state", (state) => {
    if (isQuitting) return;
    watches?.resolveAttention(state);
    remote?.observe(state);
    if (!window.isDestroyed())
      window.webContents.send("jarvis:state", snapshot());
  });
  handle("snapshot", snapshot);
  handle("desktopScreenPermissions",()=>shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"));
  handle("desktopCheckAccess",async()=>{
    const result=await nativeCall(desktop.helper,{action:"permissions"},new AbortController().signal);
    desktopAccess={accessibility:result.accessibility===true,eventPosting:result.eventPosting===true,screenCapture:result.screenCapture===true};
    publishBackground();return desktopAccess;
  });
  extensions.on("change",publishBackground);
  agent.skillContext=()=>extensions.instructions(agent.executionJob?.profile||"desktop");
  const extensionIdle=()=>{if(agent.active||agent.busy||agent.stopping||jobs?.current())throw Error("Finish or pause the current task before changing skills or plugins.");};
  handle("skillSave",(value:unknown)=>{extensionIdle();return extensions.saveSkill(value);});
  handle("skillRemove",(id:unknown)=>{extensionIdle();extensions.removeSkill(id);});
  handle("skillImport",async()=>{
    extensionIdle();const chosen=await dialog.showOpenDialog(window,{title:"Import skill instructions",properties:["openFile"],filters:[{name:"Skill text",extensions:["md","txt"]}]});
    if(chosen.canceled)return null;extensionIdle();const file=await readSelectedFile(chosen.filePaths[0]);if(file.bytes>20000)throw Error("Choose a skill text file up to 20 KB. Scripts and assets are not installed.");return {name:chosen.filePaths[0].split("/").at(-1)!.replace(/\.(md|txt)$/i,"").slice(0,80),text:file.text,scope:"all",enabled:false};
  });
  handle("pluginSave",async(value:unknown)=>changeConfiguration(async()=>{desktop.broker.cancel();return extensions.savePlugin(value);}));
  handle("pluginEnable",async(id:unknown,enabled:unknown)=>{
    if(isBuiltinPlugin(id)){desktop.broker.cancel();if(enabled===false&&google.state.connecting===id)google.cancel();pluginCatalog.set(id,enabled);return {enabled:pluginCatalog.enabled(id)};}
    if(enabled===true){extensionIdle();const p=extensions.snapshot().plugins.find(p=>p.id===id);if(!p)throw Error("Unknown plugin.");const revision=extensions.revision;const choice=await dialog.showMessageBox(window,{type:"warning",buttons:["Cancel","Connect plugin"],defaultId:0,cancelId:0,title:"Connect custom MCP plugin",message:"Connect "+p.name+"?",detail:"Server: "+p.endpoint+"\n\nJARVIS will load this server’s tool catalog. Calls require approval of exact arguments, even in Autopilot. The server may access accounts or files configured on that server. Use only a server you trust. No subprocesses or downloaded scripts are started. You can disable it at any time."});if(choice.response!==1)return {cancelled:true};extensionIdle();if(extensions.revision!==revision)throw Error("Plugin configuration changed during review. Inspect it again.");return changeConfiguration(async()=>{desktop.broker.cancel();await extensions.enable(id,true);return {enabled:true};});}
    desktop.broker.cancel();await extensions.enable(id,enabled);return {enabled};
  });
  handle("pluginRemove",async(id:unknown)=>{if(isBuiltinPlugin(id))throw Error("Embedded and built-in plugins cannot be removed. Optional built-ins can be disabled.");desktop.broker.cancel();await extensions.removePlugin(id);});
  providers.on("change",publishBackground);
  let configurationChanging=false;
  const configurationIdle=(provider=false)=>{
    if(configurationChanging||agent.active||agent.busy||agent.stopping||jobs?.current()||localReleases?.busy()||(provider&&(localVoiceActive||remote?.voiceOwner)))throw Error("Finish or pause current work and end voice before changing this configuration.");
  };
  const changeConfiguration=async(work:()=>Promise<unknown>,provider=false,newContext=false)=>{
    configurationIdle(provider);
    const pending=newContext?agent.newConversation():Promise.resolve();
    configurationChanging=true;agent.busy=true;agent.publish();
    try{await pending;return await work();}finally{configurationChanging=false;agent.busy=false;agent.publish();}
  };
  handle("providerSave",async(value:unknown)=>{
    configurationIdle(true);const prepared=providers.prepare(value),active=prepared.kind===providers.config.selected,revision=providers.revision;
    if(active){const choice=await dialog.showMessageBox(window,{type:"question",buttons:["Cancel","Save and reconnect"],defaultId:0,cancelId:0,title:"Change the active task connection",message:"Apply changes to "+prepared.kind+"?",detail:"Destination: "+prepared.endpoint+"\nModel: "+prepared.model+"\n\nNew task instructions, enabled skills and requested file/account/tool content and captured window images will go to this server. A fresh conversation starts. Tools must pass their probe again; voice is configured separately."});if(choice.response!==1)return {cancelled:true};}
    if(providers.revision!==revision)throw Error("Provider configuration changed during review. Inspect it again.");
    return changeConfiguration(async()=>{await providers.save(prepared);if(active){desktop.stop();agent.model="";await agent.connect();}return {saved:true};},true,active);
  });
  handle("providerCancelTest",()=>providers.cancelTest());
  const providerProbe=async(kind:unknown,vision=false)=>{
    const active=kind===providers.config.selected;
    return changeConfiguration(async()=>{try{return await (vision?providers.testVision(kind):providers.test(kind));}finally{if(active){desktop.stop();agent.model="";await agent.connect();}}},true,active);
  };
  handle("providerTest",(kind:unknown)=>providerProbe(kind));
  handle("providerTestVision",(kind:unknown)=>providerProbe(kind,true));
  handle("providerRemove",async(kind:unknown)=>changeConfiguration(()=>providers.remove(kind),true));
  handle("providerSelect",async(kind:unknown)=>{
    configurationIdle(true);
    if(typeof kind!=="string")throw Error("Choose a task provider.");
    const p=providers.snapshot().profiles.find(p=>p.kind===kind),revision=providers.revision;if(!p)throw Error("Unknown provider.");
    const choice=await dialog.showMessageBox(window,{type:"question",buttons:["Cancel","Use this provider"],defaultId:0,cancelId:0,title:"Change JARVIS task provider",message:"Use "+kind+" for new tasks?",detail:kind==="codex"?"Use your existing Codex sign-in. A new conversation will begin; prior history is retained.":"Destination: "+p.endpoint+"\nModel: "+p.model+"\n\nNew task instructions, enabled skills and requested file/account/tool content and captured window images will be sent to this server. "+(p.toolsVerified?"Structured tools passed the compatibility probe; JARVIS approvals still apply.":"This model is conversation-only until its tool probe passes.")+" A new conversation will begin. Voice is configured separately."});
    if(choice.response!==1)return {cancelled:true};if(providers.revision!==revision)throw Error("Provider configuration changed during review. Inspect it again.");
    return changeConfiguration(async()=>{await providers.select(kind);desktop.stop();agent.model="";await agent.connect();return {selected:kind};},true,true);
  });
  handle("googleSetup",()=>shell.openExternal("https://console.cloud.google.com/auth/clients"));
  handle("googleManageAccess",()=>shell.openExternal("https://myaccount.google.com/connections"));
  handle("googleConfigure",async()=>{
    const picked=await dialog.showOpenDialog(window,{title:"Import Google Desktop OAuth client",properties:["openFile"],filters:[{name:"Google OAuth client JSON",extensions:["json"]}]});
    if(picked.canceled)return;
    const {lstat}=await import("node:fs/promises"); const info=await lstat(picked.filePaths[0]);
    if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw Error("Choose a regular OAuth JSON file up to 16 KiB.");
    const client=parseGoogleClient(JSON.parse(readFileSync(picked.filePaths[0],"utf8")));
    await google.configure(client);
  });
  handle("googleConnect",async(service:unknown,write:unknown)=>{
    if((service!=="gmail"&&service!=="calendar")||typeof write!=="boolean")throw Error("Choose Gmail or Calendar and an explicit permission mode.");
    desktop.broker.cancel();const revision=pluginCatalog.beginConnect(service);
    await google.connect(service,write);pluginCatalog.finishConnect(service,revision);
  });
  handle("googleCancel",()=>{const service=google.state.connecting;if(service)pluginCatalog.set(service,false);google.cancel();});
  handle("googleDisconnect",async(service:unknown)=>{
    if(service!=="gmail"&&service!=="calendar")throw Error("Invalid Google service.");
    const choice=await dialog.showMessageBox(window,{type:"question",buttons:["Keep connected","Disconnect"],defaultId:0,cancelId:0,title:"Disconnect Google account",message:`Disconnect ${service==="gmail"?"Gmail":"Calendar"} from this Mac?`,detail:"JARVIS removes this connection's locally stored tokens. Existing chat history remains. To revoke Google's grant too, use Manage Google access; revoking the shared client can affect both connections."});
    if(choice.response===1){desktop.broker.cancel();pluginCatalog.set(service,false);await google.disconnect(service);}
  });
  handle("configureReleaseBuildState",async()=>{
    const selected=await dialog.showOpenDialog(window,{title:"Choose private JARVIS release build state",properties:["openDirectory","showHiddenFiles"]});if(selected.canceled)return;
    const directory=validateBuildState(selected.filePaths[0]);
    const choice=await dialog.showMessageBox(window,{type:"warning",buttons:["Cancel","Use private build state"],defaultId:0,cancelId:0,title:"Configure local release builds",message:"Use this private build state for owner-approved JARVIS releases?",detail:directory+"\n\nIncludes the existing local Mac signing identity, fixed vault, Android signing key, release signing key and SDK settings. Each build requires approval of the exact checked source commit. Builds run reviewed source with access to this private state. Project coding jobs cannot access it. Keys remain on this Mac; only signed app artifacts are published. No public-repository self-hosted runner is registered."});
    if(choice.response!==1)return;
    store.set("releaseBuildStateDirectory",directory);publishBackground();return {configured:true};
  });
  handle("openReleaseLog",()=>localReleases.state.log?shell.openPath(localReleases.state.log):undefined);
  handle("buildRelease",async()=>{
    const requests=store.get<{version:string;commit:string}[]>("localReleaseRequests",[]),request=requests[0];if(!request)throw Error("Ask JARVIS to request an exact release version first.");
    if(localReleases.busy()||updateInstalling)throw Error("Finish the current release/update first.");
    const choice=await dialog.showMessageBox(window,{type:"warning",buttons:["Cancel","Build and publish release"],defaultId:0,cancelId:0,title:"Review JARVIS release build",message:"Build and publish JARVIS "+request.version+"?",detail:"Source commit: "+request.commit+"\n\nRun the exact checked source with the configured private signing/build state. Build and verify signed DMG, ZIP and Android APK, then publish a complete signed GitHub release. This does not install the update. Build scripts execute with your Mac account privileges; approve only reviewed source."});
    if(choice.response!==1)return {cancelled:true};
    return localReleases.build(request.version,request.commit);
  });
  handle("configureGitHubMaintenance", async()=>{
    const choice=await dialog.showOpenDialog(window,{title:"Import private JARVIS GitHub identities",properties:["openFile"],filters:[{name:"GitHub App identity JSON",extensions:["json"]}]});
    if(choice.canceled)return {cancelled:true};
    const bytes=readFileSync(choice.filePaths[0]);if(bytes.length>64000)throw Error("GitHub identity file exceeds its limit.");
    const credentials=JSON.parse(bytes.toString("utf8"));
    if(!credentials.proposer?.privateKey || !credentials.reviewer?.privateKey)throw Error("Provide separate proposer/reviewer GitHub App identities.");
    const probe=new GitHubMaintenance(async()=>credentials);
    const token=await probe.token("proposer");await probe.token("reviewer");await probe.ensureRules(token);
    const confirmed=await dialog.showMessageBox(window,{type:"warning",buttons:["Cancel","Save maintenance identities"],defaultId:0,cancelId:0,title:"Enable JARVIS repository maintenance",message:"Allow these separate GitHub Apps to maintain sultandilaram/jarvis?",detail:"Proposer app: "+credentials.proposer.appId+"\nReviewer app: "+credentials.reviewer.appId+"\nInstallation tokens are limited to this repository. They cannot administer the repository or change workflows. Ordinary reviewed documentation PRs can merge after trusted checks; sensitive changes need your GitHub code-owner approval. Private keys are encrypted in this Mac's vault. The imported plaintext file remains at its original location."});
    if(confirmed.response!==1)return {cancelled:true};
    writeEncrypted(githubKeyPath,await encryptSecret(JSON.stringify(credentials)));githubMaintenance.tokens.clear();publishBackground();return {configured:true};
  });
  handle("removeGitHubMaintenance",async()=>{
    const c=await dialog.showMessageBox(window,{type:"question",buttons:["Cancel","Disconnect maintenance"],defaultId:0,cancelId:0,message:"Remove JARVIS's saved GitHub maintenance credentials?",detail:"Local source jobs remain. GitHub PRs remain open; this does not uninstall or revoke the GitHub Apps."});
    if(c.response!==1)return;
    if(existsSync(githubKeyPath))unlinkSync(githubKeyPath);githubMaintenance.tokens.clear();publishBackground();
  });
  handle("rendererReady", () => {
  // An update is healthy only after main initialization and the real renderer load.
  const healthArg=process.argv.find(a=>a.startsWith("--update-health="))?.slice(16);
  const healthNonce=process.argv.find(a=>a.startsWith("--update-nonce="))?.slice(15);
  if(healthArg && healthNonce && /^[a-f0-9-]{36}$/.test(healthNonce) && resolve(healthArg).startsWith(join(data,"Updates")+"/") && healthArg.endsWith("/health.json")) {
    writeFileSync(healthArg,JSON.stringify({nonce:healthNonce,version:app.getVersion()}),{mode:0o600});
  }
    return {ready:true};
  });
  handle("maintenanceReview", (id:unknown)=>{
    const p=maintenance.get(id);
    return {id:p.id,goal:p.goal,digest:p.digest,review:p.review,checks:p.receipts,changes:p.changes?.map(c=>({path:c.path,before:c.before?sourcePreview(c.before):null,after:c.after?sourcePreview(c.after):null}))};
  });
  handle("maintenanceMerge", async(id:unknown,digest:unknown)=>{
    const p=maintenance.get(id);
    if(p.state!=="owner_review" || p.digest!==digest)throw Error("This source review changed or expired.");
    const c=await dialog.showMessageBox(window,{type:"warning",buttons:["Cancel","Approve source merge"],defaultId:0,cancelId:0,title:"Review JARVIS source changes",message:"Merge this reviewed source improvement locally?",detail:p.goal+"\n\nSnapshot: "+p.digest+"\nFiles: "+p.changes?.map(c=>c.path).join(", ")+"\n\nIndependent review:\n"+p.review+"\n\nThis merges source only. It does not install an app update or publish to GitHub."});
    if(c.response!==1)return {cancelled:true};
    const current=maintenance.get(id);if(current.digest!==digest)throw Error("The reviewed source changed; approval expired.");
    return maintenance.merge(current.id,true);
  });
  handle("checkForUpdates", () => updater.check());
  handle("installUpdate", async () => {
    const idle = () => !agent.active && !agent.busy && !localVoiceActive && !remote?.voiceOwner && !desktop.broker.pending.size && !localReleases?.busy();
    if(updateInstalling || !idle()) throw Error("Pause current work and end voice before installing an update.");
    if(!app.isPackaged || process.platform!=="darwin" || process.arch!=="arm64") throw Error("Automatic installation is available in the packaged Apple Silicon app.");
    const release=updater.state.release;
    if(!release || updater.state.phase!=="available") throw Error("Check for a verified update first.");
    updateInstalling=true;
    let updateStage:string|undefined;
    try {
      const choice=await dialog.showMessageBox(window,{type:"question",buttons:["Cancel","Download and restart"],defaultId:0,cancelId:0,title:"Install JARVIS "+release.version,message:"Install verified JARVIS "+release.version+"?",detail:release.notes+"\n\nSource: sultandilaram/jarvis\nCommit: "+release.commit+"\nThe app will restart and briefly disconnect your phone. The fixed vault must remain unchanged. Failed launch checks restore the previous app; completed external effects cannot be undone."});
      if(choice.response!==1)return {cancelled:true};
      if(!idle() || updater.state.release?.commit!==release.commit)throw Error("Work or the selected release changed; review the update again.");
      const prepared=await updater.download();
      updateStage=prepared.stage;
      if(!idle())throw Error("Work started during download. Pause it and check the update again before installing.");
      const application=resolve(app.getPath("exe"),"../../..");
      const helper=join(__dirname,"native/update-installer.cjs");
      const installer=createRequire(join(__dirname,"main.cjs"))(helper);
      const candidate=installer.prepare({...prepared,application});
      if(!idle())throw Error("Work started while preparing the update. Finish it before retrying.");
      const nonce=randomUUID(),health=join(prepared.stage,"health.json"),result=join(data,"Updates","last-result.json");
      const plan=join(prepared.stage,"install.json");
      writeFileSync(plan,JSON.stringify({...candidate,application,version:prepared.version,parentPid:process.pid,health,nonce,result,cleanupStage:prepared.stage}),{mode:0o600,flag:"wx"});
      const child=spawn(process.execPath,[helper,plan],{env:{...process.env,ELECTRON_RUN_AS_NODE:"1"},detached:true,stdio:"ignore"});
      await new Promise<void>((resolve,reject)=>{child.once("spawn",resolve);child.once("error",reject);});
      child.unref();updateStage=undefined;app.quit();return {restarting:true};
    }catch(e){if(updateStage)rmSync(updateStage,{recursive:true,force:true});updater.change({phase:"available",error:(e as Error).message});throw e;}
    finally{updateInstalling=false;}
  });
  handle("monitorControl", (id: unknown, action: unknown) => {
    if (typeof id !== "string" || !["pause", "remove"].includes(String(action)))
      throw Error("Invalid monitor action");
    return monitors.control(id, action as any);
  });
  handle("jobEnqueue", (goal: unknown, profile: unknown, runAt: unknown) => {
    if (
      typeof goal !== "string" ||
      !["desktop", "project"].includes(String(profile))
    )
      throw Error("Invalid job");
    const job = jobs.enqueue({
      goal,
      profile: String(profile),
      runAt: typeof runAt === "string" ? runAt : undefined,
    });
    job.operatorResearchText = goal;
    jobs.save(job);
    return job;
  });
  handle("jobControl", (id: unknown, action: unknown) => {
    if (
      typeof id !== "string" ||
      !["resume", "pause", "cancel"].includes(String(action))
    )
      throw Error("Invalid job action");
    return jobs.control(id, action as any);
  });
  handle("jobOpen", async (id: unknown) => {
    if (typeof id !== "string") throw Error("Invalid job");
    const j = jobs.get(id);
    if (!j || j.profile !== "project") throw Error("Project job not found");
    await shell.openPath(j.workspace);
  });
  handle("watchEnableTasks", async (phoneId: unknown) => {
    if (typeof phoneId !== "string") throw Error("Choose a phone");
    const plan = await watches.plan("watch.tasks", { phoneId });
    await plan.verify?.();
    return plan.run(new AbortController().signal);
  });
  handle("watchAcknowledge", (id: unknown) => {
    if (typeof id !== "string") throw Error("Invalid update");
    return watches.ack(id);
  });
  handle("watchRemove", (id: unknown) => {
    if (typeof id !== "string") throw Error("Invalid watch");
    return watches.remove(id);
  });
  handle("watchPauseAll", () => watches.pauseAll());
  handle("remoteStart", () => remote.start());
  handle("remoteConfigurePermanent", (value: unknown) =>
    remote.configurePermanent(value),
  );
  handle("remoteQR", () => remote.refreshQR());
  handle("remoteDisable", () => remote.disable());
  handle("remotePair", (id: unknown, accept: unknown) => {
    if (typeof id !== "string" || typeof accept !== "boolean")
      throw Error("Invalid pairing decision");
    return remote.gateway.decide(id, accept);
  });
  handle("remoteRevoke", (id: unknown) => {
    if (typeof id !== "string") throw Error("Invalid phone");
    return remote.gateway.revoke(id);
  });
  handle("remoteConfigurePush", () => remote.configurePush());
  handle("remoteNotify", () =>
    remote.notify("JARVIS is ready to speak with you, sir."),
  );
  handle("desktopPermissions", async () => {
    showWindow();
    systemPreferences.isTrustedAccessibilityClient(true);
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    );
    return "Enable JARVIS under Accessibility, then ask JARVIS to inspect an app.";
  });
  handle("revokeFolder", (root: unknown) => {
    if (agent.active)
      throw Error("Stop the active task before revoking a folder.");
    if (typeof root !== "string") throw Error("Invalid folder.");
    desktop.saveRoots(desktop.roots().filter((r) => r !== root));
    agent.publish();
  });
  handle("quit", () => {
    setImmediate(() => app.quit());
  });
  handle("voiceActivity", (active: unknown) => {
    if (typeof active !== "boolean")
      throw new Error("Invalid voice activity state.");
    if (active && remote?.voiceOwner)
      throw Error("The phone already has an active voice conversation.");
    localVoiceActive = active;
    wake.setVoiceActive(active || !!remote?.voiceOwner);
  });
  handle("browserSurface",(active:unknown)=>{if(typeof active!=="boolean")throw Error("Invalid browser surface.");desktop.browser.surface(active);});
  handle("browserLayout",(bounds:unknown)=>desktop.browser.layout(bounds as import("./desktop/browser.ts").BrowserBounds));
  handle("browserAction",async(action:unknown,id:unknown,value:unknown)=>{
    if(action==="new")return {tabId:desktop.browser.create(true)};
    if(typeof id!=="string")throw Error("Choose a browser tab.");
    if(action==="activate")return desktop.browser.activate(id);
    if(action==="close")return desktop.browser.close(id);
    if(action==="navigate"){if(typeof value!=="string")throw Error("Enter a page address.");return desktop.browser.navigate(id,value);}
    if(action==="take-control")return desktop.browser.takeControl(id);
    if(action==="resume")return desktop.browser.resume(id);
    if(["back","forward","reload","stop"].includes(String(action)))return desktop.browser.control(id,String(action));
    if(action==="popup"){const target=desktop.browser.state().tabs.find(t=>t.id===id)?.popup;if(!target)throw Error("No blocked popup for this tab.");desktop.browser.takeControl(id);const tabId=desktop.browser.create(true);await desktop.browser.navigate(tabId,target);return {tabId};}
    throw Error("Unknown browser action.");
  });
  handle("subagentCancel",(id:unknown)=>{if(typeof id!=="string")throw Error("Choose a subagent.");delegations.cancel(id);return delegations.ownerResult(id);});
  handle("subagentRead",(id:unknown)=>delegations.ownerResult(id));
  handle("send", (text: unknown) => {
    if (typeof text !== "string") throw new Error("Invalid message.");
    return jobs.send(text);
  });
  agent.on("state", () => {
    if (agent.stopping) desktop.browser.stop();
    if(agent.approvals.size)desktop.browser.surface(false);
  });
  handle("stop", stop);
  handle("stopCurrent", stopCurrent);
  handle("newConversation", () => agent.newConversation());
  handle("approve", (id, accept) => {
    if (typeof accept !== "boolean") throw new Error("Invalid approval.");
    return agent.approve(id, accept);
  });
  handle("answer", (id, answers) => agent.answer(id, answers));
  handle("fullscreen", () => window.setFullScreen(!window.isFullScreen()));
  handle("readFile", async () => {
    if (agent.active || agent.busy || agent.stopping)
      throw new Error(
        "Finish or stop the active task before reading a local file.",
      );
    const generation = agent.epoch;
    agent.busy = true;
    try {
      const result = await dialog.showOpenDialog(window, {
        title: "Choose a text file for JARVIS to read",
        properties: ["openFile"],
        buttonLabel: "Read file",
      });
      if (result.canceled || generation !== agent.epoch) return;
      const read = await readSelectedFile(result.filePaths[0]);
      if (generation !== agent.epoch) return;
      const task = store.task(`Read ${read.path}`, null);
      store.updateTask(task.id, { status: "completed" });
      store.entry(
        "assistant",
        `File read verified\n${read.path}\n${read.bytes} bytes · SHA-256 ${read.sha256}\n\n${read.text}`,
        task.id,
      );
      agent.publish();
    } finally {
      agent.busy = false;
      agent.publish();
    }
  });
  handle("settings", async(patch: Partial<Settings>) => {
    if (!patch || typeof patch !== "object")
      throw new Error("Invalid settings.");
    if(patch.publicResearchEnabled===true && !store.settings().publicResearchEnabled){
      configurationIdle();
      const choice=await dialog.showMessageBox(window,{type:"warning",buttons:["Cancel","Allow public research"],defaultId:0,cancelId:0,title:"Allow automatic public research",message:"Let JARVIS research your requests without reviewing each search?",detail:"In Autopilot, search terms from your own task requests (including names and details you provide), plus neutral research words, can be sent to DuckDuckGo. JARVIS may read observed public result links in fresh tabs. This uses the separate JARVIS browser session; website cookies may apply. Files, account contents and retrieved pages cannot extend the automatic query vocabulary. New query terms, existing signed-in tabs, account/login pages, forms and consequential actions still need review. This permission applies to tasks until you turn it off. Stop and corrections revoke current research. Excerpts remain data for the task model, not instructions; this setting is a standing research permission, not an English-command detector."});
      if(choice.response!==1)return {cancelled:true};
      configurationIdle();
    }
    const next = store.settings();
    if(typeof patch.publicResearchEnabled==="boolean" && patch.publicResearchEnabled!==!!next.publicResearchEnabled){desktop.stop();researchPermissionEpoch++;next.publicResearchEnabled=patch.publicResearchEnabled;}
    if(typeof patch.subagentsEnabled === "boolean") next.subagentsEnabled=patch.subagentsEnabled;
    if (patch.approvalMode === "always" || patch.approvalMode === "critical") {
      if (next.approvalMode !== patch.approvalMode) {desktop.stop();researchPermissionEpoch++;}
      next.approvalMode = patch.approvalMode;
    }
    if (liveVoices.includes(patch.voiceName as any))
      next.voiceName = patch.voiceName!;
    for (const k of ["routineChecks", "speakReplies", "keepAvailable"] as const)
      if (typeof patch[k] === "boolean") next[k] = patch[k]!;
    if (["live", "realtime"].includes(patch.voiceProvider!))
      next.voiceProvider = patch.voiceProvider!;
    if (
      typeof patch.voiceModel === "string" &&
      /^[a-zA-Z0-9._-]{1,100}$/.test(patch.voiceModel)
    )
      next.voiceModel = patch.voiceModel;
    if (typeof patch.wakeWordEnabled === "boolean")
      next.wakeWordEnabled = patch.wakeWordEnabled;
    if (typeof patch.startAtLogin === "boolean") {
      setLogin(patch.startAtLogin);
      next.startAtLogin = patch.startAtLogin;
    }
    if (
      typeof patch.voiceIdleSeconds === "number" &&
      [15, 20, 30, 60].includes(patch.voiceIdleSeconds)
    )
      next.voiceIdleSeconds = patch.voiceIdleSeconds;
    store.set("settings", next);
    if(!next.subagentsEnabled)delegations.cancelAll("Read-only subagents were disabled.");
    availability.update(!!next.keepAvailable, powerMonitor.isOnBatteryPower());
    if (wake.enabled !== next.wakeWordEnabled)
      wake.configure(next.wakeWordEnabled);
    refreshTray();
    agent.publish();
  });
  handle("remember", (text, kind) => {
    if (
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 4000 ||
      !["confirmed", "inferred"].includes(kind)
    )
      throw new Error("Invalid memory.");
    store.remember(text.trim(), kind);
    agent.publish();
  });
  handle("forget", (id) => {
    if (typeof id === "string") store.forget(id);
    agent.publish();
  });
  handle("saveKey", async (key: unknown) => {
    if (typeof key !== "string" || key.length > 1000)
      throw new Error("Invalid key.");
    if (!key.trim()) {
      if (existsSync(keyPath)) unlinkSync(keyPath);
      cachedApiKey = "";
      agent.publish();
      return;
    }
    if (app.commandLine.hasSwitch("use-mock-keychain"))
      throw new Error(
        "Use the packaged app or npm start to save API credentials. Test launchers cannot save keys.",
      );
    writeEncrypted(keyPath, await encryptSecret(key.trim()));
    cachedApiKey = key.trim();
    store.set(
      "credentialStorage",
      usesFixedVault() ? "macos-local-vault" : "macos-keychain",
    );
    agent.publish();
  });
  handle("voiceEvent", (event: VoiceEvent) => {
    const kinds = [
      "session",
      "microphone",
      "input",
      "output",
      "delegation",
      "dispatch",
      "steer",
      "approval",
      "stop",
      "usage",
      "error",
      "transport",
    ];
    if (
      !event ||
      !kinds.includes(event.kind) ||
      typeof event.sessionId !== "string" ||
      event.sessionId.length > 100 ||
      typeof event.detail !== "string" ||
      event.detail.length > 4000
    )
      throw new Error("Invalid voice diagnostic.");
    store.voiceEvent({ ...event, createdAt: new Date().toISOString() });
  });
  handle("voiceDiagnostics", () => store.voiceDiagnostics());
  handle("checkVoice", async () => {
    const key = await unlockedApiKey();
    if (!key)
      throw new Error(
        "Add an OpenAI project API key first. Codex sign-in does not establish voice API access or billing.",
      );
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok)
      throw new Error(
        `API access check failed (${r.status}). Check your key and project permissions.`,
      );
    const data = (await r.json()) as any;
    return data.data
      .map((m: any) => m.id)
      .filter((id: string) => /live|realtime/.test(id));
  });
  handle("voiceConnect", (sdp: unknown) => {
    if (remote?.voiceOwner)
      throw Error("The phone has an active voice conversation.");
    return createVoiceConnection(sdp);
  });
  globalShortcut.register("CommandOrControl+Shift+.", () => {
    void stop().catch((e) => agent.setError(e));
  });
  await window.loadFile(join(__dirname, "index.html"));
  updater.state.error = (()=>{try{const r=JSON.parse(readFileSync(join(data,"Updates/last-result.json"),"utf8"));return r.status!=="installed"?r.error:undefined;}catch{return undefined;}})();
  updateTimer=setInterval(()=>void updater.check(),6*60*60*1000);
  if(app.isPackaged)void updater.check();
  agent.publish();
  window.setFullScreen(!background && !process.argv.includes("--windowed"));
  if (background) app.dock?.hide();
  wake.configure(store.settings().wakeWordEnabled);
  if (
    app.isPackaged &&
    store.settings().startAtLogin &&
    !loginState().enabled
  ) {
    try {
      setLogin(true);
    } catch (error) {
      store.entry("system", `Login startup failed: ${String(error)}`);
    }
  }
  void agent.connect();
  void remote.restore().catch((error) => {
    if (!isQuitting) {
      store.entry(
        "system",
        error instanceof Error
          ? error.message
          : "Permanent mobile connection could not start.",
      );
      agent.publish();
    }
  });
});
app.on("window-all-closed", () => {});
app.on("before-quit", () => {
  if (isQuitting) return;
  isQuitting = true;
  clearInterval(updateTimer);
  clearInterval(githubTimer);
  google?.cancel();
  localReleases?.stop();
  availability?.close();
  monitors?.close();
  jobs?.close();
  delegations?.close();
  clearInterval(jobsTimer);
  watches?.close();
  clearInterval(watchTimer);
  agent?.removeAllListeners();
  agent?.codex.removeAllListeners();
  remote?.removeAllListeners();
  wake?.removeAllListeners();
  remote?.close();
  wake?.close();
  tray?.destroy();
  globalShortcut.unregisterAll();
  desktop?.broker.removeAllListeners();
  desktop?.stop();
  desktop?.browser.destroy();
  extensions?.close();
  providers?.cancelTest();
  agent?.codex.close();
});
app.once("will-quit", () => {
  store?.close();
});
