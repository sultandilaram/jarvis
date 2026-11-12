import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const {validateArchive,install}=createRequire(import.meta.url)('../scripts/release/installer.cjs');
function zip(entries:{name:string,target?:string}[]){const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const e of entries){const name=Buffer.from(e.name),data=Buffer.from(e.target||''),h=Buffer.alloc(30),c=Buffer.alloc(46);h.writeUInt32LE(0x04034b50);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(name.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(((e.target?0o120777:0o100644)*65536)>>>0,38);c.writeUInt32LE(offset,42);local.push(h,name,data);central.push(c,name);offset+=30+name.length+data.length;}
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);}
test('update archives reject traversal, external links and writes through links',()=>{
 const base={name:'JARVIS.app/Contents/Info.plist'};
 validateArchive(zip([base]));
 for(const name of ['../outside','/tmp/outside','JARVIS.app/../outside','JARVIS.app/Contents/../../../../outside','JARVIS.app\\outside'])assert.throws(()=>validateArchive(zip([base,{name}])));
 assert.throws(()=>validateArchive(zip([base,{name:'JARVIS.app/link',target:'/tmp'}])));
 assert.throws(()=>validateArchive(zip([base,{name:'JARVIS.app/a',target:'.'},{name:'JARVIS.app/dir/x',target:'../a/../outside'}])));
 assert.throws(()=>validateArchive(zip([base,{name:'JARVIS.app/Foo'},{name:'JARVIS.app/foo'}])));
 assert.throws(()=>validateArchive(zip([base,{name:'JARVIS.app/link',target:'../../outside'}])));
 assert.throws(()=>validateArchive(zip([base,{name:'JARVIS.app/link',target:'Contents'},{name:'JARVIS.app/link/file'}])));
});
function fixture(){const root=mkdtempSync(join(tmpdir(),'jarvis-install-')),application=join(root,'JARVIS.app'),candidate=join(root,'candidate.app');mkdirSync(application);mkdirSync(candidate);writeFileSync(join(application,'version'),'old');writeFileSync(join(candidate,'version'),'new');return {root,plan:{application,candidate,expected:'identity',version:'0.6.1',parentPid:0,health:join(root,'health.json'),nonce:'random-test-nonce',result:join(root,'result.json')},ports:{identity:()=> 'identity',verify:()=>{},copy:(a:string,b:string)=>cpSync(a,b,{recursive:true}),waitMs:5}};}
test('healthy update replaces only the app and records success',async()=>{const f=fixture();try{
 await install(f.plan,{...f.ports,open:()=>{writeFileSync(f.plan.health,JSON.stringify({version:f.plan.version,nonce:f.plan.nonce}));return async()=>{};}});
 assert.equal(readFileSync(join(f.plan.application,'version'),'utf8'),'new');assert.equal(JSON.parse(readFileSync(f.plan.result,'utf8')).status,'installed');
 }finally{rmSync(f.root,{recursive:true,force:true});}});
test('failed health check stops owned new process and restores the previous app',async()=>{const f=fixture();let stopped=false,reopened=false;try{
 await assert.rejects(install(f.plan,{...f.ports,open:(_app:string,args:string[])=>{if(args.includes('--background'))reopened=true;return async()=>{stopped=true;};}}));
 assert(stopped&&reopened);assert.equal(readFileSync(join(f.plan.application,'version'),'utf8'),'old');assert.equal(JSON.parse(readFileSync(f.plan.result,'utf8')).status,'rolled_back');
 }finally{rmSync(f.root,{recursive:true,force:true});}});
test('signing mismatch cannot replace the installed app',async()=>{const f=fixture();try{
 await assert.rejects(install(f.plan,{...f.ports,identity:()=> 'different'}));assert.equal(readFileSync(join(f.plan.application,'version'),'utf8'),'old');
 }finally{rmSync(f.root,{recursive:true,force:true});}});
