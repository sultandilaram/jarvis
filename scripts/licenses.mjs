import { execFileSync } from 'node:child_process';
import { readFile,readdir,mkdir,copyFile,writeFile,rm,realpath } from 'node:fs/promises';
import { join,resolve,relative,sep } from 'node:path';
const root=await realpath('.');
const out=resolve('dist/licenses');await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
await copyFile('LICENSE',join(out,'JARVIS-LICENSE.txt'));await copyFile('NOTICE',join(out,'JARVIS-NOTICE.txt'));
const [reportedRoot,...paths]=execFileSync(process.platform==='win32'?process.execPath:'npm',process.platform==='win32'?[process.env.npm_execpath || (()=>{throw Error('Run the Windows build using npm run build.');})(),'ls','--omit=dev','--all','--parseable']:['ls','--omit=dev','--all','--parseable'],{encoding:'utf8'}).trim().split('\n'),inventory=[];
for(const reported of new Set(paths)){
 // npm redacts UUIDs in parseable output, including legitimate build-directory
 // names. Recover dependency paths relative to its equally redacted root; never
 // interpret npm's rendered absolute paths as real filesystem locations.
 const suffix=relative(reportedRoot,reported);
 if(!suffix.startsWith('node_modules'+sep)||suffix.split(sep).includes('..'))throw Error('Dependency path escaped the project.');
 const directory=await realpath(resolve(root,suffix));
 if(!directory.startsWith(root+sep))throw Error('Dependency symlink escaped the project.');
 const p=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
 const destination=join(out,p.name);await mkdir(destination,{recursive:true});
 const notices=(await readdir(directory)).filter(n=>/^(licen[sc]e|copying|notice)([.-].*)?$/i.test(n));
 if(!notices.length)throw Error('Review missing runtime license notice: '+p.name);
 for(const name of notices)await copyFile(join(directory,name),join(destination,name));
 inventory.push({name:p.name,version:p.version,license:p.license||'SEE INCLUDED NOTICE'});
}
await writeFile(join(out,'dependencies.json'),JSON.stringify(inventory,null,2)+'\n');
console.log('Included source and '+inventory.length+' runtime dependency license notices.');
