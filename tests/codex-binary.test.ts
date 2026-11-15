import {test} from 'node:test';
import assert from 'node:assert/strict';
import {windowsCodexBinary,windowsManagedCodexBinary} from '../src/main/codex-binary.ts';
import {win32} from 'node:path';
test('Windows Codex discovery uses native executables and ignores current directory and command wrappers',()=>{
  assert.throws(()=>windowsCodexBinary({PATH:'.;relative'},()=>true),/not found/);
  assert.throws(()=>windowsCodexBinary({JARVIS_CODEX_PATH:'C:\\Tools\\codex.cmd'},()=>true),/native codex.exe/);
  assert.equal(windowsCodexBinary({PATH:'C:\\Tools'},p=>p==='C:\\Tools\\codex.exe'),'C:\\Tools\\codex.exe');
  assert.throws(()=>windowsCodexBinary({JARVIS_CODEX_PATH:'codex.exe'},()=>true));
});
test('Windows desktop runtime discovery handles versioned caches without PATH or a shell',()=>{
  const env={LOCALAPPDATA:'C:\\Users\\Tester\\AppData\\Local'},root=win32.join(env.LOCALAPPDATA,'OpenAI','Codex','bin');
  const old='1111111111111111',latest='9e1da79431da526b';
  const files=new Map<string,{directory:boolean;file:boolean;link:boolean;modified:number}>();
  const dir={directory:true,file:false,link:false,modified:0},file={directory:false,file:true,link:false,modified:1};
  let current='C:\\';files.set(current,dir);
  for(const part of root.slice(3).split('\\')){current=win32.join(current,part);files.set(current,dir);}
  for(const name of [old,latest]){files.set(win32.join(root,name),dir);files.set(win32.join(root,name,'codex.exe'),{...file,modified:name===latest?2:1});}
  const reads:string[]=[];
  const io={list:(p:string)=>{assert.equal(p,root);return [old,latest,'..','codex.cmd','unexpected-version'];},info:(p:string)=>{reads.push(p);const s=files.get(p);if(!s)throw Error('Missing');return s;}};
  const expected=win32.join(root,latest,'codex.exe');
  assert.equal(windowsManagedCodexBinary(env,io),expected);
  assert.ok(!reads.some(p=>p.endsWith('codex.cmd')||p.includes('WindowsApps')));
  assert.equal(windowsCodexBinary(env,()=>false,e=>windowsManagedCodexBinary(e,io)),expected);
  // Explicit selection and PATH retain priority over automatic cache discovery.
  const forbidden=()=>{throw Error('Managed lookup must not run');};
  assert.equal(windowsCodexBinary({JARVIS_CODEX_PATH:'C:\\Tools\\codex.exe'},()=>true,forbidden),'C:\\Tools\\codex.exe');
  assert.equal(windowsCodexBinary({PATH:'C:\\Tools',...env},()=>true,forbidden),'C:\\Tools\\codex.exe');
  // A junction anywhere in the known root is refused before enumeration.
  files.set(win32.join(env.LOCALAPPDATA,'OpenAI'),{...dir,link:true});
  assert.equal(windowsManagedCodexBinary(env,{...io,list:()=>{throw Error('Must not enumerate');}}),undefined);
  files.set(win32.join(env.LOCALAPPDATA,'OpenAI'),dir);
  files.set(win32.join(root,latest),{...dir,link:true});
  assert.equal(windowsManagedCodexBinary(env,io),win32.join(root,old,'codex.exe'));
  files.set(win32.join(root,old,'codex.exe'),{...file,link:true});
  assert.equal(windowsManagedCodexBinary(env,io),undefined);
  assert.equal(windowsManagedCodexBinary(env,{...io,list:()=>Array(257).fill(old)}),undefined);
});
test('Managed runtime discovery rejects network, device and malformed roots before I/O',()=>{
  const io={list:()=>{throw Error('Unexpected I/O');},info:()=>{throw Error('Unexpected I/O');}};
  for(const value of [undefined,'relative','\\\\server\\share','\\\\?\\C:\\a','C:\\a:stream','C:\\NUL']){
    assert.equal(windowsManagedCodexBinary({LOCALAPPDATA:value},io),undefined);
  }
});
