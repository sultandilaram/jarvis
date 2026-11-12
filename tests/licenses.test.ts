import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
test('license packaging recovers real dependency paths when npm redacts a UUID build directory',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'jarvis-license-')),root=join(parent,'0.6.1-'+randomUUID()),script=resolve('scripts/licenses.mjs');
 try{
  const dependency=join(root,'node_modules','fixture-runtime');await mkdir(dependency,{recursive:true});
  await writeFile(join(root,'package.json'),JSON.stringify({name:'fixture',version:'1.0.0',dependencies:{'fixture-runtime':'1.0.0'}}));
  await writeFile(join(root,'LICENSE'),'Fixture project license');await writeFile(join(root,'NOTICE'),'Fixture notice');
  await writeFile(join(dependency,'package.json'),JSON.stringify({name:'fixture-runtime',version:'1.0.0',license:'MIT'}));
  await writeFile(join(dependency,'LICENSE'),'Fixture dependency license');
  execFileSync(process.execPath,[script],{cwd:root,env:{...process.env,OPENSSL_CONF:'/dev/null'},stdio:'pipe'});
  const inventory=JSON.parse(await readFile(join(root,'dist/licenses/dependencies.json'),'utf8'));
  assert.deepEqual(inventory,[{name:'fixture-runtime',version:'1.0.0',license:'MIT'}]);
  assert.equal(await readFile(join(root,'dist/licenses/fixture-runtime/LICENSE'),'utf8'),'Fixture dependency license');
 }finally{await rm(parent,{recursive:true,force:true});}
});
