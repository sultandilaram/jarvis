import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

test("native desktop controller compiles and its real field policy protects sensitive inputs", { skip: process.platform !== "darwin", timeout: 120000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-native-policy-"));
  try {
    const policy=JSON.parse(await readFile('src/shared/desktop-sensitive.json','utf8'));
    const source=await readFile('native/DesktopControl.swift','utf8');
    assert.equal(source.match(/^let desktopSensitivePattern = #"(.*)"#$/m)?.[1],policy.pattern);
    const helper = join(dir, "desktop-policy-test");
    const compiled = spawnSync("/usr/bin/xcrun", ["swiftc", "-D", "JARVIS_TESTING", "-module-cache-path", join(dir, "modules"), resolve("native/DesktopControl.swift"), "-o", helper], { encoding: "utf8", timeout: 100000 });
    assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
    // The real dispatch orchestration must deny before input and keep its sender
    // alive after exactly one down/up pair. No real input or permission prompt.
    for (const allowed of [false, true]) {
      const result = spawnSync(helper, [], { input: JSON.stringify({ action: "test.pointerDispatch", allowed }), encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { sequence: allowed ? ["preflight", "down", "up", "drain"] : ["preflight"], blocked: !allowed });
    }
    for(const secure of [true,false]) {
      const r=spawnSync(helper,[],{input:JSON.stringify({action:"test.snapshotFields",label:"PIN-LABEL-CANARY",subrole:"PIN-ID-CANARY",value:"VALUE-CANARY",secure}),encoding:"utf8",timeout:5000});
      assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),secure?{label:"[sensitive control]",subrole:"[sensitive]",value:"[redacted]"}:{label:"PIN-LABEL-CANARY",subrole:"PIN-ID-CANARY",value:"VALUE-CANARY"});
    }
    for(const secure of [true,false]) {
      const r=spawnSync(helper,[],{input:JSON.stringify({action:'test.guardedRead',secure}),encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);
      const result=JSON.parse(r.stdout);assert.equal(result.blocked,secure);assert.deepEqual(result.events,secure?['classify']:['classify','read']);assert.equal(JSON.stringify(result).includes('INERT-CANARY'),!secure);
    }
    const {assertDesktopPrivacy}=await import('../src/main/desktop/sensitive.ts');
    for(const browser of [false,true]) {
      const r=spawnSync(helper,[],{input:JSON.stringify({action:'test.protectedWindow',browser,title:'WINDOW-TITLE-CANARY',identifier:'WINDOW-ID-CANARY'}),encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);
      const context=JSON.parse(r.stdout);assert.equal(context.window,'[sensitive window]');assert.equal(context.windowIdentifier,'');assert.equal(context.documentURL,'');assert.equal(context.elements.length,1);assert.equal(context.pageContentAvailable,false);assert.ok(!r.stdout.includes('CANARY'));assert.doesNotThrow(()=>assertDesktopPrivacy(context));
    }
    for(const [nodes,expected] of [
      [[{role:'AXWindow',label:'Fixture',children:[1,3]},{role:'AXGroup',label:'Credentials',children:[2]},{role:'AXWebArea',label:'Private canary',children:[]},{role:'AXWebArea',label:'Public',children:[]}],{found:true,node:3,path:[1],expanded:[0]}],
      [[{role:'AXWindow',label:'Fixture',children:[1]},{role:'AXGroup',label:'Credentials',children:[2]},{role:'AXWebArea',label:'Private canary',children:[]}],{found:false,expanded:[0]}],
      [[{role:'AXWindow',label:'Credentials',children:[1]},{role:'AXWebArea',label:'Private canary',children:[]}],{found:false,expanded:[]}],
    ] as const) {
      const r=spawnSync(helper,[],{input:JSON.stringify({action:'test.pageRoot',nodes}),encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),expected);
    }
    {
      const r=spawnSync(helper,[],{input:JSON.stringify({action:'test.ancestorReadback'}),encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{blocked:true,reads:1,expansions:3});
    }
    for(const [role,allowed] of [['AXWindow',false],['AXGroup',false],['AXWebArea',false],['AXScrollArea',false],['AXUnknown',false],['AXTextField',true],['AXTextArea',true],['AXStaticText',true],['AXButton',true],['AXLink',true]] as const) {
      const r=spawnSync(helper,[],{input:JSON.stringify({action:'test.scalarValue',role}),encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{reads:allowed?1:0,value:allowed?'INERT-SCALAR-CANARY':''});
    }
    const cases: Array<[Record<string, string>, boolean]> = [
      [{ role: "AXTextField", label: "Display name" }, false],
      [{ role: "AXTextArea", label: "Test message" }, false],
      [{ role: "AXTextField", label: "Shipping address" }, false],
      [{ role: "AXTextField", subrole: "AXSecureTextField" }, true],
      [{ role: "AXTextField", label: "Password" }, true],
      [{ role: "AXTextField", label: "Card number" }, true],
      [{ role: "AXTextField", label: "Verification code" }, true],
      [{ role: "AXTextField", label: "PIN" }, true],
      [{ role: "AXTextField", label: "Value", identifier: "api_token" }, true],
      [{ role: "AXTextField", label: "Value", placeholder: "One-time code" }, true],
      [{ role: "AXTextField", label: "Value", help: "credit card security code" }, true],
      [{ role: "AXTextArea", label: "Recovery code" }, true],
      [{ role: "AXSecureTextField", label: "Value" }, true],
      [{ role: "AXTextField", label: "Value", identifier: "fieldPin" }, true],
      [{ role: "AXGroup", label: "Credentials" }, true],
      [{ role: "AXGroup", label: "Message controls" }, false],
      [{ role: "AXWindow", label: "Password settings" }, true],
      [{ role: "AXTextField", label: "Value", help: "Backup code" }, true],
      [{ role: "AXTextField", label: "Value", help: "Recovery phrase" }, true],
      [{ role: "AXTextField", label: "Value", placeholder: "Bank  Account" }, true],
      [{ role: "AXTextField", label: "Value", identifier: "paymentDetails" }, true],
      [{ role: "AXTextField", label: "Value", help: "Credential" }, true],
    ];
    for (const [url, allowed] of [["https://example.com", true], ["http://127.0.0.1:1234/", true], ["file:///tmp/test.html", true], ["chrome://password-manager/", false], ["arc://settings", false], ["data:text/html,private", false], ["https://user:secret@example.com", false], ["", false]] as const) {
      const result = spawnSync(helper, [], { input: JSON.stringify({ action: "test.browserPagePolicy", url }), encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).allowed, allowed, url);
    }
    for (const [value, secure, expected, truncated] of [["x".repeat(1000), false, "x".repeat(1000), false], ["x".repeat(1000) + "hidden tail", false, "x".repeat(1000), true], ["secret", true, "[redacted]", false]] as const) {
      const result = spawnSync(helper, [], { input: JSON.stringify({ action: "test.snapshotValue", value, secure }), encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { value: expected, truncated });
    }
    const frame = { x: 100, y: 200, width: 120, height: 40 };
    const image={action:"test.visualPolicy",frame,width:120,height:40,x:50,y:20};
    for(const [patch,allowed] of [[{},true],[{x:0,y:0},true],[{x:-1},false],[{x:120},false],[{y:40},false],[{width:0},false],[{width:3001},false],[{height:2001},false],[{width:3000,height:2000},false],[{frame:{...frame,width:0}},false]] as const){
      const r=spawnSync(helper,[],{input:JSON.stringify({...image,...patch}),encoding:"utf8",timeout:5000});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).allowed,allowed);
    }
    const visualContext={pageContentAvailable:true,truncated:false,elements:[{secure:false}]};
    for(const [patch,allowed] of [[{},true],[{truncated:true},false],[{pageContentAvailable:false},false],[{elements:[]},false],[{elements:[{secure:true}]},false]] as const){
      const r=spawnSync(helper,[],{input:JSON.stringify({action:"test.visualContext",snapshot:{...visualContext,...patch}}),encoding:"utf8",timeout:5000});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).allowed,allowed);
    }
    for (const [role, actions, allowed] of [["AXStaticText", [], true], ["AXImage", [], true], ["AXGroup", [], true], ["AXHeading", [], true], ["AXLink", [], false], ["AXButton", [], false], ["AXTextField", [], false], ["AXCheckBox", [], false], ["AXUnknown", [], false], ["AXGroup", ["AXPress"], false], ["AXImage", ["AXPress"], false]] as const) {
      const result = spawnSync(helper, [], { input: JSON.stringify({ action: "test.hitPolicy", role, actions }), encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).allowed, allowed, role);
    }
    const context = { documentURL: "https://example.com/form", windowIdentifier: "window-1", window: "Form", pid: 123, pageContentAvailable: true, truncated: false, elements: [{ id: "0.1", role: "AXTextField", value: "approved" }] };
    const nativeContext = { ...context, documentURL: "", windowIdentifier: "", windowKind: "native" };
    for (const [expected, actual, browser, pointer, allowed] of [
      [nativeContext, nativeContext, false, false, true],
      [nativeContext, nativeContext, false, true, false],
      [nativeContext, { ...nativeContext, window: "Other conversation" }, false, false, false],
      [nativeContext, { ...nativeContext, truncated: true }, false, false, false],
      [{ ...nativeContext, windowIdentifier: "stable-window" }, { ...nativeContext, windowIdentifier: "stable-window" }, false, true, true],
      [{ ...nativeContext, windowKind: "web", documentURL: "chrome://passwords" }, { ...nativeContext, windowKind: "web", documentURL: "chrome://passwords" }, false, false, false],
    ] as const) {
      const result = spawnSync(helper, [], { input: JSON.stringify({ action: "test.controlContextPolicy", expected, actual, browser, pointer }), encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).allowed, allowed);
    }
    for (const [patch, allowed] of [[{}, true], [{ elements: [{ id: "0.1", role: "AXTextField", value: "changed" }] }, false], [{ window: "Other" }, false], [{ pid: 456 }, false], [{ windowIdentifier: "window-2" }, false], [{ documentURL: "https://example.com/other" }, false], [{ truncated: true }, false], [{ pageContentAvailable: false }, false]] as const) {
      const result = spawnSync(helper, [], { input: JSON.stringify({ action: "test.contextPolicy", expected: context, actual: { ...context, ...patch } }), encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).allowed, allowed, JSON.stringify(patch));
    }
    for (const patch of [{ windowIdentifier: "" }, { documentURL: "arc://settings" }, { documentURL: "https://user:secret@example.com" }, { truncated: true }, { pageContentAvailable: false }]) {
      const invalid = { ...context, ...patch };
      const result = spawnSync(helper, [], { input: JSON.stringify({ action: "test.contextPolicy", expected: invalid, actual: invalid }), encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).allowed, false);
    }
    for (const [values, timeout, expected, reads] of [[["", "", "settled"], 0.2, "settled", 3], [[""], 0, "", 1]] as const) {
      const result = spawnSync(helper, [], { input: JSON.stringify({ action: "test.readback", values, expected: "settled", timeout }), encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { value: expected, reads });
    }
    const button = { role: "AXButton", browser: true, enabled: true, actions: [], frame };
    for (const [patch, method] of [
      [{}, "pointer"],
      [{ role: "AXLink" }, "pointer"],
      [{ role: "AXTextField" }, "none"],
      [{ role: "AXGroup" }, "none"],
      [{ browser: false }, "none"],
      [{ secure: true }, "none"],
      [{ enabled: false }, "none"],
      [{ enabled: null }, "none"],
      [{ frame: { ...frame, width: 0 } }, "none"],
      [{ frame: { ...frame, height: -1 } }, "none"],
      [{ frame: { ...frame, width: 10001 } }, "none"],
      [{ frame: { ...frame, x: 100001 } }, "none"],
      [{ frame: { x: 1, width: 10, height: 10 } }, "none"],
      [{ actions: ["AXPress"] }, "accessibility"],
      [{ actions: ["AXPress"], browser: false }, "accessibility"],
      [{ actions: ["AXPress"], secure: true }, "none"],
      [{ actions: ["AXPress"], enabled: false }, "none"],
    ] as const) {
      const result = spawnSync(helper, [], { input: JSON.stringify({ action: "test.pressPolicy", ...button, ...patch }), encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).method, method, JSON.stringify(patch));
    }
    for (const [input, expected] of cases) {
      const result = spawnSync(helper, [], { input: JSON.stringify({ action: "test.fieldPolicy", ...input }), encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).sensitive, expected, JSON.stringify(input));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
