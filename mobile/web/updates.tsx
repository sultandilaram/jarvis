import React,{useEffect,useState} from 'react';
import type { MobileLink } from './link';
export function MobileUpdates({link,connected}:{link:MobileLink;connected:boolean}){
 const [status,setStatus]=useState('Updates are checked through your paired desktop.');
 const [release,setRelease]=useState<any>();const [busy,setBusy]=useState(false);
 useEffect(()=>{const listener=(event:Event)=>{try{const d=JSON.parse((event as CustomEvent).detail);if(d.type==='update'){setStatus(String(d.value));setBusy(false);}}catch{}};window.addEventListener('jarvis-native',listener);return()=>window.removeEventListener('jarvis-native',listener);},[]);
 const check=async()=>{setBusy(true);setRelease(undefined);setStatus('Checking signed GitHub release…');try{
  await link.rpc('updates.check',{});const r=await link.rpc('updates.android',{});
  const current=(window.JarvisNative?.getAppVersion?.()||'0.0.0').replace(/-test$/,'');
  const a=String(r.version).split('.').map(Number),b=current.split('.').map(Number);let newer=false;for(let i=0;i<3;i++){if(a[i]!==b[i]){newer=a[i]>b[i];break;}}
  if(newer){setRelease(r);setStatus('JARVIS '+r.version+' is verified and available.');}else setStatus('No newer Android release is available.');
 }catch(e){setStatus(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 return <section><h2>App updates</h2><p role="status">{status}</p><div className="button-row"><button disabled={!connected||busy} onClick={()=>void check()}>Check Android updates</button>
 {release&&<button disabled={busy||!window.JarvisNative?.installVerifiedUpdate} onClick={()=>{window.JarvisNative?.installVerifiedUpdate?.(JSON.stringify(release));}}>Review Android update</button>}</div><p className="muted">Downloads are checked against signed release metadata from your Mac. Android asks before installation.</p></section>;
}
