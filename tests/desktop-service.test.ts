import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import cp from "node:child_process";

test('container text replacement is refused before approval, readback or dispatch; ordinary leaf siblings remain editable',async()=>{
 const stub='data:text/javascript,'+encodeURIComponent('export const dialog={};export const shell={};export class BrowserWindow{};export class WebContentsView{};export const session={};');
 const hooks=registerHooks({resolve(s,c,n){return s==='electron'?{url:stub,shortCircuit:true}:n(s,c);}});
 const original=cp.execFile;let current:any;const calls:any[]=[];
 (cp as any).execFile=(_f:unknown,_a:unknown,_o:unknown,cb:any)=>({stdin:{end(raw:string){const req=JSON.parse(raw);calls.push(req);queueMicrotask(()=>cb(null,JSON.stringify(req.action==='desktop.observe'?current:{accepted:true,verified:false})));}}});syncBuiltinESMExports();
 try {
  const {DesktopService}=await import('../src/main/desktop/service.ts');
  const base={pid:123,window:'Fixture',documentURL:'',pageContentAvailable:true,truncated:false};
  const field={id:'0.1',runtimeId:'42.1',role:'AXTextField',subrole:'',label:'Message',value:'',secure:false,actions:[],pressMethod:'none',frame:{}};
  for(const windows of [false,true])for(const role of ['AXTextField','AXTextArea'])for(const protectedChild of [false,true])for(const reversed of [false,true]){
   const child=protectedChild?{...field,id:'0.1.0',runtimeId:'42.2',label:'[sensitive control]',subrole:'[sensitive]',value:'[redacted]',secure:true}:{...field,id:'0.1.0',runtimeId:'42.2',role:'AXStaticText',label:'Ordinary text',value:'ordinary'};
   const parent={...field,role};current={...base,bundleId:windows?'windows.exe.'+'a'.repeat(64):'com.example.Fixture',windowIdentifier:windows?'1234':'fixture',windowKind:windows?'application':'native',elements:reversed?[child,parent]:[parent,child]};
   const service=new DesktopService('inert-helper',()=>[],()=>{},()=>{throw Error('No UI');});let approvals=0;
   service.broker.on('approval',(a:any)=>{approvals++;service.broker.decide(a.id,false);});
   const read=await service.broker.execute('desktop.observe',{bundleId:current.bundleId});assert.equal(read.success,true);
   const snapshotId=service.snapshots.keys().next().value;assert.ok(snapshotId);
   const before=calls.length;const result=await service.broker.execute('desktop.type',{snapshotId,elementId:parent.id,text:'Must not replace children'});
   assert.equal(result.success,false);assert.equal(approvals,0);assert.equal(calls.length,before);assert.equal(service.broker.pending.size,0);service.stop();
  }
  current={...base,bundleId:'com.example.Fixture',windowIdentifier:'fixture',windowKind:'native',elements:[field,{...field,id:'0.10',runtimeId:'42.3',label:'Sibling'}]};
  const service=new DesktopService('inert-helper',()=>[],()=>{},()=>{throw Error('No UI');});let approvals=0;
  service.broker.on('approval',(a:any)=>{approvals++;service.broker.decide(a.id,true);});
  const read=await service.broker.execute('desktop.observe',{bundleId:current.bundleId});const before=calls.filter(c=>c.action==='desktop.type').length;
  const result=await service.broker.execute('desktop.type',{snapshotId:service.snapshots.keys().next().value,elementId:field.id,text:'Blue'});
  assert.equal(result.success,true);assert.equal(approvals,1);assert.equal(calls.filter(c=>c.action==='desktop.type').length-before,1);service.stop();
 }finally{cp.execFile=original;syncBuiltinESMExports();hooks.deregister();}
});

