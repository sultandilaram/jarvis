import {statSync} from 'node:fs';
import {win32} from 'node:path';
export function windowsCodexBinary(env:NodeJS.ProcessEnv=process.env,exists:(p:string)=>boolean=p=>{try{return statSync(p).isFile();}catch{return false;}}):string {
  if(env.JARVIS_CODEX_PATH){const p=env.JARVIS_CODEX_PATH;if(!win32.isAbsolute(p)||!p.toLowerCase().endsWith('.exe')||!exists(p))throw Error('JARVIS_CODEX_PATH must select an installed native codex.exe. Command scripts are not executed.');return p;}
  const paths=(env.PATH||env.Path||'').split(';').map(p=>p.replace(/^"|"$/g,'' )).filter(p=>win32.isAbsolute(p)&&!p.startsWith('\\\\'));
  for(const directory of paths){
    const candidates=[win32.join(directory,'codex.exe'),win32.join(directory,'node_modules','@openai','codex','vendor','x86_64-pc-windows-msvc','codex','codex.exe'),win32.join(directory,'node_modules','@openai','codex','node_modules','@openai','codex-win32-x64','vendor','x86_64-pc-windows-msvc','codex','codex.exe')];
    for(const p of candidates)if(exists(p))return p;
  }
  throw Error('Native Windows codex.exe was not found. Install Codex CLI or set JARVIS_CODEX_PATH to its absolute executable path, then restart JARVIS.');
}
