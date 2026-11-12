import { lstat,symlink } from 'node:fs/promises';
import { resolve,isAbsolute,sep } from 'node:path';
const p=process.env.JARVIS_RELEASE_STATE_DIR;
if(!p||!isAbsolute(p)||resolve(p).startsWith(process.cwd()+sep))throw Error('Configure a private persistent release state directory outside the checkout.');
const info=await lstat(p);if(!info.isDirectory()||(info.mode&0o077))throw Error('Release state must be a private owner-only directory.');
await symlink(p,resolve('.jarvis'),'dir');
console.log('Attached private release state. No credentials copied into source.');
