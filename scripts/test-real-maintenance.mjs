// Real Codex acceptance in a disposable repository. No voice API or owner source.
import { mkdtemp,rm,writeFile,mkdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';import { tmpdir } from 'node:os';import assert from 'node:assert/strict';
import { Store } from '../src/main/store.ts';import { Codex } from '../src/main/codex.ts';import { Orchestrator } from '../src/main/orchestrator.ts';import { DesktopBroker } from '../src/main/desktop/broker.ts';import { JobManager } from '../src/main/jobs.ts';import { ProjectService } from '../src/main/project.ts';import { Maintenance,readTree,treeDigest } from '../src/main/maintenance.ts';
const root=await mkdtemp(join(tmpdir(),'jarvis-real-maintenance-')),store=new Store(':memory:'),codex=new Codex();let agent,jobs,maintenance;const projects=new ProjectService(()=>jobs.current());
const broker=new DesktopBroker(async(action,args)=>{
 if(action.startsWith('repo.'))return maintenance.plan(action,args);
 if(action.startsWith('task.'))return agent.taskPlan(action,args);
 if(action.startsWith('project.')){
  const p=await projects.plan(action,args);if(action==='project.exec'){const run=p.run;p.run=async(signal)=>{const j=jobs.current(),before=treeDigest(readTree(j.workspace)),r=await run(signal);maintenance.receipt(j,args.command,args.path,before,r);return r;};}return p;
 }
 throw Error('Only isolated maintenance/task/project tools are enabled.');
});
agent=new Orchestrator(store,codex,root,()=>false,broker);jobs=new JobManager(store,agent,join(root,'jobs'),()=>{});agent.beforeTool=()=>jobs.countTool();
const approved=[];broker.on('approval',a=>{const c=a.params.preview?.command;const yes=a.params.action==='project.exec'&&[['npm','ci','--ignore-scripts'],['npm','run','typecheck'],['npm','test'],['npm','run','build']].some(x=>JSON.stringify(x)===JSON.stringify(c));if(yes)approved.push(c);broker.decide(a.id,yes);});
let timer;
try{
 const seed=join(root,'seed.json'),files={
 'README.md':'# Acceptance fixture\nA tiny local calculator.\n',
 'package.json':JSON.stringify({name:'jarvis-maintenance-fixture',version:'1.0.0',scripts:{typecheck:'node --check index.cjs',test:'node --test test.cjs',build:'node -e "require(\'fs\').mkdirSync(\'dist\',{recursive:true});require(\'fs\').writeFileSync(\'dist/result.txt\',\'built\')"'}}),
 'package-lock.json':JSON.stringify({name:'jarvis-maintenance-fixture',version:'1.0.0',lockfileVersion:3,requires:true,packages:{'':{name:'jarvis-maintenance-fixture',version:'1.0.0'}}}),
 'index.cjs':'module.exports=(a,b)=>a+b;\n',
 'test.cjs':'const test=require("node:test"),assert=require("node:assert/strict"),sum=require("./index.cjs");test("addition",()=>assert.equal(sum(2,3),5));\n'};
 await writeFile(seed,JSON.stringify({schema:1,version:'fixture',files:Object.fromEntries(Object.entries(files).map(([p,s])=>[p,Buffer.from(s).toString('base64')]))}));
 maintenance=new Maintenance(store,jobs,join(root,'source'),seed,()=>{});
 await agent.connect();if(!agent.model)throw Error(agent.error||'Codex unavailable.');
 const started=await maintenance.start('In this zero-dependency acceptance fixture, change only README.md: append the sentence “Local maintenance verified.” Do not change scripts or any other file. No new dependencies. Use repo.submit with the proposal ID in your task instructions, then finish.');
 const p=()=>maintenance.get(started.proposalId);
 await new Promise((done,reject)=>{const check=()=>{const proposal=p();if(proposal.state==='merged'){agent.off('state',check);done();}else if(['rejected','conflict','owner_review'].includes(proposal.state)){agent.off('state',check);reject(Error('Unexpected state '+proposal.state));}};agent.on('state',check);timer=setTimeout(()=>{agent.off('state',check);reject(Error('Maintenance acceptance timed out'));},240000);check();});
 const final=p();assert(final.reviewJobId&&final.reviewJobId!==final.jobId);assert.equal(final.receipts.length,3);assert.match(await readFile(join(maintenance.root,'README.md'),'utf8'),/Local maintenance verified\./);assert(final.commit);
 const report={passed:true,realCodex:true,separateProposerAndReviewer:true,verifiedCommandReceipts:3,ordinaryLocalMerge:true,sourceCommitRecorded:true,noVoiceAPI:true,ownerSourceTouched:false,githubPublished:false};await mkdir('.jarvis/verification/self-management',{recursive:true});await writeFile('.jarvis/verification/self-management/real-maintenance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(e){console.log(JSON.stringify({passed:false,error:String(e),states:maintenance?.proposals().map(p=>({state:p.state,checks:p.receipts?.length})),lastEntries:store.entries().slice(-3).map(e=>e.text.slice(0,450))}));process.exitCode=1;}
finally{clearTimeout(timer);jobs.close();agent.removeAllListeners();codex.removeAllListeners();codex.close();store.close();await rm(root,{recursive:true,force:true});}
