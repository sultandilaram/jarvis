import { createSign } from 'node:crypto';
export const maintenanceRepository='sultandilaram/jarvis';
export type AppCredential={appId:number;installationId:number;privateKey:string};
export type GitHubMaintenanceCredentials={proposer:AppCredential;reviewer:AppCredential};
export type PullChange={path:string;before?:string;after?:string};
export type PendingPull={number:number;head:string;url:string;proposalId:string;sensitive:boolean;reviewed:boolean;state:'waiting_checks'|'waiting_owner'|'merged'|'failed';error?:string};
export const trustedCheckName='Typecheck, tests and build';
export function appJWT(credential:AppCredential,now=Date.now()){
 if(!Number.isSafeInteger(credential.appId)||credential.appId<=0||!Number.isSafeInteger(credential.installationId)||credential.installationId<=0)throw Error('Invalid GitHub App identity.');
 const seconds=Math.floor(now/1000),header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url'),body=Buffer.from(JSON.stringify({iat:seconds-60,exp:seconds+540,iss:String(credential.appId)})).toString('base64url');
 const input=header+'.'+body,s=createSign('RSA-SHA256');s.update(input);return input+'.'+s.sign(credential.privateKey).toString('base64url');
}
export function checksPassed(runs:any[],head:string){const latest=runs.filter(c=>c.name===trustedCheckName&&c.head_sha===head&&c.app?.slug==='github-actions'&&Number.isSafeInteger(c.id)).sort((a,b)=>b.id-a.id)[0];return latest?.status==='completed'&&latest?.conclusion==='success';}
export class GitHubMaintenance {
 tokens=new Map<string,{value:string;expires:number}>();
 constructor(public credentials:()=>Promise<GitHubMaintenanceCredentials>,public request=fetch){}
 async api(path:string,token:string,method='GET',body?:unknown){
  if(!path.startsWith('/')||path.startsWith('//'))throw Error('Invalid GitHub API path.');
  const r=await this.request('https://api.github.com'+path,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'JARVIS-maintainer',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok)throw Error('GitHub maintenance request failed: HTTP '+r.status);
  return r.status===204?null:r.json();
 }
 async token(role:'proposer'|'reviewer'){
  const old=this.tokens.get(role);if(old&&old.expires>Date.now()+120000)return old.value;
  const credentials=await this.credentials();
  if(credentials.proposer.appId===credentials.reviewer.appId)throw Error('Proposer and reviewer must be separate GitHub Apps.');
  const c=credentials[role],jwt=appJWT(c),installation=await this.api('/app/installations/'+c.installationId,jwt);
  if(installation.account?.login!=='sultandilaram'||installation.repository_selection!=='selected')throw Error('Use a selected-repository installation on the intended owner.');
  const permissions=role==='proposer'?{contents:'write',pull_requests:'write',checks:'read'}:{contents:'read',pull_requests:'write',checks:'read'};
  // Explicitly reduce the installation token; no admin, workflows, secrets or
  // status-writing authority is requested. GitHub enforces the branch rules.
  const value=await this.api('/app/installations/'+c.installationId+'/access_tokens',jwt,'POST',{repositories:['jarvis'],permissions});
  const repo=await this.api('/repos/'+maintenanceRepository,value.token);
  if(repo.full_name!==maintenanceRepository||repo.permissions?.admin)throw Error('Maintenance identity has unexpected repository/admin access.');
  this.tokens.set(role,{value:value.token,expires:Date.parse(value.expires_at)});return value.token;
 }
 async ensureRules(token:string){
  const base='/repos/'+maintenanceRepository;
  const rules=await this.api(base+'/rules/branches/main',token);
  const review=rules.find((r:any)=>r.type==='pull_request')?.parameters;
  const checks=rules.find((r:any)=>r.type==='required_status_checks')?.parameters;
  const actions=await this.api('/apps/github-actions',token);
  if(!review || review.required_approving_review_count<1 || !review.require_code_owner_review || !review.dismiss_stale_reviews_on_push || !review.require_last_push_approval || !checks?.required_status_checks?.some((c:any)=>c.context===trustedCheckName&&c.integration_id===actions.id))throw Error('Configure enforced owner review, stale-review dismissal, latest-push approval and trusted GitHub CI rules before enabling maintenance.');
 }
 async releasePreview(version:string){
  if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw Error('Use a stable x.y.z version.');
  const token=await this.token('proposer'),base='/repos/'+maintenanceRepository;await this.ensureRules(token);
  const head=await this.api(base+'/git/ref/heads/main',token);
  const pkg=await this.api(base+'/contents/package.json?ref='+head.object.sha,token);
  if(JSON.parse(Buffer.from(pkg.content.replace(/\s/g,''),'base64').toString('utf8')).version!==version)throw Error('The reviewed main source version does not match the release request.');
  const checks=await this.api(base+'/commits/'+head.object.sha+'/check-runs?per_page=100',token);
  if(!checksPassed(checks.check_runs||[],head.object.sha))throw Error('Trusted CI must pass on the exact main source before tagging.');
  return {version,commit:head.object.sha};
 }
 async release(version:string,expectedCommit:string){
  const checked=await this.releasePreview(version);
  if(!/^[a-f0-9]{40}$/.test(expectedCommit)||checked.commit!==expectedCommit)throw Error('Main source changed after release approval. Review the exact commit again.');
  const token=await this.token('proposer');
  await this.api('/repos/'+maintenanceRepository+'/git/refs',token,'POST',{ref:'refs/tags/v'+version,sha:checked.commit});
  return {tag:'v'+version,commit:checked.commit,effect:'Tag created. An owner-approved local signing build or the separately configured protected release workflow is still required; publication is not confirmed.'};
 }

