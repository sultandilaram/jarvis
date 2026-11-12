import test from 'node:test';import assert from 'node:assert/strict';
import { generateKeyPairSync,createVerify } from 'node:crypto';
import { GitHubMaintenance,appJWT,checksPassed,trustedCheckName,type PendingPull } from '../src/main/github-maintenance.ts';
const pair=generateKeyPairSync('rsa',{modulusLength:2048}),pem=pair.privateKey.export({type:'pkcs8',format:'pem'}).toString();
const credentials={proposer:{appId:1,installationId:10,privateKey:pem},reviewer:{appId:2,installationId:20,privateKey:pem}};
test('GitHub App JWTs are short-lived and signed; identities must be separate',async()=>{
 const jwt=appJWT(credentials.proposer,1000000),[h,b,s]=jwt.split('.');const body=JSON.parse(Buffer.from(b,'base64url').toString());assert.equal(body.iss,'1');assert(body.exp-body.iat<=600);const v=createVerify('RSA-SHA256');v.update(h+'.'+b);assert(v.verify(pair.publicKey,Buffer.from(s,'base64url')));
 const g=new GitHubMaintenance(async()=>({...credentials,reviewer:credentials.proposer}));await assert.rejects(g.token('proposer'));
});
test('only the latest trusted CI check for the exact commit counts',()=>{
 const c={id:1,name:trustedCheckName,head_sha:'head',status:'completed',conclusion:'success',app:{slug:'github-actions'}};
 assert(checksPassed([c],'head'));assert(!checksPassed([{...c,app:{slug:'attacker'}}],'head'));assert(!checksPassed([c],'other'));
 assert(!checksPassed([c,{...c,id:2,conclusion:'failure'}],'head'));assert(!checksPassed([c,{...c,id:2,status:'in_progress',conclusion:null}],'head'));
});
test('installation tokens are limited to the one repository without admin/workflows access',async()=>{
 const calls:any[]=[];const g=new GitHubMaintenance(async()=>credentials,async(url:any,init:any)=>{calls.push({url,body:init.body?JSON.parse(init.body):null});let body:any={};if(String(url).includes('/app/installations/')&&!String(url).includes('/access_tokens'))body={account:{login:'sultandilaram'},repository_selection:'selected'};if(String(url).endsWith('/access_tokens'))body={token:'fixture-private-token',expires_at:new Date(Date.now()+3600000).toISOString()};if(String(url).endsWith('/repos/sultandilaram/jarvis'))body={full_name:'sultandilaram/jarvis',permissions:{admin:false}};return new Response(JSON.stringify(body),{status:200});});
 await g.token('proposer');await g.token('reviewer');for(const c of calls.filter(c=>c.url.endsWith('/access_tokens'))){assert.deepEqual(c.body.repositories,['jarvis']);assert.equal(c.body.permissions.administration,undefined);assert.equal(c.body.permissions.workflows,undefined);assert.equal(c.body.permissions.statuses,undefined);}
});
function fixture(sensitive=false){const calls:any[]=[],g=new GitHubMaintenance(async()=>credentials);g.token=async(role)=>role;g.ensureRules=async()=>{};let head='head',checks:any[]=[{id:1,name:trustedCheckName,head_sha:'head',status:'completed',conclusion:'success',app:{slug:'github-actions'}}],owner=false;
 g.api=async(path,token,method='GET',body)=>{calls.push({path,token,method,body});if(path.endsWith('/check-runs?per_page=100'))return {check_runs:checks};if(path.endsWith('/reviews?per_page=100'))return owner?[{user:{login:'sultandilaram'},commit_id:'head',state:'APPROVED'}]:[];if(path.endsWith('/reviews'))return {};if(path.endsWith('/merge'))return {merged:true};return {head:{sha:head},base:{ref:'main'},state:'open',merged:false};};
 const p:PendingPull={number:1,head:'head',url:'https://github.com/sultandilaram/jarvis/pull/1',proposalId:'fixture',sensitive,reviewed:false,state:'waiting_checks'};
 return {g,calls,p,setHead:(h:string)=>head=h,setChecks:(c:any[])=>checks=c,approveOwner:()=>owner=true};}
test('PR review and merge are bound to the exact head and separate reviewer identity',async()=>{const f=fixture();const result=await f.g.advance(f.p);assert.equal(result.state,'merged');assert.equal(f.calls.find(c=>c.path.endsWith('/reviews')).token,'reviewer');assert.equal(f.calls.find(c=>c.path.endsWith('/merge')).body.sha,'head');const x=fixture();x.setHead('changed');assert.equal((await x.g.advance(x.p)).state,'failed');assert(!x.calls.some(c=>c.method==='POST'||c.method==='PUT'));});
test('sensitive PRs wait for actual owner approval; spoofed CI cannot authorize merge',async()=>{const f=fixture(true);const waiting=await f.g.advance(f.p);assert.equal(waiting.state,'waiting_owner');assert(!f.calls.some(c=>c.path.endsWith('/merge')));f.approveOwner();assert.equal((await f.g.advance(waiting)).state,'merged');const x=fixture();x.setChecks([{id:1,name:trustedCheckName,head_sha:'head',status:'completed',conclusion:'success',app:{slug:'attacker'}}]);assert.equal((await x.g.advance(x.p)).state,'waiting_checks');assert(!x.calls.some(c=>c.method==='POST'||c.method==='PUT'));});
test('maintenance refuses missing server-side owner and CI rules',async()=>{const g=new GitHubMaintenance(async()=>credentials);g.api=async(path)=>path==='/apps/github-actions'?{id:15368}:[];await assert.rejects(g.ensureRules('fixture'));});
test('release approval pins the exact checked main commit and cannot tag changed source',async()=>{
 const g=new GitHubMaintenance(async()=>credentials),head='a'.repeat(40),writes:any[]=[];
 g.token=async()=> 'fixture';g.ensureRules=async()=>{};
 g.api=async(path,_token,method='GET',body)=>{if(method==='POST'){writes.push(body);return {};}
  if(path.endsWith('/git/ref/heads/main'))return {object:{sha:head}};
  if(path.includes('/contents/package.json'))return {content:Buffer.from(JSON.stringify({version:'0.6.0'})).toString('base64')};
  return {check_runs:[{id:1,name:trustedCheckName,head_sha:head,status:'completed',conclusion:'success',app:{slug:'github-actions'}}]};};
 assert.equal((await g.releasePreview('0.6.0')).commit,head);
 await assert.rejects(g.release('0.6.0','b'.repeat(40)));assert.equal(writes.length,0);
 await g.release('0.6.0',head);assert.deepEqual(writes,[{ref:'refs/tags/v0.6.0',sha:head}]);
});