test("browser mutation planning refuses incomplete context before offering approval", async () => {
  // No Electron runtime or UI is started: only the real service planner is exercised.
  const stub = "data:text/javascript," + encodeURIComponent("export const dialog={};export const shell={};export class BrowserWindow{};export class WebContentsView{};export const session={};");
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    return specifier === "electron" ? { url: stub, shortCircuit: true } : nextResolve(specifier, context);
  } });
  try {
    const { DesktopService } = await import("../src/main/desktop/service.ts");
    const service = new DesktopService("/must-not-execute", () => [], () => {}, () => { throw Error("No UI in planner test"); });
    const field = { id: "0.1", role: "AXTextField", subrole: "", label: "Display name", value: "", secure: false, actions: ["AXPress"] };
    const snapshot = { bundleId: "company.thebrowser.Browser", pid: 123, window: "Test form", windowIdentifier: "test-window", documentURL: "https://example.com/form", windowKind: "web", pageContentAvailable: true, truncated: false, elements: [field] };
    for (const action of ["desktop.press", "desktop.type"]) {
      const args = { snapshotId: "test", elementId: field.id, text: "Sultan Test" };
      for (const changed of [
        { truncated: true },
        { pageContentAvailable: false },
        { pageContentAvailable: undefined },
        { documentURL: "" },
        { documentURL: "arc://settings" },
        { documentURL: "https://user:secret@example.com" },
        { elements: [{ ...field, secure: true }] },
      ]) {
        service.snapshots.set("test", { ...snapshot, ...changed });
        await assert.rejects(() => service.plan(action, args, new AbortController().signal));
        const result = await service.broker.execute(action, args);
        assert.equal(result.success, false);
        assert.equal(service.broker.pending.size, 0);
      }
      service.snapshots.set("test", snapshot);
      const plan = await service.plan(action, args, new AbortController().signal);
      assert.equal(plan.approval, true);
      assert.equal(plan.preview.page, snapshot.documentURL);
      assert.equal(plan.preview.window, snapshot.window);
      assert.equal(typeof plan.verify, "function");
    }
  } finally { hooks.deregister(); }
});

test("pointer fallback keeps exact approval, rejects changed bounds and ignores caller metadata overrides", async () => {
  const stub = "data:text/javascript," + encodeURIComponent("export const dialog={};export const shell={};export class BrowserWindow{};export class WebContentsView{};export const session={};");
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    return specifier === "electron" ? { url: stub, shortCircuit: true } : nextResolve(specifier, context);
  } });
  const original = cp.execFile;
  let current: any;
  const dispatched: any[] = [];
  (cp as any).execFile = (_file: unknown, _args: unknown, _options: unknown, callback: any) => ({ stdin: { end(raw: string) {
    const args = JSON.parse(raw);
    if (args.action !== "desktop.observe") dispatched.push(args);
    queueMicrotask(() => callback(null, JSON.stringify(args.action === "desktop.observe" ? current : { dispatched: true, verified: false })));
  } } });
  syncBuiltinESMExports();
  try {
    const { DesktopService } = await import("../src/main/desktop/service.ts");
    const field = { id: "0.1", role: "AXButton", subrole: "", label: "Preview test form", value: "", secure: false, actions: [], pressMethod: "pointer", frame: { x: 100, y: 200, width: 120, height: 40 } };
    const base = { bundleId: "company.thebrowser.Browser", pid: 123, window: "Local test", windowIdentifier: "window-1", documentURL: "https://example.com/form", windowKind: "web", pageContentAvailable: true, truncated: false, elements: [field] };
    const make = () => new DesktopService("synthetic-only", () => [], () => {}, () => { throw Error("No UI"); });
    for (const mode of ["approve", "bounds changed", "decline", "stop"]) {
      const service = make();
      current = structuredClone(base);
      service.snapshots.set("test", structuredClone(current));
      const before = dispatched.length;
      service.broker.once("approval", (a: any) => {
        assert.equal(dispatched.length, before);
        assert.deepEqual(a.params.preview.element.frame, field.frame);
        assert.equal(a.params.preview.page, base.documentURL);
        if (mode === "bounds changed") current.elements[0].frame.x++;
        if (mode === "stop") service.stop();
        else service.broker.decide(a.id, mode !== "decline");
      });
      const result = await service.broker.execute("desktop.press", { snapshotId: "test", elementId: field.id, frame: { x: 99999, y: 99999, width: 1, height: 1 }, contextSnapshot: { malicious: true }, pressMethod: "accessibility", role: "AXLink", label: "Injected", value: "Injected", pid: 999 });
      assert.equal(result.success, mode === "approve");
      assert.equal(dispatched.length - before, mode === "approve" ? 1 : 0);
      if (mode === "approve") {
        assert.deepEqual(dispatched.at(-1).frame, field.frame);
        for (const key of ["role", "label", "value", "pressMethod"] as const) assert.equal(dispatched.at(-1)[key], field[key]);
        assert.equal(dispatched.at(-1).pid, base.pid);
        assert.deepEqual(dispatched.at(-1).contextSnapshot, base);
      }
    }
    for (const patch of [{ role: "AXTextField" }, { pressMethod: "none" }, { actions: ["AXPress"], pressMethod: "none" }, { secure: true }, { frame: { ...field.frame, width: 0 } }, { frame: { ...field.frame, x: Infinity } }, { frame: { ...field.frame, width: "120" } }]) {
      const service = make();
      service.snapshots.set("test", { ...base, elements: [{ ...field, ...patch }] });
      await assert.rejects(() => service.plan("desktop.press", { snapshotId: "test", elementId: field.id }, new AbortController().signal));
      assert.equal(service.broker.pending.size, 0);
    }
    const missingWindow = make();
    missingWindow.snapshots.set("test", { ...base, windowIdentifier: "" });
    await assert.rejects(() => missingWindow.plan("desktop.press", { snapshotId: "test", elementId: field.id }, new AbortController().signal));
  } finally { cp.execFile = original; syncBuiltinESMExports(); hooks.deregister(); }
});

