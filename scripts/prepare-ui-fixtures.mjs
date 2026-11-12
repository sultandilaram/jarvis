import { build } from "esbuild";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const base = resolve(".jarvis/ui-test");
for (const part of ["desktop/brand", "mobilebundle", "captures"])
  await mkdir(join(base, part), { recursive: true });
await build({
  entryPoints: ["src/renderer/app.tsx"],
  plugins:
    process.env.JARVIS_VOICE_FIXTURE === "1"
      ? [
          {
            name: "offline-voice-fixture",
            setup(build) {
              build.onLoad({ filter: /src\/renderer\/voice\.ts$/ }, () => ({
                loader: "js",
                contents: `
        export class Voice {
          constructor(update) { this.update=update; this.state="off"; window.__voiceCounters={connects:0,disconnects:0}; window.__voiceFixture=(state,caption)=>{this.state=state;update(state,caption)}; }
          observe() {}
          async connect() { window.__voiceCounters.connects++; this.state="listening"; this.update("listening"); }
          disconnect() { window.__voiceCounters.disconnects++; this.state="off"; this.update("off"); }
        }
      `,
              }));
            },
          },
        ]
      : [],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome140",
  outfile: join(base, "desktop/app.js"),
});
await copyFile("src/renderer/index.html", join(base, "desktop/index.html"));
for (const n of ["jarvis-icon.png", "jarvis-64.png"])
  await copyFile("assets/brand/" + n, join(base, "desktop/brand", n));
await build({
  entryPoints: ["mobile/web/app.tsx"],
  plugins: process.env.JARVIS_CALL_FIXTURE === "1" ? [{name: "offline-call-voice", setup(build) {
    build.onLoad({filter: /src\/renderer\/voice\.ts$/}, () => ({loader: "js", contents: `
      export class Voice {
        constructor(update, fail, diagnostic, bridge) { this.update=update;this.bridge=bridge;this.closed=true;this.state="off";window.__voice=this; }
        observe() {} context() {} setMuted(value) {this.muted=value;}
        async connect() {this.disconnect();this.closed=false;this.state="connecting";this.update("connecting");await this.bridge.voiceActivity(true);this.state="listening";this.update("listening","How may I help?");}
        disconnect() {const active=!this.closed;this.closed=true;this.state="off";this.update("off");if(active)void this.bridge.voiceActivity(false);}
      }
    `}));
  }}] : [],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome100",
  outfile: join(base, "mobilebundle/app.js"),
});
for (const [a, b] of [
  ["mobile/web/index.html", "index.html"],
  ["mobile/web/style.css", "style.css"],
  ["assets/brand/jarvis-icon.png", "logo.png"],
])
  await copyFile(a, join(base, "mobilebundle", b));
