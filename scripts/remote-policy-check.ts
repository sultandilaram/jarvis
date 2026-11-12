import {app} from 'electron';
import assert from 'node:assert/strict';
import {RemoteLink} from '../src/main/remote/link.ts';
app.setName('JARVIS remote policy check');
void app.whenReady().then(async()=>{
  let local=false,active=false,exchanges=0;
  const state:any={entries:[],tasks:[],approvals:[],memories:[{text:'private memory'}]};
  const link=new RemoteLink('/unused','/unused',()=>null as any,()=>state,async(method)=>{assert.equal(method,'voice.connect');exchanges++;return {sdp:'synthetic'};},v=>{active=v;},()=>local);
  const phone:any={id:'fixture-one'},other:any={id:'fixture-two'};
  try {
    await assert.rejects(()=>link.rpc('saveKey',{key:'not-a-key'},phone),/not available/);
    await assert.rejects(()=>link.rpc('settings',{routineChecks:true},phone),/not available/);
    assert.deepEqual((await link.rpc('snapshot',{},phone) as any).memories,[]);
    local=true;
    await assert.rejects(()=>link.rpc('voice.activity',{active:true},phone),/Another/);
    local=false;
    await link.rpc('voice.activity',{active:true},phone);
    assert.equal(active,true);
    await assert.rejects(()=>link.rpc('voice.activity',{active:true},other),/Another/);
    await assert.rejects(()=>link.rpc('voice.connect',{sdp:'synthetic'},other),/authorized/);
    await link.rpc('voice.connect',{sdp:'synthetic'},phone);
    await assert.rejects(()=>link.rpc('voice.connect',{sdp:'synthetic'},phone),/authorized/);
    assert.equal(exchanges,1);
    link.gateway.emit('disconnect',phone.id);
    assert.equal(active,false);
    await assert.rejects(()=>link.rpc('voice.heartbeat',{},phone),/expired/);
    console.log(JSON.stringify({passed:true,remotePrivilegesRestricted:true,voiceExclusion:true,singleExchange:true,disconnectReleasesVoice:true}));
  } finally {link.close();app.quit();}
}).catch(e=>{console.error(e.message);app.exit(1);});
