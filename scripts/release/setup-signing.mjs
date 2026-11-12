import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const directory=resolve('.jarvis/private/release-signing');
const key=directory+'/ed25519-private.pem';
if(existsSync(key)) {console.log('Existing release signing key retained.'); process.exit(0);}
if(existsSync('src/shared/release-config.ts')) throw Error('Pinned release trust already exists; use an explicit key rotation, never silently replace it.');
await mkdir(directory,{recursive:true,mode:0o700});
const pair=generateKeyPairSync('ed25519');
await writeFile(key,pair.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600,flag:'wx'});
const publicKey=pair.publicKey.export({type:'spki',format:'pem'}).toString();
await writeFile('src/shared/release-config.ts', '// Public verification key only. Private signing material must never enter source.\nexport const releaseRepository = "sultandilaram/jarvis";\nexport const releasePublicKey = '+JSON.stringify(publicKey)+';\nexport const releaseDataSchema = 1;\n',{flag:'wx'});
console.log('Created local release signing identity; only the public verification key is in source.');
