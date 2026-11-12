import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import electron from 'electron';
await build({entryPoints:['scripts/remote-policy-check.ts'],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:'.jarvis/remote-policy-check.cjs'});
execFileSync(electron,['.jarvis/remote-policy-check.cjs'],{stdio:'inherit'});