 async publish({proposalId,goal,changes,review,sensitive}:{proposalId:string;goal:string;changes:PullChange[];review:string;sensitive:boolean}):Promise<PendingPull>{
  if(!/^[a-f0-9-]{36}$/.test(proposalId)||changes.length<1||changes.length>100||!review)throw Error('A bounded reviewed proposal is required.');
  const token=await this.token('proposer'),base='/repos/'+maintenanceRepository;
  await this.ensureRules(token);
  const ref=await this.api(base+'/git/ref/heads/main',token),head=await this.api(base+'/git/commits/'+ref.object.sha,token);
  // Never transplant a local diff onto a different public base without checking
  // each old blob. Deletions and additions are covered by the same equality.
  for(const c of changes){
   if(!c.path||c.path.split('/').some(s=>!s||s==='.'||s==='..')||/^[\/\\]|[\\\x00-\x1f]/.test(c.path))throw Error('Unsafe source change path.');
   let old:any;try{old=await this.api(base+'/contents/'+c.path.split('/').map(encodeURIComponent).join('/')+'?ref='+ref.object.sha,token);}catch(e){if(!(e as Error).message.endsWith('HTTP 404'))throw e;}
   if(c.before===undefined){if(old)throw Error('New source path already exists upstream.');}
   else {
    if(!old||old.type!=='file')throw Error('Upstream source changed; rebase and repeat review.');
    const blob=old.encoding==='base64'?old:await this.api(base+'/git/blobs/'+old.sha,token);
    if(blob.encoding!=='base64'||Buffer.from(blob.content.replace(/\s/g,''),'base64').toString('base64')!==c.before)throw Error('Upstream source changed; rebase and repeat review.');
   }
  }
  const tree=[];
  for(const c of changes){let sha=null;if(c.after!==undefined)sha=(await this.api(base+'/git/blobs',token,'POST',{content:c.after,encoding:'base64'})).sha;tree.push({path:c.path,mode:'100644',type:'blob',sha});}
  const next=await this.api(base+'/git/trees',token,'POST',{base_tree:head.tree.sha,tree});
  const commit=await this.api(base+'/git/commits',token,'POST',{message:'JARVIS improvement '+proposalId,tree:next.sha,parents:[ref.object.sha]});
  const branch='jarvis/'+proposalId;await this.api(base+'/git/refs',token,'POST',{ref:'refs/heads/'+branch,sha:commit.sha});
  const pr=await this.api(base+'/pulls',token,'POST',{head:branch,base:'main',title:goal.slice(0,160),body:'Local proposal '+proposalId+'\n\nIndependent local review:\n'+review+'\n\n'+(sensitive?'Owner review is required.':'Ordinary documentation change; waiting for trusted CI and separate reviewer identity.'),draft:false});
  return {number:pr.number,head:commit.sha,url:pr.html_url,proposalId,sensitive,reviewed:false,state:sensitive?'waiting_owner':'waiting_checks'};
 }
 async advance(p:PendingPull):Promise<PendingPull>{
  if(p.state==='merged'||p.state==='failed')return p;
  const token=await this.token('proposer'),base='/repos/'+maintenanceRepository;
  await this.ensureRules(token);
  const pr=await this.api(base+'/pulls/'+p.number,token);
  if(pr.merged)return {...p,state:'merged'};
  if(pr.head?.sha!==p.head||pr.base?.ref!=='main'||pr.state!=='open')return {...p,state:'failed',error:'PR target or reviewed commit changed; repeat review.'};
  const checks=await this.api(base+'/commits/'+p.head+'/check-runs?per_page=100',token);
  if(!checksPassed(checks.check_runs||[],p.head))return p;
  if(!p.reviewed){const reviewer=await this.token('reviewer');await this.api(base+'/pulls/'+p.number+'/reviews',reviewer,'POST',{event:'APPROVE',commit_id:p.head,body:'Separate JARVIS reviewer identity: local independent review and immutable-snapshot command receipts passed, followed by trusted GitHub CI on this exact commit. Sensitive changes additionally require owner/code-owner approval.'});p={...p,reviewed:true};}
  // Do not attempt owner approval with an app identity. The actual owner must
  // approve sensitive source on GitHub. The merge API still enforces all rules.
  if(p.sensitive){const reviews=await this.api(base+'/pulls/'+p.number+'/reviews?per_page=100',token);const owner=reviews.filter((r:any)=>r.user?.login==='sultandilaram'&&r.commit_id===p.head).at(-1);if(owner?.state!=='APPROVED')return {...p,state:'waiting_owner'};}
  try {
   const result=await this.api(base+'/pulls/'+p.number+'/merge',token,'PUT',{sha:p.head,merge_method:'squash'});
   if(!result.merged)throw Error('GitHub did not confirm the merge.');return {...p,state:'merged',error:undefined};
  }catch(e){return {...p,error:(e as Error).message};}
 }
}
