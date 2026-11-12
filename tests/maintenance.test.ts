import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { Store } from '../src/main/store.ts';
import { Maintenance, readTree, treeDigest, sensitivePath, safeSourcePath } from '../src/main/maintenance.ts';
function fixture(){const root=mkdtempSync(join(tmpdir(),'jarvis-maintenance-'));const store=new Store(':memory:');let current:any;
 const jobs:any={current:()=>current,enqueue:(args:any,_user:any,paused:boolean)=>{assert(paused);const id=randomUUID(),workspace=join(root,id);mkdirSync(workspace);return {id,workspace,...args};},control:async()=>{},save:()=>{}};
 const seed=join(root,'seed.json');writeFileSync(seed,JSON.stringify({schema:1,version:'0.6.0',files:{'README.md':Buffer.from('original').toString('base64'),'package.json':Buffer.from('{}').toString('base64')}}));
 const m=new Maintenance(store,jobs,join(root,'source'),seed,()=>{});
 return {m,store,root,jobs,setCurrent:(j:any)=>current=j,close:()=>{store.close();rmSync(root,{recursive:true,force:true});}};}
test('maintenance ordinary lane is a positive list; policy and backend changes need owner review',()=>{
 assert(sensitivePath('src/renderer/style.css'));assert(!sensitivePath('README.md'));
 for(const p of ['src/main/main.ts','.github/workflows/ci.yml','tests/security.test.ts','package.json','docs/MAINTENANCE.md','native/CredentialVault.swift','mobile/web/app.tsx'])assert(sensitivePath(p));
 for(const p of ['../outside','src/../../key','/tmp/file','.env','.jarvis/key','file.pem','src\\bad'])assert(!safeSourcePath(p));
});
test('source snapshots reject symlinks and secrets',{skip:process.platform!=='darwin'},()=>{const f=fixture();try{const dir=join(f.root,'snap');mkdirSync(dir);symlinkSync('/etc/passwd',join(dir,'link'));assert.throws(()=>readTree(dir));rmSync(join(dir,'link'));writeFileSync(join(dir,'key.txt'),['-----BEGIN','PRIVATE KEY-----'].join(' '));assert.throws(()=>readTree(dir));}finally{f.close();}});
test('proposer cannot review itself; receipts and exact snapshot are required before ordinary merge',{skip:process.platform!=='darwin'},async()=>{const f=fixture();try{
 const started=await f.m.start('Improve readme');const p=f.m.get(started.proposalId),proposer=join(f.root,p.jobId);
 f.setCurrent({id:p.jobId,workspace:proposer});writeFileSync(join(proposer,'README.md'),'improved');
 await f.m.submit(p);let review=f.m.get(p.id);await assert.rejects(f.m.review(review,'accept','I approve my own work.'));
 const reviewer={id:review.reviewJobId,workspace:join(f.root,review.reviewJobId!)};f.setCurrent(reviewer);
 await assert.rejects(f.m.review(review,'accept','Looks good but no commands.'));
 for(const command of [['npm','run','typecheck'],['npm','test'],['npm','run','build']])f.m.receipt(reviewer as any,command,undefined,review.digest!,{verified:true,exitCode:0});
 assert.equal(f.m.get(p.id).receipts?.length,3);
 await f.m.review(f.m.get(p.id),'accept','Reviewed exact diff; all required commands passed.');
 assert.equal(f.m.get(p.id).state,'merged');assert.equal(readFileSync(join(f.m.root,'README.md'),'utf8'),'improved');
 }finally{f.close();}});
test('sensitive source merges require actual owner approval and reject source drift',{skip:process.platform!=='darwin'},async()=>{const f=fixture();try{
 const started=await f.m.start('Change backend policy');let p=f.m.get(started.proposalId);const proposer=join(f.root,p.jobId);f.setCurrent({id:p.jobId,workspace:proposer});writeFileSync(join(proposer,'package.json'),'{"changed":true}');await f.m.submit(p);p=f.m.get(p.id);
 const reviewer={id:p.reviewJobId,workspace:join(f.root,p.reviewJobId!)};f.setCurrent(reviewer);
 for(const a of [['npm','run','typecheck'],['npm','test'],['npm','run','build']])f.m.receipt(reviewer as any,a,'.',p.digest!,{verified:true,exitCode:0});
 await f.m.review(f.m.get(p.id),'accept','Sensitive dependency change needs owner approval.');assert.equal(f.m.get(p.id).state,'owner_review');assert.throws(()=>f.m.merge(p.id,false));
 writeFileSync(join(f.m.root,'README.md'),'changed after review');assert.throws(()=>f.m.merge(p.id,true));assert.equal(f.m.get(p.id).state,'conflict');
 }finally{f.close();}});
test('hosted-test handoff needs exact local receipts and GitHub; it never permits local merge',{skip:process.platform!=='darwin'},async()=>{const f=fixture();try{
 const started=await f.m.start('Improve readme with hosted tests');let p=f.m.get(started.proposalId);
 f.setCurrent({id:p.jobId,workspace:join(f.root,p.jobId)});writeFileSync(join(f.root,p.jobId,'README.md'),'hosted review');await f.m.submit(p);p=f.m.get(p.id);
 const reviewer={id:p.reviewJobId,workspace:join(f.root,p.reviewJobId!)};f.setCurrent(reviewer);
 await assert.rejects(f.m.review(p,'accept_for_ci','Tests bind sockets blocked by isolation.'),/configured/);
 f.m.githubReady=()=>true;let published=0;f.m.publishGitHub=async()=>{published++;return {} as any;};
 await assert.rejects(f.m.review(p,'accept_for_ci','Typecheck has not run.'),/Typecheck and build/);
 for(const a of [['npm','run','typecheck'],['npm','run','build']])f.m.receipt(reviewer as any,a,'.',p.digest!,{verified:true,exitCode:0});
 await f.m.review(f.m.get(p.id),'accept_for_ci','Typecheck and build passed; full tests require trusted CI.');
 p=f.m.get(p.id);assert.equal(p.state,'awaiting_ci');assert.equal(p.receipts?.length,2);assert.equal(published,0);
 assert.throws(()=>f.m.merge(p.id,false));assert.throws(()=>f.m.merge(p.id,true));
 const plan=await f.m.plan('repo.publish',{proposalId:p.id});assert.equal(plan.approval,true);await plan.run(new AbortController().signal);assert.equal(published,1);
 assert.equal(readFileSync(join(f.m.root,'README.md'),'utf8'),'original');
 }finally{f.close();}});
