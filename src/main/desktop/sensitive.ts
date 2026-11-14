import policy from '../../shared/desktop-sensitive.json' with {type:'json'};
const pattern=new RegExp(policy.pattern,'i');
export function sensitiveDesktopContext(...values:unknown[]):boolean {
  const context=values.filter(v=>typeof v==='string').join(' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/\s+/g,' ');
  return pattern.test(context);
}
const rootKeys=new Set(['bundleId','pid','window','windowIdentifier','documentURL','windowKind','pageContentAvailable','truncated','elements']);
const elementKeys=new Set(['id','runtimeId','role','subrole','label','value','secure','sensitive','actions','pressMethod','frame']);
const frameKeys=new Set(['x','y','width','height']);
// Refuse incompatible or unredacted responses before any native data reaches the
// model. Do not rewrite the exact context used for stale-target verification.
export function assertDesktopPrivacy(snapshot:any):void {
  const record=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const text=(v:any,max=10000)=>typeof v==='string'&&v.length<=max;
  const pathId=(v:any)=>text(v,1024)&&/^\d*(?:\.\d+)*$/.test(v);
  const axName=(v:any)=>text(v,200)&&/^AX[A-Za-z][A-Za-z0-9]*$/.test(v);
  if(!record(snapshot)||Object.keys(snapshot).some(k=>!rootKeys.has(k))||!text(snapshot.bundleId,200)||!/^[-\w.]+$/.test(snapshot.bundleId)||!Number.isSafeInteger(snapshot.pid)||snapshot.pid<1||!text(snapshot.window)||!text(snapshot.windowIdentifier)||!text(snapshot.documentURL,8192)||!['native','web','application'].includes(snapshot.windowKind)||typeof snapshot.pageContentAvailable!=='boolean'||typeof snapshot.truncated!=='boolean'||!Array.isArray(snapshot.elements)||snapshot.elements.length>500)throw Error('Incompatible native snapshot. Use direct interaction.');
  if(snapshot.documentURL) {
    let url:URL;try{url=new URL(snapshot.documentURL);}catch{throw Error('Incompatible native document URL. Use direct interaction.');}
    if(!['http:','https:','file:'].includes(url.protocol)||url.username||url.password)throw Error('Restricted native document URL. Use direct interaction.');
  }
  const ids=new Set<string>(),protectedIds:string[]=[];
  for(const e of snapshot.elements) {
    if(!record(e)||Object.keys(e).some(k=>!elementKeys.has(k))||!pathId(e.id)||ids.has(e.id)||!axName(e.role)||!text(e.subrole)||!text(e.label)||!text(e.value)||typeof e.secure!=='boolean'||!Array.isArray(e.actions)||e.actions.length>64||!e.actions.every(axName)||!Object.hasOwn(e,'pressMethod')||![null,'none','accessibility','pointer'].includes(e.pressMethod))throw Error('Incompatible native control metadata. Use direct interaction.');
    ids.add(e.id);
    if(e.runtimeId!==undefined&&(!text(e.runtimeId,1024)||! /^-?\d+(?:\.-?\d+)*$/.test(e.runtimeId)))throw Error('Incompatible native control identity. Use direct interaction.');
    if(!record(e.frame)||Object.entries(e.frame).some(([k,v])=>!frameKeys.has(k)||typeof v!=='number'||!Number.isFinite(v))||![0,4].includes(Object.keys(e.frame).length)||Object.keys(e.frame).length===4&&(e.frame.width<0||e.frame.height<0))throw Error('Incompatible native control bounds. Use direct interaction.');
    if(e.sensitive!==undefined&&typeof e.sensitive!=='boolean')throw Error('Incompatible native privacy flags. Use direct interaction.');
    const inputContext=['AXTextField','AXTextArea','AXComboBox','AXSecureTextField','AXGroup','AXWindow'].includes(e.role);
    const recognized=e.label==='[sensitive control]'||e.subrole==='[sensitive]'||inputContext&&(e.role==='AXSecureTextField'||/secure/i.test(String(e.subrole||''))||sensitiveDesktopContext(e.label,e.subrole));
    if(recognized&&!e.secure&&!e.sensitive)throw Error('The native helper returned an unprotected sensitive field. Use direct interaction.');
    if(e.secure||e.sensitive) {
      protectedIds.push(e.id);
      if(!['AXTextField','AXTextArea','AXComboBox','AXSecureTextField','AXWindow','AXGroup','AXButton','AXLink'].includes(e.role))throw Error('Incompatible sensitive control role. Use direct interaction.');
      if(!['','[redacted]'].includes(e.value)||e.label!=='[sensitive control]'||e.subrole!=='[sensitive]'||!Array.isArray(e.actions)||e.actions.length||![null,undefined,'none'].includes(e.pressMethod))throw Error('The native helper returned unredacted sensitive metadata. Use direct interaction.');
      if(typeof e.id!=='string'||!/^\d*(?:\.\d+)*$/.test(e.id)||e.runtimeId!==undefined&&(typeof e.runtimeId!=='string'||! /^-?\d+(?:\.-?\d+)*$/.test(e.runtimeId)))throw Error('Incompatible sensitive control identity. Use direct interaction.');
    }
  }
  const protectedWindow=snapshot.elements.some((e:any)=>e.role==='AXWindow'&&(e.secure||e.sensitive)&&(e.id===''||e.id==='0'));
  if(protectedWindow||snapshot.window==='[sensitive window]'||sensitiveDesktopContext(snapshot.window,snapshot.windowIdentifier)) {
    const safeIdentity=snapshot.windowIdentifier===''||/^windows\.exe\.[a-f0-9]{64}$/.test(snapshot.bundleId)&&/^-?\d{1,20}$/.test(snapshot.windowIdentifier);
    const protectedOnly=protectedWindow&&snapshot.elements.length===1;
    const unavailable=snapshot.elements.length===0&&snapshot.pageContentAvailable===false;
    if(snapshot.window!=='[sensitive window]'||snapshot.documentURL!==''||!safeIdentity||!protectedOnly&&!unavailable)throw Error('The native helper returned unredacted protected-window metadata. Use direct interaction.');
  }
  for(const parent of protectedIds)if(snapshot.elements.some((e:any)=>e.id!==parent&&(parent===''||e.id.startsWith(parent+'.'))))throw Error('The native helper exposed a protected control subtree. Use direct interaction.');
}
