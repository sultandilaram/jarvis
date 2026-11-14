import {execFileSync} from 'node:child_process';
import {rm, mkdir, copyFile,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
const dotnet=process.env.JARVIS_DOTNET||'dotnet';
const env={...process.env,DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_GENERATE_ASPNET_CERTIFICATE:'false',DOTNET_SKIP_FIRST_TIME_EXPERIENCE:'1'};
const output=resolve('.jarvis/windows-native');await rm(output,{recursive:true,force:true});
execFileSync(dotnet,['publish','JarvisNative.csproj','-c','Release','-p:RestoreLockedMode=true','-o',output],{cwd:'native/windows',env,stdio:'inherit'});
const notices=join(output,'licenses');await mkdir(notices,{recursive:true});
const packages=process.env.NUGET_PACKAGES||join(homedir(),'.nuget','packages');
for(const [source,name] of [
 ['microsoft.netcore.app.runtime.win-x64/10.0.15/LICENSE.TXT','DOTNET-LICENSE.txt'],
 ['microsoft.netcore.app.runtime.win-x64/10.0.15/THIRD-PARTY-NOTICES.TXT','DOTNET-THIRD-PARTY-NOTICES.txt'],
 ['microsoft.windowsdesktop.app.runtime.win-x64/10.0.15/LICENSE','WPF-LICENSE.txt'],
])await copyFile(join(packages,source),join(notices,name));
await copyFile('LICENSE',join(notices,'VOSK-APACHE-2.0.txt'));
for(const name of ['GCC-GPL-3.0.txt','GCC-RUNTIME-EXCEPTION.txt','WINPTHREADS-COPYING.txt'])await copyFile(join('docs/licenses/windows',name),join(notices,name));
await copyFile('docs/WINDOWS-NATIVE-NOTICES.txt',join(notices,'WINDOWS-NATIVE-NOTICES.txt'));
const sourceHashes={};for(const name of ['native/windows/Desktop.cs','native/windows/Wake.cs','native/windows/Program.cs','native/windows/JarvisNative.csproj','native/windows/app.manifest','native/windows/packages.lock.json','src/shared/desktop-sensitive.json'])sourceHashes[name]=createHash('sha256').update(await readFile(name)).digest('hex');
await writeFile(join(output,'build-receipt.json'),JSON.stringify({schema:1,platform:'win32',arch:'x64',sourceHashes},null,2));
console.log('Windows helper published with locked native DLLs and runtime notices.');
