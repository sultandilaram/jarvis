import {spawn,spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,copyFile,mkdtemp,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
if(process.platform!=='win32')throw Error('These tests require an actual Windows desktop session. Cross-compilation is insufficient.');
const helper=resolve('.jarvis/windows-native/JarvisNative.exe');
function call(request,ok=true){const r=spawnSync(helper,[],{input:JSON.stringify(request),encoding:'utf8',timeout:20000,windowsHide:true});if(r.error)throw r.error;const value=JSON.parse(r.stdout);if(ok)assert.equal(value.error,undefined,value.detail);else assert.ok(value.error);return value;}
const fixtureExecutable=resolve('.jarvis/windows-fixture/NativeControlFixture.exe');
await mkdir('.jarvis/verification',{recursive:true});
const policyDirectory=await mkdtemp(resolve('.jarvis/verification/path-policy-'));
try {
 const systemRoot=process.env.SystemRoot||process.env.WINDIR;if(!systemRoot)throw Error('Windows system root unavailable.');
 for(const [name,source,allowed]of [['ordinary.exe',join(systemRoot,'explorer.exe'),true],['WindowsTerminal.exe',join(systemRoot,'explorer.exe'),false],['ordinary-looking.exe',join(systemRoot,'System32','cmd.exe'),false]]) {
  const target=join(policyDirectory,name),resultFile=join(policyDirectory,name+'.json');await copyFile(source,target,constants.COPYFILE_EXCL);
  const run=spawnSync(fixtureExecutable,['--probe-ordinary',resolve('.jarvis/windows-native/JarvisNative.dll'),target,resultFile],{encoding:'utf8',timeout:20000,windowsHide:true});if(run.error)throw run.error;assert.equal(run.status,0,run.stderr);
  const result=JSON.parse(await readFile(resultFile,'utf8'));assert.equal(result.allowed,allowed,name);if(!allowed)assert.match(result.reason,/require direct interaction/);
 }
}finally{await rm(policyDirectory,{recursive:true,force:true});}
const child=spawn(fixtureExecutable,[],{stdio:'ignore'});
try{
 let app;for(let i=0;i<30;i++){app=call({action:'apps.list'}).apps.find(a=>a.path?.toLowerCase()===fixtureExecutable.toLowerCase());if(app)break;await new Promise(r=>setTimeout(r,500));}assert.ok(app,'Real fixture window did not open');
 const observe=()=>{const snapshot=call({action:'desktop.observe',bundleId:app.bundleId});assert.equal(snapshot.pid,child.pid,'Refusing to target an existing or unrelated fixture process');return snapshot;};
 let snapshot=observe();assert.equal(snapshot.truncated,false);assert.equal(snapshot.pageContentAvailable,true);
 assert.ok(!JSON.stringify(snapshot).includes('must-not-leak'),'Sensitive values or identifiers leaked');
 assert.ok(!JSON.stringify(snapshot).includes('Nested ordinary fixture'),'Protected parent descendants must not be traversed');
 assert.ok(snapshot.elements.filter(e=>e.secure).length>=9,'Password, PIN/OTP/bank identifiers, help-only input and protected parent must be protected');
 function request(snapshot,element,action,text){return{action,bundleId:app.bundleId,windowIdentifier:snapshot.windowIdentifier,contextSnapshot:snapshot,elementId:element.id,text};}
 const field=snapshot.elements.find(e=>e.label==='Fixture message');assert.ok(field);
 const old=snapshot;
 call(request(snapshot,field,'desktop.type','Blue'));
 snapshot=observe();assert.equal(snapshot.elements.find(e=>e.id===field.id).value,'Blue');
 call(request(old,field,'desktop.type','Stale input'),false);
 for(const secure of snapshot.elements.filter(e=>e.secure)){call(request(snapshot,secure,'desktop.type','No'),false);}
 const submit=snapshot.elements.find(e=>e.label==='Submit local fixture');assert.ok(submit);call(request(snapshot,submit,'desktop.press'));
 assert.ok(JSON.stringify(observe()).includes('Submitted: Blue'));
 call({action:'desktop.capture',bundleId:app.bundleId},false);
 const missing=spawnSync(helper,['--wake','--file',resolve('tests/fixtures/windows-wake/does-not-exist.wav')],{encoding:'utf8',timeout:45000,windowsHide:true});
 assert.equal(missing.status,1);const failure=JSON.parse(missing.stdout.trim());assert.equal(failure.type,'error');assert.equal(typeof failure.message,'string');
 const results=[];
 for(const [name,expected] of [['positive',true],['unrelated',false],['near-name',false]]){
  const run=spawnSync(helper,['--wake','--file',resolve(`tests/fixtures/windows-wake/${name}.wav`)],{encoding:'utf8',timeout:45000,windowsHide:true});if(run.error)throw run.error;
  const event=JSON.parse(run.stdout.trim());assert.equal(event.onDevice,true);assert.equal(event.type,expected?'wake':'no_wake',`${name}: ${run.stdout}`);results.push({name,detected:event.type==='wake'});
 }
 await mkdir('.jarvis/verification',{recursive:true});await writeFile('.jarvis/verification/windows-native.json',JSON.stringify({platform:process.platform,nativeControl:true,protectedExecutablePolicy:true,secretRedaction:true,staleInputRejected:true,readback:'Submitted: Blue',offlineWake:results,physicalMicrophoneTested:false},null,2));
 console.log('Windows UI Automation and offline wake fixtures passed. Physical microphone acceptance remains separate.');
}finally{child.kill();}
