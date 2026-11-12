import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyManifest, verifyArtifact, newer, assetURL } from '../src/main/releases.ts';
import { ReleaseUpdater } from '../src/main/updater.ts';
const pair=generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({type:'spki',format:'pem'}).toString();
const data=Buffer.from('verified artifact');
const asset=(name:string)=>({name,size:data.length,sha256:createHash('sha256').update(data).digest('hex')});
function fixture(){return {schema:1,repository:'sultandilaram/jarvis',version:'0.6.1',commit:'a'.repeat(40),publishedAt:new Date().toISOString(),notes:'A verified fix.',dataSchema:1,assets:{macArm64:asset('JARVIS-macOS-AppleSilicon-0.6.1.zip'),android:asset('JARVIS-Android-0.6.1.apk')}};}
function check(m:any,current='0.6.0'){const bytes=Buffer.from(JSON.stringify(m));return verifyManifest(bytes,sign(null,bytes,pair.privateKey),current,publicKey,'0.6.1');}
test('release signatures bind repository, version, assets and compatible data format',()=>{
 const m=fixture();assert.equal(check(m).version,'0.6.1');
 const bytes=Buffer.from(JSON.stringify(m)),signature=sign(null,bytes,pair.privateKey);bytes[10]^=1;
 assert.throws(()=>verifyManifest(bytes,signature,'0.6.0',publicKey));
 for(const mutation of [{repository:'attacker/jarvis'},{version:'0.6.0'},{version:'0.6.1-preview'},{dataSchema:2},{commit:'main'},{publishedAt:'invalid'}])assert.throws(()=>check({...m,...mutation}));
 assert.throws(()=>check({...m,assets:{...m.assets,macArm64:{...m.assets.macArm64,name:'../../app.zip'}}}));
 assert.throws(()=>check({...m,assets:{...m.assets,macArm64:{...m.assets.macArm64,size:2**40}}}));
 assert.throws(()=>verifyManifest(Buffer.from(JSON.stringify(m)),Buffer.alloc(64),'0.6.0',publicKey));
 assert.throws(()=>assetURL('0.6.1','../evil.zip'));
 assert(newer('0.10.0','0.9.9'));assert(!newer('0.6.1','0.6.1'));assert.throws(()=>newer('01.6.1','0.6.0'));
});
test('artifact verification rejects changed bytes and mismatched length',()=>{
 verifyArtifact(data,asset('file'));
 assert.throws(()=>verifyArtifact(Buffer.from('changed artifact!'),asset('file')));
 assert.throws(()=>verifyArtifact(data,{...asset('file'),size:1}));
});
test('release check fails closed for absent releases and untrusted signatures',async()=>{
 const root=await mkdtemp(join(tmpdir(),'jarvis-update-'));
 try{
  const updater=new ReleaseUpdater('0.6.0',root,async()=>{throw Error('No public release is available yet.');});
  assert.equal((await updater.check()).phase,'error');await assert.rejects(updater.download());
  const raw=Buffer.from(JSON.stringify(fixture()));
  updater.fetchBytes=async(url)=>url.includes('/latest')?Buffer.from(JSON.stringify({tag_name:'v0.6.1'})):url.endsWith('release.json')?raw:sign(null,raw,pair.privateKey);
  assert.equal((await updater.check()).phase,'error');assert.equal(updater.manifest,undefined);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('verified metadata supports current Mac / older Android and downloaded bytes are rechecked',async()=>{
 const root=await mkdtemp(join(tmpdir(),'jarvis-verified-update-'));
 const raw=Buffer.from(JSON.stringify(fixture())),sig=sign(null,raw,pair.privateKey);
 const fetcher=async(url:string)=>url.includes('/latest')?Buffer.from(JSON.stringify({tag_name:'v0.6.1'})):url.endsWith('release.json')?raw:url.endsWith('release.sig')?sig:data;
 try{
  const u=new ReleaseUpdater('0.6.1',root,fetcher,publicKey);assert.equal((await u.check()).phase,'latest');assert.equal(u.manifest?.assets.android.name,'JARVIS-Android-0.6.1.apk');await assert.rejects(u.download());
  u.current='0.6.0';assert.equal((await u.check()).phase,'available');const staged=await u.download();assert.equal(u.state.phase,'ready');assert(staged.archive.endsWith('/update.zip'));
  await u.check();u.fetchBytes=async()=>Buffer.from('tampered');await assert.rejects(u.download());assert.equal(u.state.phase,'available');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('GitHub API checks request JSON while release assets request binary media',async(t)=>{
 const seen:any[]=[];t.mock.method(globalThis,'fetch',async(url:any,init:any)=>{seen.push({host:new URL(url).hostname,accept:init.headers.Accept});return new Response('{}',{status:200});});
 const {githubBytes}=await import('../src/main/releases.ts');
 await githubBytes('https://api.github.com/repos/sultandilaram/jarvis/releases/latest',100);
 await githubBytes('https://github.com/sultandilaram/jarvis/releases/download/v0.6.1/release.json',100);
 assert.deepEqual(seen,[{host:'api.github.com',accept:'application/vnd.github+json'},{host:'github.com',accept:'application/octet-stream'}]);
});
