import {build} from 'esbuild';
import {spawn} from 'node:child_process';
import {rm} from 'node:fs/promises';
// Keep the fixture entry outside the packaged dist directory.
const outfile='.jarvis/desktop-fixture.cjs';
await build({entryPoints:['scripts/desktop-check.ts'],bundle:true,platform:'node',format:'cjs',outfile,external:['electron','node:sqlite'],target:'node24'});
const child=spawn('node_modules/.bin/electron',[outfile],{stdio:'inherit'});
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code??1));});
await rm(outfile,{force:true});process.exitCode=Number(code);
