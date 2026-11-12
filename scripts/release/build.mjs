import { execFileSync } from 'node:child_process';
import { mkdir,copyFile,writeFile,readFile,rm } from 'node:fs/promises';
import { resolve,join } from 'node:path';
const version=JSON.parse(await readFile('package.json','utf8')).version;
if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw Error('Use a stable release version.');
const run=(exe,args)=>execFileSync(exe,args,{stdio:'inherit'});
// Fail before builds if no clean source revision is available. Local signing,
// Android SDK/key and fixed vault must be provisioned on this trusted Mac.
execFileSync('/usr/bin/git',['rev-parse','--verify','HEAD'],{stdio:'ignore'});
if(execFileSync('/usr/bin/git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('Commit reviewed source before building a release.');
run('npm',['ci']);run('npm',['run','typecheck']);run('npm',['test']);
// A fresh checkout has no dist/native cache. Restore verified public runtime
// assets explicitly instead of relying on leftovers from the owner's workspace.
run('/usr/bin/python3',['scripts/setup-wake.py']);
run('/usr/bin/python3',['scripts/setup-remote.py']);
run(process.execPath,['scripts/build-mobile.mjs']);
run('npm',['run','package:local']);run(process.execPath,['scripts/create-dmg.mjs']);run(process.execPath,['scripts/deliver.mjs']);
const directory=resolve('.jarvis/release-candidate');await rm(directory,{recursive:true,force:true});await mkdir(directory,{recursive:true,mode:0o700});
for(const [source,name]of [['JARVIS-macOS-AppleSilicon-test.zip',`JARVIS-macOS-AppleSilicon-${version}.zip`],['JARVIS-macOS-AppleSilicon-test.dmg',`JARVIS-macOS-AppleSilicon-${version}.dmg`],['JARVIS-Android-test.apk',`JARVIS-Android-${version}.apk`]])await copyFile(join('deliverables',source),join(directory,name));
await copyFile('docs/RELEASE-NOTES.txt',join(directory,'RELEASE-NOTES.txt'));
run(process.execPath,['scripts/release/sign-manifest.mjs',directory]);
console.log('Candidate prepared locally. Publication is a separate gated step.');
