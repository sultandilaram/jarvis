import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ReleaseUpdater} from '../src/main/updater.ts';

test('unsupported platform never fetches or downloads a Mac update',async()=>{
 let calls=0;const updater=new ReleaseUpdater('0.8.2','unused',async()=>{calls++;throw Error('must not fetch');});updater.platformSupported=false;
 assert.equal((await updater.check()).phase,'error');assert.equal(calls,0);await assert.rejects(()=>updater.download(),/platform/);assert.equal(calls,0);
});
