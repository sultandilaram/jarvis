import {statSync,lstatSync,readdirSync} from 'node:fs';
import {win32} from 'node:path';
import {windowsLocalPath} from './desktop/windows-paths.ts';

type ManagedRuntimeIO={
  list:(path:string)=>string[];
  info:(path:string)=>{directory:boolean;file:boolean;link:boolean;modified:number};
};
const managedRuntimeIO:ManagedRuntimeIO={
  list:path=>readdirSync(path),
  info:path=>{const s=lstatSync(path);return {directory:s.isDirectory(),file:s.isFile(),link:s.isSymbolicLink(),modified:s.mtimeMs};},
};
// The desktop app installs its native CLI in a versioned per-user cache, which
// need not be on PATH. Read only this known layout; never enumerate WindowsApps,
// follow junctions, invoke a shell, or persist a path containing an update hash.
export function windowsManagedCodexBinary(env:NodeJS.ProcessEnv,io:ManagedRuntimeIO=managedRuntimeIO):string|undefined {
  if(!env.LOCALAPPDATA)return;
  let root:string;
  try{root=win32.join(windowsLocalPath(env.LOCALAPPDATA),'OpenAI','Codex','bin');}catch{return;}
  try {
    let current=win32.parse(root).root;
    const drive=io.info(current);if(drive.link||!drive.directory)return;
    for(const part of root.slice(current.length).split('\\').filter(Boolean)){
      current=win32.join(current,part);const s=io.info(current);
      if(s.link||!s.directory)return;
    }
    const names=io.list(root);
    if(names.length>256)return; // Unexpected layout; request explicit selection.
    const candidates:{path:string;modified:number}[]=[];
    for(const name of names){
      if(!/^[a-f0-9]{16,64}$/i.test(name))continue;
      try {
        const directory=win32.join(root,name),d=io.info(directory);
        if(d.link||!d.directory)continue;
        const path=win32.join(directory,'codex.exe'),s=io.info(path);
        if(s.link||!s.file||!Number.isFinite(s.modified))continue;
        candidates.push({path,modified:s.modified});
      }catch{/* An update may be creating/removing a runtime. */}
    }
    candidates.sort((a,b)=>b.modified-a.modified||a.path.localeCompare(b.path));
    return candidates[0]?.path;
  }catch{return;}
}
export function windowsCodexBinary(env:NodeJS.ProcessEnv=process.env,exists:(p:string)=>boolean=p=>{try{return statSync(p).isFile();}catch{return false;}},managed:(env:NodeJS.ProcessEnv)=>string|undefined=windowsManagedCodexBinary):string {
  if(env.JARVIS_CODEX_PATH){const p=env.JARVIS_CODEX_PATH;if(!win32.isAbsolute(p)||!p.toLowerCase().endsWith('.exe')||!exists(p))throw Error('JARVIS_CODEX_PATH must select an installed native codex.exe. Command scripts are not executed.');return p;}
  const paths=(env.PATH||env.Path||'').split(';').map(p=>p.replace(/^"|"$/g,'' )).filter(p=>win32.isAbsolute(p)&&!p.startsWith('\\\\'));
  for(const directory of paths){
    const candidates=[win32.join(directory,'codex.exe'),win32.join(directory,'node_modules','@openai','codex','vendor','x86_64-pc-windows-msvc','codex','codex.exe'),win32.join(directory,'node_modules','@openai','codex','node_modules','@openai','codex-win32-x64','vendor','x86_64-pc-windows-msvc','codex','codex.exe')];
    for(const p of candidates)if(exists(p))return p;
  }
  const installed=managed(env);if(installed)return installed;
  throw Error('Native Windows codex.exe was not found. Install Codex CLI or set JARVIS_CODEX_PATH to its absolute executable path, then restart JARVIS.');
}
