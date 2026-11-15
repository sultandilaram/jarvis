// An isolated software test: no running JARVIS instance, accounts or live IPC.
import { build } from "esbuild";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
const root = process.cwd(),
  dir = resolve(".jarvis/renderer-smoke"),
  receipt = join(dir, "result.json");
await mkdir(dir, { recursive: true });
await rm(receipt, { force: true });
const html = join(dir, "index.html");
await writeFile(
  html,
  `<!doctype html><meta charset="utf-8"><title>Isolated renderer recovery test</title><p id="status">Starting</p><script>
window.jarvis.onState(s=>{document.querySelector('#status').textContent=s.model;void window.jarvis.voiceEvent({test:'observed',revision:s.model,entries:s.entries.length,approvals:s.approvals.length});});
window.jarvis.snapshot().then(s=>{document.querySelector('#status').textContent=s.model;return window.jarvis.rendererReady();});
</script>`,
);
const code = `
import {app,BrowserWindow,ipcMain} from 'electron';
import {writeFileSync} from 'node:fs';
import {rendererWire,RendererPublisher} from ${JSON.stringify(join(root, "src/main/renderer-state.ts"))};
import {RendererRecovery} from ${JSON.stringify(join(root, "src/main/renderer-recovery.ts"))};
void (async()=>{
app.setName('JARVIS isolated renderer test');app.setPath('userData',${JSON.stringify(join(dir, "profile"))});
app.commandLine.appendSwitch('disable-gpu');
let win,phase=0,loads=0,sends=0,revision=0,crashes=0,done=false;const mainActionCounter=1;
const text='Synthetic activity — no owner data. '.repeat(1600);
const entries=Array.from({length:1000},(_,i)=>({id:String(i),role:'activity',taskId:'test',createdAt:'now',text}));
const state=()=>({status:'ready',model:String(revision),settings:{wakeWordEnabled:false},tasks:[],entries,approvals:[],memories:[],jobs:[]});
function finish(error){if(done)return;done=true;publisher?.pause();recovery?.close();writeFileSync(${JSON.stringify(receipt)},JSON.stringify({success:!error,error,loads,sends,crashes,revision,mainActionCounter,fullHistoryEntries:entries.length,fullHistoryChars:entries.length*text.length,wireBytes:Buffer.byteLength(rendererWire(state()))},null,2));app.exit(error?1:0);}
let publisher,recovery;setTimeout(()=>finish('Isolated renderer test timed out'),60000);
await app.whenReady();
win=new BrowserWindow({show:false,webPreferences:{preload:${JSON.stringify(join(root, "dist/preload.cjs"))},contextIsolation:true,nodeIntegration:false,sandbox:true,offscreen:true}});
publisher=new RendererPublisher(()=>rendererWire(state()),wire=>{sends++;win.webContents.send('jarvis:state',wire);},error=>finish(String(error)),30);
recovery=new RendererRecovery(()=>{void win.loadFile(${JSON.stringify(html)}).catch(error=>finish(String(error)));},()=>finish('Recovery exhausted'),()=>Date.now(),50);
win.webContents.on('render-process-gone',(_e,d)=>{crashes++;publisher.pause();recovery.gone(d.reason);});
ipcMain.handle('jarvis:snapshot',()=>rendererWire(state()));
ipcMain.handle('jarvis:rendererReady',()=>{loads++;publisher.resume();if(loads===1){for(let i=1;i<=20000;i++){revision=i;publisher.queue();}}return {ready:true};});
ipcMain.handle('jarvis:voiceEvent',(event,value)=>{if(event.sender!==win.webContents||value?.test!=='observed'||value.revision!=='20000')return;if(phase===0){phase=1;setTimeout(()=>win.webContents.forcefullyCrashRenderer(),80);}else if(loads===2&&crashes===1){if(mainActionCounter!==1||entries.length!==1000||sends>4)return finish('Action replay or coalescing regression');finish();}});
await win.loadFile(${JSON.stringify(html)});
})().catch(error=>{console.error(error);app.exit(1);});
`;
await build({
  stdin: {
    contents: code,
    resolveDir: root,
    sourcefile: "renderer-smoke.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  outfile: join(dir, "main.cjs"),
});
const electron = (await import("electron")).default;
const child = spawn(electron, [join(dir, "main.cjs")], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (b) => {
    if (output.length < 20000) output += b.toString();
  });
const exit = await new Promise((done, reject) => {
  child.on("error", reject);
  child.on("close", done);
});
let result;
try {
  result = JSON.parse(await readFile(receipt, "utf8"));
} catch {
  throw Error("Renderer smoke produced no receipt. " + output.slice(-2000));
}
if (exit !== 0 || !result.success)
  throw Error(
    "Renderer smoke failed: " +
      JSON.stringify(result) +
      " " +
      output.slice(-2000),
  );
console.log(JSON.stringify(result));
