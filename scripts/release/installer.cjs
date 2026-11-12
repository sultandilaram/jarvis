const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const command=(file,args)=>cp.execFileSync(file,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024});
function requirement(app) {
 const p=cp.spawnSync('/usr/bin/codesign',['-d','-r-',app],{encoding:'utf8'});
 if(p.status!==0)throw Error('Cannot inspect installed signing identity.');
 const line=(p.stdout+'\n'+p.stderr).split('\n').find(s=>s.startsWith('designated => '));
 if(!line || !/certificate/.test(line))throw Error('Updates require a persistent certificate-bound app identity.');
 return line.slice('designated => '.length);
}
function validateArchive(data) {
 let end=-1;
 for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--)if(data.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw Error('Invalid update ZIP.');
 const count=data.readUInt16LE(end+10),offset=data.readUInt32LE(end+16);
 if(count===65535 || data.readUInt16LE(end+4)!==0 || data.readUInt16LE(end+6)!==0 || offset>=end)throw Error('Unsupported ZIP format.');
 let cursor=offset,total=0;const entries=[],links=new Set(),targets=new Map(),seen=new Set();
 for(let i=0;i<count;i++){
  if(cursor+46>end || data.readUInt32LE(cursor)!==0x02014b50)throw Error('Invalid ZIP directory.');
  const flags=data.readUInt16LE(cursor+8),method=data.readUInt16LE(cursor+10),size=data.readUInt32LE(cursor+24),compressed=data.readUInt32LE(cursor+20),n=data.readUInt16LE(cursor+28),extra=data.readUInt16LE(cursor+30),comment=data.readUInt16LE(cursor+32);
  if(cursor+46+n+extra+comment>end)throw Error('Invalid ZIP entry.');
  const name=data.subarray(cursor+46,cursor+46+n).toString('utf8').replace(/\/$/,'');
  if(!name || /[\\\x00-\x1f]/.test(name) || name.startsWith('/') || name.split('/').some(p=>!p || p==='.' || p==='..') || !(name==='JARVIS.app'||name.startsWith('JARVIS.app/')||name==='__MACOSX'||name.startsWith('__MACOSX/')) || seen.has(name.normalize("NFC").toLowerCase()) || flags&1 || ![0,8].includes(method))throw Error('Unsafe ZIP path or compression.');
  seen.add(name.normalize("NFC").toLowerCase()); total+=size;
  if(size>1024*1024*1024 || total>3*1024*1024*1024)throw Error('Unpacked update exceeds its size limit.');
  const mode=(data.readUInt32LE(cursor+38)>>>16)&0o170000;
  if(mode===0o120000){
   const local=data.readUInt32LE(cursor+42);
   if(local+30>offset || data.readUInt32LE(local)!==0x04034b50 || size>4096)throw Error('Invalid ZIP link.');
   const start=local+30+data.readUInt16LE(local+26)+data.readUInt16LE(local+28);
   if(start+compressed>offset)throw Error('Invalid ZIP link bytes.');
   const raw=data.subarray(start,start+compressed),target=(method===8?zlib.inflateRawSync(raw,{maxOutputLength:4096}):raw).toString('utf8');
   const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(name),target));
   if(!target || path.posix.isAbsolute(target) || /[\\\x00-\x1f]/.test(target) || !(resolved==='JARVIS.app'||resolved.startsWith('JARVIS.app/')))throw Error('ZIP link escapes the app.');
   links.add(name);targets.set(name.normalize("NFC").toLowerCase(),target);
  } else if(mode && ![0o100000,0o040000].includes(mode))throw Error('Unsupported special ZIP file.');
  entries.push(name);cursor+=46+n+extra+comment;
 }
 for(const name of entries)for(const link of links)if(name.normalize('NFC').toLowerCase().startsWith(link.normalize('NFC').toLowerCase()+'/'))throw Error('ZIP writes through a symlink.');
 // Expand link chains before processing '..'; lexical normalization alone can
 // miss a relative target escaping through another link on a case-folding disk.
 for(const link of links){
  const target=targets.get(link.normalize('NFC').toLowerCase());
  const pending=path.posix.dirname(link).split('/').concat(target.split('/')),stack=[];let expansions=0;
  while(pending.length){const part=pending.shift();if(!part||part==='.')continue;if(part==='..'){if(stack.length<=1)throw Error('ZIP link chain escapes the app.');stack.pop();continue;}stack.push(part);if(stack[0]!=='JARVIS.app')throw Error('ZIP link chain escapes the app.');const next=targets.get(stack.join('/').normalize('NFC').toLowerCase());if(next!==undefined){if(++expansions>40)throw Error('Cyclic ZIP link.');stack.pop();pending.unshift(...next.split('/'));}}
 }
 if(!entries.includes('JARVIS.app/Contents/Info.plist'))throw Error('Missing update application.');
 return {entries:count,unpackedBytes:total};
}
function inspect(app,expected,version) {
 command('/usr/bin/codesign',['--verify','--deep','--strict','-R','='+expected,app]);
 const plist=path.join(app,'Contents/Info.plist');
 if(command('/usr/bin/plutil',['-extract','CFBundleIdentifier','raw','-o','-',plist]).trim()!=='com.sultan.jarvis')throw Error('Unexpected application identifier.');
 if(command('/usr/bin/plutil',['-extract','CFBundleShortVersionString','raw','-o','-',plist]).trim()!==version)throw Error('Application version does not match signed release.');
}
function prepare({application,archive,stage,version}) {
 const expected=requirement(application);
 validateArchive(fs.readFileSync(archive));
 const extracted=path.join(stage,'extracted');fs.mkdirSync(extracted,{mode:0o700});
 command('/usr/bin/ditto',['-x','-k',archive,extracted]);
 const candidate=path.join(extracted,'JARVIS.app');inspect(candidate,expected,version);
 const vault='Contents/Resources/app/dist/native/jarvis-credential-vault';
 const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
 if(digest(path.join(application,vault))!==digest(path.join(candidate,vault)))throw Error('The fixed credential vault changed. Use an explicitly reviewed migration.');
 return {candidate,expected};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function launch(application,args) {
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=cp.spawn(path.join(application,'Contents/MacOS/JARVIS'),args,{detached:true,stdio:'ignore',env});
 child.on('error',()=>{});child.unref();
 return async()=>{
  if(!child.pid)return;
  const alive=()=>{try{process.kill(child.pid,0);return true;}catch{return false;}};
  try{process.kill(-child.pid,'SIGTERM');}catch{}
  for(let i=0;i<20 && alive();i++)await sleep(100);
  if(alive()){try{process.kill(-child.pid,'SIGKILL');}catch{};for(let i=0;i<20 && alive();i++)await sleep(100);}
  if(alive())throw Error('Updated app could not be stopped safely.');
 };
}
async function install(plan,{open=launch,waitMs=45000,identity=requirement,verify=inspect,copy=(a,b)=>command('/usr/bin/ditto',[a,b])}={}) {
 const {application,candidate,expected,version,parentPid,health,nonce,result}=plan;
 const record=(status,error)=>fs.writeFileSync(result,JSON.stringify({version,status,...(error?{error:String(error)}:{})}),{mode:0o600});
 let staged,backup,replaced=false,stopNew,complete=false;
 try {
  const end=Date.now()+30000;
  while(parentPid){try{process.kill(parentPid,0);}catch{break;}if(Date.now()>end)throw Error('JARVIS did not quit; update cancelled.');await sleep(100);}
  if(identity(application)!==expected)throw Error('Installed app identity changed during update.');
  verify(candidate,expected,version);
  const base=path.dirname(application),id=crypto.randomUUID();staged=path.join(base,'.JARVIS-update-'+id+'.app');backup=path.join(base,'.JARVIS-backup-'+id+'.app');
  copy(candidate,staged);verify(staged,expected,version);
  fs.renameSync(application,backup);
  try{fs.renameSync(staged,application);}catch(e){fs.renameSync(backup,application);backup=undefined;throw e;}
  replaced=true;stopNew=open(application,['--update-health='+health,'--update-nonce='+nonce]);
  const endHealth=Date.now()+waitMs;
  while(Date.now()<endHealth){
   try{const h=JSON.parse(fs.readFileSync(health,'utf8'));if(h.nonce===nonce && h.version===version){record('installed');fs.rmSync(backup,{recursive:true,force:true});complete=true;return;}}catch{}
   await sleep(Math.min(250,waitMs));
  }
  throw Error('Updated app did not confirm a healthy launch.');
 }catch(e){
  if(replaced && backup){
   try {
    if(typeof stopNew!=='function')throw Error('Cannot safely stop updated app.');
    await stopNew();
    const failed=application+'.failed-'+crypto.randomUUID();fs.renameSync(application,failed);
    try{fs.renameSync(backup,application);}catch(error){fs.renameSync(failed,application);throw error;}
    fs.rmSync(failed,{recursive:true,force:true});backup=undefined;
    record('rolled_back',e);complete=true;open(application,['--background']);
   }catch(recovery){record('recovery_required',String(e)+' '+String(recovery)+' Backup: '+backup);}
  }else record('failed',e);
  throw e;
 }finally{if(staged && fs.existsSync(staged))fs.rmSync(staged,{recursive:true,force:true});if(complete && plan.cleanupStage && path.resolve(candidate)===path.join(path.resolve(plan.cleanupStage),'extracted','JARVIS.app') && path.dirname(path.resolve(health))===path.resolve(plan.cleanupStage) && !path.resolve(result).startsWith(path.resolve(plan.cleanupStage)+path.sep))fs.rmSync(plan.cleanupStage,{recursive:true,force:true});}
}

module.exports={validateArchive,requirement,inspect,prepare,install};
if(require.main===module){
 const plan=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 install(plan).catch(()=>process.exitCode=1);
}
