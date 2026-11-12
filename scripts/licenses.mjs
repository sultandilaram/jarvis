import { execFileSync } from 'node:child_process';
import { readFile,readdir,mkdir,copyFile,writeFile,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
const out=resolve('dist/licenses');await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
await copyFile('LICENSE',join(out,'JARVIS-LICENSE.txt'));await copyFile('NOTICE',join(out,'JARVIS-NOTICE.txt'));
const paths=execFileSync('npm',['ls','--omit=dev','--all','--parseable'],{encoding:'utf8'}).trim().split('\n').slice(1),inventory=[];
for(const directory of new Set(paths)){
 const p=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
 const destination=join(out,p.name);await mkdir(destination,{recursive:true});
 const notices=(await readdir(directory)).filter(n=>/^(licen[sc]e|copying|notice)([.-].*)?$/i.test(n));
 if(!notices.length)throw Error('Review missing runtime license notice: '+p.name);
 for(const name of notices)await copyFile(join(directory,name),join(destination,name));
 inventory.push({name:p.name,version:p.version,license:p.license||'SEE INCLUDED NOTICE'});
}
await writeFile(join(out,'dependencies.json'),JSON.stringify(inventory,null,2)+'\n');
console.log('Included source and '+inventory.length+' runtime dependency license notices.');
