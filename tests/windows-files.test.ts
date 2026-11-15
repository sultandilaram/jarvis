import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,symlink,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {windowsNoLinks} from '../src/main/desktop/windows-paths.ts';
test('Windows ancestors reject junction traversal before following the target',{skip:process.platform!=='win32'},async()=>{
 const root=await mkdtemp(join(tmpdir(),'jarvis-path-'));
 try {const target=join(root,'target');await mkdir(target);await writeFile(join(target,'data.txt'),'inert');await symlink(target,join(root,'junction'),'junction');await assert.rejects(()=>windowsNoLinks(join(root,'junction','data.txt')),/junctions/);await windowsNoLinks(join(target,'data.txt'));}
 finally{await rm(root,{recursive:true,force:true});}
});
