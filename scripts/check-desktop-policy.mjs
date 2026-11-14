import {readFile} from 'node:fs/promises';
const policy=JSON.parse(await readFile('src/shared/desktop-sensitive.json','utf8'));
const swift=await readFile('native/DesktopControl.swift','utf8');
const embedded=swift.match(/^let desktopSensitivePattern = #"(.*)"#$/m)?.[1];
if(policy.schema!==1||typeof policy.pattern!=='string'||embedded!==policy.pattern)throw Error('Mac sensitive-field policy differs from shared JSON; refuse build.');
