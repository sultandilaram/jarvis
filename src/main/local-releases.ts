import { spawn } from 'node:child_process';
import { createWriteStream,existsSync,realpathSync,statSync,readFileSync } from 'node:fs';
import { mkdir,symlink,readFile } from 'node:fs/promises';
import { join,dirname } from 'node:path';
import { homedir,userInfo } from 'node:os';
import { randomUUID } from 'node:crypto';
import { verifyManifest,verifyArtifact,versionParts } from './releases.ts';
import { releasePublicKey } from '../shared/release-config.ts';
import { checksPassed,type GitHubMaintenance } from './github-maintenance.ts';
export type LocalReleaseState={phase:'idle'|'preparing'|'building'|'verifying'|'publishing'|'completed'|'failed'|'interrupted';version?:string;commit?:string;error?:string;url?:string;log?:string};
export function validateBuildState(directory:string){
 const root=realpathSync(directory),st=statSync(root);
 if(!st.isDirectory()||(st.mode&0o077))throw Error('Choose an owner-only private build-state directory.');
 for(const file of ['private/local-signing.json','private/vault-v1/identity.json','private/release-signing/ed25519-private.pem','android-tools/environment.json','android-tools/test-signing.json'])if(!existsSync(join(root,file)))throw Error('Private build state is missing '+file+'.');
 return root;
}
export function runBuildCommand(exe:string,args:string[],cwd:string,env:NodeJS.ProcessEnv,log:string,signal:AbortSignal,timeout=30*60*1000):Promise<void>{
 signal.throwIfAborted();
 return new Promise((done,reject)=>{
  const stream=createWriteStream(log,{flags:'a',mode:0o600}),child=spawn(exe,args,{cwd,env,detached:true,stdio:['ignore','pipe','pipe']});
  let settled=false,count=0,timedOut=false;
  const stop=()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{}};
  const timer=setTimeout(()=>{timedOut=true;stop();},timeout);
  const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',stop);stream.end();error?reject(error):done();};
  stream.on('error',()=>{stop();finish(Error('Cannot write the private release log.'));});
  const output=(chunk:Buffer)=>{count+=chunk.length;if(count<=32*1024*1024)stream.write(chunk);};
  child.stdout.on('data',output);child.stderr.on('data',output);child.on('error',()=>finish(Error('Release command could not start. Inspect the private build log.')));
  signal.addEventListener('abort',stop,{once:true});
  child.on('close',code=>{stop();finish(signal.aborted?Error('Release operation stopped. If publication had started, check GitHub before retrying.'):timedOut?Error('Release command exceeded its time limit.'):code!==0?Error('Release command failed. Inspect the private build log.'):undefined);});
 });
}
export class LocalReleases {
 controller?:AbortController;
 state:LocalReleaseState;
 constructor(public directory:string,public getPrivateState:()=>string|undefined,public github:GitHubMaintenance,public save:(s:LocalReleaseState)=>void,previous?:LocalReleaseState,public run=runBuildCommand,public verificationKey=releasePublicKey){
  this.state=previous||{phase:'idle'};
  if(['preparing','building','verifying','publishing'].includes(this.state.phase)){this.state={...this.state,phase:'interrupted',error:'JARVIS stopped during release work. Check GitHub before an explicit retry; publication is never replayed automatically.'};this.save(this.state);}
 }
 busy(){return !!this.controller||['preparing','building','verifying','publishing'].includes(this.state.phase);}
 change(p:Partial<LocalReleaseState>){this.state={...this.state,...p};this.save(this.state);}
 stop(){this.controller?.abort();}
 async build(version:string,commit:string,outer?:AbortSignal){
  versionParts(version);if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Choose the exact checked source commit.');
  if(this.busy())throw Error('A local release is already running.');
  const privateRoot=this.getPrivateState();if(!privateRoot)throw Error('Configure private release build state in desktop Settings.');
  const state=validateBuildState(privateRoot),controller=new AbortController();this.controller=controller;
  const signal=outer?AbortSignal.any([outer,controller.signal]):controller.signal;
  const work=join(this.directory,version+'-'+randomUUID()),log=join(this.directory,'build-'+Date.now()+'.log');
  try{
   this.change({phase:'preparing',version,commit,log,error:undefined,url:undefined});
   await mkdir(this.directory,{recursive:true,mode:0o700});
   const token=await this.github.token('proposer'),base='/repos/sultandilaram/jarvis';await this.github.ensureRules(token);
   const tag=await this.github.api(base+'/git/ref/tags/v'+version,token);
   if(tag.object.type!=='commit'||tag.object.sha!==commit)throw Error('Release tag no longer matches the approved source commit.');
   const comparison=await this.github.api(base+'/compare/main...'+commit,token);
   if(!['identical','behind'].includes(comparison.status))throw Error('Release source must be part of reviewed main history.');
   const checks=await this.github.api(base+'/commits/'+commit+'/check-runs?per_page=100',token);
   if(!checksPassed(checks.check_runs||[],commit))throw Error('Trusted CI must pass on the exact release source.');
   // Normal source/project jobs never see this environment or private build state.
   // Each invocation requires a fresh owner approval for this commit.
   let node:string|undefined;
   const candidates=[join(homedir(),'.nvm/versions/node')];
   const runtimes:string[]=[];
   if(!process.versions.electron)runtimes.push(process.execPath);
   runtimes.push('/opt/homebrew/bin/node','/usr/local/bin/node');
   try{const fs=await import('node:fs/promises');for(const v of (await fs.readdir(candidates[0])).sort().reverse())runtimes.push(join(candidates[0],v,'bin/node'));}catch{}
   const {execFileSync}=await import('node:child_process');
   for(const candidate of runtimes){if(!existsSync(candidate))continue;try{const n=realpathSync(candidate),v=execFileSync(n,['-p','process.versions.node'],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',OPENSSL_CONF:'/dev/null'},timeout:5000}).trim();if(Number(v.split('.')[0])>=24){node=n;break;}}catch{}}
   if(!node)throw Error('A local Node.js 24+ runtime is required to build releases. Normal assistant use does not need it.');
   const env:NodeJS.ProcessEnv={PATH:[dirname(node),'/usr/bin','/bin','/usr/sbin','/sbin','/opt/homebrew/bin','/usr/local/bin'].join(':'),HOME:homedir(),USER:userInfo().username,LOGNAME:userInfo().username,LANG:'en_US.UTF-8',CI:'1',OPENSSL_CONF:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'};
   await this.run('/usr/bin/git',['-c','core.hooksPath=/dev/null','clone','--no-checkout','--single-branch','--branch','v'+version,'https://github.com/sultandilaram/jarvis.git',work],this.directory,env,log,signal,120000);
   await this.run('/usr/bin/git',['-c','core.hooksPath=/dev/null','checkout','--detach',commit],work,env,log,signal,30000);
   const pkg=JSON.parse(await readFile(join(work,'package.json'),'utf8'));if(pkg.version!==version)throw Error('Checked source version does not match release approval.');
   await symlink(state,join(work,'.jarvis'),'dir');
   this.change({phase:'building'});await this.run(node,['scripts/release/build.mjs'],work,env,log,signal);
   signal.throwIfAborted();this.change({phase:'verifying'});
   const candidate=join(state,'release-candidate'),raw=await readFile(join(candidate,'release.json')),sig=await readFile(join(candidate,'release.sig'));
   const manifest=verifyManifest(raw,sig,'0.0.0',this.verificationKey,version);
   if(manifest.commit!==commit)throw Error('Built source does not match the approved release commit.');
   if(!manifest.assets.macDmg)throw Error('Candidate must include the signed DMG artifact.');
   for(const asset of Object.values(manifest.assets))verifyArtifact(await readFile(join(candidate,asset.name)),asset);
   signal.throwIfAborted();this.change({phase:'publishing'});
   const publishToken=await this.github.token('proposer');
   await this.run(node,['scripts/release/publish.mjs'],work,{...env,GITHUB_TOKEN:publishToken,JARVIS_PUBLISH_APPROVED:version},log,signal,10*60*1000);
   const published=await this.github.api(base+'/releases/tags/v'+version,publishToken);
   if(published.draft||published.tag_name!=='v'+version)throw Error('GitHub publication was not confirmed. Check the release before retrying.');
   this.change({phase:'completed',url:'https://github.com/sultandilaram/jarvis/releases/tag/v'+version,error:undefined});
   return {published:true,version,commit,url:this.state.url,installed:false};
  }catch(e){this.change({phase:signal.aborted?'interrupted':'failed',error:(e as Error).message});throw e;}
  finally{this.controller=undefined;}
 }
}
