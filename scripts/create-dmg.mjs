import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, symlink, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const app=resolve('release/JARVIS-darwin-arm64/JARVIS.app');
const hint=JSON.parse(await readFile(join(app,'Contents/Resources/app/dist/workspace.json'),'utf8'));
if (hint.workspace !== null) throw Error('DMG requires a portable app with no owner workspace');
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
const stage=await mkdtemp(join(tmpdir(),'jarvis-dmg-'));
const output=resolve('deliverables/JARVIS-macOS-AppleSilicon-test.dmg');
try {
  await mkdir('deliverables',{recursive:true});
  execFileSync('/usr/bin/ditto',[app,join(stage,'JARVIS.app')]);
  await symlink('/Applications',join(stage,'Applications'));
  await rm(output,{force:true});
  execFileSync('/usr/bin/hdiutil',['create','-volname','JARVIS','-srcfolder',stage,'-format','UDZO','-ov',output],{stdio:'inherit'});
  execFileSync('/usr/bin/hdiutil',['verify',output],{stdio:'inherit'});
  console.log('Created and verified '+output);
} finally { await rm(stage,{recursive:true,force:true}); }