test('sensitive native controls are refused before readback, approval or input even if a helper mislabels them',async()=>{
 const stub='data:text/javascript,'+encodeURIComponent('export const dialog={};export const shell={};export class BrowserWindow{};export class WebContentsView{};export const session={};');
 const hooks=registerHooks({resolve(s,c,n){return s==='electron'?{url:stub,shortCircuit:true}:n(s,c);}});
 const original=cp.execFile;let current:any;const dispatched:any[]=[];
 (cp as any).execFile=(_f:unknown,_a:unknown,_o:unknown,callback:any)=>({stdin:{end(raw:string){const req=JSON.parse(raw);if(req.action!=='desktop.observe')dispatched.push(req);queueMicrotask(()=>callback(null,JSON.stringify(req.action==='desktop.observe'?current:{accepted:true})));}}});syncBuiltinESMExports();
 try {
  const {DesktopService}=await import('../src/main/desktop/service.ts');
  for(const label of ['PIN','OTP','Bank account','Routing number','IBAN','SSN','apiKey','Private key','Verification code','Security code','Social security','Recovery code','Bank  Account']) {
   const service=new DesktopService('inert-helper',()=>[],()=>{},()=>{throw Error('No UI');});
   const field={id:'0.1',role:'AXTextField',subrole:'',label,value:'inert-sensitive-canary',secure:false,sensitive:false,actions:[],pressMethod:null,frame:{x:0,y:0,width:100,height:30}};
   current={bundleId:'windows.exe.'+'a'.repeat(64),pid:123,window:'Inert test',windowIdentifier:'1234',documentURL:'',windowKind:'application',pageContentAvailable:true,truncated:false,elements:[field]};
   const read=await service.broker.execute('desktop.observe',{bundleId:current.bundleId});assert.equal(read.success,false,label);assert.ok(!JSON.stringify(read).includes('inert-sensitive-canary'));
   service.snapshots.set('inert',structuredClone(current));const before=dispatched.length;
   const write=await service.broker.execute('desktop.type',{snapshotId:'inert',elementId:field.id,text:'Must not dispatch'});
   assert.equal(write.success,false,label);assert.equal(service.broker.pending.size,0);assert.equal(dispatched.length,before);
  }
  for(const changed of [{label:'PIN-LABEL-CANARY'},{subrole:'PIN-ID-CANARY'},{helpText:'Verification code',secure:false,sensitive:false,label:'Input',value:'VALUE-CANARY'}]) {
   const service=new DesktopService('inert-helper',()=>[],()=>{},()=>{throw Error('No UI');});
   current={bundleId:'windows.exe.'+'a'.repeat(64),pid:123,window:'Inert test',windowIdentifier:'1234',documentURL:'',windowKind:'application',pageContentAvailable:true,truncated:false,elements:[{id:'0.1',role:'AXTextField',label:'[sensitive control]',subrole:'[sensitive]',value:'',secure:true,sensitive:true,actions:[],pressMethod:'none',frame:{},...changed}]};
   const r=await service.broker.execute('desktop.observe',{bundleId:current.bundleId});assert.equal(r.success,false);assert.ok(!JSON.stringify(r).includes('CANARY'));assert.equal(service.broker.pending.size,0);
  }
  const {assertDesktopPrivacy,sensitiveDesktopContext}=await import('../src/main/desktop/sensitive.ts');
  assert.equal(sensitiveDesktopContext('Display name'),false);assert.equal(sensitiveDesktopContext('fieldPin'),true);
  assert.throws(()=>assertDesktopPrivacy({elements:[{role:'AXTextField',subrole:'AXSecureTextField',label:'Input',value:'canary',secure:false}]}));
  assert.throws(()=>assertDesktopPrivacy({elements:[{role:'AXTextField',label:'[sensitive]',value:'canary',secure:true}]}));
  const protectedContext={bundleId:'com.example.Fixture',pid:123,window:'Fixture',windowIdentifier:'fixture',documentURL:'',windowKind:'native',pageContentAvailable:true,truncated:false,elements:[{id:'0.1',role:'AXTextField',label:'[sensitive control]',subrole:'[sensitive]',value:'[redacted]',secure:true,actions:[],pressMethod:'none',frame:{}}]};
  assert.doesNotThrow(()=>assertDesktopPrivacy(protectedContext));
  for(const changed of [{label:'PIN-LABEL-CANARY'},{subrole:'PIN-ID-CANARY'},{helpText:'Verification code'},{identifier:'ID-CANARY'},{frame:{secret:'CANARY'}},{actions:['AX-SECRET-CANARY']},{role:'AX-PIN-CANARY'},{secure:'CANARY'}])assert.throws(()=>assertDesktopPrivacy({...protectedContext,elements:[{...protectedContext.elements[0],...changed}]}));
  assert.throws(()=>assertDesktopPrivacy({...protectedContext,elements:[{...protectedContext.elements[0],secure:false,value:'FLAG-MISMATCH-CANARY'}]}));
  const ordinary={...protectedContext,elements:[{...protectedContext.elements[0],label:'Message',subrole:'',value:'ordinary',secure:false}]};
  current=structuredClone(ordinary);
  assert.equal((await new DesktopService('inert-helper',()=>[],()=>{},()=>{throw Error('No UI');}).broker.execute('desktop.observe',{bundleId:ordinary.bundleId})).success,true);
  const parent={...protectedContext.elements[0],id:'0',role:'AXGroup'};
  const descendant={...ordinary.elements[0],id:'0.1',value:'DESCENDANT-CANARY'};
  for(const elements of [[parent,descendant],[descendant,parent],[{...parent,id:''},{...descendant,id:'0'}]]) {
   current={...ordinary,elements};const service=new DesktopService('inert-helper',()=>[],()=>{},()=>{throw Error('No UI');});
   const r=await service.broker.execute('desktop.observe',{bundleId:ordinary.bundleId});assert.equal(r.success,false);assert.ok(!JSON.stringify(r).includes('CANARY'));assert.equal(service.snapshots.size,0);assert.equal(service.broker.pending.size,0);
  }
  assert.doesNotThrow(()=>assertDesktopPrivacy({...ordinary,elements:[{...parent,id:'0.1'},{...descendant,id:'0.2',value:'ordinary'}]}));
  assert.throws(()=>assertDesktopPrivacy({...ordinary,elements:[{...ordinary.elements[0],id:'0',role:'AXGroup',label:'Credentials'},descendant]}));
  const protectedWindow={...ordinary,window:'[sensitive window]',windowIdentifier:'',pageContentAvailable:false,elements:[{...parent,id:'',role:'AXWindow'}]};
  assert.doesNotThrow(()=>assertDesktopPrivacy(protectedWindow));
  for(const patch of [{window:'WINDOW-TITLE-CANARY'},{windowIdentifier:'WINDOW-ID-CANARY'},{documentURL:'https://example.com/?token=WINDOW-URL-CANARY'}]) {
   current={...protectedWindow,...patch};const service=new DesktopService('inert-helper',()=>[],()=>{},()=>{throw Error('No UI');});const events:any[]=[];service.broker.on('activity',e=>events.push(e));
   const r=await service.broker.execute('desktop.observe',{bundleId:ordinary.bundleId});assert.equal(r.success,false);assert.ok(!JSON.stringify([r,events]).includes('CANARY'));assert.equal(service.snapshots.size,0);assert.equal(service.broker.pending.size,0);
  }
  const badMetadata=[
   {window:{helpText:'Verification code',value:'ROOT-CANARY'}},
   {pid:{value:'PID-CANARY'}},{documentURL:{value:'URL-CANARY'}},
   ...[{label:{helpText:'Verification code',value:'LABEL-CANARY'}},{value:{secret:'VALUE-CANARY'}},{id:{value:'ID-CANARY'}},{runtimeId:{value:'RUNTIME-CANARY'}},{role:{value:'ROLE-CANARY'}},{actions:[{value:'ACTION-CANARY'}]},{actions:['AXPress',{value:'ACTION-CANARY'}]},{frame:null},{frame:[]},{frame:{x:0}},{secure:undefined},{pressMethod:{value:'METHOD-CANARY'}}].map(p=>({elements:[{...ordinary.elements[0],...p}]})),
   {elements:[ordinary.elements[0],ordinary.elements[0]]},
  ];
  for(const patch of badMetadata) {
   current={...structuredClone(ordinary),...patch};const service=new DesktopService('inert-helper',()=>[],()=>{},()=>{throw Error('No UI');});
   const r=await service.broker.execute('desktop.observe',{bundleId:ordinary.bundleId});
   assert.equal(r.success,false,JSON.stringify(patch));assert.ok(!JSON.stringify(r).includes('CANARY'));assert.equal(service.broker.pending.size,0);assert.equal(service.snapshots.size,0);
  }
  assert.equal(dispatched.length,0);
 }finally{cp.execFile=original;syncBuiltinESMExports();hooks.deregister();}
});