const state = {
  watches:{watches:[],updates:[]},
  jobs:[],monitors:[],
  status: "ready",
  error: null,
  model: "Fixture model",
  workspace: "/Synthetic/Workspace",
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
    wakeWordEnabled: true,
    startAtLogin: false,
    voiceIdleSeconds: 20,
  },
  hasApiKey: process.env.JARVIS_VOICE_FIXTURE === "1",
  activeTaskId: null,
  background: {
    wake: {
      state: "listening",
      detail: "Listening locally for Hey JARVIS.",
      lastWakeAt: null,
    },
    login: { enabled: false, status: "not enabled" },
  },
  desktop: {
    roots: ["/Synthetic/Workspace"],
    accessibility: false,
    capabilities: [
      "App launch",
      "Accessibility inspect / press / text",
      "Dedicated browser",
      "Granted UTF-8 files",
    ],
  },
  remote: {
    running: false,
    starting: false,
    url: "",
    error: null,
    qrDataURL: "",
    qrExpires: 0,
    pushConfigured: false,
    voiceActive: false,
    phones: [],
    pending: null,
  },
};
await writeFile(
  join(base, "desktop/preload.cjs"),
  `const base=${JSON.stringify(state)};let state=structuredClone(base);const listeners=new Set();const emit=()=>listeners.forEach(f=>f(structuredClone(state)));window.__critiqueSeed=(mode)=>{state=structuredClone(base);if(mode==='maintenance'){state.updates={current:'0.6.0',repository:'sultandilaram/jarvis',phase:'available',release:{version:'0.6.1',notes:'Fix background task recovery and improve progress details.',commit:'abc123'.repeat(6)+'abcd',size:220000000}};state.maintenance={mode:'local',githubConfigured:false,pulls:[],proposals:[{id:'proposal1',goal:'Improve recovery details',state:'owner_review',digest:'abc123',checks:['typecheck','test','build'],changes:[{path:'src/main/jobs.ts',sensitive:true}]}]};}if(mode==='jobs'){state.jobs=[{id:'j1',goal:'Build the report generator',profile:'project',workspace:'/Synthetic/Jobs/j1',state:'interrupted',createdAt:Date.now(),updatedAt:Date.now(),checkpoint:'Source imported; tests still pending.',error:'JARVIS restarted. Review progress before resuming.',activeMs:60000,maxActiveMinutes:30,toolCalls:12,maxToolCalls:150}];state.monitors=[{id:'m1',kind:'url',target:'https://example.com/releases',condition:'changed',goal:'Summarize release changes',intervalSeconds:300,maxRuns:1,runs:0,enabled:true,baseline:'fixture',lastMatched:false,lastCheck:Date.now()}];}if(mode==='question'){state.status='approval';state.activeTaskId='task1';state.approvals=[{id:'question1',method:'item/tool/requestUserInput',params:{questions:[{id:'folder',question:'Which folder should I use?'}]}}];}if(mode==='watch'){state.watches={watches:[{id:'watch1',symbol:'SOL',dropPercent:5,windowMinutes:15,phoneId:'p',phoneName:'Fixture phone',enabled:false,createdAt:Date.now(),samples:[]}],updates:[{id:'update1',watchId:'watch1',text:'Synthetic SOL price alert: threshold reached.',createdAt:Date.now(),dueAt:Date.now()+3600000,phoneId:'p',phoneName:'Fixture phone',state:'waiting'}]};state.remote.phones=[{id:'p',name:'Fixture phone',alertsEnabled:true,online:false}];}if(mode==='conversation'||mode==='approval'||mode==='working'){state.tasks=[{id:'task1',title:'Create meeting-notes.txt',status:mode==='conversation'?'completed':'working',threadId:'fixture',turnId:'fixture',createdAt:new Date().toISOString()}];state.entries=[{id:'e1',taskId:'task1',role:'user',text:'Create meeting-notes.txt in my Workspace containing Agenda: review the prototype.',createdAt:new Date().toISOString()},{id:'e2',taskId:'task1',role:'assistant',text:mode==='conversation'?'Created meeting-notes.txt and verified its contents: Agenda: review the prototype.':'I will create meeting-notes.txt after you review the exact path and content.',createdAt:new Date().toISOString()}];}if(mode==='approval'){state.status='approval';state.activeTaskId='task1';state.approvals=[{id:'desktop:77',method:'jarvis/desktop/requestApproval',params:{title:'Write meeting-notes.txt',voiceId:77,reason:'Create a new text file in the granted Workspace.',preview:{path:'/Synthetic/Workspace/meeting-notes.txt',before:null,after:'Agenda: review the prototype.'}}}];}if(mode==='working'){state.status='working';state.activeTaskId='task1';}if(mode==='error'){state.status='error';state.error='The desktop link disconnected. Reconnect to continue.';}emit();};window.jarvis={checkForUpdates:async()=>{window.__updateChecks=(window.__updateChecks||0)+1;if(window.__updateFailure){state.updates.phase='error';state.updates.error='No public release is available yet.';}emit()},installUpdate:async()=>{window.__installReviews=(window.__installReviews||0)+1},maintenanceReview:async id=>({id,goal:'Improve recovery details',digest:'abc123',review:'Separate reviewer confirmed all three checks on the submitted snapshot.',changes:[{path:'src/main/jobs.ts',before:'old verified source',after:'new reviewed source'}]}),maintenanceMerge:async(id,digest)=>{window.__sourceMerge={id,digest};state.maintenance.proposals[0].state='merged';emit()},jobEnqueue:async(goal,profile,runAt)=>{window.__jobRecords=(window.__jobRecords||[]).concat({goal,profile,runAt});state.jobs.unshift({id:'j2',goal,profile,workspace:'/Synthetic/Jobs/j2',state:'queued',createdAt:Date.now(),updatedAt:Date.now(),activeMs:0,maxActiveMinutes:30,toolCalls:0,maxToolCalls:150,notBefore:runAt?Date.parse(runAt):undefined});emit()},jobControl:async(id,action)=>{window.__jobControl={id,action};if(action==='resume')state.jobs.find(j=>j.id===id).error=undefined;state.jobs.find(j=>j.id===id).state=action==='resume'?'queued':action==='pause'?'paused':'cancelled';emit()},jobOpen:async()=>{},monitorControl:async(id,action)=>{state.monitors=action==='remove'?state.monitors.filter(m=>m.id!==id):state.monitors.map(m=>({...m,enabled:false}));emit()},watchAcknowledge:async id=>{const u=state.watches.updates.find(u=>u.id===id);u.acknowledgedAt=Date.now();u.state='cancelled';emit()},watchRemove:async id=>{state.watches.watches=state.watches.watches.filter(w=>w.id!==id);emit()},watchPauseAll:async()=>{state.watches.watches.forEach(w=>w.enabled=false);state.watches.updates.forEach(u=>u.state='cancelled');emit()},watchEnableTasks:async id=>{state.watches.taskPhone={id,name:'Fixture phone'};emit()},snapshot:async()=>structuredClone(state),onState:f=>{listeners.add(f);return()=>listeners.delete(f)},onWake:()=>()=>{},onStop:()=>()=>{},voiceActivity:async()=>{},voiceEvent:async()=>{},voiceDiagnostics:async()=>[],voiceConnect:async()=>{throw Error('Critique fixture: paid calls disabled.')},send:async()=>{},stop:async()=>{state.activeTaskId=null;state.status='ready';state.approvals=[];emit()},newConversation:async()=>window.__critiqueSeed('empty'),approve:async()=>{},answer:async(id,answers)=>{window.__answerRecords={id,answers};state.approvals=[];state.status='working';emit()},readFile:async()=>{},settings:async p=>{state.settings={...state.settings,...p};emit()},saveKey:async()=>{throw Error('Critique fixture: credentials disabled.')},checkVoice:async()=>[],remember:async()=>{},forget:async()=>{},fullscreen:async()=>{},remoteStart:async()=>{},remoteQR:async()=>{},remoteDisable:async()=>{},remotePair:async()=>{},remoteRevoke:async()=>{},remoteConfigurePush:async()=>{},remoteNotify:async()=>({}),desktopPermissions:async()=>'',revokeFolder:async()=>{},quit:async()=>{}};`,
);
await writeFile(
  join(base, "desktop-main.cjs"),
  `const {app,BrowserWindow}=require('electron');app.setName('JARVIS Critique Desktop');app.setPath('userData',${JSON.stringify(join(base, "desktop-profile"))});app.whenReady().then(()=>{const w=new BrowserWindow({width:1440,height:940,webPreferences:{preload:${JSON.stringify(join(base, "desktop/preload.cjs"))},contextIsolation:false,nodeIntegration:false}});w.loadFile(${JSON.stringify(join(base, "desktop/index.html"))});});app.on('window-all-closed',()=>app.quit());`,
);
let mobile = await readFile("scripts/mobile-fixture.ts", "utf8");
mobile = mobile
  .replace(
    "resolve('.jarvis/mobile-render-profile')",
    JSON.stringify(join(base, "mobile-profile")),
  )
  .replace("'JARVIS Mobile UI Test'", "'JARVIS Critique Mobile'")
  .replace(
    "resolve('.jarvis/mobile-render-fixture')",
    JSON.stringify(join(base, "mobile")),
  )
  .replace(
    "'mobile/android/app/src/main/assets'",
    JSON.stringify(join(base, "mobilebundle")),
  )
  .replace(
    "'mobile/web/index.html'",
    JSON.stringify(join(base, "mobilebundle/index.html")),
  );
await build({
  stdin: { contents: mobile, resolveDir: resolve("scripts"), loader: "ts" },
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  outfile: join(base, "mobile-main.cjs"),
  target: "node24",
});
console.log(base);
