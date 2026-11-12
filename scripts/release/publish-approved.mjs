import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const version=JSON.parse(await readFile('package.json','utf8')).version;
if(process.env.JARVIS_RELEASE_TAG!=='v'+version||process.env.GITHUB_REF_PROTECTED!=='true')throw Error('A protected matching release tag is required.');
const p=spawnSync(process.execPath,['scripts/release/publish.mjs'],{stdio:'inherit',env:{...process.env,JARVIS_PUBLISH_APPROVED:version}});process.exit(p.status??1);
