import { readFile,readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join,resolve } from 'node:path';
import { verify,createHash } from 'node:crypto';
const dir=resolve('.jarvis/release-candidate'),raw=await readFile(join(dir,'release.json')),m=JSON.parse(raw);
const config=await readFile('src/shared/release-config.ts','utf8'),key=JSON.parse(config.match(/releasePublicKey = (".*");/)?.[1]||'null');
if(!key||!verify(null,raw,key,await readFile(join(dir,'release.sig'))))throw Error('Candidate signature invalid.');
if(m.repository!=='sultandilaram/jarvis'||!/^\d+\.\d+\.\d+$/.test(m.version)||process.env.JARVIS_PUBLISH_APPROVED!==m.version)throw Error('Publish requires the exact version approval from a protected release environment.');
const sha=execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const tag=execFileSync('/usr/bin/git',['rev-parse',`refs/tags/v${m.version}^{commit}`],{encoding:'utf8'}).trim();
if(m.commit!==sha||tag!==sha||execFileSync('/usr/bin/git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('Publish requires the clean source commit and matching protected tag.');
for(const a of Object.values(m.assets)){const bytes=await readFile(join(dir,a.name));if(bytes.length!==a.size||createHash('sha256').update(bytes).digest('hex')!==a.sha256)throw Error('Candidate artifact changed.');}
const token=process.env.GITHUB_TOKEN;if(!token)throw Error('GitHub release authorization is not configured.');
const api=async(url,init={})=>{const r=await fetch(url,{...init,redirect:'error',headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10',...init.headers}});if(!r.ok)throw Error('GitHub release operation failed: HTTP '+r.status);return r.status===204?null:r.json();};
const base='https://api.github.com/repos/sultandilaram/jarvis';
// Always create a draft. A failed upload cannot expose a half-complete update.
const release=await api(base+'/releases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tag_name:'v'+m.version,target_commitish:m.commit,name:'JARVIS '+m.version,body:m.notes,draft:true,prerelease:false})});
const upload=release.upload_url.replace(/\{.*$/,'');
if(!upload.startsWith('https://uploads.github.com/repos/sultandilaram/jarvis/releases/'))throw Error('Unexpected upload endpoint.');
for(const name of [...Object.values(m.assets).map(a=>a.name),'release.json','release.sig'])await api(upload+'?name='+encodeURIComponent(name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:await readFile(join(dir,name))});
await api(base+'/releases/'+release.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({draft:false})});
console.log('Published complete signed release '+m.version+'.');
